# Wiki content: the frontend (TypeScript).
# SPDX-License-Identifier: Apache-2.0

ARTICLES = [
    dict(
        slug="fe-main",
        title="frontend/src/main.ts + index.html — the shell",
        category="frontend", path="frontend/src/main.ts", lines=15, lang="TypeScript",
        status="CORE", pkg="frontend", related=["fe-app", "fe-ipc"],
        lead=[
            "The entry: imports the stylesheet, creates the Backend (choosing wails bindings or the e2e bridge by ?e2e=1), starts the Application, and — in bridge mode only — exposes window.__xe so Playwright can drive real flows. index.html carries the toolbar, tab strip, outline panel, editor host, preview host, empty state (with emblem + recent list), and status bar; deliberately no document-level CSP meta (WebKit does not reliably match script-src 'self' on the wails:// scheme, which silently stripped the injected Wails runtime — the attack surface is the preview iframe, which keeps its own strict CSP).",
        ],
        key_items=[
            ("window.__xe", "bridge-only test hook exposing the Application controller"),
            ("No main-document CSP", "deliberate; documented in the file and SECURITY-AUDIT.md"),
        ],
    ),
    dict(
        slug="fe-app",
        title="frontend/src/app.ts — the controller (1,415 lines)",
        category="frontend", path="frontend/src/app.ts", lines=1415, lang="TypeScript",
        status="CORE", pkg="frontend", phase="the other seam", tested_by="e2e-editor",
        related=["app-go", "fe-ipc", "fe-eol"],
        lead=[
            "The Application class owns tabs, modes, saves, auto-save, crash-recovery offers, session restore, conversions, outline, settings, and every event from the backend. Its invariants mirror the Go side: dirty tracking compares content AND terminators (equalsSaved) so undo-back-to-clean clears the dot; a separate encodingDirty flag keeps conversion changes dirty (autosave skips them — the user's Save is the act); saves ride saveInFlight (autosave included, closing the manual/autosave race); external opens are pull-based (markExternalReady returns the backlog).",
        ],
        sections=[
            ("The bugs this file taught", [
                "The re-entrant save bug (Overwrite in the external-change dialog no-oped against its own in-flight guard) was found by E2E; the autosave/manual race was found by delta review; the ghost Untitled tab and the stale outline were found by the fourth audit round. Each fix carries its comment explaining the invariant.",
            ]),
            ("Boot order matters", [
                "start(): appInfo → getSettings → newTab → markExternalReady (pull backlog, open deterministically) → offerRecovery (void — never gates delivery) → session restore (silent failures, gated by the setting). The fatal-backend screen exists for a dead binding surface; getSettings alone now degrades to a toast.",
            ]),
        ],
        key_items=[
            ("start()", "boot sequence with the exact ordering guarantees documented inline"),
            ("doSave(tab, path, overwrite, quiet)", "save + external-change decision (modal for user saves, banner+toast for autosave)"),
            ("normalizeLineEndings()", "preserves the final-newline state; routes through view.dispatch; disclosed as not-undoable"),
            ("convertToUTF8()", "two-step: marks encodingDirty; the user's Save writes"),
            ("handlePaste(e)", "clipboard image → named file via Go → markdown reference at cursor"),
            ("scheduleSnapshot/scheduleOutline", "debounced side effects keyed per tab"),
        ],
    ),
    dict(
        slug="fe-ipc",
        title="frontend/src/ipc.ts — the backend seam",
        category="frontend", path="frontend/src/ipc.ts", lines=327, lang="TypeScript",
        status="CORE", pkg="frontend", related=["app-go", "e2e-serve"],
        lead=[
            "One interface (Backend) with two implementations: the Wails adapter and the e2e bridge adapter (loopback HTTP + SSE, selected by ?e2e=1). The Wails adapter resolves the bound service STRUCTURALLY — appBinding() scans window.go for the struct exposing NewTab — because the namespace silently moved from main.App to app.App when App changed packages, killing every call for two releases. Event listeners wire synchronously when the runtime exists, with an interval fallback.",
        ],
        sections=[
            ("Null discipline", [
                "Every Go slice that can be nil arrives as JSON null; both adapters materialize arrays (?? []) and every consumer guards. This class caused two production crashes before it became a checked convention with regression tests on both sides.",
            ]),
        ],
        key_items=[
            ("appBinding()", "namespace-agnostic binding resolution — the fix for the 0.1.2 catastrophe"),
            ("createBridgeBackend()", "?e2e=1 loopback adapter: fetch + SSE, same interface"),
            ("fileArgs(args)", "filters launch arguments to document paths"),
        ],
    ),
    dict(
        slug="fe-eol",
        title="frontend/src/eol.ts — the terminator tracker",
        category="frontend", path="frontend/src/eol.ts", lines=119, lang="TypeScript",
        status="CORE", pkg="frontend", tested_by="fe-unit", related=["fileio-eol"],
        lead=[
            "The frontend half of mixed-line-ending preservation: a StateField holding the terminator array, updated on every transaction by applyChanges. For a change covering old lines [first..last] with K new line breaks: terminators before first are untouched, the K new lines take the document's default, the region's trailing terminator survives, and everything after shifts. The math guarantees len(eols) always equals doc.lines.",
        ],
        sections=[
            ("setEolsEffect", [
                "A StateEffect for deliberate normalization (the Convert command): replaces the whole array in one transaction, handled before the docChanged branch. Not undoable (no doc change) — disclosed in the command's dialog.",
            ]),
        ],
        key_items=[
            ("eolField", "StateField: the aligned terminator array"),
            ("applyChanges(oldEols, tr, defaultEol)", "the alignment math — unit-tested against splits/joins/pastes/deletes"),
            ("serialize(content, eols)", "mirrors Go Rebuild exactly"),
            ("setEolsEffect", "deliberate whole-array replacement for Normalize"),
        ],
    ),
    dict(
        slug="fe-editor",
        title="frontend/src/editor.ts — CodeMirror assembly",
        category="frontend", path="frontend/src/editor.ts", lines=208, lang="TypeScript",
        status="CORE", pkg="frontend", related=["fe-app"],
        lead=[
            "State factory and compartment wiring: language detection (filename via LanguageDescription.matchFilename + shebang sniffing), markdown with embedded code languages, wrap/tab/gutter/active-line/font-size compartments, brand syntax palette (rust-family keywords, muted comments — no rainbow), and the EOL compartments. settingsEffects and reconfigureLanguage let the controller reconfigure states without rebuilding them, preserving undo history and cursor.",
        ],
        key_items=[
            ("makeState(opts)", "full per-tab state: EOL config, compartments, keymaps, theme"),
            ("settingsEffects(settings, theme)", "compartment reconfigure effects for live settings changes"),
            ("reconfigureLanguage(state, oldPath, newPath)", "language swap only when markdown-ness flips; undo survives"),
            ("detectLanguage(path, firstLines)", "filename match + shebang fallback"),
        ],
    ),
    dict(
        slug="fe-markdown",
        title="frontend/src/markdown.ts — the render pipeline",
        category="frontend", path="frontend/src/markdown.ts", lines=200, lang="TypeScript",
        status="CORE", pkg="frontend", tested_by="fe-unit", related=["fe-preview", "security-model"],
        lead=[
            "marked (GFM) → DOMPurify (FORBID_TAGS/FORBID_ATTR lists, ALLOW_DATA_ATTR false) → URL rewriting: local images to /ximg/<tabId>/…, remote images replaced with visible blocked-notes (default; the setting admits them and the iframe CSP is built accordingly), links tagged data-external/data-internal/data-anchor with external anchors stripped of their live href (no self-navigation vector). A DOMPurify hook converts task-list checkboxes to styled spans (inputs are forbidden).",
        ],
        sections=[
            ("Attack surface discipline", [
                "Post-sanitize mutations are DOM setAttribute on parsed nodes; the only hand-built attribute is the escaped hljs class. The XSS battery (26 vectors) verifies: no script/iframe/object/embed/form/input/video/source/marquee elements, no event handlers, no javascript:/vbscript:/data:text hrefs, remote URLs absent from DOM and network.",
            ]),
        ],
        key_items=[
            ("renderMarkdown(src, opts)", "the full pipeline; returns html + remoteBlocked list"),
            ("localImageUrl(tabId, src)", "sandboxed image URL with segment encoding; rejects remote/empty"),
            ("isRemoteUrl(url)", "any scheme or protocol-relative counts as remote"),
        ],
    ),
    dict(
        slug="fe-preview",
        title="frontend/src/preview.ts — the sandboxed iframe",
        category="frontend", path="frontend/src/preview.ts", lines=119, lang="TypeScript",
        status="CORE", pkg="frontend", related=["fe-markdown"],
        lead=[
            "Renders the sanitized HTML as srcdoc into an iframe with sandbox=\"allow-same-origin\" (no scripts) and a CSP built from the blocking setting: default-src 'none'; img-src 'self' data: (plus http:/https: only when the user explicitly allows remote resources); style-src 'unsafe-inline' for the app's own stylesheet. Click routing reaches into the same-origin document to send data-external links to Go (scheme-validated) and scroll anchors to elements; debounce, proportional scroll sync, and a once-per-document wiring guard against double listeners.",
        ],
        key_items=[
            ("update(source, tabId, theme)", "debounced rebuild; CSP adapts to the blockRemote setting"),
            ("route(e)", "click routing: external → Go, anchor → scroll, internal → inert"),
        ],
    ),
    dict(
        slug="fe-outline",
        title="frontend/src/outline.ts — the heading tree",
        category="frontend", path="frontend/src/outline.ts", lines=37, lang="TypeScript",
        status="CORE", pkg="frontend", tested_by="fe-unit",
        lead=[
            "parseOutline extracts headings (#{1,6}) outside fenced code blocks, tracking ``` and ~~~ fences with matched markers, returning {level, text, line}. The panel renders with per-level indentation and click-to-jump (selection + scrollIntoView); the controller refreshes it debounced on doc change and immediately on tab switch.",
        ],
        key_items=[
            ("parseOutline(markdown)", "fence-aware heading extraction; unit-tested"),
        ],
    ),
    dict(
        slug="fe-ui",
        title="frontend/src/ui.ts + util.ts — modals, toasts, banners",
        category="frontend", path="frontend/src/ui.ts", lines=179, lang="TypeScript",
        status="CORE", pkg="frontend", related=["fe-app"],
        lead=[
            "The dialog system: promise-based modals with a topmost-only rule (stacked modals — recovery + session-restore issues — resolve one at a time), a focus trap moving keyboard focus to the primary button so the editor behind an overlay never swallows Enter/Escape, toasts, unsaved/quit prompts, and external-change banners keyed per tab. util.ts adds clipboard fallback and platform-correct reveal labels.",
        ],
        key_items=[
            ("showModal(spec)", "promise dialog; topmost-only keys; focus trap"),
            ("showBanner(slot, id, text, actions)", "per-tab external-change strips"),
            ("copyText / revealLabel", "clipboard fallback + Finder/Explorer naming"),
        ],
    ),
    dict(
        slug="fe-settingsui",
        title="frontend/src/settingsui.ts — the settings modal",
        category="frontend", path="frontend/src/settingsui.ts", lines=263, lang="TypeScript",
        status="CORE", pkg="frontend", related=["settings-go"],
        lead=[
            "Hand-built settings modal returning the edited settings on Save (the caller persists). Rows: theme, auto-save (with its off-by-default disclosure), restore-session, auto-save delay, word wrap, indent size, Tab-as-spaces, line numbers, active-line highlight, font size, block-remote-resources, and the crash-recovery disclosure row (Always on). Every input is clamped; the modal is compact enough to avoid scrolling and participates in the topmost-only keyboard rule.",
        ],
        key_items=[
            ("openSettingsModal(current)", "draft-based editing; returns null on cancel"),
            ("imageNameDialog(suggested)", "editable file-name dialog for pasted images"),
        ],
    ),
    dict(
        slug="fe-theme",
        title="frontend/src/theme.ts + styles/ — the brand",
        category="frontend", path="frontend/src/theme.ts", lines=54, lang="TypeScript",
        status="CORE", pkg="frontend", related=["brand"],
        lead=[
            "Three-mode theme (system/light/dark) driving data-theme on the root, with the emblem auto-swapping between the black and white treatments. The tokens are the sampled brand palette; the CodeMirror syntax palette is the same family (rust keywords, muted comments) in both themes. base.css and the preview stylesheet share the variables; the preview iframe re-renders with a theme class.",
        ],
        key_items=[
            ("setTheme / effective / onThemeChange", "system-following with manual override"),
            ("styles/base.css + preview.css", "brand tokens, derived shades documented as derived"),
        ],
    ),
]
