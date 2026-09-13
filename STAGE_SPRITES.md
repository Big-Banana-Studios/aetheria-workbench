# STAGE_SPRITES.md — the open-mic poses, and the frames they still need

The stage (`src/openmic/stage.js`) drives Mira's own renderer with a small
vocabulary of poses the model emits inline in a set: `{pace}`, `{lean}`,
`{shriek}`, `{deadpan}`, `{aside}`, plus the stage's own `enter` and `bow`.
Each is a gesture over the `speaking` state (so the mouth keeps following
the voice) built from clips the courier atlas already has. This file says
which clip each pose borrows today and which frames AutoSprite should draw
so the stage, and the game's `cutscene/` player, can swap the real ones in.

Atlas facts (from `public/assets/sprites/courier/courier.json`): 160 px
frames, the character 144 px tall, feet at y=159, mouth anchors only on the
down-facing clips (`idle_down`, `walk_down`, `resonate_down`, `hurt_down`,
`jump_down`, `punch_down`, `sleep_down`). A pose that talks must face down
or carry its own mouth anchor.

| pose | what it means on stage | borrowed today | frames to draw (down-facing, 160 px, feet at 159, mouth anchor) |
|---|---|---|---|
| `enter` | she walks in from the wing to the mic | `walk_right` off-left → centre, `idle_down` | none needed |
| `pace` | walking the stage while she talks | `walk_right` to +26, `idle_right`, `walk_left` to −18, then `walk_down` frame 1 held | **pace_talk**: 8 frames, a slow side-on walk with the head turned to the room, mouth anchor on each |
| `lean` | leaning on the mic stand for the quiet part | `idle_southeast` 0.5 s, then `walk_down` frame 1 held | **lean_mic**: 4 frames, weight on one hip, one hand on the stand, breathing loop |
| `shriek` | the one loud line; the aura flares, the light flares | `resonate_down` frames 1–3 held 3 s | **shriek**: 6 frames, visor up, mouth wide, arms out, one frame past the peak to hold |
| `deadpan` | the freeze for the tag | `idle_down` frame 0 held (no bob) | **deadpan**: 1 frame, half-lidded, still; blink off |
| `aside` | the observation, spoken slower, the light dips | `idle_southwest` 0.45 s, then `idle_down` frames 0–1 at 2 fps | **aside**: 3 frames, a quarter turn away, a hand half up to the mouth, back |
| `beat` | a bare direction, "(beat)" | `idle_down` frame 2 held | none needed |
| `bow` | the end of the set | `sleep_down` frames 0–1 at 4 fps held 1.6 s, then `idle_down` | **bow**: 4 frames, a small nod-bow from the waist and back up |

Build notes for AutoSprite: keep the 160 px frame and the 144 px body so
the manifest's `mouth` and `visor` anchors line up (`tools/build_sprites.py`
in Mira measures them); name the packs `stage_<pose>` so `courier.json`
can take them as clips without touching the renderer. Once a real clip
exists, `STAGE_GESTURES` in `stage.js` points at it and the row above
moves to "drawn".

The game's `cutscene/cutscene_player.gd` maps the same poses onto the
bagless courier's animations (`walk_*`, the eight-direction `idle_*`,
`resonate_down`, `sleep_down`); the same five packs, imported with
`tools/mz_import.py`, replace them there.

## The drag (2026-09-11)

`stage_drag` / `stage_drag_l` (a drag on the cigarette between bits, and
now and then while she waits) borrow `smoke_southeast` / `smoke_southwest`
as they are, at the clips' own pace (5 fps since 2026-09-11, slowed from 7
in the manifest, Mira's copy included). No new frames needed; a front-facing
`smoke_down` would let her drag while looking straight at the room.
