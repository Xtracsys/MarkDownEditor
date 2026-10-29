# Wiki content: project overviews (README, WIKI.md, security model).
# SPDX-License-Identifier: Apache-2.0

ARTICLES = [
    dict(
        slug="project-overview",
        title="README.md — the user-facing contract",
        category="overview", path="README.md", lines=194, lang="Markdown",
        status="META", related=["release-history", "architecture"],
        lead=[
            "README.md is the promise the rest of the codebase has to keep. It opens with the product's single non-negotiable rule — a file's bytes change only in response to user edits, and only when the user saves — and derives every advertised feature from it: byte-faithful saves, no metadata injection, no silent reformatting, offline-only operation.",
            "It was rewritten four times as features landed, and every claim in it is backed by a test somewhere in the repository. The install section documents the drag-to-install DMG flow and the Gatekeeper right-click-Open dance for ad-hoc-signed builds, because the project ships without Apple notarization until a Developer certificate exists.",
        ],
        sections=[
            ("Feature list discipline", [
                "Each bullet in the editing/markdown/security sections names a mechanism that exists in code: per-line terminator tracking, the O_EXCL image writer, the origin/Host/Content-Type guard on the test bridge. When a feature was added in 0.1.5 (session restore, Open Recent, convert commands, outline, image paste, reveal, print), the README bullet was written to describe the guarantee, not the UI — e.g. image paste 'writes a new file next to the document (user-named, never overwrites, PNG/JPEG sniffed)'.",
                "The wiki link section was added last, pointing at WIKI.md for the full project story, keeping the README user-facing rather than historical.",
            ]),
        ],
        key_items=[
            ("Byte-faithful saves", "encoding, BOM, per-line EOL (incl. mixed), trailing whitespace, final-newline state all round-trip; unchanged saves write nothing"),
            ("Local-first promise", "no accounts, telemetry, or background network calls; the preview blocks remote resources by default"),
            ("Install section", "DMG drag-to-Applications + Gatekeeper first-launch instructions for ad-hoc signed builds"),
        ],
    ),
    dict(
        slug="release-history",
        title="WIKI.md — the complete project record",
        category="overview", path="WIKI.md", lines=265, lang="Markdown",
        status="META", related=["project-overview", "security-model"],
        lead=[
            "WIKI.md is the historical encyclopedia of this thread: what was built in each release, what broke, how it was diagnosed, and what the project taught. It exists because several of the bugs here were unusual enough to be worth remembering — a bindings namespace that moved when a struct changed packages, a build pipeline silently shipping stale binaries because a codesign step aborted, an iCloud file provider that renamed README.md and corrupted build outputs.",
            "Each release section follows the same shape: what shipped, what the war story was, and how it was verified. The 'war stories' section distills the transferable lessons: error visibility is a feature (silent fallbacks masked dead bindings for three releases), static audits find design flaws while dynamic tests find wiring bugs, and nil slices crossing Go→JSON→TS crash on .length.",
        ],
        sections=[
            ("Release highlights", [
                "0.1.0 — working editor: Go file-integrity engine, Wails app, frontend, e2e bridge. First acceptance run caught a re-entrant-save bug in the external-change flow.",
                "0.1.1 — 'Open With' (macOS Apple Events were never wired), crash recovery, first static security audit.",
                "0.1.2 — the bindings catastrophe: App moved from package main to internal/app, silently renaming window.go.main.App to window.go.app.App; a strict CSP meta broke the injected runtime; a nil-slice crashed startup. Fixed plus the error-visibility work that made it diagnosable.",
                "0.1.3 — icon fix (iconfile.icns name mismatch) + three-audit bug hunt (packaging, frontend QA, regression review).",
                "0.1.4 — stale-artifact pipeline fix: build stamp verification after the installed app was found running old code; iCloud detritus countermeasures.",
                "0.1.5 — dynamic security testing (fuzzers, XSS battery, HTTP attack suite) + the approved roadmap features: session restore (with setting), Open Recent, convert commands, outline, image paste, reveal, print.",
            ]),
        ],
        key_items=[
            ("War story: silent fallbacks", "the settings fallback masked dead backend bindings until the fatal-backend screen was added"),
            ("War story: iCloud", "synced folders rename files mid-build, re-attach codesign-breaking xattrs, and resurrect deleted conflict copies into go:embed"),
            ("War story: test the wiring", "guard() had a unit test while the handler never called it — only the live HTTP attack suite caught it"),
        ],
    ),
    dict(
        slug="security-model",
        title="docs/SECURITY-AUDIT.md + SECURITY.md — the security record",
        category="overview", path="docs/SECURITY-AUDIT.md", lines=202, lang="Markdown",
        status="META", related=["e2e-serve", "fe-markdown", "fileio-save"],
        lead=[
            "The security record spans four audit rounds plus a dynamic-testing program. The model is defense in depth around untrusted content: the Markdown preview is a sandboxed iframe (allow-same-origin, NO allow-scripts) with CSP default-src 'none', fed by marked → DOMPurify → URL rewriting; local images are served only from the open document's directory tree through a sniffed, size-capped, SVG-excluding handler; the only outbound network action in the shipped app is a user-clicked http(s) link validated in Go.",
            "SECURITY.md is the disclosure policy: scope (fileio, preview sandbox, image handler, settings, dependency vulnerabilities), out-of-scope (the webview engines themselves), design guarantees researchers should test, and the crash-recovery data disclosure (0600 snapshots in app-data only).",
        ],
        sections=[
            ("Round-by-round", [
                "Round 1 (static, at 0.1.1): preview sandbox verified; image-handler containment hardened; e2e bridge origin/Host/Content-Type guard added after the drive-by-write finding; Go toolchain pinned to 1.26.10 for nine reachable stdlib CVEs.",
                "Round 2 (frontend): sanitizer configuration, srcdoc/CSP construction, DOM hygiene (textContent everywhere) verified; four low fixes applied.",
                "Round 3 (dynamic, at 0.1.5): Go fuzzers (60M+ execs), a 26-vector live XSS battery, and a 19-check HTTP attack suite. The dynamic suite caught two real regressions: the bridge guard dropped from the handler, and the same guard over-rejecting same-origin POSTs (browsers attach Origin to all non-GET requests).",
                "Round 4 (0.1.5 features): WriteImageFile containment provable (charset-restricted names, fixed extension, O_EXCL), menu action round-trip injection-proof; fixes for the normalize trailing-terminator bug and RevealPath flag-like paths.",
            ]),
        ],
        key_items=[
            ("Preview sink", "sandbox without allow-scripts + CSP default-src 'none' — a sanitizer bypass has nothing to execute"),
            ("Dynamic suites", "tests/e2e/security.spec.ts (XSS battery) + scripts/security-dynamic.mjs (HTTP attacks) — repeatable"),
            ("Scanners", "govulncheck and npm audit run in CI; 0 findings on the current toolchain"),
        ],
    ),
]
