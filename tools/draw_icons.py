# -*- coding: utf-8 -*-
"""draw_icons.py - the two desk icons the tileset does not have: a mic for
the Open Mic desk and a cassette for the Suno desk, drawn as 16x16 pixel
maps and scaled to the 48 px the rail uses (integer nearest-neighbour, like
cut_icons.py). Mira's palette: ink on the night blue, the HEART rose and
the HEAD cyan for the lit parts.

    python tools/draw_icons.py
"""
import os, sys

try:
    from PIL import Image
except ImportError:
    sys.stderr.write("draw_icons needs Pillow:  python -m pip install Pillow\n")
    raise SystemExit(2)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "assets", "desk-icons")

PAL = {
    ".": (0, 0, 0, 0),
    "b": (12, 13, 29, 255),      # night
    "B": (24, 27, 50, 255),      # night, lit
    "g": (109, 108, 115, 255),   # steel
    "G": (164, 172, 171, 255),   # steel, lit
    "w": (234, 225, 232, 255),   # ink
    "r": (255, 79, 139, 255),    # rose
    "R": (255, 150, 190, 255),   # rose, lit
    "c": (67, 216, 232, 255),    # cyan
    "C": (55, 230, 240, 255),
    "o": (255, 138, 60, 255),    # ember
    "k": (4, 4, 10, 255),        # outline
}

MIC = [
    "................",
    "......kkkk......",
    ".....kGGGGk.....",
    ".....kGwwGk.....",
    ".....kGGGGk.....",
    ".....kGggGk.....",
    ".....kgggGk.....",
    "....k.kggk.k....",
    "....k..kk..k....",
    ".....k.kk.k.....",
    "......kkkk......",
    ".......kk.......",
    ".......kk.......",
    ".....kkkkkk.....",
    "....kggggggk....",
    ".....kkkkkk.....",
]

CASSETTE = [
    "................",
    ".kkkkkkkkkkkkkk.",
    "kGGGGGGGGGGGGGGk",
    "kGwwwwwwwwwwwwGk",
    "kGwrrrrrrrrrrwGk",
    "kGwwwwwwwwwwwwGk",
    "kGgkkkgggkkkggGk",
    "kGgkbbkgkbbkggGk",
    "kGgkbwkgkbwkggGk",
    "kGgkkkgggkkkggGk",
    "kGgggggggggggGGk",
    "kGGkkkkkkkkkkGGk",
    "kGkccccccccccCGk",
    "kGkkkkkkkkkkkkGk",
    ".kkkkkkkkkkkkkk.",
    "................",
]


def draw(rows, size=48):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            px[x, y] = PAL[ch]
    return im.resize((size, size), Image.NEAREST)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, rows in (("openmic", MIC), ("suno", CASSETTE)):
        path = os.path.join(OUT, name + ".png")
        draw(rows).save(path)
        print("wrote", os.path.relpath(path, os.path.join(HERE, "..")))


if __name__ == "__main__":
    main()
