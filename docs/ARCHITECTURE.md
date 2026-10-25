# Xtracsys Editor — Architecture

Status: implemented as described. This document is the architecture proposal that preceded
implementation, kept up to date as the system evolves.

## Summary

**Xtracsys Editor is a Go application built with [Wails v2](https://wails.io): a native OS
webview hosts a TypeScript/CodeMirror 6 editor surface, while every byte-level,
security-sensitive, and persistence concern lives in Go.**

```
┌──────────────────────────────────────────────────────────────┐
│  Native window (WKWebView / WebView2 / WebKitGTK)            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Frontend (TypeScript, embedded into the binary)        │  │
│  │  CodeMirror 6 editor · tabs · find/replace · preview   │  │
│  │  markdown render (marked) · sanitizer (DOMPurify)      │  │
│  │  themes · settings UI · auto-save timer                │  │
│  └───────────────▲────────────────────────────────────────┘  │
│                  │ JSON bindings / events (in-process)        │
│  ┌───────────────┴────────────────────────────────────────┐  │
│  │ Go backend                                             │  │
│  │  internal/fileio    byte-faithful load / atomic save   │  │
│  │                     encoding + EOL + BOM round-trip    │  │
│  │                     external-change polling watcher    │  │
│  │  internal/settings  OS app-data JSON settings          │  │
│  │  internal/localimg  sandboxed preview image serving    │  │
│  │  app.go             dialogs, menus, tab registry       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Why this stack (trade-offs)

The project preference is Go for maintained application/backend infrastructure. The
decisive requirement is a **real editing experience** — line numbers, syntax highlighting
across many languages, undo/redo, find/replace — plus a **live Markdown preview**. A
Markdown preview is a rendered-HTML surface; a webview gives us one natively.

| Option | Editor quality | Size | Maintainability | Security | Assessment |
|---|---|---|---|---|---|
| **Go + Wails v2 (chosen)** | Excellent (CodeMirror 6) | ~10–20 MB | Go core + TS view; both mainstream | Webview sandbox; no app-owned sockets; DOMPurify + CSP + sandboxed iframe for preview | Best fit |
| Go + Fyne / Gio | Poor — no code-editor widget exists; we would have to build one | ~25 MB | Huge surface to own | Simple, but everything is custom | Rejected: months of work for a worse editor |
| Electron (+ Go sidecar) | Excellent | 100 MB+ | Two runtimes | Chromium attack surface; Node in process | Rejected: violates Go-for-infrastructure preference |
| Tauri (Rust) | Excellent | ~10 MB | Rust core | Comparable to Wails | Rejected: not Go |

The webview approach keeps Go where correctness matters — **all file I/O, encoding
detection, line-ending/BOM preservation, atomic saves, external-change detection, and
settings persistence are Go code with Go unit tests**. The TypeScript layer is a
presentation shell over those bindings and contains no file-writing logic of its own.

### Costs we accept, stated honestly

- Two toolchains at build time (Go + npm). The frontend is compiled and **embedded into
  the binary**; end users need neither Node nor a network connection.
- Webview rendering differs slightly per OS (WKWebView on macOS, WebView2 on Windows,
  WebKitGTK on Linux); Linux requires the `webkit2gtk-4.1` system library.
- Wails itself is a framework dependency (MIT-licensed).

## Network posture

The application **opens no listening sockets**. Wails serves the embedded frontend to the
webview through OS-native resource mechanisms (custom URL scheme on macOS/Windows; on
Linux, WebKitGTK's custom URI scheme). There are no accounts, no telemetry, no background
requests, and no document uploads. The only outbound network action in the entire app is
an explicit user click on an `http(s)` link in the Markdown preview, which opens the
system browser via `BrowserOpenURL` after the URL is scheme-validated in Go.

Local preview images are served to the preview iframe from Go through the app's asset
handler under `/ximg/`, restricted to image content types, size-capped, and path-checked
to stay inside the document's directory tree (symlinks resolved before the check).

## File integrity model (the core invariant)

Everything in `internal/fileio` exists to guarantee: **a file's bytes change only in
response to user edits, and only when the user saves.**

- **Load** (`load.go`): BOM detection (UTF-8, UTF-16 LE/BE), UTF-8 validation, NUL-byte
  binary detection. Unsupported encodings are *refused* with an explanation (and an
  optional, clearly-marked read-only view); they are never silently transcoded.
- **Line endings** (`eol.go`): the file is decoded into lines plus a **per-line terminator
  array** (`\n`, `\r\n`, `\r`, or empty for an unterminated final line). CodeMirror edits
  an LF-normalized buffer; a frontend tracker keeps the terminator array aligned across
  edits, so **mixed line endings are preserved per line** rather than normalized. New
  lines use the file's predominant terminator.
- **Save** (`save.go`): bytes are rebuilt from (content, terminators, encoding, BOM). If
  the rebuilt bytes are identical to what is on disk, the write is skipped entirely.
  Otherwise: temp file in the same directory → `fsync` → `chmod` to the original
  permissions → atomic `rename` → directory `fsync`. Symlinked paths are resolved so the
  link itself is never replaced. Before overwriting, the on-disk hash is compared to the
  last-known state; a mismatch surfaces an "external change" decision instead of a silent
  overwrite.
- **Watch** (`watch.go`): a polling watcher (stat + SHA-256, no inotify dependencies)
  reports external modifications/deletions per tab.
- **Settings** (`settings/`): a single JSON file under the OS application-data directory.
  Nothing is ever written next to documents.

## Cross-platform delivery

| Platform | OS floor | Architectures | Formats |
|---|---|---|---|
| macOS | 13+ | arm64 + x86_64 (universal) | `.app` (dmg optional) |
| Windows | 10 1809+ | x64 (arm64 best-effort) | `.exe` (NSIS installer optional) |
| Linux | webkit2gtk-4.1 era distros (Ubuntu 22.04+) | x64, arm64 | binary; AppImage/deb optional |

Builds are driven by `wails build` and reproducible from a clean checkout with Go 1.24+,
Node 18+, and platform prerequisites (see README). CI workflows in `.github/workflows/`
build and test all three OSes; their per-platform status is reported honestly in
`docs/PLATFORM-STATUS.md` — building on one OS does not certify the others.

## Test strategy

1. **Go tests** (`internal/...`): byte-level round-trips (encodings × line endings × BOM ×
   final-newline), binary/unsupported-encoding handling, atomic save semantics, permission
   and symlink preservation, external-change detection, settings defaults (auto-save off).
   These run headless on every platform.
2. **Frontend unit tests** (vitest): EOL tracker alignment under edits, Markdown render +
   sanitize + remote-resource blocking, settings store, auto-save timer logic.
3. **End-to-end tests** (Playwright against a dev-only HTTP bridge that reuses the real Go
   backend): tab lifecycle, markdown modes, theme switching, auto-save behavior, and the
   acceptance suite's UI-level claims. The bridge is a test harness, not shipped.
4. **Manual checklists** per platform with recorded results.
