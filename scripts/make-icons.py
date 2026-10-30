#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Xtracsys LLC
#
# Generates the application icons from the emblem crops derived from the
# supplied brand reference sheet (design/brand-reference.png).
# Temporary assets: production vector logo sources have been requested; these
# rasters preserve the supplied geometry at 1.4x upscale (LANCZOS).

from PIL import Image
import os, struct, subprocess, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMBLEM_DARKBG = os.path.join(ROOT, "design/crops/E_inverse_emblem_tight.png")  # white emblem on #0A0B0C

BRAND_FIELD = (0x0A, 0x0B, 0x0C)   # sampled: DARK FIELD panel
BRAND_WARMWHITE = (0xF6, 0xF5, 0xF1)

def emblem_on(field, emblem_img, size, emblem_ratio=0.66):
    """White emblem centered on a full-bleed field square."""
    canvas = Image.new("RGBA", (size, size), (*field, 255))
    esz = int(size * emblem_ratio)
    # The crop carries the dark field around the emblem; resample and paste —
    # identical field color, so it composites seamlessly.
    em = emblem_img.resize((esz, esz), Image.LANCZOS)
    canvas.paste(em, ((size - esz) // 2, (size - esz) // 2))
    return canvas

def main():
    src = Image.open(EMBLEM_DARKBG).convert("RGBA")
    build = os.path.join(ROOT, "build")
    os.makedirs(build, exist_ok=True)

    # 1024 master (wails build/appicon.png)
    master = emblem_on(BRAND_FIELD, src, 1024)
    master.save(os.path.join(build, "appicon.png"))

    # Linux PNG set
    linux = os.path.join(build, "linux")
    os.makedirs(linux, exist_ok=True)
    for s in (512, 256, 128, 64, 32, 16):
        emblem_on(BRAND_FIELD, src, s).save(os.path.join(linux, f"{s}x{s}.png"))

    # macOS icns via iconutil
    darwin = os.path.join(build, "darwin")
    os.makedirs(darwin, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        iconset = os.path.join(td, "AppIcon.iconset")
        os.makedirs(iconset)
        sizes = {"icon_16x16.png": 16, "icon_16x16@2x.png": 32, "icon_32x32.png": 32,
                 "icon_32x32@2x.png": 64, "icon_128x128.png": 128, "icon_128x128@2x.png": 256,
                 "icon_256x256.png": 256, "icon_256x256@2x.png": 512, "icon_512x512.png": 512,
                 "icon_512x512@2x.png": 1024}
        for name, s in sizes.items():
            emblem_on(BRAND_FIELD, src, s).save(os.path.join(iconset, name))
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o",
                        os.path.join(darwin, "icon.icns")], check=True)

    # Windows ICO (PNG-compressed entries; Vista+)
    win = os.path.join(build, "windows")
    os.makedirs(win, exist_ok=True)
    images = []
    for s in (256, 128, 64, 48, 32, 16):
        images.append(emblem_on(BRAND_FIELD, src, s))
    # Multi-size ICO via PIL
    images[0].save(os.path.join(win, "icon.ico"), format="ICO",
                   sizes=[(i.width, i.height) for i in images], append_images=images[1:])
    print("icons written to build/")

if __name__ == "__main__":
    main()
