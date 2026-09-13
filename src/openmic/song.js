// A song in the Suno desk's shape (prompts/suno.md): a title, the hook,
// the rhyme scheme, and three fenced blocks: `lyrics` (section tags with
// descriptors, three verses at least), `style` (the short line, 120
// characters or fewer, for Suno's basic style field) and `spec` (the
// production spec, 400 to 900 characters, for the expanded field). This
// reads the shape back and checks the rules a program can check: the verse
// count, the hook in every chorus, the two lengths, the tag vocabulary, the
// clauses of the spec. Pure; the per-song history and the spec library
// live in localStorage on the desk (main.js).

export const METATAGS = ["Intro", "Verse 1", "Verse 2", "Verse 3", "Verse 4", "Verse 5", "Pre-Chorus", "Chorus", "Final Chorus", "Bridge", "Instrumental Break", "Outro", "Hook", "Voice 1", "Voice 2"];
export const DELIVERY = ["whispered", "spoken word", "build", "drop", "gang vocals"];
export const STYLE_MAX = 120;
export const SPEC_MIN = 400;
export const SPEC_MAX = 900;
export const VERSES_MIN = 3;
export const VERSES_MAX = 5;

function block(md, name) {
  const m = new RegExp("```" + name + "[^\\n]*\\n([\\s\\S]*?)```", "i").exec(md);
  return m ? m[1].trim() : "";
}

