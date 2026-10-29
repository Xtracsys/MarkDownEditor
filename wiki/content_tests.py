# Wiki content: the test suites.
# SPDX-License-Identifier: Apache-2.0

ARTICLES = [
    dict(
        slug="fileio-tests",
        title="internal/fileio tests — the integrity proofs",
        category="tests", path="internal/fileio/load_test.go", lines=256, lang="Go",
        status="TEST", pkg="fileio", related=["fileio-load", "fileio-save", "fileio-eol", "fileio-fuzz"],
        lead=[
            "Four test files (load_test 256, save_test 249, eol_test 127, watch_test 95 lines) prove the integrity claims at the byte level. TestLoadRoundTripBytes is a 40-case matrix (5 shapes × 4 encodings) asserting byte equality through a full load/save cycle. TestSaveUnchangedPreservesBytesAndSkipsWrite proves an unchanged save writes nothing (mtime untouched). TestSaveDetectsExternalChange proves the gate refuses and the foreign content survives. TestSavePreservesMixedLineEndings pins per-line endings across edits. TestSaveFollowsSymlinkWithoutReplacingIt, TestSavePreservesPermissions, TestSaveLeavesNoTempClutter cover the safe-save protocol.",
        ],
        sections=[
            ("The watched invariants", [
                "watch_test.go proves the full state machine with timing: touch-with-identical-bytes must NOT fire, real changes fire exactly once, deletion and restoration both detected, and the app's own saves are absorbed after Update. Every flake here historically pointed at a real product bug (the stale-binary incident was caught because Startup logs appeared in these tests' output).",
            ]),
        ],
        key_items=[
            ("TestLoadRoundTripBytes", "40-case encoding×EOL×BOM×final-newline matrix"),
            ("TestNoMetadataEver", "no BOM/header/trailer injection for any content shape"),
            ("TestSaveDetectsExternalChange", "refuse → foreign content intact → explicit overwrite"),
        ],
    ),
    dict(
        slug="app-tests",
        title="internal/app tests — the service contracts",
        category="tests", path="internal/app/app_test.go", lines=135, lang="Go",
        status="TEST", pkg="app", related=["app-go"],
        lead=[
            "Unit tests for the binding surface's tricky contracts: external-open queueing (backlog delivered exactly once via the MarkExternalReady return value, never duplicated as an event), flag/empty filtering, ListRecovery and NewTab marshaling [] instead of null (the nil-slice crash class), and headless lifecycle sanity. The headless harness (InitHeadless + event sink) is how the service is tested without a webview.",
        ],
        key_items=[
            ("TestExternalOpenQueuesUntilReady", "pull-based delivery; no event before ready, none duplicated after"),
            ("TestExternalOpenFiltersFlagsAndEmpties", "-psn_* noise and argv[0] never become documents"),
            ("TestListRecoveryMarshalsEmptyNotNUll / TestNewTabWarningsNotNull", "the nil-slice regression class"),
        ],
    ),
    dict(
        slug="state-tests",
        title="recovery/session/settings tests — the store contracts",
        category="tests", path="internal/session/session_test.go", lines=116, lang="Go",
        status="TEST", pkg="session", related=["recovery-go", "session-go", "settings-go"],
        lead=[
            "Three test files pin the store behaviors: recovery (round-trip, oldest-first ordering, corrupt/foreign file tolerance, 0600/0700 permissions, hostile-id escape attempts, empty-content recoverability), session (round-trip, missing-file dropping, dedupe/move-to-front/cap-10, clear, permissions), settings (fresh-install auto-save OFF — the acceptance requirement — persistence of user choice, app-data-not-project location, corrupt-file fallback to safe defaults, clamping).",
        ],
        key_items=[
            ("TestFreshInstallAutoSaveDisabled", "acceptance requirement #1, enforced"),
            ("TestHostileIdsCannotEscapeFolder", "recovery id traversal is impossible"),
            ("TestSettingsLiveInAppDataNotProject", "nothing is ever written beside documents"),
        ],
    ),
    dict(
        slug="fe-unit",
        title="frontend unit tests — vitest",
        category="tests", path="frontend/src/eol.test.ts", lines=107, lang="TypeScript",
        status="TEST", pkg="frontend", related=["fe-eol", "fe-markdown", "fe-outline"],
        lead=[
            "Three vitest files: eol.test.ts drives real CodeMirror transactions against the terminator tracker (typing inside a CRLF line, splitting with a predominant terminator, mixed files, joins, multi-line pastes, deletes, undo) and checks serialize/equalsSaved. markdown.test.ts runs the XSS-relevant assertions (sanitizer stripping, remote blocking, URL rewriting, scheme tagging). outline.test.ts pins fence-aware heading extraction including marker-matched closing fences.",
        ],
        key_items=[
            ("eol.test.ts", "the alignment math under real transactions — the frontend half of byte fidelity"),
            ("markdown.test.ts", "sanitizer + URL rewriting guarantees"),
            ("outline.test.ts", "fence tracking with matched markers"),
        ],
    ),
    dict(
        slug="e2e-editor",
        title="tests/e2e/editor.spec.ts — the acceptance suite",
        category="tests", path="tests/e2e/editor.spec.ts", lines=638, lang="TypeScript",
        status="TEST", related=["e2e-serve", "platform-status"],
        lead=[
            "27 tests driving the real UI against the real Go backend through the bridge, with real files on disk and real byte checks. Coverage: fresh-install auto-save off; unsaved edits never touch files; auto-save on/off transitions; byte fidelity through real edits (CRLF + no final newline, mixed endings); markdown modes incl. task lists/code/tables/local images; theme + preview byte-neutrality; dotfile/extensionless/unknown-extension cycles; binary refusal; read-only flow; external-change decision flow; close/quit guards; zero network egress; crash recovery; session restore on/off; both convert commands (byte-verified); outline jump; image paste round-trip.",
        ],
        sections=[
            ("The patterns that matter", [
                "openFile waits for the tab to be ACTIVE (typing before that lands in the previous tab — a real flake source); flows that raise modals are fire-and-forget so the caller can click; the session tests set the session explicitly via _SetSession and clear stale recovery snapshots for determinism; the settings-write race is handled by polling the backend until the value lands before reloading.",
            ]),
        ],
        key_items=[
            ("byte fidelity tests", "shasum-equivalent byte equality through the real UI"),
            ("external-changes test", "the flow that caught the re-entrant-save bug"),
            ("security.spec.ts sibling", "the XSS battery + scheme refusal"),
        ],
    ),
]
