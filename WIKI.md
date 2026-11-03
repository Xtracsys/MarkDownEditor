# Xtracsys Editor — Project Guide

Xtracsys Editor is a local-first desktop editor for plain text, code,
configuration files, and Markdown. Its core design goal is to keep documents
portable and preserve their contents unless the user edits and saves them.

## Core guarantees

- Existing encodings, byte-order marks, line endings, trailing whitespace,
  and final-newline state are preserved through edits and saves.
- Unchanged files are not rewritten. External changes are detected before a
  save, and symbolic links are resolved instead of replaced.
- Markdown preview sanitizes rendered content, blocks remote resources by
  default, and displays local images through a bounded file handler.
- There are no accounts, telemetry, or background network requests. Crash
  recovery is optional and off by default.

## Architecture

The desktop shell uses Wails with a Go backend and a TypeScript frontend.
File loading and saving, session state, settings, recovery, and local image
handling live in the Go code. The frontend provides editing, navigation,
Markdown rendering, and presentation. The detailed component map is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Project documentation

- [`README.md`](README.md) — features, installation, build instructions, and
  platform status.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — application components and
  data flow.
- [`docs/SECURITY-AUDIT.md`](docs/SECURITY-AUDIT.md) and
  [`SECURITY.md`](SECURITY.md) — security controls, verification evidence, and
  vulnerability reporting.
- [`docs/PLATFORM-STATUS.md`](docs/PLATFORM-STATUS.md) — tested platform
  coverage and known runtime gaps.
- [`wiki/index.html`](wiki/index.html) — searchable, tabbed reference for the
  source files and project concepts.

The source is licensed under Apache-2.0. Product names and trademarks are
covered separately in [`TRADEMARKS.md`](TRADEMARKS.md).
