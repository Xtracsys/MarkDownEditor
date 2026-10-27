import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGE-ERROR:", String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0, 200)); });
await page.goto("http://127.0.0.1:34126/?e2e=1");
await page.waitForFunction(() => !!window.__xe);
await page.evaluate(() => { void window.__xe.app.openPaths(["/tmp/sess-doc.md"]); });
await page.waitForTimeout(800);
const saved = await page.evaluate(async () => {
  await fetch("/api/SaveSessionNow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) });
  return window.__xe.app.getSettings();
});
console.log("restoreSession setting:", saved.restoreSession);
await page.reload();
await page.waitForFunction(() => !!window.__xe);
await page.waitForTimeout(2000);
const state = await page.evaluate(async () => {
  const last = await (await fetch("/api/GetLastSession", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) })).json();
  const settings = await window.__xe.app.getSettings();
  return {
    last: last.result,
    restore: settings.restoreSession,
    tabs: document.querySelectorAll(".tab").length,
    active: document.querySelector(".tab.active")?.textContent,
  };
});
console.log("after reload:", JSON.stringify(state));
await browser.close();
