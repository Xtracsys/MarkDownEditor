// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// End-to-end acceptance tests. They drive the real editor UI (the same
// frontend bundle the desktop app embeds) against the real Go backend through
// the e2e-serve bridge — including real files on disk and real byte checks.
// Native file dialogs are the one surface the bridge cannot show; those flows
// are covered by the manual checklist (docs/PLATFORM-STATUS.md).

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const docs = resolve(__dirname, ".fixtures");

test.beforeAll(() => {
  rmSync(docs, { recursive: true, force: true });
  mkdirSync(join(docs, "assets"), { recursive: true });
  writeFileSync(join(docs, "demo.md"), [
    "# Demo",
    "",
    "A **local-first** editor.",
    "",
    "- [x] done",
    "- [ ] todo",
    "",
    "```go",
    "func main() {}",
    "```",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "![remote](https://cdn.example.com/x.png)",
    "",
  ].join("\n"), "utf8");
  // 1x1 PNG for the local-image test.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  writeFileSync(join(docs, "assets", "tiny.png"), png);
  writeFileSync(join(docs, "notes.md"), "line one\nline two\n", "utf8");
  writeFileSync(join(docs, "crlf.txt"), "alpha\r\nbeta\r\n", "utf8");
  writeFileSync(join(docs, ".dotfile"), "dotfile content\n", "utf8");
  writeFileSync(join(docs, "extensionless"), "#!/bin/sh\necho hi\n", "utf8");
  writeFileSync(join(docs, "data.weirdext"), "strange but text\n", "utf8");
  writeFileSync(join(docs, "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])); // caf\xe9
  writeFileSync(join(docs, "binary.dat"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01]));
  writeFileSync(join(docs, "mixed.md"), "a\r\nb\nc\rd", "utf8");
});

async function openApp(page: Page) {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!(window as never as { __xe?: unknown }).__xe);
}

async function openFile(page: Page, path: string, opts: { waitForTab?: boolean } = {}) {
  // Fire-and-forget: flows that raise modals must not be awaited here, or
  // the caller could never click the modal. Callers that type into the
  // document wait for the tab to become active (default) — typing before
  // that lands in the previous tab.
  await page.evaluate((p) => {
    void (window as never as { __xe: { app: { openPaths(p: string[]): Promise<void> } } }).__xe.app.openPaths([p]);
  }, path);
  if (opts.waitForTab !== false) {
    const name = path.split("/").pop() || path;
    await expect(page.locator(".tab.active")).toContainText(name, { timeout: 8000 });
  }
}

async function resetSettings(page: Page) {
  await page.evaluate(async () => {
    const w = window as never as { __xe: { app: { getSettings(): Promise<Record<string, unknown>>; updateSettings(s: Record<string, unknown>): void } } };
    const s = await w.__xe.app.getSettings();
    await w.__xe.app.updateSettings({ ...s, autoSaveEnabled: false, autoSaveDelayMs: 500, blockRemoteResources: true });
  });
}

const bytes = (p: string) => readFileSync(p).toString("latin1");

// --------------------------------------------------------------------

test("fresh installation has auto-save disabled", async ({ page }) => {
  await openApp(page);
  const s = await page.evaluate(() =>
    (window as never as { __xe: { app: { getSettings(): Promise<{ autoSaveEnabled: boolean; blockRemoteResources: boolean }> } } }).__xe.app.getSettings(),
  );
  expect(s.autoSaveEnabled).toBe(false);
  expect(s.blockRemoteResources).toBe(true);
});

test("with auto-save off, unsaved edits never touch the file", async ({ page }) => {
  const file = join(docs, "notes.md");
  const before = bytes(file);
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await page.locator(".cm-content").click();
  await page.keyboard.type("EDITED ");
  // Wait well past any plausible auto-save delay.
  await page.waitForTimeout(2500);
  expect(bytes(file)).toBe(before);
});

