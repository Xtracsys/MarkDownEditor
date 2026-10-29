# Wiki content: specification documents.
# SPDX-License-Identifier: Apache-2.0

ARTICLES = [
    dict(
        slug="architecture",
        title="docs/ARCHITECTURE.md — why this stack",
        category="specs", path="docs/ARCHITECTURE.md", lines=123, lang="Markdown",
        status="SPEC", related=["app-go", "fe-app"],
        lead=[
            "The architecture document is the proposal that preceded implementation, kept current. It justifies Go + Wails v2 over the alternatives: a Markdown preview needs a rendered-HTML surface; Fyne/Gio have no code-editor widget (months of work for a worse editor); Electron is 100 MB+ and drags Node into the process. Wails gives a native webview with a Go backend — the frontend is presentation only.",
        ],
        sections=[
            ("The cost statement", [
                "The document is explicit about what the stack costs: two toolchains at build time (the frontend is embedded, so users need neither Node nor network), webview rendering differences per OS, and the webkit2gtk system dependency on Linux. It also defines the network posture (no listening sockets; asset serving via OS-native custom schemes) and the test strategy (Go tests for the integrity core, vitest for the frontend, Playwright E2E through the loopback bridge).",
            ]),
        ],
        key_items=[
            ("Layer rule", "the frontend performs no file I/O; every byte-level, security-sensitive, and persistence concern is Go with Go tests"),
            ("Network posture", "no listening sockets in the shipped app; assets via OS-native custom schemes"),
        ],
    ),
    dict(
        slug="requirements-checklist",
        title="docs/REQUIREMENTS-CHECKLIST.md — every requirement, mapped to evidence",
        category="specs", path="docs/REQUIREMENTS-CHECKLIST.md", lines=172, lang="Markdown",
        status="SPEC", related=["fileio-tests", "e2e-editor"],
        lead=[
            "Each requirement from the original brief is mapped to where it is implemented and how it is verified, using codes: [T] automated Go test, [E2E] Playwright, [V] verified visually/manually, [D] by design. The file grew a section per release; the 0.1.5 section covers session restore (paths only, app-data, missing files dropped), recent files, the two-step convert commands, the outline panel, image paste, reveal, and print.",
        ],
        sections=[
            ("The verification standard", [
                "The interesting rows are the byte-fidelity ones: 'Never inject metadata' is backed by TestNoMetadataEver and the 40-case round-trip matrix; 'external changes never silently overwritten' by the watcher unit tests plus a full E2E decision flow; 'auto-save off by default' by TestFreshInstallAutoSaveDisabled plus a dedicated E2E. Anything that cannot be tested headlessly is explicitly listed in PLATFORM-STATUS.md's manual checklist instead of being claimed.",
            ]),
        ],
        key_items=[
            ("Codes", "[T] Go test, [E2E] Playwright, [V] manual, [D] by design"),
            ("Honesty rule", "untestable claims are deferred to the manual checklist, never asserted"),
        ],
    ),
    dict(
        slug="platform-status",
        title="docs/PLATFORM-STATUS.md — honest per-OS state",
        category="specs", path="docs/PLATFORM-STATUS.md", lines=72, lang="Markdown",
        status="SPEC", related=["build-pipeline"],
        lead=[
            "The platform matrix distinguishes Built / Auto-tested / Manually tested / Verified, because 'it compiles in CI' is not 'it works'. macOS is verified on real hardware (launch, edit/save, Open With via real Apple Events); Windows and Linux are CI-built and headless-tested but honestly marked unverified until someone runs the 11-step interactive checklist.",
        ],
        sections=[
            ("Stated blockers", [
                "Signing and notarization require certificates that do not exist yet (Gatekeeper/SmartScreen prompts expected). CI workflows are written but not executed — publishing the repository awaits explicit approval. The manual checklist covers dialogs, Gatekeeper flow, and OS-specific quirks per platform.",
            ]),
        ],
        key_items=[
            ("macOS", "universal .app + drag-install DMG, ad-hoc signed; Open With verified via real Apple Events"),
            ("Windows/Linux", "cross-built/CI-tested; interactive verification pending hardware"),
        ],
    ),
    dict(
        slug="brand",
        title="docs/BRAND.md + design/ — the visual authority",
        category="specs", path="docs/BRAND.md", lines=63, lang="Markdown",
        status="SPEC", related=["make-icons"],
        lead=[
            "Brand tokens were sampled pixel-by-pixel from the supplied reference sheet (design/brand-reference.png): warm white #F6F5F1, black #080808, dark field #0A0B0C, rust #B14831. The document is explicit that derived UI shades (borders, muted text, dark-theme accents like #C0593F/#D0795F) are interpolations for contrast, not official tokens, and that production vector logo assets have been requested — every current asset is a labeled temporary raster crop.",
        ],
        sections=[
            ("Asset lineage", [
                "design/crops/B_light_emblem_tight.png (black emblem, 497×509) and E_inverse_emblem_tight.png (white on dark, same geometry) feed frontend/public/logo-light.png, logo-dark.png, and scripts/make-icons.py, which composes the app icon as the white emblem centered on the dark field. The icon bug in 0.1.3 (Resources/icon.icns vs the plist's required iconfile.icns) is why the plist name is documented here.",
            ]),
        ],
        key_items=[
            ("Tokens", "#F6F5F1 / #080808 / #0A0B0C / #B14831 / #FFFFFF — sampled, not guessed"),
            ("Temporary assets", "raster crops pending production vectors; requests recorded in this document"),
        ],
    ),
]
