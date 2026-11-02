# Requirements Checklist

Every requirement from the project brief, mapped to where it is implemented
and how it is verified. Verification codes: **[T]** automated test,
**[E2E]** automated end-to-end test, **[V]** verified visually/manually,
**[D]** by design (code structure), **[—]** not yet done (stated honestly).

## 1. Core editing experience

- Open/create/edit/save ordinary files — `[D] internal/app`, **[E2E]**
- Any extension, extensionless, dotfiles — **[E2E]** “dotfiles, extensionless…”
- Binary / unsupported encodings detected safely with explanation — **[T]**
  `TestLoadBinaryRefused`, `TestLoadUnsupportedEncoding`; **[E2E]** both flows
- Tabs, line numbers, syntax highlighting, undo/redo, find/replace,
  indentation controls, word-wrap, standard shortcuts — **[V]** (browser
  verification; CodeMirror provides undo/search primitives)
- Active file path + unsaved state visible — status bar & tab dots **[V]**,
  window title carries dirty marker `[D]`
- New / Open / Save / Save As — **[E2E]** (Save As via shared path; dialog UI
  needs interactive pass)
- Warn before closing unsaved work — **[E2E]** “closing a dirty tab…” and
  “quit guard”

## 2. Markdown source and preview

- Source / preview / split modes — **[E2E]** “markdown source, split, and
  preview modes”
- Headings, lists, links, images, blockquotes, fenced code, tables, task
  lists — **[T]** vitest render suite; **[E2E]** assertions on all of them
- Preview derived from source; never rewrites it — **[E2E]** “preview
  rendering and theme switching never alter document bytes”
- Sanitized, no script execution, no automatic remote resources by default —
  **[T]** sanitizer suite; **[E2E]** “no network requests…” (remote image
  blocked with visible note)
- Local images relative to document, no unrestricted filesystem access —
  **[T]** `internal/localimg` suite (traversal, symlink escape, type
  sniffing, SVG refusal); **[E2E]** local image loads

## 3. File integrity

- Never inject metadata/branding/front matter/anything — **[T]**
  `TestNoMetadataEver`, `TestLoadRoundTripBytes` (byte equality)
- Open+close without edits = byte-identical — **[T]** (no write paths on
  open; round-trip builds identical bytes)
- Saving unchanged file preserves bytes — **[T]**
  `TestSaveUnchangedPreservesBytesAndSkipsWrite` (write skipped, mtime
  untouched)
- Encoding/BOM/line-endings/trailing-whitespace/final-newline preserved —
  **[T]** 40-case round-trip matrix; **[E2E]** CRLF + no-final-newline and
  mixed-ending edit cycles
- No silent normalization of mixed endings — **[T]**
  `TestSavePreservesMixedLineEndings`; per-line tracker **[T]** vitest
  `eol.test.ts`
- Auto-formatting/trimming/conversion disabled by default — **[D]** (no such
  code exists; nothing to disable)
- Unsafe round-trips blocked, not guessed — **[T]** lossy UTF-16 → read-only
  (`TestLoadUTF16UnpairedSurrogateIsReadOnly`); validation rejects bad input
- Preferences in OS app-data — **[T]** `TestSettingsLiveInAppDataNotProject`
- No project-side metadata/lock/backup clutter — **[T]**
  `TestSaveLeavesNoTempClutter`; the save temp file is transient by design
- External changes detected; no silent overwrite — **[T]** watcher + guard
  suites; **[E2E]** full decision flow (a real re-entrant-save bug was found
  and fixed by this test)
- Safe save (atomic, permissions preserved, symlinks honored) — **[T]**
  `TestSavePreservesPermissions`, `TestSaveFollowsSymlinkWithoutReplacingIt`
- Apache license applies to source, not user documents — **[D]** NOTICE,
  TRADEMARKS

## 4. Auto-save

- OFF by default — **[T]** `TestFreshInstallAutoSaveDisabled`; **[E2E]** fresh
  bridge home
- Clearly labeled setting — settings modal `[V]`
- Choice persists — **[T]** `TestUserChoicePersists`
- Named files only, after idle delay, delay configurable — **[D/E2E]**
- Never silently chooses a location for untitled docs — **[E2E]** (autosave
  skips untitled; Save As is explicit)
- When disabled, no writes until explicit save — **[E2E]** “unsaved edits
  never touch the file”