test("enabling auto-save saves after idle; disabling stops writes", async ({ page }) => {
  const file = join(docs, "autosave.md");
  writeFileSync(file, "start\n", "utf8");
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await page.locator(".cm-content").click();

  // Enable auto-save through the app's real settings path.
  await page.evaluate(async () => {
    const w = window as never as { __xe: { app: { getSettings(): Promise<Record<string, unknown>>; updateSettings(s: Record<string, unknown>): void } } };
    const s = await w.__xe.app.getSettings();
    await w.__xe.app.updateSettings({ ...s, autoSaveEnabled: true, autoSaveDelayMs: 600 });
  });
  await page.keyboard.press("End");
  await page.keyboard.type("added by autosave");
  await expect
    .poll(() => bytes(file), { timeout: 8000 })
    .toBe("start\nadded by autosave");

  // Disable: further typing must not write.
  await page.evaluate(async () => {
    const w = window as never as { __xe: { app: { getSettings(): Promise<Record<string, unknown>>; updateSettings(s: Record<string, unknown>): void } } };
    const s = await w.__xe.app.getSettings();
    await w.__xe.app.updateSettings({ ...s, autoSaveEnabled: false });
  });
  const after = bytes(file);
  await page.keyboard.type(" NEVER SAVED");
  await page.waitForTimeout(2500);
  expect(bytes(file)).toBe(after);
});

test("byte fidelity: CRLF, BOM-less UTF-8, no final newline preserved through real edits", async ({ page }) => {
  const file = join(docs, "fidelity.txt");
  writeFileSync(file, "one\r\ntwo", "utf8"); // CRLF, no final newline
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await expect(page.locator("#status-eol")).toHaveText("CRLF");

  // Append a word at the very end via the editor.
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" three");
  await page.evaluate(() =>
    (window as never as { __xe: { app: { saveActive(): Promise<boolean> } } }).__xe.app.saveActive(),
  );
  await page.waitForTimeout(400);
  // CRLF preserved, still no final newline, nothing appended or re-encoded.
  expect(bytes(file)).toBe("one\r\ntwo three");
});

test("mixed line endings survive an open/edit/save cycle untouched", async ({ page }) => {
  const file = join(docs, "mixed.md");
  const before = bytes(file); // a\r\nb\nc\rd
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("End");
  await page.keyboard.type("A"); // edit line 1 in place
  await page.evaluate(() =>
    (window as never as { __xe: { app: { saveActive(): Promise<boolean> } } }).__xe.app.saveActive(),
  );
  await page.waitForTimeout(400);
  expect(bytes(file)).toBe("aA\r\nb\nc\rd");
  void before;
});

test("markdown source, split, and preview modes all work", async ({ page }) => {
  await openApp(page);
  await resetSettings(page);
  await openFile(page, join(docs, "demo.md"));

  // Source: editor visible, no preview.
  await expect(page.locator("#editor-host")).toBeVisible();
  await expect(page.locator("#preview-host")).toBeHidden();

  // Split: both visible, preview renders markdown (sandboxed iframe).
  await page.click("#btn-mode-split");
  await expect(page.locator("#preview-host")).toBeVisible();
  const frame = page.frameLocator("#preview-frame");
  await expect(frame.locator("h1")).toHaveText("Demo");
  await expect(frame.locator("li.task .task-cb.on")).toHaveCount(1);
  await expect(frame.locator("table")).toHaveCount(1);
  await expect(frame.locator("pre code.hljs")).toHaveCount(1);

  // Remote image blocked with a visible note.
  await expect(frame.locator(".blocked-note")).toContainText("cdn.example.com");

  // Preview-only: source hidden.
  await page.click("#btn-mode-preview");
  await expect(page.locator("#editor-host")).toBeHidden();
  await expect(frame.locator("h1")).toBeVisible();

  // Back to source.
  await page.click("#btn-mode-source");
  await expect(page.locator(".cm-content")).toBeVisible();
});

