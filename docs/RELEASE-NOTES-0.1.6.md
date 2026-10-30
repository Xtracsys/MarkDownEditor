# Xtracsys Editor 0.1.6

First public-source release candidate. A local-first desktop editor for
plain text, code, configuration files, and Markdown — built on one rule:
your files stay ordinary, portable, byte-faithful text. No telemetry, no
accounts, no network calls, no metadata injection. Ever.

## Highlights

- **Byte-faithful editing** — UTF-8 (± BOM), UTF-16, mixed per-line line
  endings, final-newline state, and trailing whitespace all survive
  open → edit → save exactly; unchanged saves write nothing.
- **Markdown** — source / split / preview with tables, task lists, code
  highlighting, and local images; sanitized sandboxed rendering; remote
  resources blocked by default.
- **Open anything** — any extension, extensionless, dotfiles; binary and
  unsupported encodings explained with an explicit read-only fallback.
- **Session restore, Open Recent, crash recovery** — paths only, stored in
  the OS app-data folder; unsaved work offered separately after a crash.
- **Convert to UTF-8 / Normalize Line Endings** — deliberate two-step
  commands; the file changes only when you save.
- **Outline panel, image paste, print preview, reveal-in-Finder**.
- **Auto-save** — off by default, configurable, never overwrites external
  changes, never touches untitled documents.

## Integrity guarantees

Opening and closing a file without edits leaves it byte-for-byte unchanged.
No application metadata, branding, or hidden state is ever written into
your documents. Saves are atomic; symlinks are respected; permissions are
preserved; external changes are detected and never silently overwritten.

## Verification

7 Go packages (51 tests), 23 frontend unit tests, 27 end-to-end tests
driving the real UI against the real backend, 21/21 live security checks,
Go fuzzers on the byte engine (60M+ executions). govulncheck and npm audit:
0 findings.

## Notes

- macOS builds are ad-hoc signed (no notarization yet): right-click → Open
  on first launch.
- Windows/Linux packages are CI-produced; hardware verification is tracked
  in docs/PLATFORM-STATUS.md.
- Apache-2.0 licensed source, copyright Xtracsys LLC. The Xtracsys name and
  emblem are trademarks of Xtracsys LLC (see TRADEMARKS.md).
