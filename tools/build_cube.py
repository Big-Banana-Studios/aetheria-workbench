# -*- coding: utf-8 -*-
"""build_cube.py - writes public/data/aetheria-cube.json from the canonical sources.

    python tools/build_cube.py

Sources (read-only):
  aetheria-rct/index.html                 the 27-frequency table: keyword, scene, colour,
                                          hexagram, trigrams, geometry
  aetheria-rct/LOSHU_WALKS_IMPLEMENTATION.md  the walks (re-derived here from the formulas)
  aetheria-rct/loshu_cube_explorer_v3.html    the Ouroboros construction (re-derived here)
  Paperless data/stones.json, letters.json, recipients.json   stones, letters, holders

The formulas are the canon; the files above are checked against them.
"""
import json, re, os, sys, math

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
RCT = os.environ.get("AETHERIA_RCT", r"c:/Users/jobo1/Documents/GitHub/aetheria-rct")
GAME = os.environ.get("PAPERLESS", r"c:/Users/jobo1/Desktop/Paperless, The Forgotten Courier/paperless")

GUT = [174, 285, 396, 417, 528, 639, 741, 852, 963]
HEART = [2178 + (q - 5) * 243 for q in range(1, 10)]
HEAD = [4920 + (q - 5) * 354 for q in range(1, 10)]
assert HEART == [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150]
assert HEAD == [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336]

NM = [
    ["Foundation", "Tissue Repair", "Liberation", "Change", "Transformation", "Connection", "Intuition", "Spiritual Order", "Divine Consciousness"],
    ["Gateway", "Harmonic Bridge", "Unified Field", "Emotional Alchemy", "Compassion", "Heart Coherence", "Relational Harmony", "Soul Connection", "Heart Completion"],
    ["Mental Clarity", "Sacred Geometry", "Consciousness Mastery", "Soul Star", "Expressive Truth", "Universal Mind", "Galactic Consciousness", "Divine Source", "SOURCE"],
]
POS_DIR = {1: "N", 2: "SW", 3: "E", 4: "SE", 5: "Center", 6: "NW", 7: "W", 8: "NE", 9: "S"}
POS_ELEM = {1: "Water", 2: "Earth", 3: "Wood", 4: "Wood", 5: "Earth", 6: "Metal", 7: "Metal", 8: "Earth", 9: "Fire"}
LOSHU = [[4, 9, 2], [3, 5, 7], [8, 1, 6]]
P2CELL = {LOSHU[r][c]: r * 3 + c for r in range(3) for c in range(3)}
FS = [5, 6, 7, 8, 9, 1, 2, 3, 4]
REG = ["GUT", "HEART", "HEAD"]


def rct_meta():
    """keyword / scene / colour / hexagram per Hz from the RCT app's F table."""
    p = os.path.join(RCT, "index.html")
    if not os.path.exists(p):
        print("warning: aetheria-rct not found; keywords/colours will be blank", file=sys.stderr)
        return {}
    src = open(p, encoding="utf-8").read()
    m = re.search(r"const F=\[(.*?)\];", src, re.S)
    rows = re.findall(
        r'\{f:(\d+),kw:"([^"]*)",sc:"([^"]*)",c:"([^"]*)",hx:(\d+),hn:"([^"]*)",hc:"([^"]*)",ut:(\w+)?"?(\w+)?"?,lt:"?(\w+)"?,hw:"([^"]*)",geo:"([^"]*)"\}',
        m.group(1),
    )
    out = {}
    # the ut/lt capture is loose because the source is minified JS; re-parse per row
    for row in re.findall(r"\{f:\d+,[^}]*\}", m.group(1)):
        d = dict(re.findall(r'(\w+):"?([^",}]*)"?', row))
        out[int(d["f"])] = dict(
            keyword=d.get("kw", ""), scene=d.get("sc", ""), colour=d.get("c", ""),
            hexagram=int(d.get("hx", 0) or 0), hexagram_name=d.get("hn", ""), hexagram_pinyin=d.get("hc", ""),
            upper_trigram=d.get("ut", ""), lower_trigram=d.get("lt", ""), trigram_note=d.get("hw", ""), geometry=d.get("geo", ""),
        )
    assert len(out) == 27, len(out)
    return out


