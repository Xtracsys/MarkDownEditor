# Tests
*verification*

- **load_test.go** — `internal/fileio/load_test.go` (256 lines): Four test files (load_test 256, save_test 249, eol_test 127, watch_test 95 lines) prove the integrity claims at the byte level. TestLoadRoundTripBytes is a 40-case matrix (5 shapes
- **app_test.go** — `internal/app/app_test.go` (135 lines): Unit tests for the binding surface's tricky contracts: external-open queueing (backlog delivered exactly once via the MarkExternalReady return value, never duplicated as an event),
- **session_test.go** — `internal/session/session_test.go` (116 lines): Three test files pin the store behaviors: recovery (round-trip, oldest-first ordering, corrupt/foreign file tolerance, 0600/0700 permissions, hostile-id escape attempts, empty-cont
- **eol.test.ts** — `frontend/src/eol.test.ts` (107 lines): Three vitest files: eol.test.ts drives real CodeMirror transactions against the terminator tracker (typing inside a CRLF line, splitting with a predominant terminator, mixed files,
- **editor.spec.ts** — `tests/e2e/editor.spec.ts` (638 lines): 27 tests driving the real UI against the real Go backend through the bridge, with real files on disk and real byte checks. Coverage: fresh-install auto-save off; unsaved edits neve
