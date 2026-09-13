# paperless-bible.md

The Paperless desk loads this file into its prompt. It is a starter, built from the game's own data on 2026-09-08 (`docs/paperless-brief-v8.md`, `docs/CANON.md`, `docs/paperless-narrative-system.md`, `data/*.json`, the README). Keep it current by hand; the desk treats it as canon and it outranks anything the model remembers. The game repo is the source of truth for anything this file does not say.

## The pitch

In a city that abolished physical mail to save the planet, a freelance courier makes rent carrying letters that are not supposed to exist. A stranger hands over a job: twenty-seven letters, unaddressed, to be delivered by resonance. Each letter, put into the right hands, is traded for a stone; each stone adds its colour to the courier's aura; every one of the twenty-seven can be delivered by opening a hand or closing a fist.

**The keystone: paper cannot be edited remotely.** The public network rewrites what citizens remember. A letter is the last medium it cannot reach into. The ban on paper is popular and the reason given for it is good; nobody had to be evil to build this.

**The Quiet (the story revision).** The network has been rewriting memory for nineteen years and is nearly done. On a scheduled day it performs a full synchronisation; anything not on the network will simply not have happened. Twenty-seven people still remember something it has already deleted. The letters are warnings, each with an instruction, addressed by description because names are on the network. The clock is measured in **deliveries**, never a timer: every letter delivered is a day closer and a person saved, and those are the same act. Terminals read 27 days at 0 delivered, 18 at 9, 9 at 18, 1 at 26. The city degrades toward the day (scanners read further, the watch doubles, signs stutter, hollowed people stand in the street, someone already reached no longer knows her). The first delivery lands hard: whoever it is does something they have not done in years.

**The title.** "Paperless" is the title; "the forgotten courier" is the tagline. Top-down 3/4 action-adventure, Godot 4.7, 48 px tiles, phone-first (Android) with PC alongside.

## The three regimes

| Regime | District | Look | Enforcement | Aura |
|---|---|---|---|---|
| **GUT** | The Undercity | navy, rust, standing water, exposed infrastructure | none; the network barely reaches | ember `#ff8a3c` |
| **HEART** | The Street Market and tenements | amber and rose, clutter, awnings, handmade signage | informants: people who might report you | rose `#ff4f8b` |
| **HEAD** | Corporate Plaza and The Stack | white light, glass, grid geometry, no wear | door scanners on every entrance | white light `#37e6f0` |
| Dead Zone | Quarantine | all three palettes malfunctioning | the network eating itself | — |

Each regime: one dungeon, nine recipients (six in the open, three in the dungeon, the last the guardian), interiors that open, terminals, vendors, a safehouse, a transit stop. Regime borders are open streets. Every walk opens in the Undercity.

Dungeons and guardians: **The Sunk Works** (GUT, The Diver, wants the letter about surviving what drowned you); **Market Under Market** (HEART, The Broker, the letter about what a community owes its own); **Vertical Custody** (HEAD, The Custodian, the letter about consent); **The Dead Zone** (The Echo, holds no stone and takes no letter).

## The controls, and the hold

Stick, and two buttons. **HIT tap** punches; **HIT hold** RESONATES: the courier speaks a specific compliment drawn from something that enemy's design actually shows, and if it lands they stop and follow as an ally. **JUMP tap** clears a low prop; **JUMP hold** is the dash once the GUT has taught it (Ring, three stones). BAG opens the satchel. There is no interact button: delivery reuses the hold. All input thresholds are in seconds (hold 0.18 s, resonate wind-up 0.9 s, 1.8 s on someone already struck; resonance progress degrades under fire by 0.35 per hit, never resets).

**Violence begets violence; peace follows peace.** Resonance only lands cleanly on someone not struck and who has not seen a friend struck. Every district has a hidden Temperament (−100..100): resonating +6, a correct delivery +8, a contract delivered +3, freeing a hollowed civilian +5; a knockout −6, seen fighting −4, fighting a guardian −30. Recipients refuse below −20 ("Give me a reason to open this door."), a district hardens at −40, drifts back toward zero 1.5 a minute, and always keeps sending patrols, so there is always someone to resonate. Allies: cap 3, they vouch, screen scanners, mirror your violence, stay five minutes, peel off after two doors. Heat 0–3 (clean, flagged, wanted, sweep) decays 90 s a level, 35 in GUT, 6 on a roof deck; getting caught costs contract mail and a fine, never one of the 27.

