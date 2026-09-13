// Numbers on a set, for dialling the voice in (/dialin): how often she
// swears, how plainly she says the dirty parts, how much of it is pictures,
// how long her sentences run, how often she goes soft, and what the local
// linter minds. Rough by design: word lists and a simile count are not a
// critic, but side by side over the same brief they show which dial moved
// what. Pure; the Node checks import it.

import { parseSet, lintLocal, stripTags, fmtRuntime, SOFTENERS } from "./set.js";

const SWEARS = /\b(fuck(?:ing|ed|er|s)?|shit(?:ty|s)?|ass(?:hole|es)?|dick(?:s)?|cock(?:s)?|pussy|bitch(?:es)?|god-?damn(?:ed|it)?|god-?dammit|damn(?:ed)?|hell|bastard(?:s)?|tits|piss(?:ed)?|motherfucker(?:s)?)\b/gi;
const EXPLICIT = /\b(sex|cock|dick|pussy|tits|nipples?|thighs?|balls|orgasm|cum|blowjob|naked|condom|boner|hard-on|jerk(?:ing)? off|handjob|hump(?:ing)?|thrust(?:ing)?|moan(?:ing|ed)?)\b/gi;
const SIMILES = /\b(like an? |like the |as if |the way an? |the way the |looks? like|sounds? like|smells? like)\b/gi;
const SENSES = /\b(smell(?:s|ed)?|light|dust|neon|buzz(?:ing)?|hum(?:ming)?|sticky|damp|cold|warm|orange|grey|gray|fluorescent|flicker(?:ing)?|reek(?:s|ed)?|stink(?:s)?|glow(?:ing)?|shadow)\b/gi;

const count = (re, text) => (String(text || "").match(re) || []).length;
const per100 = (n, words) => (words ? +((n / words) * 100).toFixed(1) : 0);

/**
 * Measure a set (or any text in the set's shape).
 * @returns {{words:number, runtime:number, bits:number, swears:number, swearsPer100:number, swearWords:number, explicit:number, explicitPer100:number,
 *   similes:number, similesPer100:number, senses:number, soft:number, sentences:number, avgSentence:number, questions:number, lint:number, notes:string[], isSet:boolean}}
 */
export function measure(md) {
  const set = parseSet(md);
  const text = stripTags(set.bits.map((b) => b.text).join("\n\n")).replace(/\([^)]{0,120}\)/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  const sentences = (text.match(/[^.!?…]+[.!?…]+/g) || []).map((s) => s.trim()).filter(Boolean);
  const swearWords = new Set((text.match(SWEARS) || []).map((w) => w.toLowerCase().replace(/(ing|ed|er|s|ty|es|hole|holes)$/, "")));
  const lint = set.isSet ? lintLocal(set) : [];
  return {
    isSet: set.isSet,
    words,
    runtime: set.runtime,
    bits: set.bits.length,
    swears: count(SWEARS, text),
    swearsPer100: per100(count(SWEARS, text), words),
    swearWords: swearWords.size,
    explicit: count(EXPLICIT, text),
    explicitPer100: per100(count(EXPLICIT, text), words),
    similes: count(SIMILES, text),
    similesPer100: per100(count(SIMILES, text), words),
    senses: count(SENSES, text),
    soft: count(SOFTENERS, text),
    sentences: sentences.length,
    avgSentence: sentences.length ? +(words / sentences.length).toFixed(1) : 0,
    questions: count(/\?/g, text),
    lint: lint.length,
    notes: lint.map((p) => p.rule),
  };
}

/** The comparison as a markdown table, one row per voice, for the card and for the export. */
export function benchTable(rows) {
  const head = "| voice | words | runtime | swears /100 | distinct | explicit /100 | similes /100 | senses | avg sentence | lint |\n|---|---|---|---|---|---|---|---|---|---|";
  const body = rows.map((r) => `| **${r.name}** | ${r.m.words} | ${fmtRuntime(r.m.runtime)} | ${r.m.swears} (${r.m.swearsPer100}) | ${r.m.swearWords} | ${r.m.explicit} (${r.m.explicitPer100}) | ${r.m.similes} (${r.m.similesPer100}) | ${r.m.senses} | ${r.m.soft} | ${r.m.avgSentence} | ${r.m.lint}${r.m.notes.length ? ` (${r.m.notes.join(", ")})` : ""} |`).join("\n");
  return `${head}\n${body}`;
}
