// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// Captures README screenshots from the running e2e bridge (start it with
// `go run ./cmd/e2e-serve` first). Not part of the shipped app.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = resolve(root, "docs/screenshots");
mkdirSync(out, { recursive: true });

// Fixture document with a local image.
const docs = "/tmp/xe-screenshots";
mkdirSync(docs + "/assets", { recursive: true });
writeFileSync(docs + "/handbook.md", [
  "# Project Handbook",
  "",
  "A short guide kept next to the code it describes.",
  "",
  "## Editing rules",
  "",
  "1. Files stay plain text — no metadata, ever",
  "2. Line endings and encodings survive every save",
  "3. Preview renders from source and never rewrites it",
  "",
  "> Xtracsys Editor keeps documents portable for every other tool.",
  "",
  "## Checklist",
  "",
  "- [x] Install the editor",
  "- [ ] Write the docs",
  "",
  "```go",
  "func main() {",
  "    println(\"hello, editor\")",
  "}",
  "```",
  "",
  "| Mode | Key |",
  "| --- | --- |",
  "| Source | Alt+1 |",
  "| Split | Alt+2 |",
  "| Preview | Alt+3 |",
  "",
  "![emblem](assets/logo.png)",
  "",
].join("\n"), "utf8");
copyFileSync(resolve(root, "frontend/public/logo-dark.png"), docs + "/assets/logo.png");
mkdirSync(docs + "/keep", { recursive: true });
writeFileSync(docs + "/keep/notes.txt", "config notes\n", "utf8");

const base = "http://127.0.0.1:34115/?e2e=1";
const browser = await chromium.launch();

async function shot(name, setup) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base);
  await page.waitForFunction(() => !!window.__xe);
  await page.evaluate(() => {
    void window.__xe.app.openPaths(["/tmp/xe-screenshots/handbook.md"]);
  });
  await setup(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(out, name) });
  await page.close();
  console.log("saved", name);
}

await shot("light-split.png", async (p) => {
  await p.click("#btn-mode-split");
});

await shot("dark-preview.png", async (p) => {
  await p.click("#btn-theme");
  await p.click("#btn-mode-preview");
});

await shot("dark-split-editor.png", async (p) => {
  await p.click("#btn-theme");
  await p.click("#btn-mode-split");
  await p.locator(".cm-content").click();
  await p.keyboard.press("ControlOrMeta+Home");
  await p.keyboard.press("Shift+ArrowDown");
});

await browser.close();
console.log("done");
