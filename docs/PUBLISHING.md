# Publishing Runbook

The repository is prepared for public GitHub upload. This page is the exact
checklist — follow it in order. Estimated time: 15 minutes.

## 0. Preconditions (already done)

- [x] Copyright is `Copyright 2026 Xtracsys LLC` in every file header, NOTICE,
      wails.json, the About dialog, the Info.plist, the NSIS installer, and
      the deb maintainer field.
- [x] Apache-2.0 license text in `LICENSE`; trademark boundary in
      `TRADEMARKS.md`; third-party notices in `THIRD-PARTY-NOTICES.md`.
- [x] `CHANGELOG.md` covers 0.1.0–0.1.6; the repo is tagged `v0.1.6`.
- [x] GitHub templates: PR integrity checklist, bug report, feature request;
      CI workflow (3-OS test + package + security jobs) on push/PR.
- [x] Scanners clean: govulncheck 0, npm audit 0 (production), secrets sweep
      0 true positives, no large stray binaries in git.

## 1. Pre-flight (do these the day of the upload)

```sh
cd /Users/admin/Desktop/ZcodeProjects/MarkDownEditor

# 1. Recommended: move the repo out of the iCloud-synced Desktop first.
#    The file provider has repeatedly corrupted build outputs and renamed
#    files in this location.
mkdir -p ~/Projects && mv ~/Desktop/ZcodeProjects/MarkDownEditor ~/Projects/

# 2. Final test pass from the new location (paths in test config are relative).
go test ./... && (cd frontend && npm ci && npm test && npm run build)
npx playwright test

# 3. Verify the working tree is clean and the tag exists.
git status                # should be clean
git tag                   # should list v0.1.6
```

## 2. Create the repository and push

The Go module path is `github.com/xtracsys/xtracsys-editor` — create the repo
at that exact path (under the `xtracsys` user or org) or rename the module
first.

```sh
gh auth login                                    # once
gh repo create xtracsys-editor --public --source=. --push
git push origin v0.1.6                           # the release tag
```

If you prefer not to use `gh`:

```sh
git remote add origin https://github.com/<owner>/xtracsys-editor.git
git push -u origin main
git push origin v0.1.6
```

## 3. Verify CI on all three OSes

Watch `gh run watch` or the Actions tab. Expected: test + package + security
jobs on macOS/Ubuntu/Windows. First-run failures on Windows/Linux are
possible (this machine is macOS-only) — fix-forward; the packaging steps are
the likeliest culprits.

## 4. Create the GitHub release

```sh
gh release create v0.1.6 \
  dist/xtracsys-editor-0.1.6-macos-universal.dmg \
  dist/xtracsys-editor-0.1.6-windows-x64-setup.exe \
  dist/xtracsys-editor-0.1.6-windows-x64.zip \
  dist/SHA256SUMS.txt \
  --title "Xtracsys Editor 0.1.6" \
  --notes-file docs/RELEASE-NOTES-0.1.6.md
```

Alternatively upload the artifacts manually from `dist/`. Keep
`SHA256SUMS.txt` attached — it is the integrity anchor for the binaries.

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
