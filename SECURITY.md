# Security Policy

## Reporting a vulnerability

Do not open public issues for security problems.

Email **security@xtracsys.com** (placeholder until an official security
address is published) with details, reproduction steps, and affected commits.
You will receive an acknowledgement within 72 hours. Please avoid public
disclosure until a fix is released; we will credit reporters in the release
notes unless you prefer otherwise.

## Scope

Xtracsys Editor handles untrusted local files by design — it opens documents
from anywhere on disk. In scope:

- Anything in `internal/fileio` (byte handling, safe save, symlink logic,
  external-change detection)
- The Markdown preview sandbox (`frontend/src/markdown.ts`,
  `frontend/src/preview.ts`): script injection, sanitizer bypass, resource
  loading, click routing
- The preview image handler (`internal/localimg`): path traversal, symlink
  escapes, content-type confusion
- The settings store and any path that writes to disk
- Dependency vulnerabilities in modules linked into shipped binaries

Out of scope: the webview engines themselves (WKWebView, WebView2,
WebKitGTK — report those to their vendors), and anything requiring the
attacker to already control the machine.

## Design guarantees security researchers should test

- The preview iframe is `sandbox="allow-same-origin"` with **no scripts**, and
  a CSP of `default-src 'none'; img-src 'self' data:`. Remote resources are
  URL-rewritten away even before the CSP would block them.
- Local images are served only from the open document's directory tree,
  symlink-resolved, content-sniffed, capped at 20 MB, SVG excluded.
- The only outbound network action in the app is an explicit user click on an
  http(s) link, scheme-validated in Go before `BrowserOpenURL`.
- Saves are atomic (temp + rename) and refuse to clobber externally changed
  files without an explicit decision.
- Crash-recovery snapshots may contain private document content; they are
  written with 0600 permissions to the app-data folder only, cleared on
  save/close/discard, and never stored next to documents.
