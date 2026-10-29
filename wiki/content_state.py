# Wiki content: state stores (settings, recovery, session, localimg).
# SPDX-License-Identifier: Apache-2.0

ARTICLES = [
    dict(
        slug="settings-go",
        title="internal/settings/settings.go — preferences in app-data",
        category="core", path="internal/settings/settings.go", lines=144, lang="Go", status="CORE",
        pkg="settings", tested_by="settings-tests", related=["fe-settingsui"],
        lead=[
            "The entire persisted application state as one JSON file in <OS app-data>/xtracsys-editor/settings.json (0600). Defaults are chosen for safety: auto-save OFF, remote-resource blocking ON, restore-session ON, theme system. Load fails open to safe defaults (a corrupt file disables auto-save) and normalize clamps every value into range so older files stay forward-compatible.",
        ],
        sections=[
            ("The fields", [
                "RestoreSession (session reopen, paths only), Theme (system/light/dark), AutoSaveEnabled + AutoSaveDelayMs (250 ms–60 s clamp), WordWrap, TabSize (1–8), InsertSpaces, ShowLineNumbers, HighlightActiveLine, EditorFontSize (0 = default), BlockRemoteResources (preview network off-switch). Nothing here is ever written beside a document.",
            ]),
        ],
        key_items=[
            ("Dir() / Path()", "app-data location; created 0700"),
            ("Load()", "defaults on fresh install or corrupt file — auto-save can never silently turn on"),
            ("Save(s)", "clamped, 0600, newline-terminated"),
        ],
    ),
    dict(
        slug="recovery-go",
        title="internal/recovery/recovery.go — crash-recovery snapshots",
        category="core", path="internal/recovery/recovery.go", lines=182, lang="Go", status="CORE",
        pkg="recovery", tested_by="recovery-tests", related=["app-go"],
        lead=[
            "Periodic snapshots of dirty buffers so a crash never loses work. The constraints are enforced here and by tests: snapshots live only in <app-data>/recovery, never beside documents; files are 0600 in a 0700 directory; writes are atomic (temp + rename); corrupt or foreign files are ignored, never fatal; the tmp sweep spares files younger than five minutes so an in-flight write is never unlinked.",
        ],
        sections=[
            ("Hostile-id defense", [
                "Snapshot ids come from tab ids, but safeName still enforces [A-Za-z0-9._-], no leading dot, 128-char cap — traversal through a crafted id is impossible and tested (TestHostileIdsCannotEscapeFolder). List skips corrupt JSON and empties are recoverable (a dirty-but-emptied buffer still restores as an empty tab).",
            ]),
        ],
        key_items=[
            ("Save(e)", "atomic 0600 snapshot keyed by tab id"),
            ("List()", "valid entries oldest-first; corrupt/foreign files skipped; tmp sweep with 5-minute grace"),
            ("Clear(ids...) / ClearAll()", "removal on save/close/discard"),
        ],
    ),
    dict(
        slug="session-go",
        title="internal/session/session.go — session + recent files",
        category="core", path="internal/session/session.go", lines=128, lang="Go", status="CORE",
        pkg="session", tested_by="session-tests", related=["app-go", "app-menu"],
        lead=[
            "Paths only — never document content (unsaved work belongs to recovery). One session.json (0600, atomic) holds Recent (deduplicated, capped at 10, most-recent-first) and LastSession (open named documents at quit). LoadLastSession drops paths that no longer exist so a deleted file never errors at launch; LoadRecent keeps everything for menu gray-out but re-caps against tampered files.",
        ],
        sections=[
            ("Privacy posture", [
                "The RestoreSession setting gates both the restore read (GetLastSession returns empty when off) and the shutdown write (SaveSessionNow returns early). The mutex serializes AddRecent and SaveLastSession, which share one temp path. Disclosed in Settings next to the auto-save row.",
            ]),
        ],
        key_items=[
            ("SaveLastSession(paths)", "overwrites the recorded session; empty list is valid"),
            ("LoadLastSession()", "existing paths only, order preserved"),
            ("AddRecent(path)", "dedupe + move-to-front + cap 10"),
        ],
    ),
    dict(
        slug="localimg",
        title="internal/localimg/handler.go — the preview image sandbox",
        category="core", path="internal/localimg/handler.go", lines=114, lang="Go", status="CORE",
        pkg="localimg", tested_by="localimg-tests", related=["fe-markdown", "security-model"],
        lead=[
            "The preview's only channel to local files. /ximg/<tabId>/<rel> resolves against the open document's directory: symlinks resolved on BOTH sides (a symlinked document directory still works, a symlink escaping the tree is blocked with a response byte-identical to not-found so the handler cannot be an existence oracle), GET-only, 20 MB cap, regular files only, content-sniffed against a raster allowlist with SVG explicitly refused (scripts), nosniff header.",
        ],
        sections=[
            ("Containment proof shape", [
                "filepath.Join + Clean lexically contains, EvalSymlinks resolves reality, and a separator-aware prefix check verifies the real path is inside the resolved document root. In the shipped app the handler is unreachable from outside the webview (Wails serves assets via in-process scheme handlers, not TCP) — the TCP exposure exists only in the test bridge, which is Host-pinned.",
            ]),
        ],
        key_items=[
            ("ServeHTTP", "GET-only, tab-gated, contained, sniffed, capped, nosniff"),
            ("ResolveTab", "the App injects its tab registry; unknown/untitled tabs 404"),
        ],
    ),
]
