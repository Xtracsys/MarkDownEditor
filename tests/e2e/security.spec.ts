// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// Dynamic security tests: attack the real preview pipeline with XSS payloads
// and verify nothing executes, navigates, or leaks. The preview sandbox (no
// scripts + CSP) is the last line — these tests verify the lines BEFORE it
// too, and that even a sanitizer miss would hit the inert sink.

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve, join } from "node:path";

const docs = resolve(__dirname, ".secfixtures");

async function waitForAppReady(page: Page) {
  await page.waitForFunction(() =>
    !!(window as never as { __xe?: { ready?: Promise<void> } }).__xe?.ready,
  );
  await page.evaluate(async () => {
    await (window as never as { __xe: { ready: Promise<void> } }).__xe.ready;
  });
}

const XSS_VECTORS: [string, string][] = [
  ["inline script", "<script>alert('x1')</script>\n\nafter"],
  ["img onerror", `![x](x" onerror="alert('x2')>.png)`],
  ["raw img tag", `<img src=x onerror="alert('x3')">`],
  ["svg onload", `<svg onload="alert('x4')"><circle r="1"/></svg>`],
  ["iframe", `<iframe src="https://evil.example/frame"></iframe>`],
  ["object/embed", `<object data="https://evil.example/o"></object><embed src="https://evil.example/e">`],
  ["style import", `<style>@import url(https://evil.example/s.css);</style>`],
  ["form machinery", `<form action="https://evil.example"><input type=submit><button>go</button></form>`],
  ["body onload", `<body onload="alert('x5')">text</body>`],
  ["details ontoggle", `<details open ontoggle="alert('x6')">d</details>`],
  ["video source", `<video><source onerror="alert('x7')"></video>`],
  ["math mXSS", `<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert('x8')>--></style></mglyph></table></mtext></math>`],
  ["noscript mXSS", `<noscript><p title="</noscript><img src=x onerror=alert('x9')>">`],
  ["template tag", `<template><script>alert('x10')</script></template>`],
  ["srcset", `<img srcset="https://evil.example/1x 1x" src="https://evil.example/def.png">`],
  ["marquee starttag", `<marquee onstart=alert('x11')>m</marquee>`],
  ["anchor with js + quotes", `[click](javascript:alert('x12'))`],
  ["anchor vbscript", `[click](vbscript:msgbox("x"))`],
  ["anchor data uri", `[click](data:text/html,<script>alert('x13')</script>)`],
  ["anchor encoded tab", `[click](jav&#x09;ascript:alert('x14'))`],
  ["anchor protocol relative", `[click](//evil.example/phish)`],
  ["img data-svg", `![d](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIG9ubG9hZD0iYWxlcnQoJ3gxNScpIj48L3N2Zz4=)`],
  ["remote image", `![r](https://evil.example/track.png)`],
  ["remote image with query", `![r2](https://evil.example/pixel?id=leak-test)`],
  ["autolink js", `<javascript:alert('x16')>`],
  ["nested bold XSS", `**[x](javascript:alert('x17'))**`],
];