## The 27 letters and who they are for

Letter indices are 0–26 ordered HEART, GUT, HEAD, and read in that order they form one continuous text. Delivered in walk order they form a different poem per walk. One letter, one stone, always. Guardians are recipients: resonated, the letter is delivered and the stone given; fought, the stone is taken and the letter stays undelivered forever, which locks the true ending.

| # | Voice | Letter | Recipient | Where | Stone | Codex hint |
|---|---|---|---|---|---|---|
| 0 | HEART | *On What Is Owed* | Uncle Sef (`sef`) | overworld | `heart_01` ember | Feeds anyone who sits down. Keeps no ledger. |
| 1 | HEART | *On Talking to the Silent* | Zaya (`zaya`) | overworld | `heart_02` ember | Talks to her mother every day. Her mother stopped answering. |
| 2 | HEART | *On Small Rooms* | Perpetua (`perpetua`) | overworld | `heart_03` ring | Makes shutters. Every one of them opens. |
| 3 | HEART | *On Handwriting* | Halim (`halim`) | overworld | `heart_04` ring+ | Writes letters for people who cannot. Criminal trade now. |
| 4 | HEART | *On Standing Between* | Nine-Fingers (`nine_fingers`) | overworld | `heart_05` ring+ | Fence, informant, has not picked a side. |
| 5 | HEART | *On the Old Routes* | Grandmother Oyo (`oyo`) | dungeon | `heart_06` halo | The last person here who worked for a postal service. |
| 6 | HEART | *On Being Sold* | Kessa (`kessa`) | dungeon | `heart_07` halo+ | Sold something that could talk. Twice. |
| 7 | HEART | *On the Weight You Carry* | Sara (`mira`) | overworld | `heart_08` halo+ | Runs the market board. Carries everyone else's news. |
| 8 | HEART | *On What a Market Owes* | The Broker (`the_broker`) | boss | `heart_09` lattice | Holds the market under the market. Owns what she locks up. |
| 9 | GUT | *On Hunger* | Wick (`wick`) | overworld | `gut_01` ember | Keeps one dry room stacked with paper he cannot read. |
| 10 | GUT | *On Standing Still* | Ma Teodora (`ma_teodora`) | overworld | `gut_02` ember | Runs an unlicensed clinic. Reads aloud to people who cannot sleep. |
| 11 | GUT | *On Being Found* | Ollo (`ollo`) | overworld | `gut_03` ring | A child who has never seen paper and does not believe in it. |
| 12 | GUT | *On Holding the Valve* | Bram the Valve (`bram`) | overworld | `gut_04` ring+ | Controls the flood gates. Trades only in favours. |
| 13 | GUT | *On Walking Out* | Sister Anka (`anka`) | overworld | `gut_05` ring+ | Walked out of a corporate tower and went under. Still standing. |
| 14 | GUT | *On the Nine Below* | Acolyte Ren (`ren`) | overworld | `gut_06` halo | Speaks only in fragments of something much older. |
| 15 | GUT | *On Salvage* | Halden (`halden`) | dungeon | `gut_07` halo+ | Went in for salvage and never came back up. |
| 16 | GUT | *On Singing Together* | The Choir (`the_choir`) | dungeon | `gut_08` halo+ | Three acolytes who share one stone and one answer. |
| 17 | GUT | *On What Drowned You* | The Diver (`the_diver`) | boss | `gut_09` lattice | Went under for the district and stayed under. |
| 18 | HEAD | *On Consent* | Auditor Vess (`vess`) | overworld | `head_01` ember | Approves removals all day. Nobody asks the removed. |
| 19 | HEAD | *On Naming* | Kell (`kell`) | overworld | `head_02` ember | Names the drones. Command calls that inefficient. |
| 20 | HEAD | *On Keeping Notes* | Nurse Ipa (`ipa`) | overworld | `head_03` ring | Administers memory hygiene. Has started keeping notes on paper. |
| 21 | HEAD | *On Standing at the Door* | Prefect Dane (`dane`) | overworld | `head_04` ring+ | Plaza security, one week from resigning. |
| 22 | HEAD | *On the Last Page* | Sub-Archivist Tomm (`tomm`) | overworld | `head_05` ring+ | Digitised the last physical archive and kept one page. |
| 23 | HEAD | *On Being Twelve* | Iri (`iri`) | overworld | `head_06` halo | An executive's child, twelve, has never been outdoors alone. |
| 24 | HEAD | *On Routing* | Dispatcher Ovis (`ovis`) | dungeon | `head_07` halo+ | Routes every transit car. Knows where everything goes. |
| 25 | HEAD | *On Counting* | Subject 9 (`subject_9`) | dungeon | `head_08` halo+ | Held in custody as an asset, not a person. Logged, measured, never asked. |
| 26 | HEAD | *On Being Kept* | The Custodian (`the_custodian`) | boss | `head_09` lattice | Keeps the tower in vertical custody. Was never asked either. |

