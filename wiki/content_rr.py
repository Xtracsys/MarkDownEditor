# Wiki content: release-readiness FR registry (loop 3).
# SPDX-License-Identifier: Apache-2.0
# Regenerate the wiki after editing: see wiki/README section in INDEX.md.

ARTICLES = [
    dict(
        slug="rr-fr-registry",
        title="Release-readiness FR registry (loop 3)",
        category="meta", path="docs/RELEASE-READINESS-REPORT.md", lines=0, lang="Registry",
        status="META", related=["security-model", "e2e-editor"],
        lead=[
            "Findings and corrective changes from the release-readiness loop (3 corrective passes, 2026-10-31 → 11-01). IDs are stable; never renumber. Each entry links the finding, the pass, the affected files, and the verification that closed it.",
        ],
        sections=[
            ("Registry", [
                "RR-FR-001 (pass 1) — OpenPaths/OpenPathReadOnly now require absolute paths. A relative traversal resolved against the CWD and opened /etc/passwd when the dynamic suite ran from a deep working directory. Files: internal/app/app.go. Verified: dynamic suite 21/21 with the new relative-path-refused check; desktop flows unaffected (argv/Apple Events/drop all provide absolute paths).",
                "RR-FR-002 (pass 1) — build-all.sh writes dist/STAMP.txt; the RR battery verifies the shipped DMG against the real stamp instead of a stale harness argument. Files: scripts/build-all.sh, scripts/rr-battery.sh.",
                "RR-FR-003 (pass 1) — coverage map claims internal/app/buildstamp_gen.go (134→135).",
                "RR-FR-004 (pass 2) — RR battery A1-01 no longer self-matches its own pattern file (scanner self-hit). Files: scripts/rr-battery.sh.",
                "RR-FR-005 (pass 2) — deterministic waitForBytes polling replaces fixed sleeps at 7 E2E save-verification sites (ExFAT/loaded-run flake). Files: tests/e2e/editor.spec.ts.",
                "RR-FR-006 (pass 2) — saveActive raced against stalled-drive timeouts in E2E (ExFAT writes can hang); failures surface fast and honestly. Files: tests/e2e/editor.spec.ts.",
                "RR-FR-007 (pass 2) — Playwright testIgnore for AppleDouble companions (._editor.spec.ts was picked up as a test file on ExFAT). Files: playwright.config.ts.",
                "RR-FR-008 (pass 2) — Settings field-initialized to defaults: updateSettings before boot completion no longer crashes on undefined settings. Files: frontend/src/app.ts.",
                "RR-FR-009 (pass 3) — RR battery harness fixes: stamp check reads /tmp/rr-stamp; A1-01 self-exclusion. Verified by the clean pass-3 run (35/35).",
            ]),
            ("Out of scope / deferred", [
                "Print on macOS WKWebView (window.print may be a no-op there) — needs manual verification on real hardware. ExFAT save stalls under load — environment limitation, documented in the platform notes; the editor keeps content in the app (dirty) and the user can retry. Windows/Linux hardware verification — pending per docs/PLATFORM-STATUS.md.",
            ]),
        ],
        key_items=[
            ("Passes", "3 corrective passes requested and completed; pass 1 = 31/35 → pass 3 = 35/35"),
            ("Registry rule", "IDs stable, never reused; each entry names its verification"),
        ],
    ),
]
