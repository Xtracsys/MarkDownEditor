#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Xtracsys
#
# Builds the drag-to-install macOS DMG:
#   app icon + /Applications symlink + branded "drag here" background.
#
# Usage: scripts/make-dmg.sh <path-to.app> <output.dmg>
# Icon layout is applied via Finder/AppleScript when automation is permitted;
# without it the DMG is fully functional (app + Applications symlink) and the
# background is still visible on first open.
set -euo pipefail

APP_PATH="$1"
OUT_DMG="$2"
VOLNAME="Xtracsys Editor"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

STAGE="$(mktemp -d)"
TMP_DMG="$(mktemp -u).$RANDOM.dmg"
trap 'rm -rf "$STAGE" "$TMP_DMG"' EXIT

cp -R "$APP_PATH" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
mkdir -p "$STAGE/.background"
python3 "$REPO/scripts/dmg-background.py" "$STAGE/.background/background.png"

hdiutil create -volname "$VOLNAME" -srcfolder "$STAGE" -ov -fs HFS+ "$TMP_DMG" >/dev/null

LAYOUT_APPLIED=0
MOUNT="$(mktemp -d)"
if hdiutil attach "$TMP_DMG" -mountpoint "$MOUNT" -nobrowse -quiet 2>/dev/null; then
  osascript <<EOF >/dev/null 2>&1 && LAYOUT_APPLIED=1 || true
tell application "Finder"
  tell disk "$VOLNAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {120, 120, 780, 520}
    set viewOptions to icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 104
    set background picture of viewOptions to file ".background:background.png"
    set position of item "xtracsys-editor.app" of container window to {170, 240}
    set position of item "Applications" of container window to {490, 240}
    close
    open
    update without registering applications
    delay 1
  end tell
end tell
EOF
  hdiutil detach "$MOUNT" -quiet
fi
rmdir "$MOUNT" 2>/dev/null || true

if [ "$LAYOUT_APPLIED" = "1" ]; then
  echo "layout applied"
else
  echo "note: Finder automation unavailable — building DMG without icon layout (still drag-installable)"
fi

hdiutil convert "$TMP_DMG" -format UDZO -o "$OUT_DMG" -ov >/dev/null
echo "wrote $OUT_DMG"
