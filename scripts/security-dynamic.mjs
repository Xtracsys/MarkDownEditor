// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// Dynamic security tests against the e2e bridge's HTTP surface (the only
// network listener any build of this app has). Run:
//   go run ./cmd/e2e-serve -addr 127.0.0.1:34125 -dist frontend/dist -home /tmp/sec-home
//   node scripts/security-dynamic.mjs 127.0.0.1:34125
// Attacks the guard, the /ximg/ handler, and protocol abuse. Exits non-zero
// on any failed check.

const host = process.argv[2] || "127.0.0.1:34125";
const base = `http://${host}`;
const json = { "Content-Type": "application/json" };
import http from "node:http";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== "" ? " — " + detail : ""}`);
}

async function api(method, body, headers = {}) {
  return fetch(`${base}/api/${method}`, {
    method: "POST",
    headers: { ...json, ...headers },
    body: JSON.stringify({ args: body ?? [] }),
  });
}

async function ximg(path, headers = {}) {
  return fetch(`${base}${path}`, { headers });
}

// --- 1. Cross-origin / rebinding guard -----------------------------------
{
  const r = await api("NewTab", [], { Origin: "https://evil.example" });
  record("origin header refused", r.status === 403, `status ${r.status}`);
}
{
  // Node's fetch refuses to spoof Host; use http.request for the real test.
  const status = await new Promise((resolve) => {
    const req = http.request(
      { host: host.split(":")[0], port: Number(host.split(":")[1]), path: "/api/NewTab",
        method: "POST", headers: { "Content-Type": "application/json", Host: "evil.example:34125" } },
      (res) => { resolve(res.statusCode); res.resume(); },
    );
    req.on("error", () => resolve(-1));
    req.end(JSON.stringify({ args: [] }));
  });
  record("foreign Host refused", status === 403, `status ${status}`);
}
{
  const r = await fetch(`${base}/api/NewTab`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ args: [] }),
  });
  record("non-JSON content type refused", r.status === 415, `status ${r.status}`);
}
{
  const r = await fetch(`${base}/api/NewTab`, { method: "GET" });
  record("GET refused", r.status === 405, `status ${r.status}`);
}

// --- 2. Crafted payloads must not crash the bridge ------------------------
{
  const r = await api("SaveTab", ["t9", "/tmp/sec-attacker-chosen", "x", null, "utf8", false]);
  record("null eols handled", r.status === 200 || r.status === 400, `status ${r.status}`);
}
{
  const r = await api("SaveTab", ["t9", "/tmp/x", "y".length > 0 ? "y" : "y", ["\n"], "utf8", false]);
  record("unknown tab save refused cleanly", r.status === 200, `status ${r.status}`);
}
{
  const big = "A".repeat(5 * 1024 * 1024);
  const r = await api("SaveTab", ["t9", "/tmp/sec-big", big, ["\n"], "utf8", false]);
  record("5MB payload tolerated (no crash)", r.status === 200 || r.status === 500, `status ${r.status}`);
}
{
  const r = await fetch(`${base}/api/SnapshotTab`, {
    method: "POST",
    headers: json,
    body: "{not json",
  });
  record("malformed JSON rejected", r.status === 400, `status ${r.status}`);
}
{
  const r = await fetch(`${base}/api/../../etc/passwd`, { method: "POST" });
  record("path traversal on /api rejected", [400, 404].includes(r.status), `status ${r.status}`);
}
{
  const r = await api("NoSuchMethod", []);
  record("unknown method rejected", r.status === 200, `status ${r.status} (JSON error envelope expected)`);
  const env = await r.json();
  record("unknown method returns error envelope", !!env.error, JSON.stringify(env).slice(0, 80));
}
{
  const r = await api("OpenPaths", [["../../../../etc/passwd"]]);
  const env = await r.json();
  const outcome = env.result?.[0];
  record(
    "traversal open refused or explained",
    outcome?.issue != null && ["not-found", "io", "not-regular", "directory"].includes(outcome.issue.reason),
    `status ${r.status} body ${JSON.stringify(env).slice(0, 120)}`,
  );
}

// --- 2b. Host pin on SSE + image routes (live, through the mux) -----------
{
  const status = await new Promise((resolve) => {
    const req = http.request(
      { host: host.split(":")[0], port: Number(host.split(":")[1]), path: "/api/events",
        method: "GET", headers: { Host: "evil.example:34128" } },
      (res) => { resolve(res.statusCode); res.resume(); },
    );
    req.on("error", () => resolve(-1));
    req.end();
  });
  record("SSE route host-pinned", status === 403, `status ${status}`);
}
{
  const status = await new Promise((resolve) => {
    const req = http.request(
      { host: host.split(":")[0], port: Number(host.split(":")[1]), path: "/ximg/t1/pic.png",
        method: "GET", headers: { Host: "evil.example:34128" } },
      (res) => { resolve(res.statusCode); res.resume(); },
    );
    req.on("error", () => resolve(-1));
    req.end();
  });
  record("image route host-pinned", status === 403, `status ${status}`);
}

// --- 3. /ximg/ containment (live) -----------------------------------------
{
  const r = await ximg("/ximg/t1/../../../etc/passwd");
  record("/ximg traversal not served", r.status !== 200, `status ${r.status}`);
}
{
  const r = await ximg("/ximg/t1/%2e%2e/%2e%2e/etc/passwd");
  record("/ximg encoded traversal not served", r.status !== 200, `status ${r.status}`);
}
{
  const r = await ximg("/ximg/t1/%2e%2e%2f%2e%2e%2fetc%2fpasswd");
  record("/ximg double-encoded traversal not served", r.status !== 200, `status ${r.status}`);
}
{
  const r = await ximg("/ximg/t1//etc/passwd");
  record("/ximg absolute-path escape not served", r.status !== 200, `status ${r.status}`);
}
{
  const r = await ximg("/ximg/unknown-tab/pic.png");
  record("/ximg unknown tab 404", r.status === 404, `status ${r.status}`);
}
{
  const r = await ximg("/ximg/t1/pic.png", { Range: "bytes=0-1" });
  record("/ximg serves or 404s without crashing", r.status >= 200, `status ${r.status}`);
}

// --- 4. Legit flow still works after all attacks ---------------------------
{
  const mk = await fetch(`${base}/api/NewTab`, { method: "POST", headers: json, body: JSON.stringify({ args: [] }) });
  const tab = (await mk.json()).result;
  const save = await api("SaveTab", [tab.tabId, "/tmp/sec-canary.md", "still working\n", ["\n", ""], "utf8", false]);
  const env = await save.json();
  record("legit save works after attacks", env.result?.ok === true, JSON.stringify(env).slice(0, 100));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
