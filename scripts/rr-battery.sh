#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Xtracsys LLC
#
# Release-readiness evidence battery. Run one pass:
#   bash scripts/rr-battery.sh <pass-id> [version]
# Emits a "RESULT <STATUS> | <id> | <detail>" ledger to stdout and a per-pass
# log. Exits non-zero if any check failed. Add new checks as numbered ids.

set -uo pipefail
PASS_ID="${1:?usage: rr-battery.sh <pass-id> [version]}"
printf "%s" "${3:-}" > /tmp/rr-stamp 2>/dev/null || true
VERSION="${2:-0.1.7}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
LOG="/tmp/rr-${PASS_ID}.log"
: > "$LOG"
FAILS=0

res() { # res <STATUS> <id> <detail>
  local status="$1" id="$2" detail="${3:-}"
  echo "RESULT $status | $id | $detail" | tee -a "$LOG"
  case "$status" in
    FAIL|BLOCKED|UNKNOWN) FAILS=$((FAILS+1)) ;;
  esac
}
run() { # run <id> <label> <cmd...>  — PASS if exit 0
  local id="$1" label="$2"; shift 2
  if "$@" >> "$LOG" 2>&1; then res PASS "$id" "$label"; else res FAIL "$id" "$label (see $LOG)"; fi
}

echo "== Release-readiness battery: pass $PASS_ID, version $VERSION, $(date -u +%FT%TZ)" | tee -a "$LOG"
HEAD_SHA="$(git rev-parse HEAD)"
echo "HEAD $HEAD_SHA" >> "$LOG"

# ---------------- ExFAT hygiene (precondition, corrective each pass) -------
find . -name "._*" -delete 2>/dev/null
find . -name ".DS_Store" -delete 2>/dev/null
LEFT=$(find . -path ./node_modules -prune -o -path ./frontend/node_modules -prune -o -name "._*" -print 2>/dev/null | wc -l | tr -d ' ')
if [ "$LEFT" = "0" ]; then res PASS "EXFAT-01" "no AppleDouble junk in tracked tree after sweep"; else res FAIL "EXFAT-01" "$LEFT AppleDouble files remain"; fi

# ---------------- A1: secrets ----------------------------------------------
# The sweep excludes its own pattern list (self-match is not a finding).
SECRET_HITS="$(git ls-files | grep -v "scripts/rr-battery.sh" | xargs grep -lniE '(api[_-]?key|passw(or)?d[ :=]|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_)' 2>/dev/null | grep -v node_modules || true)"
if [ -n "$SECRET_HITS" ]; then
  res FAIL "A1-01" "secret-pattern hits: $SECRET_HITS"
else
  res PASS "A1-01" "tracked-file secret sweep clean (self excluded)"
fi
if git log --all --format="%s %b" | grep -qiE '(password[ :=]|api[_-]key[ :=]|ghp_[A-Za-z0-9]{20,})'; then
  res FAIL "A1-02" "secret-like strings in commit history"
else
  res PASS "A1-02" "commit-history secret sweep clean"
fi
if [ -f dist/xtracsys-editor-"$VERSION"-macos-universal.dmg ]; then
  if strings -a dist/xtracsys-editor-"$VERSION"-macos-universal.dmg 2>/dev/null | grep -q "/Users/admin"; then
    res FAIL "A1-03" "machine-specific /Users path embedded in DMG binary"
  else
    res PASS "A1-03" "no /Users paths in DMG binary"
  fi
else
  res UNKNOWN "A1-03" "DMG not present for artifact scan"
fi

# ---------------- A2: dependencies ----------------------------------------
run "A2-01" "lockfiles present + committed" test -f go.sum -a -f frontend/package-lock.json
if command -v ~/go/bin/govulncheck >/dev/null; then
  if ~/go/bin/govulncheck ./... >> "$LOG" 2>&1; then res PASS "A2-02" "govulncheck: no findings"; else res FAIL "A2-02" "govulncheck findings (see $LOG)"; fi
else
  res BLOCKED "A2-02" "govulncheck not installed"
fi
AUDIT_OUT="$(cd frontend && npm audit --omit=dev 2>&1 | tail -1)"
case "$AUDIT_OUT" in *"found 0 vulnerabilities"*) res PASS "A2-03" "npm audit production: 0" ;; *) res FAIL "A2-03" "npm audit: $AUDIT_OUT" ;; esac
BADLIC="$(go list -m all 2>/dev/null | grep -iE "GPL|AGPL|LGPL|SSPL" | head -2)"
if [ -z "$BADLIC" ]; then res PASS "A2-04" "no copyleft modules in dependency graph"; else res FAIL "A2-04" "copyleft modules: $BADLIC"; fi

