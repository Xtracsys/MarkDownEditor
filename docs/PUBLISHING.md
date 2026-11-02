# Publishing Runbook

The source repository is already public at
https://github.com/Xtracsys/MarkDownEditor. This page covers versioned releases
and binary publishing; it is not an initial repository-creation checklist.

## 0. Preconditions (already done)

- [x] Copyright is `Copyright 2026 Xtracsys LLC` in every file header, NOTICE,
      wails.json, the About dialog, the Info.plist, the NSIS installer, and
      the deb maintainer field.
- [x] Apache-2.0 license text in `LICENSE`; trademark boundary in
      `TRADEMARKS.md`; third-party notices in `THIRD-PARTY-NOTICES.md`.
- [x] `CHANGELOG.md` covers 0.1.0–0.1.6.
- [ ] No GitHub tags, releases, or packages have been published. Local tags
      `v0.1.6` and `v0.1.7` are not published tags.
- [x] GitHub templates: PR integrity checklist, bug report, feature request;
      CI workflow (3-OS test + package + security jobs) on push/PR.
- [x] Scanners clean in the recorded local readiness review: govulncheck 0,
      npm audit 0 (production), secrets sweep 0 true positives, no large stray
      binaries in git.
- [ ] Public CI must pass on the current `main` commit before a release. Run
      `88d846d` passed all three test jobs and security scans, but macOS DMG
      packaging failed because Pillow was missing; the workflow now installs it.

## 1. Pre-flight (current — 2026-11-01)

The canonical repository now lives at:
**/Volumes/XSdrive/Projects/MarkDownEditor**

**Interim backup (2026-10-31):** while this volume is the only copy, a full
git bundle of the repository — history, both tags, working-tree state as of
HEAD `337af75` — is stored at `~/Backups/xtracsys-editor-2026-10-31.bundle`
on the internal disk. If anything happens to this volume before the new
APFS drive arrives: `git clone ~/Backups/xtracsys-editor-2026-10-31.bundle`
restores everything.

## 2. Push source updates

The existing public repository is `Xtracsys/MarkDownEditor`. Push source
updates to `main` after reviewing the local change:

```sh
git push origin main
```

Do not publish a version tag, GitHub release, or package until the owner has
approved that release and the current CI run is green.

## 3. Verify CI on all three OSes

Watch the Actions tab after pushing. Run 88d846d passed all three OS test
jobs, including Windows E2E, and the security scan. The macOS app bundle built,
but DMG packaging failed because Pillow was missing; the workflow now installs
it before creating the DMG. Require a green test matrix, package jobs, and
security scan before publishing a release.

## 4. Create an explicitly approved GitHub release

Only after the owner approves a release, the current `main` CI run is green,
and matching release notes and artifacts have been prepared and verified,
create the GitHub release. Attach the exact artifacts produced by
`scripts/build-all.sh` for the approved version, plus `dist/SHA256SUMS.txt`,
and use the matching `docs/RELEASE-NOTES-<version>.md` file. No release
artifacts are currently published.

## 5. Post-publish

- [ ] Enable branch protection on `main` (require PR + CI).
- [ ] Add a CODEOWNERS file once the GitHub org/user handles are final.
- [ ] Verify the Actions badge in README renders.
- [ ] If release artifacts change, re-run `scripts/build-all.sh <version>`
      — never hand-edit `dist/`; the stamp verification is the guarantee.

## Note on artifacts vs git

`dist/` contents are gitignored by design — releases carry their own
checksums, and every artifact is reproducible from source via
`scripts/build-all.sh` (per-build stamp verified inside each binary).
