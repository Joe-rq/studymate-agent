# -*- coding: utf-8 -*-
"""Crop logo option A's icon (not the wordmark) from the ChatGPT sheet and export app sizes."""
from PIL import Image

SRC = r"D:\EdgeDownload\ChatGPT Image 2026年8月15日 18_02_41.png"
ROOT = r"D:\code\studymate-agent"

# Detected via content-mask analysis: icon 182x181 square, wordmark to its right.
ICON_BOX = (95, 267, 277, 448)        # x0, y0, x1, y1
LOCKUP_BOX = (95, 267, 701, 448)      # icon + "StudyMate" wordmark

img = Image.open(SRC).convert("RGBA")

icon = img.crop(ICON_BOX)
print("icon:", icon.size)

def save(im, path, size):
    out = im.resize((size, size), Image.LANCZOS)
    out.save(path)
    print("saved", path, out.size)

save(icon, rf"{ROOT}\docs\logo.png", 512)
save(icon, rf"{ROOT}\web\public\logo.png", 512)
save(icon, rf"{ROOT}\web\public\apple-touch-icon.png", 180)
save(icon, rf"{ROOT}\web\public\favicon-32.png", 32)
save(icon, rf"{ROOT}\web\public\favicon-16.png", 16)

# full lockup (icon + wordmark) kept for README / banner use
lockup = img.crop(LOCKUP_BOX)
lockup.save(rf"{ROOT}\docs\logo-lockup.png")
print("saved lockup:", lockup.size)
