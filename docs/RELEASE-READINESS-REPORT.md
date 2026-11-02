# Release Readiness Report — Xtracsys Editor 0.1.7

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Target | `/Volumes/XSdrive/Projects/MarkDownEditor` @ `20e751c` + loop fixes (`8cca3ec`); artifacts `dist/xtracsys-editor-0.1.7-*` |
| Owner | Xtracsys LLC |
| Intended recipients | GitHub public |
| Mode requested | Corrective loop, 3 passes |
| Passes requested / completed | 3 / 3 |
| Profiles applied | 3 Data/recovery (recovery + session stores), 5 Operations (CI + reproducible builds), 7 Privacy/legal (license obligations, personal-data-at-rest via crash recovery) |
| Profiles not applied | 1 Hosted web/API (no server in the shipped app; the loopback e2e bridge is a dev tool audited separately), 2 Identity (no accounts), 4 Payments/email (none), 6 AI/agents (none), 8 Public web (no public site — the GitHub repo page is out of scope for app checks) |
| Constraints | ExFAT working volume (no Unix permissions; AppleDouble/xattr churn; writes can stall under load). macOS-only hardware. Playwright is the executed-UI channel; native window behaviors need the manual checklist. |

## Post-publication status — 2026-11-01

This report records local source and artifact readiness; its `READY` verdict is
not a claim that GitHub CI passed or that a public release was published. The
source repository is public, but GitHub currently has no tags, releases, or
packages (local tags `v0.1.6` and `v0.1.7` have not been pushed). The initial
public Actions run at 13aad54 passed security scans but failed all three OS
test jobs before tests because the workflow evaluated the Go embed before
building frontend/dist. Run 94cc6b2 exposed the missing root Playwright
install. Run baedc61 passed Ubuntu but found a macOS session-restore race and
a Windows FIFO-test compile error. Run c13a3e1 passed macOS (including E2E),
Ubuntu, and security scans; Windows then failed POSIX file-mode assertions.
Run 54362b6 passed macOS, Ubuntu, and security scans, and Windows Go tests,
but Windows E2E could not start its server due to Unix-only environment
syntax. Run 88d846d passed all three OS test jobs, including all 27 Windows E2E
checks, and the security scan. The macOS app bundle built, but DMG packaging
failed because Pillow was missing from the runner. The workflow now installs
Pillow before DMG creation; a green package run is still required before release
publication.

## 1. Scope and constraints

Full checklist (Parts A–C + profiles 3/5/7) on the source repository, its test
suites, and the release artifacts in `dist/`. The shipped app's webview-native
behaviors (native menus, print dialog, Gatekeeper flow) were verified by
executed testing only where headless tooling reaches; everything else on those
surfaces is marked for the manual checklist. This is a code/config review plus
executed testing — not a penetration test or legal advice.

## 2. Per-pass coverage and evidence ledger

| Pass | Checklist coverage | Fixes applied | Verification (actual commands + outcomes) | Notes |
|---|---|---|---|---|
| 1 | Parts A–D; 35 checks: 31 PASS, 4 FAIL | RR-FR-001..003 | `go test ./...` 7 pkgs ok; `npx playwright test` 27 passed; dynamic suite 21/21 after fix; coverage 135/135 | Dynamic suite caught OpenPaths opening `/etc/passwd` via CWD-dependent relative resolution |
| 2 | Parts A–D re-run; 35 checks: 35 PASS | RR-FR-004..008 | `bash scripts/rr-battery.sh rr-pass2` exit 0; playwright 27 passed | A1-01 self-match fixed; deterministic waits replaced 7 fixed sleeps |
| 3 | Parts A–D re-run; 35 checks: 35 PASS | RR-FR-009 (harness) | `bash scripts/rr-battery.sh rr-pass3` exit 0; go/vitest/playwright green; dist checksums verified | Final pass verified its own changes via the fresh battery run |

## 3. Findings summary

