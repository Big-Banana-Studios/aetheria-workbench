// A set, as text and as a timeline. The Open Mic desk asks the model for a
// fixed shape (prompts/open-mic.md): a `# Title`, one `## Bit N` heading per
// bit, spoken lines with a small vocabulary of inline pose tags, stage
// directions in parentheses, and a `> pull quote` at the end. This module
// reads that shape back: the bits, the sentences, which pose each sentence
// carries, which are asides, how long the set runs at a stand-up pace, and
// whether any paragraph repeats an earlier one. Pure: no DOM, testable in
// Node (tools/smoke.mjs). The stage, the linter and the exports all read
// the same timeline.

import { SentenceSplitter } from "../splitter.js";

/** The pose vocabulary the model may emit inline, and the renderer strips before TTS. */
export const POSES = ["pace", "lean", "shriek", "deadpan", "aside"];
const TAG = /\{(pace|lean|shriek|deadpan|aside\+?)\}/gi;
const ANY_TAG = /\{[a-z_+-]{1,16}\}/gi;
/** The inline form, `{aside: the remark}` (any pose): the remark rides inside the braces. */
const INLINE_TAG = /\{(pace|lean|shriek|deadpan|aside)\s*:\s*([^{}]+?)\s*\}/gi;

/**
 * `{aside: the remark}` becomes `{aside} the remark`, one tag per sentence
 * of the remark; a second and later sentence of an aside carries `{aside+}`,
 * a continuation, so a two-sentence aside still counts as one. The bare
 * `{aside}` in front of a sentence keeps working.
 */
export function inlineTags(text) {
  return String(text || "").replace(INLINE_TAG, (_, p, remark) => {
    const pose = p.toLowerCase();
    const parts = remark.trim().split(/(?<=[.!?…])\s+(?=\S)/);
    return parts.map((s, i) => `{${pose}${i && pose === "aside" ? "+" : ""}} ${s}`).join(" ");
  });
}

/** Words per minute at a stand-up pace, room and pauses included. */
export const WPM = 150;

/**
 * Her tag on every aside (2026-09-12, the family's design): she leans in,
 * lands the quip, then says this, its own line in the aside's pose; the
 * closer of a set brings everything she put aside back and connects it.
 * Empty to switch it off.
 */
export const ASIDE_TAG = "You can put that aside.";

function tidy(t) {
  return String(t || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
}

/** Strip every pose tag (and any unknown `{tag}`) from a string. */
export function stripTags(text) {
  return tidy(inlineTags(text).replace(ANY_TAG, ""));
}

/** Stage directions in parentheses are shown, never spoken. */
export function stripDirections(text) {
  return tidy(String(text || "").replace(/\([^)]{0,120}\)/g, ""));
}

export function countWords(text) {
  const t = stripTags(text);
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}

/** Seconds a text takes read aloud at WPM, plus a beat per sentence end. */
export function estimateRuntime(text) {
  const words = countWords(text);
  const beats = (String(text || "").match(/[.!?…](\s|$)/g) || []).length;
  return Math.round((words / WPM) * 60 + beats * 0.35);
}

