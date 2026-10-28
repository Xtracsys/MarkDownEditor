# Xtracsys Editor — Project Wiki

The complete record of this project: what it is, how it is built, everything
that went wrong and got fixed, and where it stands. Start here; the README is
the user-facing summary, this is the full story.

- **Version:** 0.1.5 (working title; not a finalized product name)
- **License:** Apache-2.0 for the source — Xtracsys trademarks and the logo
  are *not* covered (see TRADEMARKS.md)
- **Stack:** Go 1.25+ (Wails v2.17) + TypeScript (CodeMirror 6, Vite)
- **Platforms:** macOS 12+ (universal, DMG), Windows 10+ x64 (NSIS + zip),
  Linux via CI (deb/tar)

---

## 1. What this app is

A local-first desktop editor for plain text, code, configuration files, and
Markdown, built around one non-negotiable rule:

> **A file's bytes change only in response to user edits, and only when the
> user saves.**

Everything else follows from that: no metadata injection, no silent
normalization, no telemetry, no network calls, no accounts. Files stay
ordinary, portable, byte-faithful — usable in every other editor, compiler,
and VCS.

## 2. Architecture

```
Native window (WKWebView / WebView2 / WebKitGTK)
 └── Frontend: TypeScript, CodeMirror 6, marked + DOMPurify (embedded)
      └── JSON bindings / events (in-process)
           └── Go backend
                ├── internal/fileio     byte-faithful load/save + watcher
                ├── internal/app        service bound to the UI + menus
                ├── internal/settings   OS app-data settings
                ├── internal/recovery   crash-recovery snapshots
                ├── internal/session    session + recent-files store
                ├── internal/localimg   sandboxed preview images
                └── cmd/e2e-serve       loopback-only test bridge
```

Why this stack (full trade-offs in `docs/ARCHITECTURE.md`): a Markdown
preview needs a rendered-HTML surface; Fyne/Gio have no code-editor widget;
Electron is 100 MB+ and drags Node into the process. Wails gives a native
webview with a Go backend — the frontend is presentation only, and every
byte-level, security-sensitive, and persistence concern is Go code with Go
tests.

## 3. The file-integrity engine

The heart of the product, `internal/fileio` + `frontend/src/eol.ts`:

- **Load:** BOM detection (UTF-8, UTF-16 LE/BE), UTF-8 validation, NUL-byte
  binary detection. Unsupported encodings are *refused with an explanation*
  and an explicit read-only fallback — never silently transcoded.
- **Per-line terminators:** the file is decoded into lines plus a terminator
  array (`\n`, `\r\n`, `\r`, `""` for the final line). The editor edits an
  LF-normalized buffer; a CodeMirror StateField tracks terminators through
  every transaction (splits, joins, pastes, deletes) so **mixed line
  endings survive per line**. New lines take the file's predominant style.
- **Save:** bytes are rebuilt from (content, terminators, encoding); if
  identical to disk, nothing is written (mtime untouched). Otherwise:
  hidden temp file → fsync → original permissions → atomic rename → dir
  fsync. Symlinks are resolved, never replaced. A hash gate + pre-rename
  re-read blocks silent external-change overwrites.
- **Fuzz-proofed:** three Go fuzzers (60M+ executions) verify the
  round-trip invariants under arbitrary bytes.

## 4. Security model

Defense in depth around untrusted content, documented in
`docs/SECURITY-AUDIT.md`:

1. **Markdown preview:** marked → DOMPurify → URL rewriting (remote images
   replaced with visible blocked-notes, local images routed through the Go
   sandbox) → `<iframe sandbox="allow-same-origin">` **without scripts** +
   CSP `default-src 'none'`. Even a sanitizer bypass has nothing to execute
   and nowhere to phone home.
2. **Image handler:** serves only from the open document's directory tree,
   symlink-resolved on both sides, content-sniffed, SVG excluded, 20 MB cap.
3. **Network:** zero listeners in the shipped app; the only outbound action
   is a user-clicked http(s) link, scheme-validated in Go.
4. **Dynamic testing** (in addition to three static audit rounds): Go
   fuzzers, a 26-vector live XSS battery (zero execution/navigation/egress),
   and a 19-check HTTP attack suite against the test bridge (origin/Host/
   Content-Type guards, traversal variants, malformed payloads). Both suites
   caught real regressions the static tests missed — see §7.
5. **Scanners:** govulncheck (0 findings on the Go 1.26.10 toolchain) and
   npm audit (0 production vulnerabilities), run in CI.

