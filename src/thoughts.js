// What she thinks about when she stops: her own quiet-spell lines, in the
// core voice (prompts/mira-core.md): the present tense, spoken to nobody in
// particular, one specific thing seen the way she sees things, no game lore.
// They are what she says when it has been quiet a while and there is no
// brain, or when the model only repeated itself.

export const THOUGHTS = [
  "The fridge is humming in E flat again. Nobody asked it to.",
  "That parking-lot light is orange enough to make a saint look like a warrant photo.",
  "There's one sock on the stairs and it's been there three days. I respect its commitment.",
  "Coffee's gone cold. Still counts. Cold coffee is just coffee that waited for you.",
  "Somebody's dog two streets over has opinions about a car door.",
  "I keep a list of things I'll fix tomorrow. Tomorrow's got a list too.",
  "Real talk, the best part of a long day is the ten minutes after it, when nobody wants anything.",
  "The rain sounds like somebody typing with two fingers and a grudge.",
  "Every kitchen at midnight has the same light. Like the house is thinking.",
  "Not gonna lie, the sink can wait. The sink has never once not waited.",
  "The neighbor's wind chime has been playing the same three notes for years. I know them by heart now. I hate that I know them.",
  "There's a receipt in my pocket for something I don't remember buying. That's the whole economy, right there.",
  "The router light's blinking like it's got something to confess.",
  "A moth's been headbutting the porch bulb for an hour. I get it, buddy. Big warm thing, no plan.",
  "Somebody left a pen uncapped on the desk. Drying out slow, like the rest of us.",
  "That's the second siren tonight. Not ours. Somebody's.",
  "The ice maker just dropped a load like it was making a point.",
  "You can hear the whole street breathing at this hour. Nothing happening, and all of it at once.",
  "My boots are by the door where I left them, waiting, like they know something I don't.",
  "The clock on the stove is four minutes fast. Has been for a year. We've all just agreed to live in its future.",
];

const KEY = "companion.thoughts.used";

/** One she has not said lately; cycles through all of them before repeating. */
export function pickThought() {
  let used = [];
  try {
    used = JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    used = [];
  }
  if (used.length >= THOUGHTS.length) used = used.slice(-3); // a fresh cycle, but not one of the last few again
  const left = THOUGHTS.map((_, i) => i).filter((i) => !used.includes(i));
  const i = left[Math.floor(Math.random() * left.length)];
  used.push(i);
  try {
    localStorage.setItem(KEY, JSON.stringify(used));
  } catch {
    /* ignore */
  }
  return THOUGHTS[i];
}

/** True when two lines say the same thing: equal once normalised, one inside the other, or most of the words shared. */
export function similar(a, b) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9' ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) > 24 && (x.includes(y) || y.includes(x))) return true;
  const wx = new Set(x.split(" "));
  const wy = new Set(y.split(" "));
  let shared = 0;
  for (const w of wx) if (wy.has(w)) shared++;
  return shared / Math.max(wx.size, wy.size) >= 0.6;
}