test("preview rendering and theme switching never alter document bytes", async ({ page }) => {
  const file = join(docs, "demo.md");
  const before = bytes(file);
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await page.click("#btn-mode-split");
  await page.waitForTimeout(500);
  await page.click("#btn-theme"); // dark
  await page.waitForTimeout(500);
  await page.click("#btn-theme"); // light
  await page.click("#btn-mode-preview");
  await page.waitForTimeout(500);
  expect(bytes(file)).toBe(before);
});

test("local image resolves relative to the document and loads", async ({ page }) => {
  const file = join(docs, "img.md");
  writeFileSync(file, "![tiny](assets/tiny.png)\n", "utf8");
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await page.click("#btn-mode-split");
  const frame = page.frameLocator("#preview-frame");
  const img = frame.locator("img");
  await expect(img).toHaveCount(1);
  // The image actually loaded (natural size 1x1, not broken).
  await expect
    .poll(async () => frame.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth),
      { timeout: 5000 })
    .toBe(1);
});

test("dotfiles, extensionless, and unknown extensions open and save", async ({ page }) => {
  await openApp(page);
  await resetSettings(page);

  const cases: [string, string][] = [
    [".dotfile", "dotfile content\n"],
    ["extensionless", "#!/bin/sh\necho hi\n"],
    ["data.weirdext", "strange but text\n"],
  ];
  for (const [name, before] of cases) {
    const file = join(docs, name);
    expect(bytes(file)).toBe(before);
    const after = before.replace("\n", " EDIT\n");
    await openFile(page, file);
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("End");
    await page.keyboard.type(" EDIT");
    await page.evaluate(() =>
      void (window as never as { __xe: { app: { saveActive(): Promise<boolean> } } }).__xe.app.saveActive(),
    );
    await page.waitForTimeout(300);
    expect(bytes(file)).toBe(after);
    // Close the tab to keep a clean slate for the next case.
    await page.evaluate(() =>
      (window as never as { __xe: { app: { closeActiveTab(): Promise<void> } } }).__xe.app.closeActiveTab(),
    );
    await page.waitForTimeout(200);
  }
});

test("binary files are refused with an explanation", async ({ page }) => {
  await openApp(page);
  await openFile(page, join(docs, "binary.dat"), { waitForTab: false });
  const dialog = page.locator(".modal");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("binary");
  await expect(dialog).toContainText("NUL");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toBeHidden();
});

test("unsupported encodings are explained and open read-only only by choice", async ({ page }) => {
  await openApp(page);
  await openFile(page, join(docs, "latin1.txt"), { waitForTab: false });
  const dialog = page.locator(".modal");
  await expect(dialog).toContainText("not valid UTF-8");
  // Read-only is the explicit user choice, never silent.
  await dialog.getByRole("button", { name: "Open Read-Only" }).click();
  await expect(page.locator(".tab.readonly")).toHaveCount(1);
  await expect(page.locator("#status-encoding")).toContainText("read-only");
});

test("external changes are detected and never silently overwritten", async ({ page }) => {
  const file = join(docs, "external.md");
  writeFileSync(file, "original\n", "utf8");
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);

  // Someone else writes the file behind the editor's back.
  writeFileSync(file, "external edit\n", "utf8");
  await expect(page.locator(".banner")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".banner")).toContainText("changed on disk");

  // Keep mine, then save → the external-change decision appears.
  await page.getByRole("button", { name: "Keep Mine" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("mine ");
  await page.evaluate(() =>
    void (window as never as { __xe: { app: { saveActive(): Promise<boolean> } } }).__xe.app.saveActive(),
  );
  const decision = page.locator(".modal");
  await expect(decision).toContainText("changed on disk");
  await decision.getByRole("button", { name: "Overwrite" }).click();
  await expect
    .poll(() => bytes(file), { timeout: 5000 })
    .toBe("mine original\n");
});

