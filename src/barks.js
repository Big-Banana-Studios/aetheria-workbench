// Her quick reactions: the short things a person says out loud while
// reading what you just sent, before any thinking has happened. "Sheesh."
// "Get a load of this guy." They come from a bank, not from the model, so
// they are instant, they cost nothing, and they sound like her on every
// brain including the small ones. A message is classified by what it is (a
// wall of paste, a shout, a swear, bad news, a link, a picture, a heckle)
// and gets a line from that shelf, cycling so nothing repeats soon. The
// same bank is quoted in her persona so the model's own openers match.

export const BARKS = {
  generic: ["Sheesh.", "Get a load of this guy.", "Oh, here we go.", "Course it is.", "Yeah, no.", "Christ.", "There it is.", "Every fucking time.", "Love that for us.", "Right.", "Bold of them.", "That tracks.", "Cheers for that.", "Hang on.", "Big talk."],
  paste: ["Christ, that's a lot. Give me a second.", "That's a whole letter. Hang on.", "Alright. Reading.", "Fuck me, you've been busy.", "Sit down, this'll take a minute."],
  question: ["Let's see.", "Fair question.", "Give me a second.", "Hm.", "Depends who's asking."],
  shout: ["Alright, easy.", "Inside voice.", "I heard you the first time.", "Easy, tiger.", "Deep breath. Go on."],
  swear: ["There she is.", "Now we're talking.", "Language. Love it.", "Say it again, louder.", "That's the spirit."],
  link: ["Get a load of this.", "A link. Brave.", "Right, what's this then.", "Oh, we're clicking things now."],
  bad: ["Ah, shit.", "Shit. Okay.", "Right. Sit down a second.", "Fuck. Go on.", "Yeah. I know that one."],
  good: ["Get in.", "Look at you.", "Well, fuck. Nice one.", "About time.", "Course you did."],
  image: ["Let's have a look.", "Oh, a picture. Alright.", "Show me.", "Hold it still."],
  heckle: ["Oh, here we go.", "Get a load of this guy.", "Sheesh. Alright.", "Somebody's had a drink.", "Front row's got opinions."],
  slow: ["Hang on, it's thinking.", "Give it a second, it's a big box.", "Still going. Told you it was a lot.", "It's having a think. Long one."],
};

/** The mood her stage plays with each shelf. */
export const BARK_MOODS = { generic: "amused", paste: "tired", question: "curious", shout: "annoyed", swear: "amused", link: "curious", bad: "concerned", good: "happy", image: "curious", heckle: "sassy", slow: "tired" };

const BAD = /\b(died|dead|passed away|fired|laid off|hospital|diagnos\w*|broke up|lost my|can'?t sleep|cannot sleep|funeral|evicted|relapse)\b/i;
const GOOD = /\b(got the job|passed|nailed it|finished it|we did it|birthday|promoted|got in|paid off|first sale|published)\b/i;
const SWEAR = /\b(fuck\w*|shit\w*|bastard|bollocks|damn|arse\w*|asshole|bullshit)\b/i;

/**
 * What kind of message this is, or null when she stays quiet this time. A
 * specific kind (paste, shout, a swear, bad or good news, a link, a
 * picture) gets a reaction about seven times in ten; a plain message about
 * one in seven, so she is a person reading over your shoulder and not a
 * tic. `force` skips the coin (the tests, and a heckle).
 * @returns {{kind: string, mood: string}|null}
 */
export function classify(text, { images = 0, force = false, kind = null } = {}) {
  const t = String(text || "").trim();
  let k = kind;
  if (!k) {
    if (images) k = "image";
    else if (t.length > 800) k = "paste";
    else if (/https?:\/\//i.test(t)) k = "link";
    else if (BAD.test(t)) k = "bad";
    else if (GOOD.test(t)) k = "good";
    else if (SWEAR.test(t)) k = "swear";
    else if ((/!{2,}/.test(t) || /\b[A-Z]{5,}\b/.test(t)) && t.length > 12) k = "shout";
    else if (/\?$/.test(t)) k = "question";
  }
  const specific = !!k;
  if (!force) {
    if (specific && Math.random() < 0.3) return null;
    if (!specific && Math.random() > 0.15) return null;
  }
  const out = k || "generic";
  return { kind: BARKS[out] ? out : "generic", mood: BARK_MOODS[out] || "amused" };
}

const KEY = "workbench.barks.used";

/** A line from the shelf she has not used lately; cycles through the shelf before repeating. */
export function bark(kind = "generic") {
  const shelf = BARKS[kind] || BARKS.generic;
  let used = {};
  try {
    used = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    used = {};
  }
  let list = Array.isArray(used[kind]) ? used[kind] : [];
  if (list.length >= shelf.length) list = list.slice(-Math.min(2, shelf.length - 1));
  const left = shelf.map((_, i) => i).filter((i) => !list.includes(i));
  const i = left[Math.floor(Math.random() * left.length)];
  list.push(i);
  used[kind] = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(used));
  } catch {
    /* ignore */
  }
  return shelf[i];
}