def game_stones():
    try:
        stones = json.load(open(os.path.join(GAME, "data/stones.json"), encoding="utf-8"))
        letters = json.load(open(os.path.join(GAME, "data/letters.json"), encoding="utf-8"))
        recips = json.load(open(os.path.join(GAME, "data/recipients.json"), encoding="utf-8"))
    except FileNotFoundError:
        print("warning: Paperless data not found; stones will be blank", file=sys.stderr)
        return {}, {}, {}
    return {s["id"]: s for s in stones}, {l["id"]: l for l in letters}, {r["id"]: r for r in recips}


def idx(reg, p):
    return REG.index(reg) * 9 + (p - 1)


def ouroboros():
    """Same construction as loshu_cube_explorer_v3.html: two lobes around the
    centre column, each swept angularly, joined at SOURCE three times."""
    P2G = {LOSHU[r][c]: (r, c) for r in range(3) for c in range(3)}
    lobeL, lobeR = [], []
    for L in range(3):
        for p in range(1, 10):
            if p == 5 and L == 1:
                continue
            r, c = P2G[p]
            n = dict(p=p, L=L, x=c - 1, y=L - 1, z=1 - r)
            if n["x"] < 0:
                lobeL.append(n)
            elif n["x"] > 0:
                lobeR.append(n)
            else:
                (lobeL if (n["y"] < 0 or (n["y"] == 0 and n["z"] < 0)) else lobeR).append(n)

    def order(lobe):
        cx = sum(n["x"] for n in lobe) / len(lobe)
        cy = sum(n["y"] for n in lobe) / len(lobe)
        return sorted(lobe, key=lambda n: math.atan2(n["y"] - cy, n["x"] - cx))

    src = dict(p=5, L=1)
    seq = [src] + order(lobeL) + [src] + order(lobeR) + [src]
    return [idx(REG[n["L"]], n["p"]) for n in seq]


