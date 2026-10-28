import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
await page.goto("http://127.0.0.1:34127/?e2e=1");
await page.waitForFunction(() => !!window.__xe);
// resetSettings equivalent
await page.evaluate(async () => {
  const s = await window.__xe.app.getSettings();
  await window.__xe.app.updateSettings({ ...s, autoSaveEnabled: false, autoSaveDelayMs: 500, blockRemoteResources: true, restoreSession: true });
  await fetch("/api/ClearSession", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) });
});
await page.evaluate(() => { void window.__xe.app.openPaths(["/tmp/ro-session.md"]); });
await page.waitForTimeout(600);
await page.evaluate(async () => {
  await fetch("/api/SaveSessionNow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) });
  const s = await window.__xe.app.getSettings();
  await window.__xe.app.updateSettings({ ...s, restoreSession: false });
});
// poll persisted
await page.waitForTimeout(300);
const persisted = await page.evaluate(async () => {
  const r = await fetch("/api/GetSettings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) });
  return (await r.json()).result.restoreSession;
});
console.log("persisted restoreSession:", persisted);
await page.reload();
await page.waitForFunction(() => !!window.__xe);
await page.waitForTimeout(1500);
const state = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll(".tab")].map((t) => t.textContent),
  active: document.querySelector(".tab.active")?.textContent,
}));
console.log("after reload:", JSON.stringify(state));
await browser.close();
