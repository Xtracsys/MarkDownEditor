// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// Markdown → sanitized preview HTML.
//
// Defense in depth, outside-in:
//   1. marked renders CommonMark+GFM (tables, task lists, strikethrough).
//   2. DOMPurify strips scripts, event handlers, and exotic elements.
//   3. Every URL is rewritten: local images go through the Go-served sandbox
//      (/ximg/<tabId>/…), remote images are blocked by default with a visible
//      placeholder, and links get data- markers for click routing.
//   4. The result is injected into a sandboxed iframe (no scripts, CSP
//      default-src 'none') — see preview.ts. Even a renderer or sanitizer bug
//      has nothing to execute and nowhere to phone home.

import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";

// GFM task-list checkboxes arrive as <input type="checkbox">. Inputs are
// forbidden in the preview, so this hook converts them to styled spans with
// a data-checked attribute — visual checkboxes without any form machinery.
DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName === "input") {
    const el = node as HTMLInputElement;
    if (el.getAttribute("type") === "checkbox") {
      const doc = node.ownerDocument;
      if (doc) {
        const span = doc.createElement("span");
        span.className = el.hasAttribute("checked") ? "task-cb on" : "task-cb";
        const li = el.closest ? (el.closest("li") as HTMLLIElement | null) : null;
        if (li) {
          li.classList.add("task");
          if (el.hasAttribute("checked")) li.classList.add("task-done");
        }
        (node as ChildNode).replaceWith(span);
      }
    }
  }
});

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang || "").trim().split(/\s+/)[0];
      let body: string;
      if (language && hljs.getLanguage(language)) {
        try {
          body = hljs.highlight(text, { language, ignoreIllegals: true }).value;
        } catch {
          body = escapeHtml(text);
        }
      } else {
        body = escapeHtml(text);
      }
      const cls = language ? ` class="hljs language-${escapeAttr(language)}"` : ' class="hljs"';
      return `<pre><code${cls}>${body}</code></pre>`;
    },
  },
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

export interface RenderOptions {
  tabId: string;
  /** Whether remote http(s) resources are blocked (default true). */
  blockRemote: boolean;
}

export interface RenderResult {
  html: string; // body content for the iframe srcdoc
  remoteBlocked: string[]; // URLs that were blocked (for the status hint)
}

const BLOCKED_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="44">` +
      `<rect width="100%" height="100%" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.4"/>` +
      `<text x="50%" y="27" font-family="system-ui,sans-serif" font-size="11" fill="currentColor" text-anchor="middle" fill-opacity="0.75">remote image blocked</text></svg>`,
  );

export function renderMarkdown(src: string, opts: RenderOptions): RenderResult {
  const raw = marked.parse(src) as string;
  const clean = DOMPurify.sanitize(raw, {
    FORBID_TAGS: [
      "script", "style", "iframe", "object", "embed", "form", "input",
      "button", "select", "textarea", "link", "meta", "base", "video",
      "audio", "source", "track", "frame", "frameset", "details", "dialog",
    ],
    FORBID_ATTR: ["style", "srcset", "formaction", "background", "poster", "ping"],
    ALLOW_DATA_ATTR: false,
  });

  const doc = new DOMParser().parseFromString(`<div id="r">${clean}</div>`, "text/html");
  const root = doc.getElementById("r")!;
  const remoteBlocked: string[] = [];

  // Images: local relative → sandboxed handler; remote → blocked placeholder.
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const originalSrc = img.getAttribute("src") || "";
    const title = img.getAttribute("title") || "";
    const alt = img.getAttribute("alt") || "";
    if (isRemoteUrl(originalSrc)) {
      remoteBlocked.push(originalSrc);
      if (opts.blockRemote) {
        img.setAttribute("src", BLOCKED_IMAGE);
        img.setAttribute("data-blocked-remote", originalSrc);
        if (!alt) img.setAttribute("alt", "remote image (blocked)");
        const note = doc.createElement("div");
        note.className = "blocked-note";
        note.textContent = opts.blockRemote
          ? `Blocked remote image: ${originalSrc}`
          : originalSrc;
        img.replaceWith(note);
        continue;
      }
      // Remote allowed by explicit setting: still never autoplay/track.
      img.setAttribute("loading", "lazy");
      img.setAttribute("referrerpolicy", "no-referrer");
      continue;
    }
    if (originalSrc.startsWith("data:")) {
      continue; // data URIs pass through (CSP allows data: images)
    }
    // Local path: route through the Go sandbox.
    const resolved = localImageUrl(opts.tabId, originalSrc);
    if (resolved === null) {
      const note = doc.createElement("div");
      note.className = "blocked-note";
      note.textContent = `Image not loaded (save the document first so relative paths can resolve): ${originalSrc}`;
      img.replaceWith(note);
      continue;
    }
    img.setAttribute("src", resolved);
    if (title) img.setAttribute("title", title);
    img.setAttribute("alt", alt || basename(originalSrc));
  }

  // Links: mark external vs internal; the parent intercepts clicks. External
  // anchors lose their live href entirely (L1): middle-click/Enter cannot
  // self-navigate the sandboxed frame to remote content — routing happens
  // only through the data attribute the parent controls.
  for (const a of Array.from(root.querySelectorAll("a"))) {
    const href = a.getAttribute("href") || "";
    if (isRemoteUrl(href)) {
      a.setAttribute("data-external", href);
      a.setAttribute("rel", "noreferrer noopener");
      a.setAttribute("role", "link");
      a.removeAttribute("href");
    } else if (href.startsWith("#")) {
      a.setAttribute("data-anchor", href.slice(1));
    } else {
      a.setAttribute("data-internal", href);
    }
  }

  return { html: root.innerHTML, remoteBlocked };
}

export function isRemoteUrl(url: string): boolean {
  const u = url.trim();
  return (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u) || // any scheme (http, https, file, …)
    u.startsWith("//") // protocol-relative
  );
}

/** Map a markdown-relative image path to the sandboxed /ximg URL. */
export function localImageUrl(tabId: string, src: string): string | null {
  if (!tabId || !src) return null;
  const cleaned = src.split("?")[0].split("#")[0].trim();
  if (cleaned === "") return null;
  if (isRemoteUrl(cleaned) || cleaned.startsWith("data:")) return null;
  const rel = cleaned
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== "." && s !== "..")
    .map((s) => encodeURIComponent(s))
    .join("/");
  if (!rel) return null;
  return `/ximg/${encodeURIComponent(tabId)}/${rel}`;
}

function basename(p: string): string {
  const c = p.replace(/\\/g, "/").split("?")[0];
  const parts = c.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}
