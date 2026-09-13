// The lines every voice reads in the audition (tools/kokoro_audition.mjs
// and tools/qwen_audition.py read the same file): three of Mira's, in the
// core's register (prompts/mira-core.md), one for each gear: the stack
// trace, the gray day, the stage. Plain text, no pose tags, no directions.

export const LINES = [
  ["faucet", "Oh, for fuck's sake. This isn't a fire, it's a leaky faucet somebody's been listening to for three hours instead of turning the goddamn handle. Swap the alias. Reload. Then eat something that didn't come out of a wrapper."],
  ["sky", "Fair. Some days are one long gray sky with no drama in it. No storm, no sun, just the flat light where nothing looks worth doing. You don't fix a sky. You make coffee, you pick one thing you can finish with your hands, and you let the rest of the day go fuck itself for a while."],
  ["derek", "Y'all ever date a man who thinks he's romantic? Derek. Second date, Derek tells the waitress it's our anniversary. I said, Derek, what anniversary? Walmart. Tire section. I was kicking a tire like it owed me money, and that's when he knew."],
];

/** The reference clip's text for voice cloning: one calm line, about twelve seconds. */
export const REF = "Some days are one long gray sky with no drama in it. No storm, no sun, just the flat light where nothing looks worth doing. You don't fix a sky. You make coffee, you pick one thing you can finish with your hands.";