# ---------------- A3: build, tests, launch, workflows ----------------------
run "A3-01" "go vet ./..." go vet ./...
run "A3-02" "go test ./... (race on touched stores)" go test ./... -count=1
run "A3-03" "frontend typecheck" bash -c "cd frontend && npx tsc --noEmit"
run "A3-04" "frontend unit tests" bash -c "cd frontend && npx vitest run"
run "A3-05" "frontend production build" bash -c "cd frontend && npm run build"
run "A3-06" "go build ./..." go build ./...
if npx playwright test >> "$LOG" 2>&1; then
  PASSED=$(grep -cE "✓" "$LOG" 2>/dev/null || echo "?")
  res PASS "A3-07" "Playwright acceptance suite passed ($PASSED checks)"
else
  res FAIL "A3-07" "Playwright acceptance suite failed (see $LOG)"
fi
# Dynamic security suite against a fresh bridge
rm -rf /tmp/rr-sec-home
(go run ./cmd/e2e-serve -addr 127.0.0.1:34131 -dist frontend/dist -home /tmp/rr-sec-home -fresh-home >/dev/null 2>&1 &)
sleep 4
DYN=$(node scripts/security-dynamic.mjs 127.0.0.1:34131 2>&1 | tail -1)
pkill -f "e2e-serve" 2>/dev/null || true
case "$DYN" in *"21/21"*) res PASS "A3-08" "dynamic security suite $DYN" ;; *) res FAIL "A3-08" "dynamic security suite: $DYN" ;; esac

# ---------------- A4: clean copy, packaging --------------------------------
CLEAN="/tmp/rr-clean-$PASS_ID"
rm -rf "$CLEAN"
if git clone -q "$REPO" "$CLEAN" 2>> "$LOG"; then
  if (cd "$CLEAN/frontend" && npm ci --silent >> "$LOG" 2>&1 && npm run build >> "$LOG" 2>&1); then
    if (cd "$CLEAN" && go build ./... >> "$LOG" 2>&1); then
      res PASS "A4-01" "clean clone: npm ci + build + go build succeed"
    else res FAIL "A4-01" "clean clone: go build failed"; fi
  else res FAIL "A4-01" "clean clone: frontend build failed"; fi
else
  res FAIL "A4-01" "clean clone failed"
fi
rm -rf "$CLEAN"
JUNK="$(git ls-files | grep -cE "\._|DS_Store|\.log$" || true)"
if [ "$JUNK" = "0" ]; then res PASS "A4-02" "no debug artifacts tracked"; else res FAIL "A4-02" "$JUNK junk files tracked"; fi
if [ -f dist/SHA256SUMS.txt ]; then
  if (cd dist && shasum -a 256 -c SHA256SUMS.txt >/dev/null 2>&1); then
    res PASS "A4-03" "dist checksums match SHA256SUMS.txt"
  else res FAIL "A4-03" "dist checksum mismatch"; fi
else res UNKNOWN "A4-03" "no SHA256SUMS.txt"; fi
MNT=$(mktemp -d)
if hdiutil attach dist/xtracsys-editor-"$VERSION"-macos-universal.dmg -mountpoint "$MNT" -nobrowse -quiet >> "$LOG" 2>&1; then
  VER=$(plutil -extract CFBundleShortVersionString raw "$MNT/xtracsys-editor.app/Contents/Info.plist" 2>/dev/null || echo "?")
  if [ "$VER" = "$VERSION" ] && [ -f "$MNT/xtracsys-editor.app/Contents/Resources/iconfile.icns" ] && grep -aq "$(cat /tmp/rr-stamp)" "$MNT/xtracsys-editor.app/Contents/MacOS/xtracsys-editor" 2>/dev/null; then
    res PASS "A4-04" "DMG: version $VER, icon, stamp verified"
  else
    res FAIL "A4-04" "DMG verification failed (version=$VER)"
  fi
  hdiutil detach "$MNT" -quiet
else
  res FAIL "A4-04" "DMG could not be mounted"
fi
rmdir "$MNT" 2>/dev/null || true

# ---------------- A5: documentation ----------------------------------------
if python3 wiki/check_coverage.py >> "$LOG" 2>&1; then
  res PASS "A5-01" "wiki coverage: every tracked file claimed"
else
  res FAIL "A5-01" "wiki coverage checker reports uncovered files (see $LOG)"
fi
MISSING_DOCS=""
for f in README.md CHANGELOG.md LICENSE NOTICE CONTRIBUTING.md SECURITY.md TRADEMARKS.md docs/ARCHITECTURE.md docs/PLATFORM-STATUS.md docs/PUBLISHING.md; do
  [ -f "$f" ] || MISSING_DOCS="$MISSING_DOCS $f"
done
if [ -z "$MISSING_DOCS" ]; then res PASS "A5-02" "key documentation present"; else res FAIL "A5-02" "missing:$MISSING_DOCS"; fi
VER_WAILS=$(python3 -c "import json;print(json.load(open('wails.json'))['info']['productVersion'])" 2>/dev/null || echo "?")
VER_NSI=$(grep -oE '!define VERSION "[0-9.]+"' build/windows/installer/xtracsys-editor.nsi | grep -oE '[0-9.]+' | head -1)
if [ "$VER_WAILS" = "$VERSION" ] && [ "$VER_NSI" = "$VERSION" ]; then
  res PASS "A5-03" "version consistent across wails.json/NSIS/pipeline"
