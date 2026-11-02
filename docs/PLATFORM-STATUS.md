# Platform Status

Honest, per-platform status. This file is updated with every release
candidate; a platform is only marked tested when a human has actually used
that build. Last updated: 2026-11-01 (public CI status).

## Legend

- **Built** — the binary/package was produced from source.
- **Auto-tested** — the automated suites ran on that OS: `go test ./...`,
  frontend vitest, Playwright acceptance E2E (against the real Go backend via
  the loopback bridge).
- **Manually tested** — a human used the application interactively.
- **Verified** — packaging, launch, and core flows confirmed on real hardware.

## Matrix

| | macOS 13+ | Windows 10 1809+ | Linux (webkit2gtk-4.1) |
| --- | --- | --- | --- |
| Architectures | arm64 + x86_64 (universal) | x64 | x64, arm64 |
| **Built** | ✅ universal `.app` + DMG, ad-hoc signed | ✅ x64 `.exe` cross-built locally (zip); NSIS installer via CI | ❌ needs CI (webkit2gtk cgo; no Linux toolchain locally) |
| **Auto-tested** (go / vitest / E2E) | ✅ / ✅ / ✅ | ⏳ CI pending | ⏳ CI pending |
| **Manually tested** | ✅ launch + core edit/save smoke test (this machine, macOS 27 arm64) | ❌ | ❌ |
| **Packaging** | `.app` bundle ✅; DMG not produced yet | `.exe` via CI; NSIS installer not configured | binary; AppImage/deb not configured |
| **Signing** | Ad-hoc only. Developer-ID signing and notarization **not performed** — requires an Apple Developer certificate | Unsigned; Authenticode requires a certificate | N/A |

## Current GitHub Actions status

The public run for commit `13aad54` (2026-11-01) failed all three
OS test jobs before the Go, frontend, or E2E suites could run. Go's
`//go:embed all:frontend/dist` requires the compiled frontend bundle, but the
workflow ran Go checks before `npm run build`. The security scan passed. The
workflow now builds the frontend before running Go checks. The follow-up run
at `94cc6b2` got past those stages but the macOS E2E step could not load
`@playwright/test`: CI had installed only the frontend package, not the root
E2E dependencies. The workflow now installs the root package before E2E; a
subsequent green run is still required before calling public CI green.

## Known limitations & blockers (stated plainly)

1. **Windows and Linux have not been run on real hardware yet.** The code is
   written against Wails v2's cross-platform API and the CI matrix builds and
   tests all three OSes headlessly, but “it compiles and the headless suites
   pass” is not “it works”. Until someone runs those builds interactively,
   treat those platforms as unverified.
2. **Public CI has not passed yet.** The initial run failed at Go embed time;
   the follow-up reached E2E but lacked the root Playwright dependency. Both
   workflow ordering and dependency installation are corrected; a green run is
   still required.
3. **Code signing / notarization** for macOS and Windows requires certificates
   that are not available in this environment. macOS builds are ad-hoc signed
   (Gatekeeper will show an “unidentified developer” prompt for local builds;
   `xattr -cr` clears the quarantine flag on your own machine).
4. **Native dialogs** (Open/Save As) are exercised by code review and the
   shared save path (the E2E suite covers everything around them through the
   bridge), but the dialogs themselves need interactive verification on each
   OS.
5. **macOS window screenshot capture** was unavailable in the build
   environment (screen-recording permission); screenshots in this repository
   come from the identical frontend running against the identical Go backend
   through the E2E bridge.

## Manual test checklist (per platform)

Run once per platform before calling it verified:

1. Launch; window appears with the brand light or dark theme (system).
1a. macOS: Finder → Open With → Xtracsys Editor, and dragging a file onto the
    Dock icon — the document opens in a tab. **Verified on this machine** via
    real Apple Events (launch-with-file and open-while-running both delivered;
    the queue-while-starting path is covered by unit + E2E tests).
2. ⌘/Ctrl+O opens any file — including a dotfile, an extensionless file, and
   a file with an unknown extension.
3. Type, undo/redo, find & replace (⌘/Ctrl+F), word-wrap toggle (Alt+Z).
4. Save (⌘/Ctrl+S) — verify bytes externally (`shasum` before/after an
   unchanged save).
5. Save As to a new name; verify the original is untouched.
6. Markdown: split view renders; theme switch does not modify the file
   (`shasum`).
7. Settings: enable auto-save with 1s delay, edit, verify writes; disable,
   edit, verify no writes.
8. Modify an open file externally; confirm the banner and the decision flow.
9. Open a PNG (binary) and a Latin-1 file — explanations, read-only flow.
10. Quit with unsaved changes — prompt appears; Cancel keeps the app open.
11. Open the app offline (network disconnected); repeat core flows.
