#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Xtracsys
#
# Renders the drag-to-install background for the macOS DMG (brand tokens from
# docs/BRAND.md: warm white #F6F5F1, black #080808, rust #B14831).

from PIL import Image, ImageDraw, ImageFont
import sys

W, H = 660, 400
warm_white = (0xF6, 0xF5, 0xF1, 255)
black = (0x08, 0x08, 0x08, 255)
muted = (0x67, 0x64, 0x5C, 255)
rust = (0xB1, 0x48, 0x31, 255)

img = Image.new("RGBA", (W, H), warm_white)
d = ImageDraw.Draw(img)

def font(size):
    for path in ("/System/Library/Fonts/Helvetica.ttc",
                 "/System/Library/Fonts/HelveticaNeue.ttc",
                 "/System/Library/Fonts/SFNS.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()

title = font(21)
sub = font(13)

d.text((W // 2, 52), "XTRACSYS EDITOR", font=title, fill=black, anchor="mm")
d.rectangle((W // 2 - 60, 72, W // 2 + 60, 74), fill=rust)
d.text((W // 2, 100), "Drag the app into Applications to install", font=sub, fill=muted, anchor="mm")
d.text((W // 2, H - 34), "Then eject this disk and launch Xtracsys Editor from Applications",
       font=sub, fill=muted, anchor="mm")
# Arrow between the two icon slots.
d.line((W // 2 - 46, H // 2 + 8, W // 2 + 40, H // 2 + 8), fill=rust, width=3)
d.polygon([(W // 2 + 40, H // 2 + 8), (W // 2 + 26, H // 2), (W // 2 + 26, H // 2 + 16)], fill=rust)

img.save(sys.argv[1] if len(sys.argv) > 1 else "background.png")