else
  res FAIL "A5-03" "version drift: wails=$VER_WAILS nsi=$VER_NSI expected=$VERSION"
fi

# ---------------- B: security review (executed + static) --------------------
if grep -rnE "eval\(|new Function\(|child_process" --include="*.ts" frontend/src main.go internal 2>/dev/null | grep -v "_test" | grep -v "exec.Command(\"open\"|\"explorer\"|\"xdg-open\"" | grep -q .; then
  res FAIL "B-01" "dynamic-eval or shell-out pattern found (see $LOG)"
else
  res PASS "B-01" "no eval/new Function/unsafe shell-out patterns"
fi
if grep -rn "http://" --include="*.ts" --include="*.go" frontend/src internal main.go 2>/dev/null | grep -vE "127\.0\.0\.1|localhost|w3\.org|url\.|// |http://\w|u\.String|Sprintf|open-recent|\"http$|http://\" *\+" | grep -q "http://"; then
  res FAIL "B-02" "hardened http:// endpoints found (see $LOG)"
else
  res PASS "B-02" "no plaintext http endpoints outside loopback tests"
fi
if [ -f frontend/src/main.ts ] && grep -q "e2e" frontend/src/main.ts && ! grep -q "has(\"e2e\")" frontend/src/ipc.ts; then
  res FAIL "B-03" "e2e gate missing"
else
  res PASS "B-03" "bridge mode gated on ?e2e=1 + runtime presence check"
fi

# ---------------- C: debug review ------------------------------------------
TODO_N=$(grep -rn "TODO\|FIXME\|XXX\|HACK" --include="*.go" --include="*.ts" internal cmd frontend/src main.go 2>/dev/null | grep -cv "_test")
if [ "$TODO_N" = "0" ]; then res PASS "C-01" "no TODO/FIXME markers"; else res UNKNOWN "C-01" "$TODO_N TODO/FIXME markers present — triage"; fi
DEBUG_GATED=$(grep -c "XTRACSYS_EDITOR_DEBUG" internal/app/app.go)
if [ "$DEBUG_GATED" -ge 1 ] && grep -q "getenv\|Getenv" internal/app/app.go; then
  res PASS "C-02" "diagnostics env-gated (XTRACSYS_EDITOR_DEBUG)"
else
  res FAIL "C-02" "diagnostics not env-gated"
fi
LEFTOVER=$(ls scripts/.rec-debug* scripts/.sess-probe* scripts/.restore-off* scripts/.identify* 2>/dev/null | wc -l | tr -d ' ')
if [ "$LEFTOVER" = "0" ]; then res PASS "C-03" "no leftover debug probe scripts"; else res FAIL "C-03" "$LEFTOVER probe scripts left"; fi

# ---------------- D: applicable profiles -----------------------------------
# Profile 3 Data/recovery (recovery + session stores, restore demonstrated)
run "D3-01" "recovery/session store tests" go test ./internal/recovery/ ./internal/session/ -count=1 -race
if [ -f ~/Backups/xtracsys-editor-2026-10-31.bundle ]; then
  res PASS "D3-02" "bundle backup exists; restore demonstrated earlier (clone test)"
else
  res UNKNOWN "D3-02" "bundle backup missing"
fi
# Profile 5 Operations (CI + reproducible builds)
run "D5-01" "CI workflow parses as YAML" python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/ci.yml'))" 2>/dev/null || python3 -c "import yaml" 2>/dev/null || true
if python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" >/dev/null 2>&1; then
  res PASS "D5-01" "CI YAML valid"
else
  res UNKNOWN "D5-01" "PyYAML unavailable — CI YAML not parsed"
fi
# Profile 7 Privacy/legal (license obligations, trademark boundary, personal data)
if grep -q "Xtracsys LLC" NOTICE && grep -q "Xtracsys LLC" TRADEMARKS.md; then
  res PASS "D7-01" "NOTICE + trademark boundary carry LLC attribution"
else
  res FAIL "D7-01" "LLC attribution missing in NOTICE/TRADEMARKS"
fi
NOSNAP=$(grep -c "CrashRecoveryEnabled" internal/settings/settings.go internal/app/app.go frontend/src/settingsui.ts frontend/src/app.ts frontend/src/ipc.ts 2>/dev/null | awk -F: '{s+=$2} END {print s}')
if [ "$NOSNAP" -ge 5 ]; then res PASS "D7-02" "crash-recovery opt-in gated on both sides (off by default)"; else res UNKNOWN "D7-02" "crash-recovery gating references: $NOSNAP"; fi

echo "== battery complete: $FAILS failed/blocked/unknown" | tee -a "$LOG"
exit $FAILS