## 5. Features

- Tabs, line numbers, syntax highlighting (130+ languages + shebang
  detection), undo/redo, find & replace, multi-selection, folding
- Indentation controls, word-wrap, status bar (path/encoding/EOL/language/
  cursor), full shortcut set, native menus
- Open anything textual: any extension, extensionless, dotfiles; binary and
  unsupported encodings explained, read-only fallback by choice
- Markdown source/split/preview with task lists, tables, code highlighting,
  local images, blocked-by-default remote resources
- Crash recovery (always on, disclosed, app-data only) + **session restore**
  (setting, default on, paths only) + **Open Recent** menu
- **Convert to UTF-8** / **Normalize Line Endings** — two-step commands; the
  user saves
- Outline panel (Alt+O), image paste from clipboard (new file next to the
  document, user-named), print preview, reveal-in-Finder/Explorer
- Auto-save: off by default, configurable delay, never untitled docs, never
  overwrites external changes

## 6. Release history (this thread)

### 0.1.0 — the working editor
Go file-integrity engine (40+ tests), Wails app, full frontend, e2e bridge,
macOS build. First end-to-end acceptance run found a real re-entrant-save
bug in the external-change flow.

### 0.1.1 — "Open With" + crash recovery + first security audit
- **Open With was dead on arrival:** Wails delivers Finder opens as Apple
  Events to `Mac.OnFileOpen`, which was never wired. Fixed for macOS odoc,
  argv, second-instance, and drag-and-drop, with a queue that buffers until
  the UI is ready. Verified with real Apple Events.
- Crash recovery: 0600 snapshots in app-data, restore-as-unsaved-tabs.
- Security audit #1 (static): preview sandbox verified; image-handler
  containment hardened; e2e bridge guard added.

### 0.1.2 — the bindings catastrophe (and the lesson)
**The app opened but nothing worked** — no document opens, no settings. The
root cause chain, each layer hiding the next:
1. Moving `App` from `package main` to `internal/app` silently changed the
   generated bindings from `window.go.main.App` to `window.go.app.App` —
   every frontend→backend call threw. Fixed with a namespace-agnostic
   lookup.
2. Wails injects its runtime scripts into `<head>`; a strict CSP meta tag
   broke the injection on the `wails://` scheme. Removed (assets are
   embedded; the preview iframe keeps its own strict CSP).
3. A nil-slice (`ListRecovery` → JSON `null` → `.length` crash) killed
   startup. Fixed class-wide: every slice crossing the binding boundary is
   materialized, with regression tests.
**The lesson:** the error-surfacing work (fatal-backend screen, toasts,
`XTRACSYS_EDITOR_DEBUG=1` diagnostics) is what made this diagnosable at all.
Silent fallbacks had masked the failure for multiple releases.

### 0.1.3 — icon + full bug hunt (3 audits)
- **Icon bug:** bundle assembly copied `icon.icns` where the plist requires
  `iconfile.icns` — generic icon. Verified the emblem renders from inside
  the shipped DMG.
- Three parallel audits (packaging, frontend QA, regression review): 12
  packaging findings (plist version stamping, macOS 12 floor, CI NSIS flag,
  deb ownership), 2 high frontend findings (queued external opens racing
  event wiring — now pull-based; read-only Save As dead-end), plus ~15
  medium/low fixes.

### 0.1.4 — stale-artifact pipeline + delta audits
- The installed app was **stale**: Wails' self-sign step aborts on iCloud
  file-provider xattr detritus (this repo lives in a synced Desktop folder)
  and earlier pipelines couldn't tell. New `scripts/build-all.sh`: compiles
  with `-nopackage`, assembles + signs the bundle itself, and verifies a
  unique per-build stamp inside every artifact (raw `grep -a` — BSD
  `strings` proved unreliable on fat binaries).
- Version in the window title + build stamp at Startup: staleness is now
  provable at a glance.
- Delta reviews found the autosave/manual-save race (silent content revert)
  and six more issues — all fixed.

### 0.1.5 — dynamic security testing + approved roadmap
- Security: Go fuzzers, live XSS battery, HTTP attack suite (details in
  `docs/SECURITY-AUDIT.md`). The attack suite caught the e2e guard being
  dropped from the handler *and* over-rejecting same-origin POSTs.
- Features (user-approved): session restore (with on/off setting), Open
  Recent, Convert to UTF-8 / Normalize Line Endings (two-step, disclosed),
  outline panel, image paste, reveal-in-file-manager, print.