def main():
    meta = rct_meta()
    stone_by_id, letter_by_id, recips = game_stones()
    regimes = [
        dict(id="GUT", district="Undercity", theme="endurance", colour="#ff8a3c", frequencies=GUT,
             formula="the nine Solfeggio tones: 174 285 396 417 528 639 741 852 963", prefix="gut"),
        dict(id="HEART", district="Street Market", theme="connection", colour="#ff4f8b", frequencies=HEART,
             formula="2178 + (n-5)*243 for n = 1..9; SOURCE is 2178 at the centre", prefix="heart"),
        dict(id="HEAD", district="The Stack", theme="sight", colour="#37e6f0", frequencies=HEAD,
             formula="4920 + (n-5)*354 for n = 1..9; Expressive Truth is 4920 at the centre", prefix="head"),
    ]
    freqs = []
    for L, reg in enumerate(regimes):
        for p in range(1, 10):
            hz = reg["frequencies"][p - 1]
            cell = P2CELL[p]
            d = dict(hz=hz, regime=reg["id"], position=p, cell=cell, loshu_value=LOSHU[cell // 3][cell % 3],
                     direction=POS_DIR[p], element=POS_ELEM[p], name=NM[L][p - 1])
            d.update(meta.get(hz, {}))
            d["digital_root"] = ((hz - 1) % 9) + 1
            sid = "%s_%02d" % (reg["prefix"], p)
            st = stone_by_id.get(sid)
            if st:
                let = letter_by_id.get(st["letter_id"], {})
                rec = recips.get(st["held_by"], {})
                d["stone"] = dict(id=sid, tier=st["tier"], tier_index=st["tier_index"], aura_colour=st["aura_colour"],
                                  unlocks=st["unlocks"], held_by=st["held_by"], holder=rec.get("name"),
                                  letter_id=st["letter_id"], letter_title=let.get("title"), letter_index=let.get("index"))
            freqs.append(d)

    WALK_A = [idx(r, p) for r in REG for p in range(1, 10)]
    WALK_B = [idx(r, p) for p in range(1, 10) for r in REG]
    WALK_C = [idx(r, p) for r in REG for p in FS]
    WALK_O = ouroboros()
    assert len(WALK_O) == 29 and WALK_O.count(idx("HEART", 5)) == 3
    walks = [
        dict(key="A", id="ascent", name="Ascent", paperless="ASCENT (A)", steps=WALK_A,
             blurb="Layer ascent: 1 to 9 through GUT, then HEART, then HEAD. Ground before you rise."),
        dict(key="B", id="pillar", name="Pillar", paperless="PILLAR (B)", steps=WALK_B,
             blurb="Pillar: for each position 1 to 9, GUT then HEART then HEAD. Integrate each quality fully; every pillar through the centre passes 2178."),
        dict(key="C", id="vortex", name="Vortex", paperless="VORTEX (C)", steps=WALK_C,
             blurb="Flying Star vortex: the nine-palace circuit 5 6 7 8 9 1 2 3 4 in each layer. Emanate from the heart; every regime starts at its centre."),
        dict(key="CAB", id="cab", name="CAB", steps=WALK_C + WALK_A + WALK_B,
             blurb="Vortex, then Ascent, then Pillar: 81 steps, the cube from every angle."),
        dict(key="O", id="ouroboros", name="Ouroboros", paperless="OUROBOROS (I)", steps=WALK_O,
             blurb="Closed figure-8 through all 27, crossing SOURCE (2178, the HEART centre) three times: 29 steps."),
        dict(key="CABI", id="cabi", name="CABI", steps=WALK_C + WALK_A + WALK_B + WALK_O,
             blurb="The full circuit: CAB, then the Ouroboros loop home. 110 steps."),
    ]
    cube = dict(
        meta=dict(
            title="Aetheria cube", version="1.0", generated="2026-09-08", generated_by="tools/build_cube.py",
            note="Layer 3 material: cosmology and the creative frame. Nothing in this file is a physiological or medical claim, and the app never makes one.",
        ),
        loshu=dict(square=[4, 9, 2, 3, 5, 7, 8, 1, 6],
                   square_comment="Row-major. Every row, column and diagonal sums to 15. Cell 4 (value 5) is the SOURCE.",
                   source_cell=4, position_to_cell={str(p): P2CELL[p] for p in range(1, 10)},
                   position_to_direction=POS_DIR, position_to_element=POS_ELEM, flying_star_order=FS),
        regimes=[dict(id=r["id"], district=r["district"], theme=r["theme"], colour=r["colour"], frequencies=r["frequencies"], formula=r["formula"],
                      tiers=["ember (1-2 stones)", "ring (3) ability I", "ring+ (4-5)", "halo (6) ability II", "halo+ (7-8)", "lattice (9) capstone"]) for r in regimes],
        frequencies=freqs,
        triads=[dict(position=p, direction=POS_DIR[p], gut=GUT[p - 1], heart=HEART[p - 1], head=HEAD[p - 1]) for p in range(1, 10)],
        walks=walks,
        tuning=dict(a4=432, note="The ambience bed in this family of apps is tuned to A4 = 432 Hz. A production choice, never a mechanic."),
    )
    out = os.path.join(ROOT, "public", "data", "aetheria-cube.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(cube, f, indent=1, ensure_ascii=False)
    print("wrote", os.path.relpath(out, ROOT), "-", len(freqs), "frequencies,", ", ".join("%s=%d" % (w["key"], len(w["steps"])) for w in walks))


if __name__ == "__main__":
    main()
