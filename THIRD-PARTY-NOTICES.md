# Third-Party Notices

Copyright 2026 Xtracsys LLC. Licensed under the Apache License, Version 2.0 — see
[LICENSE](LICENSE).

This file lists the third-party software distributed inside Xtracsys Editor
binaries. Versions are pinned in `go.sum` and `frontend/package-lock.json`;
this document identifies each component and its license. Full license texts
are available in each project's repository.

All listed licenses are permissive and compatible with Apache-2.0.

## Go modules (linked into the shipped binary)

| Component | License | Purpose |
| --- | --- | --- |
| github.com/wailsapp/wails/v2 | MIT | Desktop application framework (native webview bridge) |
| github.com/gabriel-vasile/mimetype | MIT | Content-type sniffing (asset server) |
| github.com/leaanthony/go-ansi-parser | MIT | Wails dependency |
| github.com/leaanthony/slicer | MIT | Wails dependency |
| github.com/leaanthony/u | MIT | Wails dependency |
| github.com/pkg/browser | BSD-2-Clause | Open links in the system browser |
| github.com/pkg/errors | BSD-2-Clause | Wails dependency |
| github.com/rivo/uniseg | MIT | Unicode text segmentation (Wails) |
| github.com/samber/lo | MIT | Utilities (Wails) |
| github.com/tkrajina/go-reflector | Apache-2.0 | Wails dependency |
| golang.org/x/net | BSD-3-Clause | Go extended libraries |
| golang.org/x/text | BSD-3-Clause | Go extended libraries |

## Frontend packages (bundled into the application)

The frontend bundle embeds the CodeMirror editor, the Markdown renderer, the
HTML sanitizer, and the code highlighter:

| Component | License | Purpose |
| --- | --- | --- |
| codemirror, @codemirror/* (state, view, commands, language, search, language-data, lang-markdown, lang-*) | MIT | Editor |
| @lezer/* (highlight, common, and per-language grammars) | MIT | Parser toolchain for CodeMirror |
| marked | MIT | Markdown rendering (CommonMark + GFM) |
| dompurify | Apache-2.0 OR MPL-2.0 | HTML sanitization (dual-licensed; used under Apache-2.0) |
| highlight.js | BSD-3-Clause | Syntax highlighting in the preview |
| crelt | MIT | DOM helper (CodeMirror) |
| style-mod | MIT | CSS helper (CodeMirror) |
| w3c-keyname | MIT | Key naming (CodeMirror) |

Development-only tooling (TypeScript, Vite, Vitest, @playwright/test, jsdom)
is not distributed inside the application binaries.

## Trademarks

The Xtracsys name and logo are trademarks of Xtracsys and are not licensed
under the Apache-2.0 source license. See [TRADEMARKS.md](TRADEMARKS.md).
