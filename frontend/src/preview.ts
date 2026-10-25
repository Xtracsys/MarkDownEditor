// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// The preview pane: a sandboxed iframe whose srcdoc is rebuilt from the
// sanitized markdown. Scripts cannot run inside the frame (no allow-scripts);
// the parent reaches in through the same-origin document to route link clicks
// because allow-same-origin keeps the frame's document accessible.

import previewCss from "./styles/preview.css?raw";
import { renderMarkdown } from "./markdown";

export interface PreviewCallbacks {
  openExternal(url: string): void;
  remoteBlocked(urls: string[]): void;
}

export class PreviewPane {
  private iframe: HTMLIFrameElement;
  private lastBody = "";
  private lastTheme = "light";
  private blockRemote = true;
  private syncing = false;
  private cb: PreviewCallbacks;

  constructor(host: HTMLElement, cb: PreviewCallbacks) {
    this.cb = cb;
    this.iframe = document.createElement("iframe");
    this.iframe.id = "preview-frame";
    this.iframe.setAttribute("title", "Markdown preview");
    this.iframe.setAttribute("sandbox", "allow-same-origin");
    this.iframe.setAttribute("referrerpolicy", "no-referrer");
    host.appendChild(this.iframe);
  }

  setBlockRemote(block: boolean) {
    this.blockRemote = block;
  }

  update(source: string, tabId: string, theme: "light" | "dark") {
    const { html, remoteBlocked } = renderMarkdown(source, {
      tabId,
      blockRemote: this.blockRemote,
    });
    if (remoteBlocked.length) this.cb.remoteBlocked(remoteBlocked);
    if (html === this.lastBody && theme === this.lastTheme) return;
    this.lastBody = html;
    this.lastTheme = theme;

    // When the user explicitly allows remote resources, the CSP admits
    // remote images; by default it stays local-only and fails closed.
    const imgSrc = this.blockRemote ? "img-src 'self' data:" : "img-src 'self' data: http: https:";
    const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imgSrc}; style-src 'unsafe-inline'">
<style>${previewCss}</style></head>
<body class="theme-${theme}">${html}</body></html>`;
    this.iframe.srcdoc = doc;
    this.wireLinks();
  }

  /** Attach click routing once the new srcdoc has parsed. */
  private wireLinks() {
    const route = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const a = target.closest ? (target.closest("a") as HTMLAnchorElement | null) : null;
      if (!a) return;
      e.preventDefault();
      const external = a.getAttribute("data-external");
      if (external) {
        this.cb.openExternal(external);
        return;
      }
      const anchor = a.getAttribute("data-anchor");
      if (anchor) {
        const doc = this.iframe.contentDocument;
        const el = doc ? doc.getElementById(anchor) : null;
        if (el && doc && doc.defaultView) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      // Internal file links: deliberately inert in the preview.
    };
    const attach = () => {
      const doc = this.iframe.contentDocument;
      if (!doc || !doc.body) {
        // srcdoc parses async; retry on the next tick a few times.
        requestAnimationFrame(attach);
        return;
      }
      if (doc.documentElement.dataset.wired === "1") return; // L3: once per document
      doc.documentElement.dataset.wired = "1";
      doc.addEventListener("click", route);
      doc.addEventListener("auxclick", (e: Event) => e.preventDefault());
    };
    requestAnimationFrame(attach);
  }

  /** Proportional scroll sync from the editor (editor → preview). */
  syncFromEditor(scrollTop: number, scrollHeight: number, clientHeight: number) {
    if (this.syncing) return;
    const doc = this.iframe.contentDocument;
    if (!doc || !doc.documentElement) return;
    const range = scrollHeight - clientHeight;
    if (range <= 0) return;
    const frac = Math.min(1, Math.max(0, scrollTop / range));
    const win = doc.defaultView;
    if (win) {
      this.syncing = true;
      win.scrollTo(0, frac * (doc.documentElement.scrollHeight - win.innerHeight));
      requestAnimationFrame(() => (this.syncing = false));
    }
  }

  reset() {
    this.lastBody = "";
    this.iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${previewCss}</style></head><body class="theme-${this.lastTheme}"></body></html>`;
  }
}
