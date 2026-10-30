// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

import { describe, expect, it } from "vitest";
import { renderMarkdown, isRemoteUrl, localImageUrl } from "./markdown";

const opts = { tabId: "t1", blockRemote: true };

describe("markdown render pipeline", () => {
  it("renders the common feature set", () => {
    const src = [
      "# Title",
      "",
      "**bold** and *italic* and `code`",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "",
      "> quoted",
      "",
      "[link](https://example.com)",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "- [x] done",
      "- [ ] todo",
      "",
      "```js",
      "const x = 1;",
      "```",
    ].join("\n");
    const { html } = renderMarkdown(src, opts);
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("data-external");
    expect(html).toContain("<table>");
    expect(html).toContain("task-cb");
    expect(html).toContain('class="task-cb on"');
    expect(html).toContain("hljs");
    expect(html).not.toContain("<input");
  });

  it("strips scripts, event handlers, and dangerous elements", () => {
    const evil = [
      "<script>alert(1)</script>",
      '<img src="x.png" onerror="alert(2)">',
      "<iframe src=\"https://evil.example\"></iframe>",
      '<a href="javascript:alert(3)">click</a>',
      "<style>body{background:url(https://evil.example)}</style>",
    ].join("\n");
    const { html } = renderMarkdown(evil, opts);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<style");
  });

  it("blocks remote images by default with a visible placeholder", () => {
    const { html, remoteBlocked } = renderMarkdown(
      "![r](https://cdn.example.com/x.png)",
      opts,
    );
    expect(remoteBlocked).toEqual(["https://cdn.example.com/x.png"]);
    expect(html).not.toContain('src="https://cdn.example.com');
    expect(html).toContain("Blocked remote image");
  });

  it("rewrites local images through the sandboxed handler", () => {
    const { html } = renderMarkdown("![l](assets/pic.png)", opts);
    expect(html).toContain('src="/ximg/t1/assets/pic.png"');
    expect(html).not.toContain("..");
  });

  it("marks internal and anchor links", () => {
    const { html } = renderMarkdown("[a](other.md) [b](#section)", opts);
    expect(html).toContain('data-internal="other.md"');
    expect(html).toContain('data-anchor="section"');
  });

  it("keeps data-URI images (used for the blocked placeholder)", () => {
    const { html } = renderMarkdown("![d](data:image/png;base64,AAAA)", opts);
    expect(html).toContain("data:image/png");
  });

  it("protocol-relative and scheme URLs are remote", () => {
    expect(isRemoteUrl("https://x")).toBe(true);
    expect(isRemoteUrl("//cdn.example.com/x.png")).toBe(true);
    expect(isRemoteUrl("file:///etc/passwd")).toBe(true);
    expect(isRemoteUrl("assets/x.png")).toBe(false);
    expect(isRemoteUrl("./x.png")).toBe(false);
  });

  it("localImageUrl encodes segments and rejects empty/remote", () => {
    expect(localImageUrl("t1", "a/b c.png")).toBe("/ximg/t1/a/b%20c.png");
    expect(localImageUrl("t1", "https://x/y.png")).toBeNull();
    expect(localImageUrl("", "a.png")).toBeNull();
    expect(localImageUrl("t1", "")).toBeNull();
  });
});
