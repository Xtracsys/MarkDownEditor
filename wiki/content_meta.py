# Wiki content: build pipeline, CI, packaging, repo plumbing.
# SPDX-License-Identifier: Apache-2.0

ARTICLES = [
    dict(
        slug="build-pipeline",
        title="scripts/build-all.sh — the hardened pipeline",
        category="meta", path="scripts/build-all.sh", lines=104, lang="Shell",
        status="META", related=["platform-status", "make-dmg"],
        lead=[
            "Born from the stale-binary incident: Wails' self-sign step aborts on iCloud file-provider xattr detritus (this checkout lived in a synced Desktop folder), and earlier pipelines couldn't tell that the bundle never got replaced. The pipeline compiles with -nopackage (no Wails codesign race), assembles and ad-hoc signs the .app itself from a static template, scrubs file-provider conflict copies ('* 2.*') from frontend/dist before compiling, builds the frontend it embeds, and verifies a unique per-build stamp (generated into internal/app/buildstamp_gen.go — -ldflags -X proved unreliable under the build cache) inside EVERY artifact with raw grep -a (BSD strings proved unreliable on fat binaries).",
        ],
        sections=[
            ("Verification chain", [
                "bare binary → staged .app binary → binary inside the mounted DMG → windows exe. Any stage lacking the stamp aborts the build. The DMG is drag-install (app + /Applications symlink + branded background via scripts/make-dmg.sh + dmg-background.py; Finder icon layout via AppleScript when automation is permitted).",
            ]),
        ],
        key_items=[
            ("build stamp", "GeneratedBuildStamp source literal; grep -a verified in every artifact"),
            ("junk scrub", "iCloud conflict copies ('* 2.*') deleted before go:embed"),
            ("make-dmg.sh", "drag-install DMG: app + Applications symlink + background"),
        ],
    ),
    dict(
        slug="make-icons",
        title="scripts/make-icons.py + capture-screenshots.mjs",
        category="meta", path="scripts/make-icons.py", lines=71, lang="Python",
        status="META", related=["brand"],
        lead=[
            "make-icons.py derives every app icon from the emblem crops: 1024 master, macOS icns via iconutil, Windows ICO (6 sizes), Linux PNG set — the white emblem centered on the sampled dark field. capture-screenshots.mjs renders the README screenshots through the e2e bridge (the same UI the app embeds), since macOS screen capture was unavailable in the build environment.",
        ],
        key_items=[
            ("make-icons.py", "appicon.png, iconfile.png, icon.icns, icon.ico, linux set"),
            ("capture-screenshots.mjs", "light-split / dark-preview / dark-split-editor README shots"),
        ],
    ),
    dict(
        slug="ci",
        title=".github/workflows/ci.yml + playwright.config.ts",
        category="meta", path=".github/workflows/ci.yml", lines=187, lang="YAML",
        status="META", related=["e2e-editor", "security-model"],
        lead=[
            "A three-OS matrix (macOS/Ubuntu/Windows): go vet + race tests, frontend typecheck + vitest, the Playwright acceptance suite (which starts the e2e bridge itself), a file-provider conflict-copy guard, and per-OS packaging (DMG script, NSIS with the version passed via -DVERSION, deb with all icon sizes + root ownership). A separate security job runs govulncheck (pinned Go 1.26.10) and npm audit. Releases are never automatic — publishing requires explicit approval.",
        ],
        sections=[
            ("Playwright config", [
                "playwright.config.ts starts e2e-serve with a hermetic -fresh-home on loopback, workers=1 (the bridge holds shared state), and pipes server output for debugging. The global-setup lesson: config modules load per worker, so cleanup must not live at module scope — it once deleted the recovery folder out from under a running server.",
            ]),
        ],
        key_items=[
            ("security job", "govulncheck + npm audit on every push"),
            ("-fresh-home", "hermetic per-run settings/recovery/session state"),
            ("NSIS -DVERSION", "installer version passed from the pipeline"),
        ],
    ),
    dict(
        slug="packaging",
        title="wails.json + build/ — platform packaging",
        category="meta", path="wails.json", lines=247, lang="JSON",
        status="META", related=["build-pipeline", "brand"],
        lead=[
            "wails.json carries the product identity, frontend build hooks, and 37 file-type associations that render into the macOS Info.plist's CFBundleDocumentTypes (role Editor, iconfile icon). build/darwin/static/Info.plist is the assembler template (identifier editors.xtracsys.xtracsys-editor, LSMinimumSystemVersion 12.0 matching the Go toolchain floor, version stamped at build time via plutil). build/windows/installer/xtracsys-editor.nsi installs to Program Files with Start-menu/desktop shortcuts, a finish-page run checkbox, and a complete uninstall; build/linux holds the hicolor icon set.",
        ],
        key_items=[
            ("fileAssociations", "37 text formats registered for Open With"),
            ("Info.plist floor", "LSMinimumSystemVersion 12.0 (Go 1.25 cannot run on older)"),
        ],
    ),
    dict(
        slug="repo-plumbing",
        title="Repo plumbing, assets, and the wiki itself",
        category="meta", path=".gitignore", lines=26, lang="—",
        status="META",
        lead=[
            "Everything not covered by a dedicated article: .gitignore (build outputs, node_modules, test homes, the generated buildstamp); frontend/tsconfig.json, vite.config.ts, vitest.config.ts (strict TS, noUnusedLocals); frontend/package.json + lock (CodeMirror 6, marked, DOMPurify, highlight.js; vitest + Playwright dev); root package.json (Playwright runner); go.mod/go.sum (Go 1.25, toolchain 1.26.10, wails v2.17.0); LICENSE (Apache-2.0 verbatim), NOTICE, THIRD-PARTY-NOTICES.md, CONTRIBUTING.md, SECURITY.md, TRADEMARKS.md; design/ (the brand reference sheet + emblem crops — the visual authority); docs/screenshots/; internal/fileio/testdata/fuzz (a regression seed); and the wiki tooling itself (wiki/content_*.py modules, wiki_data.json, wikiupdate.py, indexes/) — docs-only, no runtime surface in the shipped app.",
        ],
        sections=[
            ("Docs set", [
                "README.md (user contract), WIKI.md (project record), docs/ARCHITECTURE.md (stack trade-offs), docs/REQUIREMENTS-CHECKLIST.md (requirement→evidence map), docs/PLATFORM-STATUS.md (honest per-OS matrix), docs/SECURITY-AUDIT.md (four audit rounds + dynamic testing), docs/BRAND.md (sampled tokens), CONTRIBUTING.md (integrity-first contribution rules), SECURITY.md (disclosure policy), TRADEMARKS.md (Apache ≠ trademark rights).",
            ]),
        ],
        key_items=[
            ("go.mod toolchain", "1.26.10 — clears nine reachable stdlib CVEs"),
            ("frontend deps", "0 production vulnerabilities; dev-only vitest findings tracked"),
            ("wiki tooling", "content modules + generator output; edit wiki_data.json first, then wikiupdate.py"),
        ],
    ),
]