test("closing a dirty tab warns and offers save/discard/cancel", async ({ page }) => {
  const file = join(docs, "close-prompt.md");
  writeFileSync(file, "body\n", "utf8");
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("typed ");

  await page.evaluate(() =>
    void (window as never as { __xe: { app: { closeActiveTab(): Promise<void> } } }).__xe.app.closeActiveTab(),
  );
  const dialog = page.locator(".modal");
  await expect(dialog).toContainText("Unsaved changes");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(300);
  expect(bytes(file)).toBe("typed body\n");
});

test("no network requests leave the app during normal editing", async ({ page }) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.host !== "127.0.0.1:34120") seen.push(r.url());
  });
  await openApp(page);
  await resetSettings(page);
  await openFile(page, join(docs, "demo.md")); // contains a remote image
  await page.locator(".cm-content").click();
  await page.keyboard.type("offline ");
  await page.click("#btn-mode-split");
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    (window as never as { __xe: { app: { saveActive(): Promise<boolean> } } }).__xe.app.saveActive(),
  );
  await page.waitForTimeout(600);
  expect(seen).toEqual([]);
});

test("quit guard: unsaved work blocks quit until resolved", async ({ page }) => {
  const file = join(docs, "quit-guard.md");
  writeFileSync(file, "q\n", "utf8");
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await page.locator(".cm-content").click();
  await page.keyboard.type("dirty ");

  await page.evaluate(async () => {
    await fetch("/api/_EmitQuitRequest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: [] }),
    });
  });
  const dialog = page.locator(".modal");
  await expect(dialog).toContainText("unsaved");
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toBeHidden();
  // The file was never written.
  expect(bytes(file)).toBe("q\n");
});

test("crash recovery restores unsaved work after an abrupt restart", async ({ page }) => {
  const file = join(docs, "crashy.md");
  writeFileSync(file, "stable content\n", "utf8");
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("PRECIOUS ");
  // Let the debounced snapshot land (4s) — then "crash" (reload, no clean close).
  await page.waitForTimeout(6000);
  expect(bytes(file)).toBe("stable content\n"); // nothing written to the file

  await page.reload();
  await page.waitForFunction(() => !!(window as never as { __xe?: unknown }).__xe);
  const modal = page.locator(".modal");
  await expect(modal).toBeVisible({ timeout: 8000 });
  await expect(modal).toContainText("Recover unsaved work");
  await expect(modal).toContainText("crashy.md");
  await modal.getByRole("button", { name: "Recover All" }).click();

  // The recovered tab holds the unsaved content and is marked dirty.
  await expect
    .poll(async () => page.locator(".cm-content").textContent(), { timeout: 8000 })
    .toContain("PRECIOUS stable content");
  await expect(page.locator(".tab.dirty")).toHaveCount(1);
  // And the snapshot is consumed: a second reload offers nothing.
  await page.reload();
  await page.waitForFunction(() => !!(window as never as { __xe?: unknown }).__xe);
  await page.waitForTimeout(1500);
  await expect(page.locator(".modal")).toHaveCount(0);
});


test("documents opened with the app externally arrive in the editor", async ({ page }) => {
  const file = join(docs, "opened-with.md");
  writeFileSync(file, "# opened externally\n", "utf8");
  await openApp(page);
  await resetSettings(page);

  // Simulate what macOS "Open With"/Dock-drop does: the Go layer queues the
  // path; after the UI signals readiness it is delivered as open:paths.
  await page.evaluate(async (p) => {
    await fetch("/api/QueueExternalOpen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: [[p]] }),
    });
  }, file);
  const name = file.split("/").pop() || file;
  await expect(page.locator(".tab.active")).toContainText(name, { timeout: 8000 });
  await expect(page.locator(".cm-content")).toContainText("opened externally");

  // Queue before UI-ready flushes on startup (argv/Open-With during launch).
  await page.reload();
  await page.waitForTimeout(300); // let the fresh app boot to its Untitled tab
  await page.evaluate(async (p) => {
    await fetch("/api/QueueExternalOpen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: [[p]] }),
    });
    // The app already marked itself ready in start(); queued paths flush live.
  }, file);
  await expect(page.locator(".tab.active")).toContainText(name, { timeout: 8000 });
});


