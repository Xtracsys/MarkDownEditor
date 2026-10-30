# Wiki content: Go application core.
# SPDX-License-Identifier: Apache-2.0

ARTICLES = [
    dict(
        slug="main-go",
        title="main.go — window, argv, single instance",
        category="core", path="main.go", lines=109, lang="Go", status="CORE",
        pkg="main", related=["app-go", "fe-main"],
        lead=[
            "main.go is the thin Wails entry: it builds the App service, queues any documents passed on the command line, assembles the options (window, asset server with the /ximg/ handler, menu, drag-and-drop, single-instance lock, Mac options), and runs. Everything interesting lives in internal/app; this file only wires.",
        ],
        sections=[
            ("External opens at the door", [
                "fileArgs(os.Args[1:]) extracts document paths (skipping '-'-prefixed flags so -psn_* launch noise never becomes a document) and queues them before wails.Run — the Windows/Linux 'Open With' path. macOS Finder opens arrive separately as Apple Events via mac.Options.OnFileOpen. Both flow into App.QueueExternalOpen, which queues until the UI signals readiness.",
            ]),
            ("Single instance + drop", [
                "SingleInstanceLock (UniqueId editors.xtracsys.xtracsys-editor) forwards second-launch arguments to the first instance, resolving relative paths against the second instance's WorkingDirectory. DragAndDrop enables file drop with DisableWebViewDrop: true so the webview can never navigate to a dropped file. mac.OnFileOpen forwards Finder opens; mac.About carries the version.",
            ]),
        ],
        key_items=[
            ("fileArgs(args)", "filters launch arguments down to document paths (drops flags/empties)"),
            ("DragAndDrop option", "EnableFileDrop + DisableWebViewDrop — drop opens files, never navigates"),
            ("OnSecondInstanceLaunch", "second launch → resolve relative args against its CWD → forward to instance one"),
        ],
    ),
    dict(
        slug="app-go",
        title="internal/app/app.go — the bound service",
        category="core", path="internal/app/app.go", lines=837, lang="Go", status="CORE",
        pkg="app", phase="the seam between UI and bytes", tested_by="app-tests",
        related=["main-go", "app-menu", "fileio-save", "fe-ipc"],
        lead=[
            "App is the single struct bound to the webview: every capability the UI has goes through its exported methods, and each one is a chokepoint that validates before touching disk. It owns the tab registry (path, encoding, known on-disk hash, dirty flag), the external-open queue, crash-recovery and session stores, settings, and the event emitter that routes Go→JS events through either Wails runtime.EventsEmit (desktop) or the headless sink (test bridge).",
            "The struct was the source of the project's worst bug: moving it from package main to internal/app renamed the generated bindings from window.go.main.App to window.go.app.App, and the frontend's hard-coded namespace died. The frontend now resolves the bound service structurally (any package, struct exposing NewTab), so the namespace can never silently break again.",
        ],
        sections=[
            ("External opens: queue then pull", [
                "QueueExternalOpen trims, drops flags and the executable's own path (EqualFold full-path compare), and either queues (extPending, before the UI is ready) or emits open:paths immediately. MarkExternalReady flips extReady atomically under extMu and RETURNS the backlog as its RPC result — delivery is pull-based, immune to event-listener wiring races. The unit test asserts exactly-once: the backlog arrives as the return value, never also as an event.",
            ]),
            ("SaveTab: the chokepoint", [
                "Validates tab existence, read-only state (in-place only — exports are allowed and clear the flag), non-empty path, and the encoding enum before any write. The known-state gate passes only for in-place saves; Save As onto another file is a deliberate policy (the native dialog confirms replace). After success it updates t.path/encoding/known, clears readOnly on export, and re-arms the watcher only if the tab still exists (a save completing after CloseTab is dropped).",
            ]),
            ("Conversions and recovery", [
                "Convert to UTF-8 is frontend-driven (encodingDirty blocks autosave so the user's Save is the write). SnapshotTab validates the buffer with fileio.Rebuild before persisting and drops snapshots for tabs that no longer exist; RecoverEntry restores as a dirty tab with the on-disk known-state adopted so watcher and save-guard agree.",
            ]),
        ],
        key_items=[
            ("OpenPaths(paths, silentFailures)", "loads files; session restore uses silent mode so unreadable entries become one summary toast, never a modal"),
            ("MarkExternalReady() []string", "flips live delivery + returns the queued backlog (pull-based)"),
            ("SaveTab(tabId, path, content, eols, encoding, overwrite)", "validates, gates on known hash, safe-saves, updates known state under lock"),
            ("WriteImageFile(tabId, name, base64)", "O_EXCL image write next to the document; charset-restricted name, sniffed PNG/JPEG, 20 MB cap, -N suffixes, never overwrites"),
            ("RevealPath(path)", "open -R / explorer /select, / xdg-open; refuses flag-like paths"),
            ("RecoverEntry(id)", "restores a crash snapshot as a dirty tab; adopts current disk state for the watcher"),
        ],
    ),
    dict(
        slug="app-menu",
        title="internal/app/menu.go — the native menu",
        category="core", path="internal/app/menu.go", lines=108, lang="Go", status="CORE",
        pkg="app", related=["app-go", "session-go"],
        lead=[
            "menu.go builds the native application menu and reinstalls it whenever the recent-files list changes (runtime.MenuSetApplicationMenu after Startup). macOS gets the App/Edit/Window role menus — the Edit role is what makes ⌘C/⌘V/⌘A work in WKWebView; every app-specific item emits a string action (via EmitMenuAction) that the frontend handles exactly like its own keyboard shortcuts.",
        ],
        sections=[
            ("Open Recent", [
                "The submenu lists recent paths, most recent first, with missing files disabled (checked via os.Stat) and a Clear Menu item. Recent items encode their path in the action string as \"open-recent\\u001f\" + path — the unit separator cannot collide with the action prefix, and the frontend splits with startsWith+slice, so a \\u001f byte inside a Linux filename stays part of the path.",
            ]),
            ("Menu surface", [
                "File (New/Open/Open Recent/Save/Save As/Print/Convert/Close/Exit), View (modes, outline, wrap, themes), Help (shortcuts/settings/about). Print uses ⌘P; Convert items emit convert-utf8 / normalize-eol.",
            ]),
        ],
        key_items=[
            ("BuildMenu() *menu.Menu", "constructs the full menu from current state; role menus on darwin only"),
            ("rebuildMenu()", "MenuSetApplicationMenu after Startup; no-op without a webview context"),
        ],
    ),
    dict(
        slug="e2e-serve",
        title="cmd/e2e-serve — the loopback test bridge",
        category="core", path="cmd/e2e-serve/main.go", lines=413, lang="Go", status="TEST",
        pkg="main", tested_by="guard-tests", related=["security-model", "e2e-editor"],
        lead=[
            "A test harness, never shipped: it serves the built frontend and exposes the real App methods over JSON on loopback, so Playwright drives the actual editor UI against the actual Go backend headlessly. It also implements the pull-based event bridge (SSE) and the test hooks (_EmitMenuAction, _SetSession) that let E2E tests simulate native flows.",
        ],
        sections=[
            ("The guard", [
                "Every POST /api/ request passes guard(): Origin must be absent or exactly the app's own http://<addr> (browsers attach Origin to all same-origin POSTs — the earlier version wrongly rejected those), Host must equal the bound address (DNS-rebinding defense), Content-Type must be JSON (forces a CORS preflight for cross-site browsers). A live attack suite (scripts/security-dynamic.mjs) verifies all of it against the running server; guard_test.go covers the function. /api/events and /ximg/ are Host-pinned for parity.",
            ]),
            ("Method dispatch", [
                "No reflection: dispatch() has an explicit case per method, decoding typed arguments (the strictness caught a real test-script bug — a string passed where []string was expected). Test hooks use the _-prefix convention and exist only in this binary; the shipped main.go has no HTTP server at all.",
            ]),
        ],
        key_items=[
            ("guard(w, r, addr)", "Origin same-origin + Host pin + JSON content-type; 403/403/415"),
            ("dispatch(a, method, args)", "explicit typed dispatch — 25+ methods including recovery, session, image-write"),
            ("_SetSession / _EmitMenuAction", "deterministic test hooks, underscore-prefixed, never bound in production"),
        ],
    ),
]