Canon notes (from CANON.md): the recipient at the market board is **Sara** now, id still `mira`, because the courier's canon name is Mira (the player names her; Mira is pre-filled). Subject 9 replaces the prototype's Fen. The Custodian's letter is 26, *On Being Kept*. Aura tiers step at 3 / 6 / 9 per regime: ember (1–2), ring (3, ability I), ring+ (4–5), halo (6, ability II), halo+ (7–8), lattice (9, capstone). GUT abilities: Surge (the dash), Second Wind, Ground Break. HEART: Pulse, Draw (resonate hollowed civilians), Chorus. HEAD: Read, Reroute (resonance works on drones), Overwrite. **The frequency number never appears in the HUD.**

## The satchel is a Lo Shu walk

The nine letters of each regime are carried in the order of a walk through the magic square 4 9 2 / 3 5 7 / 8 1 6 (row-major cells 0–8; cell 4, value 5, is the SOURCE). Cycling letters steps along the walk; the cube on the bag screen numbers each letter by its place on this walk, 1 to 9. The three guardian letters sit outside the square in their own strip. The walk is the save slot and the volume.

| Walk | Key | Cells (row-major) | Blurb | Volume of the 144 |
|---|---|---|---|---|
| VORTEX | C | 4 1 2 5 8 7 6 3 0 | flying star 5-6-7-8-9-1-2-3-4, one district at a time | *What Still Moves*: the city working, trade, favours |
| ASCENT | A | 7 2 3 0 4 8 5 6 1 | 1 to 9 through the Undercity, the market, the towers | *Sixty-One Doors*: Serrano and Oyo, the Act, who signed it |
| PILLAR | B | 0 3 6 1 4 7 2 5 8 | each position as a pillar: below, middle, above | *The Same Room, Three Floors Up*: estrangement, the same job in three lives |
| OUROBOROS | I | 0 8 4 2 6 3 5 1 7 | closed figure-8, crossing the source three times | *The Fourth*: the ship, the crew, the unsigned letters |

The sender's note names the **place** the walk starts, never the person: the salvage stacks on VORTEX, under the water on ASCENT, the dry room on PILLAR and OUROBOROS. Nine Lo Shu keypads, one per dungeon floor, each want a magic line of that regime's square (three stones summing to fifteen); they read the stones and never take them. Easter eggs: an unmarked 29-step Ouroboros route in the Undercity; a 110-step CABI walk across all three regimes; digital roots of 3, 6, 9 on room numbers, transit lines, contract IDs and prices near recipients; bookshelf lore quoting the family catalog; *Spark of Creation* is a working bar.

## The four lenses (narrative bible, part two)

The same twenty-seven people and letters; the walk changes what the story is about. A player who walks all four should feel they played four games. For every recipient the delivery scene comes in four versions, and they are four different things the person chooses to tell you, not four styles of one paragraph:

