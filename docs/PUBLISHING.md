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
- [x] `CHANGELOG.md` records the project version history; confirm it matches the release being prepared.
- [ ] Inspect GitHub tags, releases, and packages before each release. Local
      tags alone are not published release artifacts.
- [x] GitHub templates: PR integrity checklist, bug report, feature request;
      CI workflow (3-OS test + package + security jobs) on push/PR.
- [x] Release 0.1.7 notes and changelog are prepared; the Linux Debian
      package version is derived from `wails.json` so the package and filename
      match the app version.
- [ ] Run the dependency, security, and secret scans required for the release
      candidate. Prior results are not evidence for a later commit.
- [ ] Check the Actions run for the exact source commit. Require its configured
      test, packaging, and security jobs to pass before release.

## 1. Pre-flight

Run release commands from the root of the checked-out repository. Keep backups and machine-specific paths outside the repository; do not commit local paths or backup archives.

## 2. Push source updates

The existing public repository is `Xtracsys/MarkDownEditor`. Push source
updates to `main` after reviewing the local change:

```sh
git push origin main
```

Do not publish a version tag, GitHub release, or package until the owner has
approved that release and the current CI run is green.

## 3. Verify CI on all three OSes

Review GitHub Actions for the exact source commit. Require every configured test and security job to pass. Confirm the packaging job produced the expected artifacts; do not infer current status from an earlier run.

## 4. Create an explicitly approved GitHub release

Only after the owner approves a release, the current `main` CI run is green,
and matching release notes and artifacts have been prepared and verified,
create the GitHub release. Attach the macOS and Windows artifacts produced by
`scripts/build-all.sh` for the approved version, plus the Linux tarball and
Debian package produced by the exact successful CI run. Publish one
`SHA256SUMS.txt` covering every attached installer and use the matching
`docs/RELEASE-NOTES-<version>.md` file. Before version 0.1.7, no binary
release artifacts had been published.

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