- Bug hunt on the new code: Normalize's trailing-terminator corruption
  (fixed — a missing final newline is preserved, not "added"), dead context
  menu (dismiss handler ate its own clicks), ignored paste filename, plus
  hardening (O_EXCL image writes, host-pinned bridge routes, session store
  mutex).

### 0.1.x current state
7 Go packages (51 tests), 23 vitest, 27 Playwright tests — all green,
repeatably. Artifacts in `dist/` with per-build stamps and `SHA256SUMS.txt`.

## 7. War stories (what this project taught)

- **Error visibility is a feature.** Every silent fallback was eventually a
  bug multiplier: the settings fallback masked dead bindings for three
  releases; the stale binary was invisible until `Startup` logs existed.
  Now: fatal screens for broken builds, toasts everywhere else, runtime
  diagnostics (`XTRACSYS_EDITOR_DEBUG=1` logs `Startup <version>/<stamp>`,
  opens, saves to the app-data folder).
- **iCloud file-provider is an adversary.** Synced-Desktop folders rename
  files mid-build, re-attach xattrs that break codesign, and resurrect
  deleted conflict copies into `frontend/dist` (which `go:embed` then
  bakes into binaries). Countermeasures: junk scrub + stamp verification in
  the build, conflict-file guard in CI — and the real recommendation:
  **keep this repo out of synced folders.**
- **Static audits find design flaws; dynamic tests find wiring.** The guard
  function had tests; the handler wasn't calling it. Only live attacks
  caught it.
- **Nil slices crossing Go→JSON→TS crash on `.length`.** Twice. Now a
  checked class with regression tests.
- **Test the wiring, not just the units.** `guard()` had a test while the
  handler never called it. The dynamic suite exists because of that.

## 8. Testing

| Suite | Count | Scope |
| --- | --- | --- |
| Go (`go test ./...`) | 7 pkgs, 51 tests | file integrity, settings, recovery, session, image sandbox, bridge guard |
| Go fuzzers | 3 targets | ParseEols/UTF16/BuildBytes round-trip invariants |
| vitest | 23 tests | EOL tracker, sanitizer, outline parser |
| Playwright E2E | 27 tests | real UI vs real backend: byte fidelity, modes, auto-save on/off, external changes, security battery |

```bash
go test ./... && (cd frontend && npm ci && npm test && npm run build)
npx playwright install chromium && npx playwright test
node scripts/security-dynamic.mjs   # against a running e2e-serve
scripts/build-all.sh 0.1.5          # verified artifacts into dist/
```

## 9. Diagnostics

- `XTRACSYS_EDITOR_DEBUG=1` (or `launchctl setenv` for GUI-launched apps)
  logs `Startup <version>/<stamp>`, `OpenPaths`, `QueueExternalOpen`,
  `SnapshotTab`, `GetSettings` to
  `<app-data>/xtracsys-editor/debug.log`.
- The window title carries the version — staleness of an install is
  provable at a glance.
- `cmd/e2e-serve` is the headless harness: the real frontend against the
  real backend on loopback, with `_`-prefixed test hooks.

## 10. Known limitations & deferred work

- **Unverified on real Windows/Linux hardware** (CI workflows written, not
  yet run — publishing awaits approval).
- **Signing/notarization** requires certificates the project doesn't have;
  artifacts are ad-hoc/unsigned (Gatekeeper/SmartScreen prompts expected).
- **Print** on macOS WKWebView needs manual verification
  (`window.print()` may not be implemented there).
- **Normalize is not undoable** (disclosed in its dialog); Convert waits
  for the user's Save by design, so autosave skips conversion-dirty tabs.
- Deferred roadmap: find-across-tabs, workspace sidebar, configurable
  keybindings, i18n, accessibility pass, PDF export styling.

## 11. Repository map

```
main.go                    window + argv + single-instance wiring
internal/app               service, menu, lifecycle (bound to UI)
internal/fileio            byte-faithful core + fuzzers (the heart)
internal/recovery          crash-recovery snapshots
internal/session           session + recent store
internal/settings          OS app-data settings
internal/localimg          sandboxed preview images
cmd/e2e-serve              loopback test bridge (not shipped)
frontend/src               editor UI (CodeMirror 6), ipc, eol tracker,
                           markdown pipeline, preview, outline, themes
tests/e2e                  Playwright acceptance + security suites
scripts                    build-all, make-dmg, icons, screenshots
docs/                      architecture, brand, platform status, audits,
                           requirements checklist
.github/workflows          3-OS test + package matrix + security scans
```