/** @returns {{title:string, hook:string, scheme:string, lyrics:string, style:string, spec:string, isSong:boolean}} */
export function parseSong(md) {
  const src = String(md || "").replace(/\r/g, "");
  const title = (/^#\s+(.+)$/m.exec(src)?.[1] || "").replace(/^["“]|["”]$/g, "").trim();
  const hook = (/^\**hook\**\s*:\s*(.+)$/im.exec(src)?.[1] || "").replace(/^["“]|["”]$/g, "").trim();
  const scheme = (/^\**(?:rhyme\s*)?scheme\**\s*:\s*(.+)$/im.exec(src)?.[1] || "").trim();
  let lyrics = block(src, "lyrics");
  let style = block(src, "style");
  let spec = block(src, "spec");
  if (!lyrics) {
    // unnamed fences: the first is the lyrics, then the style line, then the spec
    const fences = [...src.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1].trim());
    if (fences.length >= 2) {
      lyrics = fences[0];
      style = style || fences[1];
      spec = spec || fences[2] || "";
    } else if (fences.length === 1 && /\[(verse|chorus|intro)/i.test(fences[0])) lyrics = fences[0];
  }
  return { title: title || "Untitled", hook, scheme, lyrics, style, spec, isSong: !!lyrics && /\[(chorus|verse)/i.test(lyrics) };
}

/** The tags of a lyric in order: `[Verse 1: half-spoken, tense]` is {name, base: "Verse 1", descriptor: "half-spoken, tense"}. */
export function sections(lyrics) {
  return [...String(lyrics || "").matchAll(/\[([^\]]+)\]/g)].map((m) => {
    const name = m[1].trim();
    const i = name.indexOf(":");
    return { name, base: (i >= 0 ? name.slice(0, i) : name).trim(), descriptor: i >= 0 ? name.slice(i + 1).trim() : "" };
  });
}

/** How many verses a lyric has: distinct [Verse N] tags. */
export function verses(lyrics) {
  const n = new Set();
  for (const s of sections(lyrics)) {
    const m = /^verse\s*(\d+)$/i.exec(s.base);
    if (m) n.add(m[1]);
  }
  return n.size;
}

/** The choruses of a lyric: the text under each [Chorus…] or [Final Chorus…] tag up to the next tag. */
export function choruses(lyrics) {
  const out = [];
  const re = /\[(?:final\s+)?chorus[^\]]*\]\s*([\s\S]*?)(?=\n\s*\[|$)/gi;
  let m;
  while ((m = re.exec(lyrics))) out.push(m[1].trim());
  return out;
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The clauses a spec carries (prompts/suno.md, in order), each with what a program can look for. */
export const SPEC_CLAUSES = [
  { key: "tempo", name: "a BPM", re: /\b\d{2,3}\s?bpm\b/i },
  { key: "key", name: "a key or mode", re: /\b[A-G](?:#|♯|b|♭)?\s?(?:major|minor|dorian|mixolydian|lydian|phrygian|aeolian|locrian)\b|\b(?:major|minor|modal|atonal|pentatonic)\b/i },
  { key: "vocals", name: "the vocals (gender, register, delivery)", re: /\b(vocals?|voice|alto|soprano|mezzo|contralto|tenor|baritone|spoken|sung|belt(?:ed)?|rasp|falsetto)\b/i },
  { key: "sections", name: "instrumentation by section (verses: …; chorus: …)", re: /\b(verses?|chorus|bridge|intro|outro)\s*:/i },
  { key: "production", name: "a production clause", re: /\b(tape|saturation|reverb|delay|compress\w*|sidechain\w*|autotune|auto-tune|stereo|mono|lo-fi|lofi|vinyl|hiss|noise|close-mic\w*|analog(?:ue)?|digital|mix(?:ed)?|master\w*|distort\w*|dry|wet|room)\b/i },
  { key: "arc", name: "the structure arc (intro → V1 → …)", re: /(?:→|->)/ },
  { key: "mood", name: "a mood arc in three words", re: /\b[a-z]{3,}\s*(?:→|->)\s*[a-z]{3,}\s*(?:→|->)\s*[a-z]{3,}\b/i },
  { key: "exclusions", name: "exclusions (no …)", re: /\bno\s+[a-z]/i },
];

/** The clauses a spec is missing, by name; [] for a full one. */
export function specGaps(spec) {
  const s = String(spec || "");
  return SPEC_CLAUSES.filter((c) => !c.re.test(s)).map((c) => c.name);
}

/** Why a song cannot go out as it is (the desk rewrites it once): [] when it can. */
export function songRejects(song) {
  if (!song.isSong) return ["no lyrics block"];
  const out = [];
  const v = verses(song.lyrics);
  if (v < VERSES_MIN) out.push(`only ${v} verse${v === 1 ? "" : "s"}; three at least (Verse 1 the scene, Verse 2 the turn, Verse 3 the payoff)`);
  if (!song.style) out.push("no style block (the short line for the basic field)");
  if (!song.spec) out.push("no spec block (the 400 to 900 character production spec)");
  return out;
}

/** Notes on a song: [] when it keeps the rules. `longForm` allows four or five verses without a note. */
export function checkSong(song, { longForm = false } = {}) {
  const notes = [];
  if (!song.isSong) return ["no lyrics block found"];
  const v = verses(song.lyrics);
  if (v < VERSES_MIN) notes.push(`only ${v} verse${v === 1 ? "" : "s"}; the desk needs ${VERSES_MIN}`);
  else if (v > VERSES_MAX) notes.push(`${v} verses; five is the long-form ceiling`);
  else if (v > VERSES_MIN && !longForm) notes.push(`${v} verses with long form off (/longform on allows four or five)`);
  if (!song.style) notes.push("no style line");
  else if (song.style.length > STYLE_MAX) notes.push(`style line is ${song.style.length} characters; the basic field takes ${STYLE_MAX}`);
  if (!song.spec) notes.push("no spec block");
  else {
    if (song.spec.length < SPEC_MIN) notes.push(`spec is ${song.spec.length} characters; a full spec runs ${SPEC_MIN} to ${SPEC_MAX}`);
    else if (song.spec.length > SPEC_MAX) notes.push(`spec is ${song.spec.length} characters; Suno's field takes ${SPEC_MAX}`);
    const gaps = specGaps(song.spec);
    if (gaps.length) notes.push(`spec is missing ${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ""}`);
  }
  const ch = choruses(song.lyrics);
  if (!ch.length) notes.push("no [Chorus]");
  else if (song.hook) {
    const h = norm(song.hook);
    const missing = ch.filter((c) => !norm(c).includes(h)).length;
    if (missing) notes.push(`the hook is missing from ${missing} of ${ch.length} chorus${ch.length === 1 ? "" : "es"}`);
  }
  const secs = sections(song.lyrics);
  const known = new Set([...METATAGS, ...DELIVERY].map((t) => t.toLowerCase()));
  const odd = secs.filter((s) => !known.has(s.base.toLowerCase()) && !/^(verse|chorus|voice) \d+$/i.test(s.base));
  if (odd.length) notes.push(`unknown tag [${odd[0].name}]`);
  if (!secs.some((s) => s.descriptor && /^(verse|chorus|final chorus|bridge|pre-chorus)/i.test(s.base))) notes.push("no section descriptors ([Verse 1: half-spoken, tense])");
  if (/\b(oh oh|yeah yeah|na na|la la)\b/i.test(song.lyrics)) notes.push("filler vocables in the lyrics");
  const styleText = `${song.style}\n${song.spec}`;
  if (/\bsounds? like [A-Z]/.test(styleText) || /\bin the style of\b/i.test(styleText)) notes.push("the style names an artist");
  return notes;
}

/** Syllables of a line, roughly (vowel groups), for the singability note. */
export function syllables(line) {
  const words = norm(line).split(" ").filter(Boolean);
  let n = 0;
  for (const w of words) {
    const groups = w.replace(/e$/, "").match(/[aeiouy]+/g);
    n += Math.max(1, groups ? groups.length : 1);
  }
  return n;
}

/** Lines outside 6..10 syllables, with their counts, ignoring tags and blanks. */
export function longLines(lyrics, lo = 6, hi = 10) {
  return lyrics
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\[/.test(l))
    .map((l) => ({ line: l, n: syllables(l) }))
    .filter((x) => x.n < lo || x.n > hi);
}

/** A stable key for a spec, so the library keeps one copy of the same sound. */
export function specKey(spec) {
  const n = norm(spec);
  let h = 2166136261;
  for (let i = 0; i < n.length; i++) {
    h ^= n.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return n ? h.toString(16).padStart(8, "0") : "";
}