- **VORTEX, circulation.** Present tense, busy, overheard. Most letters land on people mid-task. Sef: *"Everyone eats. Nobody owes me. Sit down or move — you're in the line."*
- **ASCENT, strata.** Accumulating, patient, angry underneath. You come up out of the water and they can tell. Sef: *"You have the water on you. Down there they still pay each other in favours. Up here they call that a debt."*
- **PILLAR, correspondence.** Rhyming, uncanny, quietly devastating. You meet the same role in three lives. Sef: *"There's a man in the Stack does what I do. Serves four hundred. Knows none of their names."*
- **OUROBOROS, return.** Recursive, dreamlike, addressed to you. The courier has done this before and nobody says so. Sef: *"...You've given me this before. I'd have remembered a thing like this."*

Three questions seeded early and never answered quickly: who wrote the letters; what is under the city; what happens to a person the network hollows. Every NPC holds one fragment and nobody holds the answer. Idle lines fall into five buckets, Route, Threat, Person, World, Self, and every recipient owes a Route and a Person line or they have not earned their place.

## The dialogue format

Resolved by `scripts/systems/lines.gd`, validated by `tools/validate_dialogue.py`. A file holds `pools`; a pool is an array of variants; the most specific match wins, ties broken by unspoken-first then random; exhaust before repeat; never reopen a round on the line that closed the last one; a character speaks unprompted at most once per 90 seconds; silence is valid.

```json
{
 "pools": {
  "delivery_sef": [
   {"when": {"walk": "ouroboros", "playthrough_gte": 2}, "weight": 100, "text": ["You are early.", "Not for the food. For this. You are early with this."]},
   {"when": {"walk": "pillar", "met_role_peers_gte": 2}, "weight": 95, "text": ["You have met all three of us now.", "Do not tell me which one eats best. I have worked it out."]},
   {"when": {"walk": "ascent", "came_from": "GUT"}, "weight": 90, "text": ["Straight up out of the water and into my line.", "Sit down. You can hand me things sitting down."]},
   {"when": {"casualties_gte": 1}, "weight": 70, "text": ["I heard.", "Sit down anyway. That rule does not have an exception in it."]},
   {"when": {"temperament_band": "hostile"}, "weight": 70, "text": ["Take it back out with you when you go.", "You can eat first. Everyone eats. But you are not staying after."]},
   {"when": {"walk": "vortex"}, "weight": 80, "text": ["Everyone eats. Nobody owes me.", "Sit down or move - you're in the line."]},
   {"when": {}, "weight": 0, "text": ["Everyone eats. Nobody owes me. That is the rule."]}
  ],
  "idle_sef": [
   {"when": {}, "weight": 10, "bucket": "route", "text": ["There is a way over the awnings from the fish stall. Mind the third one."]},
   {"when": {}, "weight": 10, "bucket": "person", "text": ["Kessa has not slept properly since she sold that thing. Twice, they say."]}
  ]
 }
}
```

**The closed set of state keys** (adding one multiplies the writing burden): `walk` (vortex / ascent / pillar / ouroboros), `playthrough` (1–4+, `_gte`), `casualties` (0 / 1–3 / 4+, `_gte`), `temperament_band` (warm / neutral / hostile), `contracts_band` (0–9 / 10–24 / 25+), `allies_present` (0 / 1–3), `heat` (0–3), `letters_delivered` (0–8 / 9–17 / 18–26 / 27), `came_from` (GUT / HEART / HEAD), `crew_rescued` (0 / 1 / 2), `keys_held`, `routes_known`, `fed_ferret` (bool), `met_role_peers` (0–2).

Pool naming: `delivery_<id>`, `idle_<id>`, `refuse_<id>`, `smoke_<id>`; bystanders `extra_<role>_<trigger>` then `extra_<band>_<trigger>` (triggers: reached, smoke, punch, swing, bump, idle); civilians `civilians_<band>` and `civilians_scanned`. Every unconditioned tier of a bystander pool is at least three deep, every conditioned one at least two. Lint fails the build on: an unknown state key, an unreachable variant, a pool smaller than its exhaust window, a duplicate line across characters, a banned term, a line over the box (90 characters), a frequency number, an efficacy claim, a proper noun not in canon.

## Enemy archetypes, and the compliment that reaches them

Every archetype has a `resonance` block; every encounter has a non-violent resolution. The compliment is drawn from what the design shows.

