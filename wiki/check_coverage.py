#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Coverage checker: every git-tracked file must be claimed by an article.
# Folder-articles declare their coverage in COVER below; extend as the repo grows.
import json, subprocess, sys, os

REPO = os.path.dirname(os.path.abspath(__file__)) + "/.."
COVER = {
    "project-overview": ["README.md"],
    "release-history": ["WIKI.md", "CHANGELOG.md"],
    "security-model": ["docs/SECURITY-AUDIT.md", "SECURITY.md", "docs/RELEASE-NOTES-"],
    "architecture": ["docs/ARCHITECTURE.md"],
    "requirements-checklist": ["docs/REQUIREMENTS-CHECKLIST.md"],
    "platform-status": ["docs/PLATFORM-STATUS.md", "docs/PUBLISHING.md", "docs/RELEASE-NOTES-"],
    "brand": ["docs/BRAND.md", "design/"],
    "main-go": ["main.go"],
    "app-go": ["internal/app/app.go", "internal/app/buildstamp_gen.go"],
    "app-menu": ["internal/app/menu.go"],
    "e2e-serve": ["cmd/e2e-serve/"],
    "fileio-eol": ["internal/fileio/eol.go"],
    "fileio-encoding": ["internal/fileio/encoding.go"],
    "fileio-load": ["internal/fileio/load.go"],
    "fileio-save": ["internal/fileio/save.go"],
    "fileio-watch": ["internal/fileio/watch.go"],
    "fileio-fuzz": ["internal/fileio/fuzz_test.go", "internal/fileio/testdata/"],
    "settings-go": ["internal/settings/"],
    "recovery-go": ["internal/recovery/"],
    "session-go": ["internal/session/"],
    "localimg": ["internal/localimg/"],
    "fe-main": ["frontend/src/main.ts", "frontend/index.html"],
    "fe-app": ["frontend/src/app.ts"],
    "fe-ipc": ["frontend/src/ipc.ts"],
    "fe-eol": ["frontend/src/eol.ts"],
    "fe-editor": ["frontend/src/editor.ts"],
    "fe-markdown": ["frontend/src/markdown.ts"],
    "fe-preview": ["frontend/src/preview.ts"],
    "fe-outline": ["frontend/src/outline.ts"],
    "fe-ui": ["frontend/src/ui.ts", "frontend/src/util.ts"],
    "fe-settingsui": ["frontend/src/settingsui.ts"],
    "fe-theme": ["frontend/src/theme.ts", "frontend/src/styles/", "frontend/public/"],
    "fileio-tests": ["internal/fileio/eol_test.go", "internal/fileio/load_test.go",
                     "internal/fileio/save_test.go", "internal/fileio/watch_test.go"],
    "app-tests": ["internal/app/app_test.go"],
    "state-tests": ["internal/recovery/recovery_test.go", "internal/session/session_test.go",
                    "internal/settings/settings_test.go"],
    "fe-unit": ["frontend/src/eol.test.ts", "frontend/src/markdown.test.ts",
                "frontend/src/outline.test.ts"],
    "e2e-editor": ["tests/e2e/editor.spec.ts", "tests/e2e/.secfixtures/"],
    "e2e-security": ["tests/e2e/security.spec.ts"],
    "build-pipeline": ["scripts/build-all.sh", "scripts/make-dmg.sh", "scripts/dmg-background.py"],
    "make-icons": ["scripts/make-icons.py", "scripts/capture-screenshots.mjs", "docs/screenshots/"],
    "security-scripts": ["scripts/security-dynamic.mjs"],
    "ci": [".github/", "playwright.config.ts"],
    "packaging": ["wails.json", "build/darwin/", "build/windows/", "build/linux/",
                  "build/appicon.png", "build/iconfile.png", "go.mod", "go.sum"],
    "repo-plumbing": [".gitignore", "LICENSE", "NOTICE", "CONTRIBUTING.md",
                      "THIRD-PARTY-NOTICES.md", "TRADEMARKS.md",
                      "frontend/package.json", "frontend/package-lock.json",
                      "frontend/package.json.md5", "frontend/tsconfig.json",
                      "frontend/vite.config.ts", "frontend/vitest.config.ts",
                      "package.json", "package-lock.json", "wiki/"],
}

def main():
    tracked = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True).stdout.split()
    claimed = set()
    for paths in COVER.values():
        for p in paths:
            claimed.update(t for t in tracked if t == p or t.startswith(p))
    missing = [t for t in tracked if t not in claimed]
    print(f"tracked: {len(tracked)}  claimed: {len(claimed)}  missing: {len(missing)}")
    for m in missing:
        print("  UNCOVERED:", m)
    sys.exit(1 if missing else 0)

if __name__ == "__main__":
    main()
