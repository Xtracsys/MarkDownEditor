# Contributing to Xtracsys Editor

Thanks for helping build a text editor people can trust with their files.

## The one rule that outranks everything

**File integrity is non-negotiable.** A pull request that writes anything the
user did not type into their document — metadata, formatting, normalization,
telemetry — will be rejected, no matter how useful it seems. When in doubt,
do nothing to the bytes.

Concretely, every change that touches loading or saving must keep these true
(enforced by `internal/fileio` tests and the E2E suite):

1. Opening and closing a file without edits leaves it byte-for-byte unchanged.
2. Saving an unchanged file writes nothing.
3. Encoding, BOM, line endings (including mixed, per line), trailing
   whitespace, and final-newline state round-trip exactly.
4. Binary and unsupported encodings are refused with an explanation, never
   transcoded silently.
5. No state is persisted next to documents — only in the OS app-data folder.

## Ground rules

- **License.** Contributions are accepted under the Apache License 2.0
  (see LICENSE; copyright Xtracsys LLC). Do not submit code you are not
  licensed to contribute.
- **No telemetry, no network features.** The editor is local-first and
  offline. Proposals for accounts, cloud sync, analytics, or auto-updating
  remote content are out of scope.
- **Dependencies** need a justification, a permissive license compatible with
  Apache-2.0, and an entry in THIRD-PARTY-NOTICES.md.
- **Security-relevant bugs** (path handling, the preview sandbox, the image
  handler) must come with a test that fails before the fix.

## Development setup

```bash
git clone <repository-url> && cd xtracsys-editor
go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0
wails doctor   # verify toolchain
```

- Run the app: `wails dev`
- Go tests (the integrity core): `go test ./...`
- Frontend unit tests: `cd frontend && npm ci && npm test`
- Acceptance E2E: `npm run build` in `frontend/`, then `npx playwright test`
  from the root

## Before you open a PR

```bash
go vet ./... && go test ./...
cd frontend && npx tsc --noEmit && npm test && npm run build
cd .. && npx playwright test
```

All green, plus a short rationale in the PR description. UI changes should
include a screenshot. Keep commits focused; the maintainers squash-merge
feature branches.