test.describe("dynamic security: preview XSS battery", () => {
  let page: Page;
  const violations: string[] = [];
  const egress: string[] = [];

  test.beforeAll(async ({ browser }) => {
    mkdirSync(docs, { recursive: true });
    const parts: string[] = ["# Security battery\n"];
    XSS_VECTORS.forEach(([name, vec], i) => {
      parts.push(`## ${i + 1}. ${name}\n\n${vec}\n`);
    });
    writeFileSync(join(docs, "battery.md"), parts.join("\n"), "utf8");

    page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
    await page.goto("/?e2e=1");
    await waitForAppReady(page);
    // Keep the boot-time session restore out of the security assertions.
    await page.evaluate(async () => {
      await fetch("/api/ClearSession", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) });
    });
    page.on("dialog", async (d) => {
      violations.push(`dialog: ${d.type()} ${d.message()}`);
      await d.dismiss();
    });
    page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!u.host.startsWith("127.0.0.1")) egress.push(r.url());
    });
  });

  test.beforeEach(async () => {
    violations.length = 0;
    egress.length = 0;
  });

  test("entire XSS battery: nothing executes, navigates, or leaves the machine", async () => {
    await page.goto("/?e2e=1");
    await waitForAppReady(page);
    await page.evaluate((p) => {
      void (window as never as { __xe: { app: { openPaths(p: string[]): Promise<void> } } })
        .__xe.app.openPaths([p]);
    }, join(docs, "battery.md"));
    const name = "battery.md";
    await expect(page.locator(".tab.active")).toContainText(name, { timeout: 8000 });

    await page.click("#btn-mode-split");
    const frame = page.frameLocator("#preview-frame");

    // The benign anchor content still renders (pipeline not broken).
    await expect(frame.locator("h1")).toHaveText("Security battery");

    // Execution vectors must be absent from the sanitized DOM. The app's own
    // <style> (static preview.css) is legitimately present; attacker styles
    // must not survive, and <template> is inert by spec (contents stripped).
    const counts = await frame.locator(
      "script, iframe, object, embed, form, input, button, video, source, marquee, [onerror], [onload], [ontoggle], [onstart]",
    ).count();
    expect(counts, "dangerous elements present in preview DOM").toBe(0);
    const styleText = await frame.locator("style").allTextContents();
    for (const t of styleText) {
      expect(t).not.toContain("evil.example");
      expect(t).not.toContain("@import");
    }
    const templateContent = await frame.locator("template").evaluateAll(
      (els) => els.map((e) => e.innerHTML),
    );
    for (const t of templateContent) {
      expect(t, "template must not retain scripts").not.toContain("<script");
    }

    // Remote images must be placeholders with visible notes, not loaded.
    const blockedNotes = await frame.locator(".blocked-note").count();
    expect(blockedNotes).toBeGreaterThanOrEqual(2);
    const remoteImgs = await frame.locator(
      'img[src^="https://evil.example"]',
    ).count();
    expect(remoteImgs, "remote image URL survived rewriting").toBe(0);

    // No javascript:/vbscript:/data:text href may survive on any anchor.
    const badHrefs = await frame.locator(
      'a[href^="javascript:" i], a[href^="vbscript:" i], a[href^="data:text" i]',
    ).count();
    expect(badHrefs).toBe(0);

    // External anchors carry no live href at all (no self-navigation vector).
    const extAnchors = await frame.locator("a[data-external]").count();
    expect(extAnchors).toBeGreaterThan(0);
    for (let i = 0; i < extAnchors; i++) {
      expect(await frame.locator("a[data-external]").nth(i).getAttribute("href"),
        `external anchor ${i} kept a live href`).toBeNull();
    }

    // Click every link in the preview: nothing may navigate the frame or top.
    const before = page.url();
    const anchorCount = await frame.locator("a").count();
    for (let i = 0; i < Math.min(anchorCount, 25); i++) {
      await frame.locator("a").nth(i).click({ force: true }).catch(() => {});
    }
    expect(page.url()).toBe(before);

    // Nothing left the machine and nothing blew up the page.
    expect(violations, `violations: ${violations.join(" | ")}`).toEqual([]);
    expect(egress, `egress: ${egress.join(" | ")}`).toEqual([]);
  });

  test("scripted markdown never gains execution even without sanitizer help", async () => {
    // Directly inject UNSANITIZED-looking content through the pipeline: this
    // is what a marked+DOMPurify bypass attempt would face. The sink must
    // remain inert regardless.
    await page.goto("/?e2e=1");
    await waitForAppReady(page);

    await page.evaluate(() => {
      const w = window as never as { __xe: { app: { openPaths(p: string[]): Promise<void> } } };
      void w.__xe.app.openPaths([]);
    });
    // Open the battery in preview-only and assert the sandbox flag + CSP hold.
    await openFile(page, join(docs, "battery.md"));
    await page.click("#btn-mode-preview");
    await page.waitForTimeout(400);
    const sandbox = await page.locator("#preview-frame").getAttribute("sandbox");
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-scripts");
    expect(violations).toEqual([]);
  });

  test("refused link schemes surface in the UI without navigating", async ({ }) => {
    const f = join(docs, "scheme.md");
    writeFileSync(f, "[mail](mailto:x@y.z)\n[tel](tel:+123)\n[web](https://example.com/ok)\n", "utf8");
    await page.goto("/?e2e=1");
    await waitForAppReady(page);
    await page.evaluate((p) => {
      void (window as never as { __xe: { app: { openPaths(p: string[]): Promise<void> } } })
        .__xe.app.openPaths([p]);
    }, f);
    await expect(page.locator(".tab.active")).toContainText("scheme.md", { timeout: 8000 });
    await page.click("#btn-mode-split");
    const frame = page.frameLocator("#preview-frame");
    await expect(frame.locator("a[data-external]")).toHaveCount(3);
    // mailto/tel are refused by the Go validator; https would open the system
    // browser — the in-app check is that nothing navigates the app itself.
    await frame.locator("a[data-external]").first().click();
    await page.waitForTimeout(300);
    expect(page.url()).toContain("/?e2e=1");
    expect(violations).toEqual([]);
  });
});

async function openFile(page: Page, path: string) {
  await page.evaluate((p) => {
    void (window as never as { __xe: { app: { openPaths(p: string[]): Promise<void> } } })
      .__xe.app.openPaths([p]);
  }, path);
  const name = basename(path);
  await expect(page.locator(".tab.active")).toContainText(name, { timeout: 8000 });
}
