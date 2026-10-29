# Xtracsys Editor — Code Wiki — Wiki Index

> Generated 2026-10-29 19:18 UTC · 42 articles · data: `wiki_data.json`


## How to edit this wiki

1. `wiki_data.json` is the canonical content — always edit it first.

2. Run `python3 wikiupdate.py` to re-embed it into `index.html`.

3. Or regenerate everything: `python3 generate_wiki.py --source <repo> --out . <content_dir>`.


## Articles


### Overviews
*orientation*

| # | article | file | lines | status |
|---|---------|------|-------|--------|
| 01 | README.md | `README.md` | 194 | META |
| 02 | WIKI.md | `WIKI.md` | 265 | META |
| 03 | SECURITY-AUDIT.md | `docs/SECURITY-AUDIT.md` | 202 | META |

### Specifications
*foundation documents*

| # | article | file | lines | status |
|---|---------|------|-------|--------|
| 01 | ARCHITECTURE.md | `docs/ARCHITECTURE.md` | 123 | SPEC |
| 02 | REQUIREMENTS-CHECKLIST.md | `docs/REQUIREMENTS-CHECKLIST.md` | 172 | SPEC |
| 03 | PLATFORM-STATUS.md | `docs/PLATFORM-STATUS.md` | 72 | SPEC |
| 04 | BRAND.md | `docs/BRAND.md` | 63 | SPEC |

### Core
*the meat*

| # | article | file | lines | status |
|---|---------|------|-------|--------|
| 01 | main.go | `main.go` | 109 | CORE |
| 02 | app.go | `internal/app/app.go` | 837 | CORE |
| 03 | menu.go | `internal/app/menu.go` | 108 | CORE |
| 04 | main.go | `cmd/e2e-serve/main.go` | 401 | TEST |
| 05 | eol.go | `internal/fileio/eol.go` | 178 | CORE |
| 06 | encoding.go | `internal/fileio/encoding.go` | 141 | CORE |
| 07 | load.go | `internal/fileio/load.go` | 296 | CORE |
| 08 | save.go | `internal/fileio/save.go` | 207 | CORE |
| 09 | watch.go | `internal/fileio/watch.go` | 186 | CORE |
| 10 | fuzz_test.go | `internal/fileio/fuzz_test.go` | 120 | TEST |
| 11 | settings.go | `internal/settings/settings.go` | 144 | CORE |
| 12 | recovery.go | `internal/recovery/recovery.go` | 182 | CORE |
| 13 | session.go | `internal/session/session.go` | 128 | CORE |
| 14 | handler.go | `internal/localimg/handler.go` | 114 | CORE |

### Tests
*verification*

| # | article | file | lines | status |
|---|---------|------|-------|--------|
| 01 | load_test.go | `internal/fileio/load_test.go` | 256 | TEST |
| 02 | app_test.go | `internal/app/app_test.go` | 135 | TEST |
| 03 | session_test.go | `internal/session/session_test.go` | 116 | TEST |
| 04 | eol.test.ts | `frontend/src/eol.test.ts` | 107 | TEST |
| 05 | editor.spec.ts | `tests/e2e/editor.spec.ts` | 638 | TEST |

### Meta
*repo plumbing*

| # | article | file | lines | status |
|---|---------|------|-------|--------|
| 01 | build-all.sh | `scripts/build-all.sh` | 104 | META |
| 02 | make-icons.py | `scripts/make-icons.py` | 71 | META |
| 03 | ci.yml | `.github/workflows/ci.yml` | 187 | META |
| 04 | wails.json | `wails.json` | 247 | META |
| 05 | .gitignore | `.gitignore` | 26 | META |