test("startup never shows the fatal backend error", async ({ page }) => {
  await openApp(page);
  // The fatal-error surface must stay hidden and a working editor visible.
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 8000 });
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("could not reach its backend");
});

// ------------------------------------------------------------------
// Session restore, convert commands, recent files, outline, image paste

test("session restore reopens the last session's documents", async ({ page }) => {
  const file = join(docs, "session.md");
  writeFileSync(file, "# session content\n", "utf8");
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  // Simulate a graceful quit's session snapshot.
  await page.evaluate(async () => {
    await fetch("/api/SaveSessionNow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) });
    // Clear stale recovery snapshots from earlier tests so the offer modal
    // does not race this assertion.
    const list = await (await fetch("/api/ListRecovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) })).json();
    const ids = (list.result || []).map((e: { id: string }) => e.id);
    if (ids.length) {
      await fetch("/api/DiscardRecovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [ids] }) });
    }
  });
  await page.reload();
  await page.waitForFunction(() => !!(window as never as { __xe?: unknown }).__xe);
  await page.waitForTimeout(1500); // startup: recovery check + session restore
  // The shared bridge home may hold a longer session from earlier tests —
  // the contract is that session.md is among the restored tabs.
  const name = file.split("/").pop() || file;
  await expect(page.locator(".tab", { hasText: name }).first()).toBeVisible({ timeout: 8000 });
});

test("restore-session setting controls whether the session reopens", async ({ page }) => {
  const file = join(docs, "session-off.md");
  writeFileSync(file, "# off\n", "utf8");
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await page.evaluate(async () => {
    await fetch("/api/SaveSessionNow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) });
    const list = await (await fetch("/api/ListRecovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) })).json();
    const ids = (list.result || []).map((e: { id: string }) => e.id);
    if (ids.length) {
      await fetch("/api/DiscardRecovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [ids] }) });
    }
  });
  await page.evaluate(async () => {
    const w = window as never as { __xe: { app: { getSettings(): Promise<Record<string, unknown>>; updateSettings(s: Record<string, unknown>): Promise<void> } } };
    const s = await w.__xe.app.getSettings();
    await w.__xe.app.updateSettings({ ...s, restoreSession: false });
  });
  // The reload must not race the settings write: poll until the BACKEND
  // reports restoreSession=false, then boot is deterministic.
  await expect
    .poll(async () => {
      const r = await page.evaluate(async () => {
        const r = await fetch("/api/GetSettings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) });
        return (await r.json()).result?.restoreSession;
      });
      return r;
    }, { timeout: 8000 })
    .toBe(false);
  await page.reload();
  await page.waitForFunction(() => !!(window as never as { __xe?: unknown }).__xe);
  await page.waitForTimeout(1200);
  const name = file.split("/").pop() || file;
  try {
    await expect(page.locator(".tab.active")).toContainText("Untitled", { timeout: 8000 });
  } catch (e) {
    const dump = await page.evaluate(async () => {
      const st = await window.__xe.app.getSettings();
      return {
        restore: st.restoreSession,
        tabs: [...document.querySelectorAll(".tab")].map((t) => t.textContent),
        modal: !!document.querySelector(".modal"),
        url: location.href,
      };
    });
    console.log("RESTORE-OFF FAILURE DUMP:", JSON.stringify(dump));
    throw e;
  }
  await expect(page.locator(".tab.active")).not.toContainText(name);
});

test("normalize line endings converts mixed endings to the predominant style on save", async ({ page }) => {
  const file = join(docs, "normalize.md");
  writeFileSync(file, "a\r\nb\nc", "utf8"); // mixed: CRLF then LF, no final newline
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await expect(page.locator("#status-eol")).toHaveText("Mixed EOL");
  await page.evaluate(() =>
    void (window as never as { __xe: { app: { normalizeLineEndings(): Promise<void> } } }).__xe.app.normalizeLineEndings(),
  );
  // Confirm the conversion modal.
  const dialog = page.locator(".modal");
  await expect(dialog).toContainText("Normalize");
  await dialog.getByRole("button", { name: "Normalize" }).click();
  await expect(page.locator("#status-eol")).toHaveText("CRLF");
  await page.evaluate(() =>
    void (window as never as { __xe: { app: { saveActive(): Promise<boolean> } } }).__xe.app.saveActive(),
  );
  await page.waitForTimeout(400);
  expect(bytes(file)).toBe("a\r\nb\r\nc\r\n"); // every line normalized to CRLF
});

test("convert to UTF-8 re-encodes the file on save", async ({ page }) => {
  const file = join(docs, "utf16.txt");
  // UTF-16 LE with BOM: "hello wide\n"
  const content = "hello wide\n";
  const le = Buffer.from(content, "utf16le");
  const bom = Buffer.from([0xff, 0xfe]);
  writeFileSync(file, Buffer.concat([bom, le]));
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await expect(page.locator("#status-encoding")).toContainText("UTF-16");
  await page.evaluate(() =>
    void (window as never as { __xe: { app: { convertToUTF8(): Promise<void> } } }).__xe.app.convertToUTF8(),
  );
  const dialog = page.locator(".modal");
  await expect(dialog).toContainText("Convert to UTF-8");
  await dialog.getByRole("button", { name: "Convert" }).click();
  await expect(page.locator("#status-encoding")).toContainText("UTF-8");
  await page.evaluate(() =>
    void (window as never as { __xe: { app: { saveActive(): Promise<boolean> } } }).__xe.app.saveActive(),
  );
  await page.waitForTimeout(400);
  expect(bytes(file)).toBe(content);
});

test("outline panel lists headings and jumps to them", async ({ page }) => {
  const file = join(docs, "outline.md");
  writeFileSync(file, "# First\n\ntext\n\n## Second\n\nmore\n", "utf8");
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  await page.click("#btn-outline");
  await expect(page.locator("#main")).toHaveClass(/with-outline/);
  await expect(page.locator("#outline .outline-h1")).toContainText("First");
  await expect(page.locator("#outline .outline-h2")).toContainText("Second");
  await page.locator("#outline .outline-h2").click();
  // Cursor moved to the "## Second" line (line 5 → Ln 5).
  await expect(page.locator("#status-pos")).toContainText("Ln 5");
});

test("paste image writes a file next to the document and inserts a reference", async ({ page }) => {
  const file = join(docs, "paste-target.md");
  writeFileSync(file, "before\n", "utf8");
  await openApp(page);
  await resetSettings(page);
  await openFile(page, file);
  // Drive the real flow: dispatch a synthetic paste carrying an image file.
  await page.evaluate(() => {
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], "clip.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = new Event("paste", { bubbles: true });
    Object.defineProperty(ev, "clipboardData", { value: dt });
    document.querySelector(".cm-content")!.dispatchEvent(ev);
  });
  const dialog = page.locator(".modal");
  await expect(dialog).toContainText("Save pasted image");
  await dialog.getByRole("button", { name: "Save Image" }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() =>
    void (window as never as { __xe: { app: { saveActive(): Promise<boolean> } } }).__xe.app.saveActive(),
  );
  await page.waitForTimeout(400);
  const expected = join(docs, "paste-target.md");
  const content = readFileSync(expected, "utf8");
  expect(content).toContain("![pasted-");
  // The referenced image file exists next to the document.
  const imgRef = content.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1] || "";
  expect(readFileSync(join(docs, imgRef)).length).toBeGreaterThan(50);
});
