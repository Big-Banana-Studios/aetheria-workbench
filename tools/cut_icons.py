# -*- coding: utf-8 -*-
"""cut_icons.py - the desk icons, cut from the Paperless tileset (48 px SakPix
tiles), Mira's portrait for her desk, and the app icon (the Lo Shu square in
the three regime colours).

    python tools/cut_icons.py

Needs Pillow and the game repo (PAPERLESS env var, or the default path).
"""
import os, sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.stderr.write("cut_icons needs Pillow:  python -m pip install Pillow\n")
    raise SystemExit(2)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
GAME = os.environ.get("PAPERLESS", r"c:/Users/jobo1/Desktop/Paperless, The Forgotten Courier/paperless")
OUT = os.path.join(ROOT, "public", "assets", "desk-icons")
T = 48

# (sheet, row, column) on the 48 px grid
PICKS = {
    "research": ("assets/tiles/06_sakpix_machines_and_tech.png", 0, 3),   # the blue terminal
    "writing": ("assets/tiles/08_sakpix_furtniure_and_fixtures.png", 1, 7),  # the desk
    "paperless": ("assets/tiles/12_sakpix_signs_and_holograms.png", 1, 6),  # WANTED
    "physics": ("assets/tiles/12_sakpix_signs_and_holograms.png", 2, 0),  # the ringed planet
    "aetheria": ("assets/tiles/12_sakpix_signs_and_holograms.png", 1, 4),  # the cube hologram
    "files": ("assets/tiles/09_sakpix_cargo_crates_and_containers.png", 0, 0),
    "memory": ("assets/tiles/06_sakpix_machines_and_tech.png", 0, 0),  # the canister
    "settings": ("assets/tiles/12_sakpix_signs_and_holograms.png", 0, 5),
    "diagnostics": ("assets/tiles/06_sakpix_machines_and_tech.png", 3, 3),
    "ambience": ("assets/tiles/12_sakpix_signs_and_holograms.png", 2, 3),
}


def app_icon(size):
    im = Image.new("RGBA", (size, size), (12, 13, 29, 255))
    d = ImageDraw.Draw(im)
    pad = size // 10
    cell = (size - 2 * pad) // 3
    gap = max(2, size // 48)
    cols = {"GUT": (255, 138, 60), "HEART": (255, 79, 139), "HEAD": (55, 230, 240)}
    layer = [["GUT", "HEART", "HEAD"], ["HEART", "HEAD", "GUT"], ["HEAD", "GUT", "HEART"]]
    for r in range(3):
        for c in range(3):
            x = pad + c * cell
            y = pad + r * cell
            d.rectangle([x + gap, y + gap, x + cell - gap, y + cell - gap], fill=cols[layer[r][c]] + (255,))
            if r == 1 and c == 1:
                d.rectangle([x + cell // 3, y + cell // 3, x + cell - cell // 3, y + cell - cell // 3], fill=(12, 13, 29, 255))
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (sheet, r, c) in PICKS.items():
        p = os.path.join(GAME, sheet)
        if not os.path.exists(p):
            print("missing", p, file=sys.stderr)
            continue
        im = Image.open(p).convert("RGBA")
        im.crop((c * T, r * T, (c + 1) * T, (r + 1) * T)).save(os.path.join(OUT, name + ".png"))
    portrait = os.path.join(ROOT, "public", "assets", "mira-portrait.png")
    if os.path.exists(portrait):
        p = Image.open(portrait).convert("RGBA")
        w, h = p.size
        s = max(w, h)
        sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        sq.paste(p, ((s - w) // 2, (s - h) // 2), p)
        sq.resize((T, T), Image.LANCZOS).save(os.path.join(OUT, "mira.png"))
    icons = os.path.join(ROOT, "public", "icons")
    os.makedirs(icons, exist_ok=True)
    app_icon(512).save(os.path.join(icons, "icon-512.png"))
    app_icon(192).save(os.path.join(icons, "icon-192.png"))
    app_icon(64).save(os.path.join(icons, "favicon.png"))
    print("icons:", sorted(os.listdir(OUT)), "+ app icons")


if __name__ == "__main__":
    main()
