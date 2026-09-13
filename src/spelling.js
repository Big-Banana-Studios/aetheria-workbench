// Spellings the voice says better. A synthesizer runs "goddamn" together
// into one flat word; "god-damn" gets the two beats she means. The stage's
// lint pass writes every set this way, and the speech cleaner does the same
// for anything read aloud (a reply, an older set, a package), so the text and
// the delivery agree. Case is kept. Pure; the Node checks import it.

const RUNS = /\b(g)od(damn(?:ed|it)?|dammit)\b/gi;

/** `text` with the run-together swears hyphenated for the voice: goddamn → god-damn, Goddamned → God-damned, goddammit → god-dammit. */
export function spokenSpelling(text) {
  return String(text || "").replace(RUNS, (m, g, rest) => `${g}od-${rest}`);
}
