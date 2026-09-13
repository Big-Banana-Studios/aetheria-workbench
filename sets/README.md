# sets/

Mira's sets, as text.

- `first-draft.md`: the first draft as it arrived ("Mira stomps to the mic",
  2026-09-10), whole, repeats and all.
- `first-draft-punched.md`: the same material punched up under the Open Mic
  desk's rules (`prompts/open-mic.md`), with one note per change in the
  desk's format. Done by hand so the rules could be judged against real
  material before the lab model was pointed at it; `/punchup` on the desk
  runs the same job with the model and shows the changes as a diff. Both
  drafts predate the updated brief (2026-09-11: no game lore on stage; the
  punched one had a single line about contract rates, swapped for rent).
- `packages/`: cutscene packages made on the PC with
  `node tools/make_package.mjs <set.md>` (git-ignored; the sample that
  ships with the game lives in the game repo under `cutscene/samples/`).

Every set the desk writes is in the shape the parser reads
(`src/openmic/set.js`): a `# Title`, `## Bit N — name` headings, the pose
tags inline, stage directions in parentheses, a `> pull quote` last. The
runtime is computed (150 words a minute plus a beat per sentence), never
trusted from the model.