| id | regime | the compliment |
|---|---|---|
| training_dummy | GUT | Somebody kept you for practice. That is a kind of care. |
| scavenger | GUT | Those goggles have been mended more than once. Somebody wanted to keep seeing. |
| tunnel_runner | GUT | You carry your boots through the water. Somebody taught you that. |
| acolyte | GUT | You have not moved since I came in. That is not fear. |
| market_muscle | HEART | This market knows your name. That took years. |
| informant | HEART | You stopped at the crossing. Habit, or decency? |
| quiet_thing | HEART | It has not moved. Neither have you. That is the entire conversation. |
| enforcer | HEAD | That earpiece has heard you say no before. |
| corporate_security | HEAD | You have stood on this crossing all day and nobody has thanked you for it. |
| drone | HEAD | Somebody gave you a name. It is still written on you. (needs Reroute) |
| carrier_gut / carrier_heart / carrier_head | each | the old postal carriers, still walking the route with nothing in the bag |
| plush_bear / plush_cat / plush_hare | GUT / HEART / HEAD | the plushies; never drift, all three needed at once |

**The watch.** Corporate security holds a post at every crossing between districts, keeps the doors the corporation minds, and the stair of every dungeon floor; friendly until a scan finds contract mail on her. Surveillance drones patrol with a two-tile beam, thickest over the Stack, one over the Undercity; a drone walks with a guard under it as the run hardens. Day one has none of it.

## Smoke breaks

The only mechanic that charges for standing still: one health every nine seconds, floor 25, and that is when people talk. She sits down; the nearest ally speaks; two or three allies talk to each other over her head (ensembles cast by tag: street, uniform, machine, strange, plush). Welcome in GUT; the market asks her to take it further down after fourteen seconds and being told and staying costs 4 temperament; in HEAD nobody says anything, something logs it (0.9 heat a second). Safe rooms: her apartment and the three safehouses. Allies who dislike smoke (drone, enforcer, carrier_head, plush_cat, corporate_security) leave after nine cost cycles. Her own smoke-break thoughts (`data/smoke.json`) are the lines Mira says when it has been quiet.

## Contract mail and the sealed correspondence

Contract mail is the side economy: paid pages, pinned on a board that is itself paper. The people at the far end are learning the language from novels one page at a time; nobody explains this. 978 excerpts from *Aetheria* and *What Struggle Knows* are dealt without replacement. The contract track pays in time: milestones at 2 / 6 / 10 / 15 / 21 / 27 / 36 shorten the resonate wind-up, speed heat decay, raise the temperament floor, thin the hostiles and thicken the street; each comes with an alien field note and kibble for Frank the ferret.

**The sealed correspondence:** 144 authored parcels across the four walks, 36 per volume, the volume is the save slot, and the courier never opens one. Every contract has a real sender and recipient who both talk (two or three lines at the board, two or three at the drop); the letter inside is 55–170 words the player never sees until all four walks are done and the archive on the Quiet Planet opens ("Carried 144. Opened 0. Until now."). The three dungeon keys arrive through this channel. The last nine contracts of a run lean toward the ending the run is heading for, in what people say, never in narration.

```json
{"n": 1, "id": "v1_01", "from": "odalys", "to": "mira",
 "pickup": ["\"Same as every week. Do not shake it.\""],
 "dropoff": ["\"She sends me one of these every seven days and we live four streets apart.\"", "\"I know. I could walk. That is not the point of it.\""],
 "letter": "Weather held. The awning has gone at the corner and nobody has come to fix it, so I have been standing in it. ..."}
```

Correspondents are listed in `data/correspondence/correspondents.json`; never invent one. No two contracts in a row to the same room; no key inside the final nine.

## The endings

Point of no return: boarding the ship at The Seam, where all three regimes meet. The survey crew (Captain Sever, held in Vertical Custody; Ferrow the engineer, in the Sunk Works; a third in Market Under Market) are rescued by resonance at Ring tier of that regime, never escorted. Ship parts ride on the guardians' stones.

