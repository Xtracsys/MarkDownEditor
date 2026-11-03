# Wiki content: project overviews (README, WIKI.md, security model).
# SPDX-License-Identifier: Apache-2.0

ARTICLES = [
    dict(
        slug="project-overview",
        title="README.md — the user-facing contract",
        category="overview", path="README.md", lines=202, lang="Markdown",
        status="META", related=["release-history", "architecture"],
        lead=[
            "README.md introduces the editor's central guarantee: documents change only through user edits and explicit saves. Its feature descriptions focus on the mechanisms that support that guarantee, including byte-faithful file handling, safe saves, a local-first design, and a Markdown preview that blocks remote resources by default.",
            "The README also gives platform-specific build and installation guidance and links to the architecture, security, and platform-status documentation for readers who need more detail.",
        ],
        sections=[
            ("Product claims and evidence", [
                "The file-integrity section describes the supported encodings, byte-order marks, per-line terminators, and final-newline behavior. Save behavior includes unchanged-file detection, atomic replacement, and external-change checks; the related implementation is documented in the file I/O articles.",
                "Privacy and preview claims are described alongside their concrete controls: no background network requests, sanitization before Markdown rendering, a sandboxed preview frame, and a restricted handler for local images.",
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
        title="WIKI.md — project guide",
        category="overview", path="WIKI.md", lines=41, lang="Markdown",
        status="META", related=["project-overview", "security-model"],
        lead=[
            "WIKI.md is a concise starting point for readers who want the product's core guarantees, a high-level architecture summary, and links to the detailed project documentation.",
            "The generated tabbed wiki provides file-level reference material. README.md remains the main entry point for installation, features, and platform support.",
        ],
        sections=[
            ("Core design guarantees", [
                "File loading and saving preserve supported encodings and line endings, including mixed line endings. Unchanged files are not rewritten, writes use a temporary file and atomic replacement, and external changes are checked before saving.",
                "The application works locally without accounts, telemetry, or background network access. Crash recovery is optional and disabled by default; Markdown preview sanitizes content and blocks remote resources unless a user explicitly opens a link.",
            ]),
            ("Where to learn more", [
                "README.md covers installation, usage, build commands, and current platform status. docs/ARCHITECTURE.md explains the Go backend and TypeScript frontend. docs/SECURITY-AUDIT.md records the security model and verification evidence, while docs/PLATFORM-STATUS.md tracks platform coverage.",
                "The tabbed reference at wiki/index.html links source files to their purpose, related components, and relevant tests.",
            ]),
        ],
        key_items=[
            ("README.md", "User-facing overview, installation, and build instructions"),
            ("docs/ARCHITECTURE.md", "Application components and data flow"),
            ("wiki/index.html", "Tabbed source and concept reference"),
        ],
    ),
    dict(
        slug="security-model",
        title="docs/SECURITY-AUDIT.md + SECURITY.md — the security record",
        category="overview", path="docs/SECURITY-AUDIT.md", lines=229, lang="Markdown",
        status="META", related=["e2e-serve", "fe-markdown", "fileio-save"],
        lead=[
            "The security model uses layered controls around untrusted content. Markdown is sanitized before rendering in a sandboxed iframe with scripts disabled and a restrictive content security policy. Local images are served only from the open document's directory tree through a content-sniffed, size-capped handler; the only outbound network action in the shipped app is a user-clicked HTTP(S) link validated in Go.",
            "SECURITY.md is the disclosure policy: scope (fileio, preview sandbox, image handler, settings, dependency vulnerabilities), out-of-scope (the webview engines themselves), design guarantees researchers should test, and the crash-recovery data disclosure (0600 snapshots in app-data only).",
        ],
        sections=[
            ("Content and file boundaries", [
                "The Markdown path runs marked output through DOMPurify, rewrites resource URLs, then renders in an iframe without script permission under a default-src 'none' policy. Remote images are replaced with visible blocked notes. Local images must remain inside the open document's directory tree, are content-sniffed, and are capped at 20 MB; SVG is excluded.",
                "The shipped application has no network listener or background request path. It validates a user-clicked HTTP(S) link before opening it. Crash-recovery snapshots are optional, stored in the application's private data directory, and are cleared when the user saves, closes, discards, or disables recovery.",
            ]),
            ("Verification evidence", [
                "The repository includes Go fuzz tests, a 26-vector live preview security suite, and a 19-check HTTP attack suite for the loopback test bridge. The project security audit describes their scope and limitations. CI also runs govulncheck and npm audit; dependency results apply to the toolchain and lockfiles at the commit being reviewed.",
            ]),
        ],
        key_items=[
            ("Preview sink", "sandbox without allow-scripts + CSP default-src 'none' — a sanitizer bypass has nothing to execute"),
            ("Dynamic suites", "tests/e2e/security.spec.ts (XSS battery) + scripts/security-dynamic.mjs (HTTP attacks) — repeatable"),
            ("Scanners", "govulncheck and npm audit run in CI; 0 findings on the current toolchain"),
        ],
    ),
]
