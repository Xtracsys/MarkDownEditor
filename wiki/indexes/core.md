# Core
*the meat*

- **main.go** — `main.go` (109 lines): main.go is the thin Wails entry: it builds the App service, queues any documents passed on the command line, assembles the options (window, asset server with the /ximg/ handler, me
- **app.go** — `internal/app/app.go` (837 lines): App is the single struct bound to the webview: every capability the UI has goes through its exported methods, and each one is a chokepoint that validates before touching disk. It o
- **menu.go** — `internal/app/menu.go` (108 lines): menu.go builds the native application menu and reinstalls it whenever the recent-files list changes (runtime.MenuSetApplicationMenu after Startup). macOS gets the App/Edit/Window r
- **main.go** — `cmd/e2e-serve/main.go` (401 lines): A test harness, never shipped: it serves the built frontend and exposes the real App methods over JSON on loopback, so Playwright drives the actual editor UI against the actual Go 
- **eol.go** — `internal/fileio/eol.go` (178 lines): eol.go is why mixed line endings survive editing. ParseEols splits text into lines plus a parallel terminator array ("\n", "\r\n", "\r", or "" for the final line) — the canonical r
- **encoding.go** — `internal/fileio/encoding.go` (141 lines): Hand-rolled UTF-16 codec (the stdlib utf16 package lacks surrogate predicates) with explicit lossy semantics: DecodeUTF16 replaces unpaired surrogates and trailing odd bytes with U
- **load.go** — `internal/fileio/load.go` (296 lines): Load is the front door. It stats first (regular files only — /dev/zero and FIFOs are refused), enforces the 32 MiB size cap and 2M-line guard (a newline bomb would otherwise alloca
- **save.go** — `internal/fileio/save.go` (207 lines): SaveDocument is the protocol that makes 'byte-faithful' true: resolve symlinks (follow, never replace), stat (regular files only), read the on-disk copy, gate on the known hash (ex
- **watch.go** — `internal/fileio/watch.go` (186 lines): A deliberately polling watcher (stat + SHA-256 on change): identical behavior on every OS and filesystem including network mounts, no inotify dependencies, and cheap for a handful 
- **fuzz_test.go** — `internal/fileio/fuzz_test.go` (120 lines): Three property-based fuzzers that have executed 60M+ times without finding a corruption path — after two property bugs in the harness itself were fixed (the fuzzer constructed edit
- **settings.go** — `internal/settings/settings.go` (144 lines): The entire persisted application state as one JSON file in <OS app-data>/xtracsys-editor/settings.json (0600). Defaults are chosen for safety: auto-save OFF, remote-resource blocki
- **recovery.go** — `internal/recovery/recovery.go` (182 lines): Periodic snapshots of dirty buffers so a crash never loses work. The constraints are enforced here and by tests: snapshots live only in <app-data>/recovery, never beside documents;
- **session.go** — `internal/session/session.go` (128 lines): Paths only — never document content (unsaved work belongs to recovery). One session.json (0600, atomic) holds Recent (deduplicated, capped at 10, most-recent-first) and LastSession
- **handler.go** — `internal/localimg/handler.go` (114 lines): The preview's only channel to local files. /ximg/<tabId>/<rel> resolves against the open document's directory: symlinks resolved on BOTH sides (a symlinked document directory still
