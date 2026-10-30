<!--
  The one rule that outranks everything: file integrity is non-negotiable.
  A change that writes anything the user did not type into their document —
  metadata, formatting, normalization, telemetry — will be rejected.
-->

## What and why

<!-- Short rationale. Link issues with Fixes #N. -->

## Integrity checklist (required for anything touching load/save/preview)

- [ ] Opening and closing a file without edits leaves it byte-for-byte unchanged
- [ ] Saving an unchanged file writes nothing
- [ ] Encoding, BOM, line endings (incl. mixed), trailing whitespace, and final-newline state round-trip exactly
- [ ] No state is persisted next to documents (app-data folder only)
- [ ] Binary/unsupported encodings are refused with an explanation, not transcoded

## General checklist

- [ ] `go vet ./... && go test ./...` green
- [ ] `cd frontend && npx tsc --noEmit && npx vitest run && npm run build` green
- [ ] `npx playwright test` green
- [ ] No telemetry, no network calls, no new dependencies without license check
- [ ] UI changes include a screenshot