| Ending | Verb | Requires |
|---|---|---|
| DISMANTLE | Stay. Break the synchronisation. | no parts |
| INHERIT | Stay. Take the network. | 1 part |
| ESCAPE | Leave, before the day. | 2 parts, 27 stones, 1 crew aboard (whole or hurt) |
| THE QUIET PLANET | Leave clean, before the day. | 3 parts, 27 stones, 3 crew whole, 0 harmed, 27 delivered |
| THE TUESDAY | Sleep, on the last night. | nothing: the only ending every run can reach |

The Quiet Planet: the morning after the sync twenty-seven people wake in a city they do not remember, each holding a letter that tells them who they are; she is the only person alive who read all twenty-seven. Land clean and the world there can be resonated; land with casualties and it can only be fought. The Tuesday: she wakes with a page under the door in a hand she does not know and a bag on the table she went to bed without: the opening closed as a loop. Every ending has its own morning (`morning_after.by_ending` in `data/quiet.json`; DISMANTLE has none); credits roll between "again" and the title. New Game+ carries read letters, aura tiers and the codex, nothing else.

## Day one and the opening

The game starts with the life the job interrupts: five ordinary contract deliveries as a tour (board to shop; market to Stack; back; market to Undercity; Undercity to Frank's pipe), peaceful, teaching movement, the board, the hold, verticality, the water, and resonance twice. Then home, the bed, and the crawl. The opening is three beats: **the crawl** is the backstory (the network nearly finished, the day chosen, paper the one thing it cannot reach, twenty-seven people holding one piece each), never saying synchronisation, sender or ship; **the note** is the call to action in the sender's plain voice with no signature, opening with her name and naming where this walk starts; **the satchel** does character: picking it up is the only time she speaks, three held cards about a strap already worn to her height.

## The world's data (where things live)

`data/letters.json` + `lore/letters/NN.md` (the 27) · `data/recipients.json` · `data/stones.json` (generated: 27 aura colours from the octave-doubling palette) · `data/regimes.json` (tiers, abilities, temperament, heat, input timings, allies, contracts track) · `data/loshu.json` (the square, the walks, the keypads, easter eggs) · `data/enemies/archetypes.json` · `data/dungeons/*.json` · `data/dialogue/*.json` (deliveries, idle, refusals, civilians, extras, company, crew, epilogue, survey, contracts) · `data/correspondence/volume_1..4.json`, `correspondents.json`, `keys.json`, `archive.json`, `endings.json` · `data/quiet.json` · `data/smoke.json` · `data/beds.json` · `data/endings.json` · `data/intro.json`, `prologue.json` · `data/atlas.json` (the city as a graph) · `data/whereabouts.json` (the answer key; only Guide reads it) · `data/city/*.plan` (one character per tile) · `data/maps/*.json`.

Gates: `tools/validate_content.py`, `validate_maps.py`, `validate_dialogue.py`, `validate_correspondence.py`, and `scenes/debug/m1_tests.tscn` (4010 assertions). After any map generator: `set_doors_in_walls.py`, `seal_edges.py`, `place_sentinels.py`, in that order.

## Art

48 px tiles (SakPix and Cute SCKR packs, MZ format); characters imported by `tools/import_courier.py` / `import_actor.py` from AutoSprite packs (49–64 frames of 640 px per animation per direction). The courier has two bodies, bagless (day one) and satchel-bearing; walk, run, jump, dash, punch, resonate, hurt, smoke, sleep; the west half is mirrored (a known gap on the carrying body). Frank the ferret is drawn. Portraits: `portrait_visor` and `portrait_face`; the visor comes off for a smoke break and nowhere else. The companion app Mira cuts her own 160 px atlas from the bagless pack (`courier.json`: `meta {frame, character_height, feet_y, atlas, columns, rows}`, `clips {name: {fps, loop, facing, frames:[{x,y,mouth?,visor?}]}}`, `states`, `gestures`, `moods`); the sprite inspector on this desk writes that shape.

## Editorial guardrail (section 14)

The letters are Layer 3 material: cosmology, poetry, the creative frame. Nothing in the game's text, UI, store page or marketing may claim a real-world physiological or medical effect of sound or frequency. Audio is never a mechanic; everything is solvable with sound off. The in-world lattice is a fantasy cosmology the way the Force is.
