# Changelog

All notable changes to Xtracsys Editor. Versions follow semver; the format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.7] — 2026-11-03

### Changed
- **Crash recovery is now opt-in and off by default.** Snapshots are
  plaintext copies of unsaved document content; a privacy-first editor
  does not put that on disk unasked. Enabling it in Settings starts
  snapshotting; disabling it erases stored snapshots immediately, and
  startup erases leftovers from older builds. The recovery offer only
  appears while the setting is on.

### Fixed
- Normalize's dialog text corrected (a missing final newline is preserved,
  not "added").

## [0.1.6] — 2026-10-30

### Fixed
- Restore-session settings row actually present in Settings (round-5's edit
  had silently no-op'd), with session erasure on opt-out.
- Settings modal now sets/clears an inert background — keyboard input can no
  longer reach the editor behind a dialog, and the app can no longer wedge
  permanently inert.
- Session store: `SaveLastSession`/`ClearRecent` hold the lock across the
  whole load-modify-save cycle.
- Normalize Line Endings preserves a file's final-newline state (no more
  appended blank lines), discloses its semantics, and no-ops cleanly on
  single-line files.

### Security
- Round-5/6 audits: the e2e bridge's `/api/events` and `/ximg/` routes are
  now genuinely Host-pinned (the round-4 fix had existed only on paper),
  verified by live route-level tests; `RevealPath` refuses flag-like paths;
  image writes are `O_EXCL` (never overwrite, never follow symlinks).
- Scanners: govulncheck 0 findings (Go 1.26.10), npm audit 0 (production).

## [0.1.5] — 2026-10-27

### Added
- Session restore (setting, default on; paths only, app-data store).
- Open Recent menu + recent list on the empty screen.
- Convert to UTF-8 / Normalize Line Endings — two-step commands; the user
  saves.
- Markdown outline panel (Alt+O), image paste from clipboard, print preview,
  reveal-in-Finder/Explorer + copy path (tab context menu).

### Fixed
- 0.1.5 hardening round: autosave/manual-save race, read-only Save As
  export, ghost pristine tab, per-tab banners, settings-write race, iCloud
  conflict-copy scrub in the build pipeline.

## [0.1.4] — 2026-10-27

### Fixed
- Stale-artifact pipeline: per-build stamp verified in every artifact;
  compile with `-nopackage` + self-assembled, self-signed bundle (the Wails
  self-sign step aborts on iCloud xattr detritus and older pipelines shipped
  stale binaries).
- Version visible in the window title; diagnostics via
  `XTRACSYS_EDITOR_DEBUG=1`.
- Delta-audit fixes: autosave/manual-save race, ghost Untitled tab on
  launch-with-file, quit retry on declined dialogs.

## [0.1.3] — 2026-10-26

### Fixed
- Missing app icon (icns name mismatch in the hand-assembled bundle).
- Packaging audit: plist version stamping, macOS 12 floor, CI NSIS flag,
  deb ownership/icons, scoped checksums.
- Frontend QA + regression-review findings (external-open wiring race,
  read-only export, stale banners).

### Security
- Dynamic testing added: Go fuzzers, 26-vector XSS battery, 19-check HTTP
  attack suite; two live regressions found and fixed (dropped guard wiring;
  over-broad Origin rejection).

## [0.1.2] — 2026-10-25

### Fixed
- Production bindings unreachable after the App package move
  (`window.go.main.App` → `window.go.app.App`): namespace-agnostic lookup.
- CSP meta stripped the injected Wails runtime on the wails:// scheme —
  removed (assets embedded; preview keeps its own strict CSP).
- Nil-slice JSON crashes at startup (`ListRecovery`/`NewTab` warnings).
- Fatal-backend screen instead of a half-initialized UI.

### Security
- Crash recovery (0600 snapshots, app-data only), security audit round 1-2
  fixes, dependency pinning (govulncheck-clean toolchain).

## [0.1.1] — 2026-10-24

### Added
- "Open With" support: macOS Apple Events, argv, drag-and-drop, second-
  instance forwarding, 37 file associations.
- Crash recovery snapshots + external-open queue.

## [0.1.0] — 2026-10-24

### Added
- Initial working editor: byte-faithful file engine (UTF-8 ± BOM, UTF-16,
  mixed per-line endings, atomic safe save, symlink + permission
  preservation, external-change detection), tabs/editing/find-replace,
  Markdown source/split/preview with sanitized sandboxed rendering,
  light/dark brand themes, settings, e2e test bridge, CI for three OSes.
