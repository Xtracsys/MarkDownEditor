# Meta
*repo plumbing*

- **build-all.sh** — `scripts/build-all.sh` (104 lines): Born from the stale-binary incident: Wails' self-sign step aborts on iCloud file-provider xattr detritus (this checkout lived in a synced Desktop folder), and earlier pipelines cou
- **make-icons.py** — `scripts/make-icons.py` (71 lines): make-icons.py derives every app icon from the emblem crops: 1024 master, macOS icns via iconutil, Windows ICO (6 sizes), Linux PNG set — the white emblem centered on the sampled da
- **ci.yml** — `.github/workflows/ci.yml` (187 lines): A three-OS matrix (macOS/Ubuntu/Windows): go vet + race tests, frontend typecheck + vitest, the Playwright acceptance suite (which starts the e2e bridge itself), a file-provider co
- **wails.json** — `wails.json` (247 lines): wails.json carries the product identity, frontend build hooks, and 37 file-type associations that render into the macOS Info.plist's CFBundleDocumentTypes (role Editor, iconfile ic
- **.gitignore** — `.gitignore` (26 lines): Everything not covered by a dedicated article: .gitignore (build outputs, node_modules, test homes, the generated buildstamp); frontend/tsconfig.json, vite.config.ts, vitest.config
- **RELEASE-READINESS-REPORT.md** — `docs/RELEASE-READINESS-REPORT.md` (— lines): Findings and corrective changes from the release-readiness loop (3 corrective passes, 2026-10-31 → 11-01). IDs are stable; never renumber. Each entry links the finding, the pass, t