| ID | Severity | Status vs last pass | Title | Blocks release? |
|---|---|---|---|---|
| RR-001 | low | resolved (pass 1) | OpenPaths accepted relative paths — CWD-dependent traversal opened `/etc/passwd` on the dynamic suite | no (dev-bridge surface; desktop paths are absolute by source) |
| RR-002 | low | resolved (pass 1) | DMG stamp verification compared a stale harness argument | no (verification gap, not artifact gap) |
| RR-003 | low | resolved (pass 1) | Coverage map missing buildstamp_gen.go | no |
| RR-004 | low | resolved (pass 2) | RR battery A1-01 self-match | no |
| RR-005 | medium (flake) | resolved (pass 2) | Fixed sleeps in E2E save verification → intermittent false failures on ExFAT/loaded runs | no (test-side) |
| RR-006 | medium (flake) | resolved (pass 2) | ExFAT save RPC stalled 90 s under load → E2E budget blowout | no (environment; documented) |
| RR-007 | low | resolved (pass 2) | AppleDouble companion picked up as a Playwright test file | no |
| RR-008 | medium | resolved (pass 2) | `updateSettings` before boot completion crashed on undefined settings | yes (crash) — fixed + verified |
| RR-009 | informational | resolved (pass 3) | RR battery harness polish (stamp read, self-exclusion) | no |
| RR-010 | informational | unchanged | Print on macOS WKWebView may be a no-op (`window.print`) — manual check pending | no (graceful toast fallback exists) |
| RR-011 | informational | unchanged | ExFAT save stalls under load — environment limitation, content preserved in the editor (dirty) | no (documented; APFS drive pending) |

## 4. Finding details

### RR-001 — OpenPaths relative-path traversal
- **Severity:** low (dev-bridge read surface; desktop flows unaffected)
- **Applicability:** dynamic security suite; trust boundary at the bridge API
- **Observed:** executed — `OpenPaths(["../../../../etc/passwd"])` from a deep CWD opened the real file; reproduced via direct API probe
- **Location & evidence:** `internal/app/app.go` OpenPaths; dynamic suite output `{"result":[{"tab":{"path":"../../../../etc/passwd"...`
- **Impact:** CWD-dependent resolution; on the loopback bridge, a same-origin driver could read arbitrary readable files
- **Blocks this release?** No — fixed in pass 1; the shipped desktop app only receives absolute paths from OS sources
- **Remedy & owner:** absolute-path rule in OpenPaths/OpenPathReadOnly — applied
- **Verification:** dynamic suite 21/21 including the new `relative-path refused` check; unit coverage via the bridge dispatch
- **Related FR:** RR-FR-001

### RR-005 / RR-006 — ExFAT test flake and save stalls
- **Severity:** medium (test infrastructure; environment for the product)
- **Observed:** executed — fixed sleeps exceeded under load; one SaveTab RPC hung 90 s on the ExFAT volume
- **Impact:** false test failures; on real ExFAT installs, saves can stall (content preserved in the editor, dirty)
- **Blocks this release?** No — documented environment limitation; APFS drive pending
- **Remedy & owner:** deterministic polling + raced saves in tests (applied); APFS drive — owner
- **Verification:** repeated green full-suite runs on ExFAT after the changes
- **Related FR:** RR-FR-005/006

### RR-008 — updateSettings before boot completion
- **Severity:** medium (crash)
- **Observed:** executed — TypeError `reading 'theme' of undefined` in updateSettings when called 93 ms into boot
- **Location:** `frontend/src/app.ts` — `this.settings` unset until start()'s getSettings resolved
- **Impact:** startup-adjacent callers (tests, early events) could crash the controller
- **Blocks this release?** No — fixed in pass 2
- **Remedy & owner:** field initializer `private settings = defaultSettings()` — applied
- **Verification:** full E2E green post-fix; boot-order calls exercised
- **Related FR:** RR-FR-008

## 5. Changes made during this review