- Crash recovery: **opt-in setting, off by default** (snapshots are
  plaintext document content at rest — a privacy-first editor does not
  create them unasked). Dirty buffers snapshot to app-data only (0600 on
  POSIX; on Windows, access follows the parent directory's ACL). Writes are
  atomic, disclosed in Settings/README, and restored as unsaved tabs after a
  crash. Disabling the setting erases stored snapshots, and startup erases
  leftovers from older builds — **[T]** internal/recovery + app gating tests;
  **[E2E]** off-by-default gate + opt-in restore flow
- Save failures shown clearly; never reported as success — **[D]** SaveResponse
  always carries the failure; **[E2E]** external-change decision flow

## 5. Branding and themes

- Light: warm-white, black text, rust accents — **[V]** (tokens sampled:
  `#F6F5F1/#080808/#B14831`; docs/BRAND.md)
- Dark: near-black, warm-white text, restrained rust — **[V]**
  (`#0A0B0C/#F6F5F1`)
- Black logo on light, inverse on dark — **[V]** (auto-swapped emblem)
- Logo proportions preserved — **[D]** raster crops used at native aspect
- No substituted/invented logo — **[D]** crops from the supplied sheet only
- Missing production assets requested & temporary assets labeled —
  docs/BRAND.md (request recorded)
- Colors sampled from assets, derived shades labeled — docs/BRAND.md
- Light/Dark/Follow-System settings, persisted — **[E2E]** (theme toggle in
  modes test); persistence via settings store **[T]**
- Branding stays out of document content — **[T]** byte-equality suites

## 6. Local-first and privacy

- All core functionality offline — **[E2E]** “no network requests leave the
  app during normal editing” (with a remote image present in the document)
- No accounts/cloud/telemetry/ads/AI — **[D]** (no such code; audited)
- No document uploads or background calls — **[D/E2E]**
- No automatic execution of opened files or markdown content — **[D]**
  (opening only reads bytes; preview sandboxed without scripts)

## 7. Architecture and cross-platform delivery

- Architecture proposed with trade-offs — docs/ARCHITECTURE.md
- Go for application/backend infrastructure (Wails v2) — **[D]** (frontend is
  presentation only; rationale in ARCHITECTURE.md)
- Installable desktop application, no network service — **[D]** wails native
  webview; bridge binds 127.0.0.1 in tests only
- macOS/Windows/Linux targets named with OS floors — README + PLATFORM-STATUS
- Reproducible build instructions — README
- Automated build/test workflows for all three OSes — `.github/workflows/`
  (written; **not yet executed** — publishing awaits approval)
- Status honestly distinguished (built / auto-tested / manually tested /
  verified) — docs/PLATFORM-STATUS.md
- Signing/notarization blockers stated — PLATFORM-STATUS.md

## 8. Open-source requirements

- Full source — repository
- Apache-2.0 full text in LICENSE — ✅ (fetched verbatim from apache.org)
- Xtracsys copyright attribution — SPDX headers, NOTICE
- README (install/usage/screenshots/build) — README.md
- Contribution + security guidance — CONTRIBUTING.md, SECURITY.md
- Dependency licenses + notices — THIRD-PARTY-NOTICES.md, NOTICE
- Automated tests + build workflows — internal/*, tests/, .github/workflows/
- No proprietary info/credentials/private docs in repo — **[D]** (audited;
  brand sheet included deliberately as the visual authority)
- Apache ≠ trademark rights — TRADEMARKS.md
- No publishing/public releases without approval — none performed

## Security audit — docs/SECURITY-AUDIT.md

Three audit passes + dependency/secrets scans; all medium/low findings fixed
with regression tests; toolchain pinned to Go 1.26.10 for stdlib CVE fixes.

## New in 0.1.5 — approved roadmap features

- Session restore (setting, default on; paths only, app-data store;
  missing files dropped silently) — **[T]** internal/session suite;
  **[E2E]** restore on/off
- Recent files (native Open Recent menu rebuilt on change + empty-state
  list + Clear) — **[T]**; manual menu check on each platform
- Convert to UTF-8 / Normalize Line Endings (two-step: mark modified, the
  user saves) — **[T]** fuzz + unit; **[E2E]** byte checks
- Markdown outline panel (Alt+O; fence-aware) — **[T]** vitest; **[E2E]**
- Image paste from clipboard (new file next to the document, user-named,
  never overwrites, PNG/JPEG only) — **[T]**; **[E2E]** real paste event
- Reveal in Finder/Explorer + Copy Path (tab context menu) — manual
- Print preview (⌘P, iframe print) — manual

## 9. Acceptance tests — see §1–§6 above; every item that can be tested
## headlessly is covered by an automated suite. Remaining interactive items
## are listed in PLATFORM-STATUS.md's manual checklist.

## 10. Execution expectations

- Working application delivered with real build/test results — macOS
  universal build + 3 test suites green on this machine
- Incremental order (core loop → markdown → themes/settings/packaging) —
  followed; git history reflects it
- Blockers reported directly — PLATFORM-STATUS.md, final report
