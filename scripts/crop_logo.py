# -*- coding: utf-8 -*-
"""Crop the app icon from the logo sheet and export all sizes used by web/ and docs/.

Usage:
    python scripts/crop_logo.py [SOURCE_PNG]

SOURCE_PNG defaults to the original ChatGPT sheet location; ICON_BOX below is
calibrated to that sheet (option A's 182x181 icon, wordmark to its right).
Dependencies: Pillow (see scripts/requirements.txt).
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = r"D:\EdgeDownload\ChatGPT Image 2026年8月15日 18_02_41.png"

src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_SRC)

# Detected via content-mask analysis of the source sheet.
ICON_BOX = (95, 267, 277, 448)      # x0, y0, x1, y1 — icon only
LOCKUP_BOX = (95, 267, 701, 448)    # icon + "StudyMate" wordmark

img = Image.open(src).convert("RGBA")
icon = img.crop(ICON_BOX)
print("source:", src)
print("icon:", icon.size)


def save(im: Image.Image, rel: str, size: int) -> None:
    out = im.resize((size, size), Image.LANCZOS)
    out.save(ROOT / rel)
    print("saved", ROOT / rel, out.size)


save(icon, "docs/logo.png", 512)
save(icon, "web/public/logo.png", 512)
save(icon, "web/public/apple-touch-icon.png", 180)
save(icon, "web/public/favicon-32.png", 32)
save(icon, "web/public/favicon-16.png", 16)

# Full lockup (icon + wordmark) — reserved for future banner use.
lockup = img.crop(LOCKUP_BOX)
lockup.save(ROOT / "docs" / "logo-lockup.png")
print("saved lockup:", lockup.size)