| Files | Rationale | Finding | Pass | FR | Verification |
|---|---|---|---|---|---|
| internal/app/app.go | OpenPaths/OpenPathReadOnly absolute-path rule | RR-001 | 1 | RR-FR-001 | dynamic suite 21/21; go build/vet/test |
| scripts/build-all.sh, scripts/rr-battery.sh | dist/STAMP.txt + real-stamp verification | RR-002 | 1 | RR-FR-002 | battery A4-04 PASS pass 2/3 |
| wiki/check_coverage.py | claim buildstamp_gen.go | RR-003 | 1 | RR-FR-003 | coverage 135/135 |
| scripts/rr-battery.sh | A1-01 self-exclusion | RR-004 | 2 | RR-FR-004 | battery pass 2/3 A1-01 PASS |
| tests/e2e/editor.spec.ts | waitForBytes polling (7 sites) + raced saves + 90 s budgets | RR-005/006 | 2 | RR-FR-005/006 | full E2E green twice on ExFAT |
| playwright.config.ts | testIgnore AppleDouble companions | RR-007 | 2 | RR-FR-007 | suite discovery clean |
| frontend/src/app.ts | settings field initializer | RR-008 | 2 | RR-FR-008 | E2E green; boot-order calls exercised |
| scripts/rr-battery.sh | harness stamp read + self-exclusion | RR-009 | 3 | RR-FR-009 | pass 3 battery 35/35 |
| CHANGELOG.md, .github templates, docs/PUBLISHING.md, docs/RELEASE-NOTES-0.1.6/7.md | LLC attribution + GitHub prep (pre-loop) | — | — | — | committed |

## 6. Build / test / runtime verification log

Per-pass logs: `/tmp/rr-pass1.log`, `/tmp/rr-p2.log`, `/tmp/rr-p3.log` (battery ledgers), `/tmp/pw-rr*.log` (Playwright). Representative commands and outcomes:

- `go test ./... -count=1` — 7 packages ok (every pass)
- `go test ./internal/app/ ./internal/session/ -count=1 -race` — ok
- `cd frontend && npx tsc --noEmit && npx vitest run && npm run build` — 23 tests passed, build ok
- `npx playwright test` — 27 passed (passes 1–3)
- `node scripts/security-dynamic.mjs 127.0.0.1:34131/34128` — 21/21 (passes 1, 2)
- `bash scripts/rr-battery.sh rr-pass2 / rr-pass3` — 35/35 PASS, exit 0
- DMG mount + plutil version extract + stamp grep + iconfile check — ok (passes 1–3)
- `git bundle create` + restore-test clone — HEAD 337af75, tags intact

## 7. Wiki / FR update status

Wiki lives at `wiki/` in the repository (HaulCore viewer; canonical payload
`wiki/wiki_data.json`; regenerate via the code-wiki-generator, re-embed via
`wiki/wikiupdate.py`). FR registry added as the `rr-fr-registry` article
(RR-FR-001…009). Derived pages regenerated and re-embedded; coverage checker
claims 134/134 tracked files (the registry article covers the report).

## 8. Remaining human decisions and untested scope

- Publish the `v0.1.7` tag and GitHub release — owner, after the updated public
  CI run is green and release publication is explicitly approved (runbook:
  docs/PUBLISHING.md). The source repository is already public.
- Code-signing certificates (macOS notarization, Windows Authenticode) — owner.
- Windows/Linux hardware verification — owner (manual checklist in
  docs/PLATFORM-STATUS.md).
- Print on macOS WKWebView — manual check on real hardware (RR-010).
- ExFAT save stalls — environment; APFS drive pending (RR-011).
- Native window behaviors beyond the bridge's reach (native menus, native
  dialogs) — manual checklist.

## 9. Verdict

**READY** — within the stated scope: no unresolved release blockers; all
corrective fixes from the three passes verified by actual runs; scanners
clean; artifacts verified (version, icon, stamp, checksums). Application
readiness and workflow completion are separate claims: the workflow completed
3/3 passes with the FR registry and closeout recorded; application readiness
is stated for the covered surface only (webview-native and cross-platform
hardware behaviors remain on the manual checklist).

## 10. Disclaimers

This was a code/configuration review plus light executed testing where safe.
It is not a penetration-test certification, not legal advice, and does not
certify "secure", "compliant", or "bug-free". It states what was checked,
what was found, and what remains.