export function fmtRuntime(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A stable hash of a paragraph with punctuation, case and tags ignored. */
export function hashParagraph(p) {
  const norm = stripTags(p)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return norm ? h.toString(16).padStart(8, "0") : "";
}

/** The paragraphs of a markdown text: blank-line separated, heading and quote lines out. */
export function paragraphs(md) {
  return String(md || "")
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .filter((l) => !/^\s*#{1,6}\s/.test(l) && !/^\s*>/.test(l) && !/^\s*\**(runtime|pull quote)\**\s*:/i.test(l) && !/^\s*-{3,}\s*$/.test(l))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Split a paragraph into spoken lines. Each line carries the pose tag found
 * in it (the last one wins; `{aside}` sets the aside flag as well as the
 * pose), the tag-free text for the screen and the direction-free text for
 * the voice. A tag standing alone at the end of a sentence applies to the
 * next one.
 */
export function splitLines(paragraph, bit = 0, { asideTag = ASIDE_TAG } = {}) {
  const raw = [];
  const sp = new SentenceSplitter((s) => raw.push(s), { minChars: 6 });
  sp.push(inlineTags(String(paragraph || "")).replace(/\s*\n\s*/g, " "));
  sp.close();
  const out = [];
  let carry = null;
  for (const s of raw) {
    const tags = [...s.matchAll(TAG)].map((m) => m[1].toLowerCase());
    const last = tags.length ? tags[tags.length - 1] : null;
    const pose = last ? last.replace("+", "") : carry;
    const cont = !!last && last.endsWith("+"); // the second sentence of one aside
    carry = null;
    const text = stripTags(s);
    const spoken = stripDirections(text);
    if (!text) {
      carry = pose;
      continue;
    }
    // a direction on its own, "(beat)" or "(she waits)": a pause, shown but not said
    const direction = !spoken;
    out.push({ bit, text, spoken, pose: pose || null, aside: pose === "aside", asideCont: cont, direction });
  }
  if (!asideTag) return out;
  // her tag after every aside: she leans in, lands the quip, then "You can put that aside." as its own line, the last of the aside's run
  const already = new RegExp(`^${asideTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    res.push(cur);
    const next = out[i + 1];
    const runEnds = cur.aside && !cur.direction && !(next && next.aside && next.asideCont);
    if (runEnds && !already.test(cur.spoken)) res.push({ bit, text: asideTag, spoken: asideTag, pose: "aside", aside: true, asideCont: true, tagLine: true, direction: false });
  }
  return res;
}

const BIT_HEAD = /^(?:#{2,4}\s*|\*\*)?(?:bit\s*)?(\d{1,2})\s*[.:)—–-]*\s*(.*?)\**\s*$/i;

/**
 * Read a set in the desk's shape. Tolerant: a set with no headings is one
 * bit; `## Bit 3`, `## 3.`, `**3.**` and `---` all start a bit; the pull
 * quote is the last blockquote or a `Pull quote:` line; a `Runtime:` line
 * the model wrote is ignored in favour of the estimate.
 * @returns {{title:string, bits:{n:number, title:string, text:string, lines:object[], words:number, asides:number}[], lines:object[], pullQuote:string, words:number, runtime:number, isSet:boolean}}
 */
export function parseSet(md, { asideTag = ASIDE_TAG } = {}) {
  const src = String(md || "").replace(/\r/g, "");
  let title = "";
  const bits = [];
  let cur = null;
  let pullQuote = "";
  let skip = false; // inside a "## Notes" (or pull quote) section: not part of any bit
  const push = (name) => {
    cur = { n: bits.length + 1, title: name || `Bit ${bits.length + 1}`, text: "" };
    bits.push(cur);
    skip = false;
  };
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (!t) {
      if (cur) cur.text += "\n";
      continue;
    }
    let m;
    if ((m = /^#\s+(.+)$/.exec(t)) && !title) {
      title = m[1].replace(/^title\s*:\s*/i, "").replace(/^["“]|["”]$/g, "").trim();
      continue;
    }
    const heading = /^#{2,4}\s/.test(t) || /^\*\*/.test(t) || /^bit\s*\d/i.test(t);
    if (heading && (m = BIT_HEAD.exec(t))) {
      push(m[2].trim() || `Bit ${m[1]}`);
      continue;
    }
    if ((m = /^#{2,4}\s+(.+)$/.exec(t))) {
      if (/pull\s*quote|^notes?$|runtime|^punched$/i.test(m[1])) {
        cur = null;
        skip = !/^punched$/i.test(m[1]);
        continue;
      }
      push(m[1].trim());
      continue;
    }
    if (/^-{3,}$|^\*{3,}$/.test(t)) {
      cur = null;
      continue;
    }
    if (skip) continue;
    if ((m = /^>\s*(.*)$/.exec(t))) {
      const q = m[1].replace(/^\**pull\s*quote\**\s*:\s*/i, "").replace(/^["“]|["”]$/g, "").trim();
      if (q) pullQuote = q;
      continue;
    }
    if ((m = /^\**pull\s*quote\**\s*:\s*(.+)$/i.exec(t))) {
      pullQuote = m[1].replace(/^["“]|["”]$/g, "").trim();
      continue;
    }
    if (/^\**(runtime|estimated runtime|length)\**\s*:/i.test(t)) continue;
    if (!cur) push("");
    cur.text += (cur.text.endsWith("\n") || !cur.text ? "" : " ") + t + "\n";
  }
  for (const b of bits) {
    b.text = b.text.trim();
    b.lines = [];
    for (const p of paragraphs(b.text)) b.lines.push(...splitLines(p, b.n, { asideTag }));
    b.words = countWords(b.text);
    b.asides = b.lines.filter((l) => l.aside && !l.asideCont).length; // a two-sentence {aside: …} is one aside
  }
  const kept = bits.filter((b) => b.lines.length);
  kept.forEach((b, i) => {
    b.n = i + 1;
    for (const l of b.lines) l.bit = b.n;
  });
  const lines = kept.flatMap((b) => b.lines);
  const body = kept.map((b) => b.text).join("\n\n");
  return {
    title: title || (kept[0]?.lines[0]?.text || "").split(/[.!?]/)[0].slice(0, 60) || "Untitled set",
    bits: kept,
    lines,
    pullQuote,
    words: countWords(body),
    runtime: estimateRuntime(body),
    isSet: kept.length >= 1 && lines.filter((l) => !l.direction).length >= 2,
  };
}

/** A one-liner pack: a numbered or bulleted list of standalone lines. */
export function parseLines(md) {
  const out = [];
  for (const line of String(md || "").split("\n")) {
    const m = /^\s*(?:\d{1,3}[.)]|[-*•])\s+(.+?)\s*$/.exec(line);
    if (m) out.push(stripTags(m[1]).replace(/^["“]|["”]$/g, ""));
  }
  return out;
}

/**
 * Paragraphs of `md` that repeat a paragraph of an earlier text (by hash),
 * or repeat inside `md` itself. `previous` is a list of hashes.
 */
export function repeats(md, previous = []) {
  const seen = new Set(previous);
  const out = [];
  for (const p of paragraphs(md)) {
    const h = hashParagraph(p);
    if (!h || countWords(p) < 6) continue;
    if (seen.has(h)) out.push(p);
    seen.add(h);
  }
  return out;
}

/**
 * The local part of the linter, run before the model's: things a program
 * can see. The model's linter (prompts/open-mic-linter.md) judges the
 * structure and the guardrail.
 * @returns {{rule:string, bit:number|null, note:string}[]}
 */
/**
 * The softeners: the apology, the wink, the moral, the hug at the end. A bit
 * that says one of these is not finished (the linter's rule 12, and the local
 * "no softening" below). Shared with bench.js, which counts them.
 */
export const SOFTENERS = /\b(just kidding|i'?m kidding|only kidding|i kid,? i kid|no offen[cs]e|but seriously|in all seriousness|all jokes aside|jokes aside|joking aside|we'?re all in this together|the moral of the story|the lesson here|lesson learned|i love you all|love y'?all|be kind to (?:each other|one another|yourself)|don'?t @ me|i don'?t (?:really )?mean (?:that|it))\b/gi;

export function lintLocal(set, previousHashes = [], { target = null } = {}) {
  const problems = [];
  const known = new RegExp(`^\\{(${POSES.join("|")}|aside\\+)\\}$`, "i");
  // the runtime against what was asked for (a tight five, a ten-minute monologue): short is the common failure, so it is a rule
  if (target) {
    if (set.runtime < target * 0.8) problems.push({ rule: "runtime", bit: null, note: `the set runs ${fmtRuntime(set.runtime)} read aloud and was asked for ${fmtRuntime(target)}: extend the bits (another beat of escalation, a longer story, one more turn before the tag), not more bits` });
    else if (set.runtime > target * 1.35) problems.push({ rule: "runtime", bit: null, note: `the set runs ${fmtRuntime(set.runtime)} read aloud and was asked for ${fmtRuntime(target)}: cut the restated lines and the weakest beats, keep every bit` });
  }
  for (const b of set.bits) {
    if (b.asides > 1) problems.push({ rule: "one aside per bit", bit: b.n, note: `${b.asides} {aside} lines in bit ${b.n}; keep one` });
    const spoken = b.lines.filter((l) => !l.direction);
    if (spoken.length >= 4) {
      const last = spoken[spoken.length - 1];
      const setup = spoken.slice(0, -1).reduce((a, l) => a + countWords(l.text), 0) / (spoken.length - 1);
      if (countWords(last.text) > setup * 1.6 && countWords(last.text) > 14) problems.push({ rule: "punchline shorter than its setup", bit: b.n, note: `the last line of bit ${b.n} is ${countWords(last.text)} words, longer than its setups` });
    }
    const unknown = [...b.text.matchAll(ANY_TAG)].map((m) => m[0]).filter((t) => !known.test(t));
    if (unknown.length) problems.push({ rule: "pose vocabulary", bit: b.n, note: `unknown tag ${unknown[0]}; only {pace} {lean} {shriek} {deadpan} {aside}` });
    const soft = stripTags(b.text).match(SOFTENERS);
    if (soft) problems.push({ rule: "no softening", bit: b.n, note: `bit ${b.n} goes soft ("${soft[0]}"); cut it and end on the knife` });
  }
  const body = set.bits.map((b) => b.text).join("\n\n");
  for (const p of repeats(body, previousHashes)) problems.push({ rule: "no repeated paragraphs", bit: set.bits.find((b) => b.text.includes(p))?.n ?? null, note: `repeats an earlier paragraph: "${stripTags(p).slice(0, 60)}…"` });
  return problems;
}

/** The hashes of every paragraph of a text, to remember against the next set. */
export function paragraphHashes(md) {
  return paragraphs(md).map(hashParagraph).filter(Boolean);
}

/**
 * A line-level diff of two texts (LCS on trimmed lines), for the punch-up
 * card: [{op:"=", text}, {op:"-", text}, {op:"+", text}].
 */
export function diffLines(before, after) {
  const a = String(before || "")
    .split("\n")
    .map((l) => l.trimEnd());
  const b = String(after || "")
    .split("\n")
    .map((l) => l.trimEnd());
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "=", text: a[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: "-", text: a[i++] });
    else out.push({ op: "+", text: b[j++] });
  }
  while (i < n) out.push({ op: "-", text: a[i++] });
  while (j < m) out.push({ op: "+", text: b[j++] });
  return out;
}

/** The diff as a fenced block the transcript renders, blank runs folded. */
export function diffMarkdown(diff) {
  const rows = [];
  for (const d of diff) {
    if (d.op === "=" && !d.text.trim()) {
      if (rows[rows.length - 1] !== "") rows.push("");
      continue;
    }
    rows.push(d.op === "=" ? `  ${d.text}` : `${d.op} ${d.text}`);
  }
  return "```diff\n" + rows.join("\n") + "\n```";
}

/**
 * The timeline for a package: every line with its start time from the clip
 * durations (seconds) and the pauses the stage keeps between lines.
 * `durations[i]` is the length of line i's clip, or null when it was never
 * synthesized (a direction, or no voice).
 */
export function timeline(set, durations = [], { gap = 0.35, beat = 0.9, bitGap = 1.2 } = {}) {
  let t = 0;
  const out = [];
  let lastBit = null;
  set.lines.forEach((l, i) => {
    if (lastBit != null && l.bit !== lastBit) t += bitGap;
    lastBit = l.bit;
    const d = durations[i] || 0;
    out.push({
      t: +t.toFixed(2),
      bit: l.bit,
      text: l.text,
      pose: l.pose || (l.aside ? "aside" : "idle"),
      aside: !!l.aside,
      direction: !!l.direction,
      audio: l.direction || !durations[i] ? null : `l${String(i + 1).padStart(3, "0")}.wav`,
      duration: +d.toFixed(2),
    });
    t += l.direction ? beat : d + (l.pose === "deadpan" || l.pose === "shriek" ? beat : gap);
  });
  return { lines: out, duration: +t.toFixed(2) };
}

/** The `set.md` of a package: the text as posted, tags and all, with the pull quote. */
export function setMarkdown(set, { style = "" } = {}) {
  const parts = [`# ${set.title}`, ""];
  for (const b of set.bits) parts.push(`## ${b.n}. ${b.title}`, "", b.text, "");
  if (set.pullQuote) parts.push(`> ${set.pullQuote}`, "");
  parts.push(`Runtime: ~${fmtRuntime(set.runtime)} (${set.words} words at ${WPM} wpm)`, "");
  if (style) parts.push("## Suno style prompt", "", style, "");
  return parts.join("\n");
}

export function slugOf(title) {
  return (
    String(title || "set")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "set"
  );
}
