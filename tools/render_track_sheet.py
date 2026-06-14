#!/usr/bin/env python3
# Contact sheet of every circuit outline in the project (ApexDuo_Prototype/track_shapes.gd,
# 25 real 2026 tracks, normalized 0..1 from f1-circuits-svg CC BY 4.0). Top-down plan view
# so each layout is recognizable. Shows what track geometry exists; ApexWeb currently ships
# only Барселона in the 3D view. Output: outputs/track_sheet.png
import re, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GD = os.path.join(ROOT, "ApexDuo_Prototype", "track_shapes.gd")
OUT = os.path.join(ROOT, "outputs", "track_sheet.png")
FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

src = open(GD, encoding="utf-8").read()
# each track: "Name": PackedVector2Array([ Vector2(x,y), ... ])
tracks = []
for m in re.finditer(r'"([^"]+)":\s*PackedVector2Array\(\[(.*?)\]\)', src, re.S):
    name = m.group(1)
    pts = [(float(a), float(b)) for a, b in re.findall(r"Vector2\(([\d.]+),\s*([\d.]+)\)", m.group(2))]
    if pts: tracks.append((name, pts))

COLS, CW, CH, PAD = 5, 280, 224, 16
ROWS = (len(tracks) + COLS - 1) // COLS
W, H = COLS*CW, ROWS*CH + 44
img = Image.new("RGB", (W, H), (12, 12, 15)); dr = ImageDraw.Draw(img)
title = ImageFont.truetype(FONT, 22); lab = ImageFont.truetype(FONT, 16)
dr.text((16, 12), f"Контуры трасс в проекте — {len(tracks)} шт. (track_shapes.gd) · в ApexWeb 3D пока только Барселона",
        font=title, fill=(225, 225, 235))

for i, (name, pts) in enumerate(tracks):
    cx0 = (i % COLS)*CW; cy0 = 44 + (i // COLS)*CH
    # fit normalized outline into the cell keeping aspect
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    sx = (CW-2*PAD)/(max(xs)-min(xs) or 1); sy = (CH-2*PAD-18)/(max(ys)-min(ys) or 1)
    s = min(sx, sy)
    ox = cx0 + (CW - (max(xs)-min(xs))*s)/2; oy = cy0 + (CH-18 - (max(ys)-min(ys))*s)/2
    poly = [(ox + (x-min(xs))*s, oy + (y-min(ys))*s) for x, y in pts]
    poly.append(poly[0])
    hi = name == "Барселона"
    dr.line(poly, fill=(90, 200, 255) if hi else (200, 205, 215), width=4, joint="curve")
    # start/finish dot
    dr.ellipse([poly[0][0]-4, poly[0][1]-4, poly[0][0]+4, poly[0][1]+4],
               fill=(255, 209, 0) if hi else (255, 122, 24))
    cap = name + ("  ◀ (в ApexWeb)" if hi else "")
    dr.text((cx0 + CW/2, cy0 + CH - 16), cap, font=lab,
            fill=(120, 210, 255) if hi else (160, 165, 175), anchor="mm")

os.makedirs(os.path.dirname(OUT), exist_ok=True); img.save(OUT)
print("wrote", OUT, img.size, "| tracks:", len(tracks))
