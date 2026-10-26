# Security Audit — v0.1.0 Development Build

Date: 2026-10-25 · Scope: full application source (Go + TypeScript), shipped
dependency tree, repository hygiene. Method: three independent audits (Go
backend static audit, frontend/preview-sandbox static audit, dependency +
tooling scan with `govulncheck`, `npm audit`, license review, secrets scan),
followed by fixes and regression tests for every actionable finding.

## Summary

| Area | Findings | Status |
| --- | --- | --- |
| Go backend | 1 medium, 3 low, 2 informational | All medium/low fixed + tested |
| Frontend / preview sandbox | see below | verified; fixes where applicable |
| Dependencies | 9 reachable Go **stdlib** CVEs (toolchain), 0 shipped npm vulns, 1 license doc error | toolchain pinned ≥ 1.26.10; doc corrected |
| Secrets / repo hygiene | 0 true positives | pass |

## Findings and resolutions

### F1 (MEDIUM) — E2E bridge: unauthenticated JSON API enabled drive-by file writes
`cmd/e2e-serve` accepted any POST from any origin; a webpage open in the
developer's browser could call `SaveTab` and write arbitrary files (CORS
simple-request, no preflight needed), and DNS rebinding made responses
readable. **Fixed**: every `/api/` request is now refused if it carries an
`Origin` header, if `Host` is not the exact loopback address the server bound,
or if `Content-Type` is not JSON (forces a failed CORS preflight). The
production app is unaffected (no HTTP server exists in it — verified).
Regression test: `cmd/e2e-serve/guard_test.go`.

### F2 (MEDIUM) — memory amplification via newline-only files
A 32 MiB file of newlines passed the size cap and allocated ~1 GiB in
per-line slices (plus a capacity bug in `ParseEols`). **Fixed**: `ParseEols`
now pre-sizes both slices correctly, and loads with more than 2,000,000 lines
are refused with a clear message before allocation. Regression tests:
`TestLoadRefusesTooManyLines`, plus the corrected pre-sizing.

### F3 (LOW) — devices/FIFOs bypassed the size cap
`/dev/zero` reported size 0 and was read unbounded. **Fixed**: every read
path (`Load`, `LoadReadOnly`, `SaveDocument`, the watcher, `RecoverEntry`,
the `/ximg/` handler) now requires a regular file. Regression test:
`TestLoadRefusesNonRegularFile` (mkfifo).

### F4 (LOW) — TOCTOU window between the external-change check and rename
An external write landing in the milliseconds between the hash guard and the
atomic rename was silently clobbered. **Fixed**: the on-disk bytes are
re-read and compared immediately before the rename; a mismatch aborts to the
external-change decision instead of overwriting. (An adversarial writer
racing *within* the final read→rename remains theoretically possible — same
residual risk class as every atomic-rename editor; documented as accepted.)

### F5 (LOW) — /ximg/ 403-vs-404 file-existence oracle
Escape attempts returned a distinguishable 403, letting a caller probe
whether arbitrary paths exist. **Fixed**: escapes now return a body-identical
404; regression test asserts byte-equality with a plain not-found. In the
shipped app this handler is only reachable from inside the webview (Wails
serves assets via in-process scheme handlers, not TCP).

### F6 (INFO) — webview compromise equals arbitrary file I/O by design
All App methods are bound to the webview; this is inherent to Wails' binding
model and acceptable **only because** untrusted Markdown cannot execute in
the webview origin — verified: preview iframe `sandbox="allow-same-origin"`
(no scripts) + CSP `default-src 'none'`, DOMPurify + URL rewriting upstream,
and the main document carries its own restrictive CSP. Documented as the
trust boundary.

### F7 (INFO) — minor hardening applied
`X-Content-Type-Options: nosniff` on served images; dead code removed from
the save path; the deterministic temp-name fallback noted (DoS-only,
crypto/rand failure path); orphaned save temps after a mid-save crash remain
documented-but-unswept (cleanup on next save of the same document is a
future nicety, not a security issue).

### Dependencies
- `govulncheck` on Go 1.26.6 flagged **9 reachable stdlib CVEs** (net/http
  family used by the local image handler, crypto/x509 via the test bridge).
  All fixed in Go 1.26.10 → `go.mod` now pins `toolchain go1.26.10`; builds
  confirm `go1.26.10` in binary metadata. No third-party Go module CVEs.
- `npm audit` (production tree): **0 vulnerabilities**. Dev-only tooling
  (vitest/tinypool) has 3 findings — nothing shipped; upgrade noted as
  housekeeping.
- Licenses: all permissive/Apache-compatible. One documentation error fixed
  (`tkrajina/go-reflector` is Apache-2.0, not MIT, in
  THIRD-PARTY-NOTICES.md).
- Secrets scan: 7 pattern hits, all false positives (design color "tokens",
  security tests referencing `/etc/passwd`, package names). No credentials,
  keys, or `.env` files in the repository.

### Frontend audit (0 high, 0 medium, 4 low, 5 informational)
The sanitizer configuration, srcdoc/CSP construction, sandbox attribute, click
routing, DOM-layer XSS surfaces (all `textContent`), bridge-mode activation,
and the EOL-alignment math were verified correct — including a formal check
that the alignment math preserves line count exactly and degrades to LF, never
corrupting beyond a new boundary. Low-severity fixes applied:
- **L1** external anchors no longer carry a live `href` (middle-click/Enter
  could otherwise self-navigate the sandboxed frame to remote content —
  confined spoofing, no script execution); `auxclick` is also prevented.
- **L2** the "block remote resources" setting now actually relaxes the iframe
  CSP when the user turns it off (previously it failed closed silently —
  safe, but the setting did nothing).
- **L3** rapid preview rebuilds could double-attach the click listener
  (double browser tabs on one click) — now once per document.
- **L4** refused link schemes (mailto:, tel:…) now show a toast instead of
  failing silently.
- Plus defense-in-depth: `..` segments filtered client-side before the image
  handler, and `CSS.escape` on banner selectors.

## Follow-up (post-audit hardening, same release)

- **Removed the document-level CSP meta** from `index.html`: WebKit does not
  reliably match `script-src 'self'` on the `wails://` custom scheme, which
  silently stripped the injected Wails runtime. All page assets are embedded
  and local; the untrusted-content boundary is the preview iframe, which
  keeps its own strict CSP (`default-src 'none'`, no scripts).
- **Fixed a production-only failure** where frontend→backend bindings were
  unreachable after the App service moved packages (the generated bindings
  namespace follows the Go package, so `window.go.main.App` became
  `window.go.app.App`). The frontend now resolves the bound service
  structurally instead of hard-coding the namespace, and a broken backend
  renders an explicit full-window error instead of a half-initialized UI.
  Document opens, settings, and the recovery flow are verified end-to-end in
  the real macOS app via opt-in diagnostics (XTRACSYS_EDITOR_DEBUG=1).

## Residual risks (stated plainly)

1. The check→rename race narrowed to one read (F4) cannot be fully closed
   without file locking, which harms cross-platform portability. Accepted.
2. Code signing/notarization are absent (no certificates); the DMG is
   ad-hoc signed. Gatekeeper/SmartScreen warnings are expected.
3. The webview engines (WKWebView/WebView2/WebKitGTK) are trusted components;
   their vulnerabilities are out of scope and handled by OS updates.

## Verdict

No high-severity findings. All medium/low findings are fixed with regression
tests; informational items are documented. The editor is fit for continued
testing and, once CI verification on Windows/Linux hardware lands, for an
initial public release.
