// The desks. Each is a system prompt (prompts/<id>.md, or prompts/<file>.md when the desk names one; editable without
// touching code), a default for thinking mode, a district for the theme, a
// pinned voice, and the reference files it loads at boot.

const PROMPTS = import.meta.glob("../prompts/*.md", { query: "?raw", import: "default", eager: true });

function promptFile(id) {
  const key = Object.keys(PROMPTS).find((p) => p.endsWith(`/${id}.md`));
  return key ? PROMPTS[key] : "";
}

/**
 * Mira's persona at four lengths, the same voice in each (the core:
 * stoic, storyteller with swagger, sailor's mouth, Bob Ross eyes; the
 * friend in the Workbench, not the courier): prompts/mira-short.md (about
 * 480 tokens, a phone's on-device budget), prompts/mira.md (about 900, the
 * standard text), prompts/mira-long.md (about 1,200, the bible without the
 * samples) and prompts/mira-core.md (about 2,700, the whole core with the
 * calibration samples, for the lab). Mira's own personas/ folder is the
 * source of truth for all four; the files here are copies of it.
 */
export const MIRA_PERSONAS = {
  short: { name: "Short", file: "mira-short", about: "about 480 tokens; fits a phone's on-device brain" },
  standard: { name: "Standard", file: "mira", about: "about 900 tokens; the core, condensed" },
  long: { name: "Long", file: "mira-long", about: "about 1,200 tokens; the bible without the samples, for a big in-app model" },
  core: { name: "Core", file: "mira-core", about: "about 2,700 tokens; the whole core with the calibration samples, for the lab" },
};

/** A brain with room for the long persona and the longer replies: the lab, or an in-app model of 12B or more. */
export function bigBrain(brain) {
  if (!brain) return false;
  const model = brain.info?.model || brain.model || "";
  return brain.live === "lab" || (brain.live === "native" && /(^|[^\d.])(1[2-9]|[2-9]\d|\d{3})\s?b\b/i.test(model));
}

/**
 * Which persona preset her desk uses: the one chosen in Settings → Mira,
 * else by the brain (the core on the lab, long on a big in-app model,
 * standard otherwise). An edited prompt on this device still wins, in
 * deskPrompt.
 */
export function miraPreset(settings, brain) {
  const p = settings?.miraPersona;
  if (p && p !== "auto" && MIRA_PERSONAS[p]) return p;
  if (brain?.live === "lab") return "core";
  return bigBrain(brain) ? "long" : "standard";
}

export const DESKS = [
  {
    id: "research",
    name: "Research",
    tagline: "summaries, critiques, claims, sources",
    icon: "research.png",
    thinking: true,
    regime: "HEAD",
    voice: "default",
    placeholder: "Paste notes or a URL's text, drop a PDF or an image, and ask for a summary, a critique, a claims table, or a source list…",
    loads: [],
  },
  {
    id: "writing",
    name: "Writing",
    tagline: "the Lewis catalog",
    icon: "writing.png",
    thinking: false,
    regime: "HEART",
    voice: "default",
    placeholder: "Draft, outline, or check continuity. Paste a bible or a chapter; /proof reads the reply back to you…",
    loads: [],
  },
  {
    id: "paperless",
    name: "Paperless",
    tagline: "the forgotten courier",
    icon: "paperless.png",
    thinking: false,
    regime: "GUT",
    voice: "default",
    placeholder: "Dialogue in the game's pool format, contracts keyed to a walk, NPC cards, a sprite sheet to inspect…",
    loads: ["data/paperless-bible.md"],
  },
  {
    id: "physics",
    name: "Physics & study",
    tagline: "AMU biology, then ASU physics",
    icon: "physics.png",
    thinking: true,
    regime: "HEAD",
    voice: "default",
    placeholder: "Socratic by default: ask, and it asks back. /worked for a full solution, /flashcards to export…",
    loads: [],
  },
  {
    id: "aetheria",
    name: "Aetheria",
    tagline: "frequency work, the cube, the walks",
    icon: "aetheria.png",
    thinking: false,
    regime: "follow",
    voice: "default",
    placeholder: "/walk C, /freq 2178, /stone the diver, /cube - or ask about the regimes and the walks…",
    loads: ["data/aetheria-cube.json"],
  },
  {
    id: "mira",
    name: "Mira",
    tagline: "the friend with the coffee",
    icon: "mira.png",
    thinking: false,
    regime: "HEART",
    voice: "mira",
    panel: true,
    placeholder: "Talk to Mira here in text, or open the companion for voice…",
    loads: [],
  },
  {
    id: "openmic",
    file: "open-mic",
    name: "Open Mic",
    tagline: "a dive bar, after hours",
    icon: "openmic.png",
    thinking: false,
    regime: "GUT",
    voice: "mira",
    placeholder: "/five for a tight five, /lines for twenty one-liners, /heckle <text>, paste a draft then /punchup, /perform to put her on the stage…",
    loads: [],
  },
  {
    id: "suno",
    name: "Suno",
    tagline: "lyrics and a style prompt",
    icon: "suno.png",
    thinking: false,
    regime: "HEART",
    voice: "mira",
    placeholder: "/song <hook or idea> [genre, mood, tempo]; /frombit takes the last set; then /chorus, /darker, /lighter, /duet, /aetheria <hz>…",
    loads: [],
  },
];

export function deskById(id) {
  return DESKS.find((d) => d.id === id) || DESKS[0];
}

/** The system prompt for a desk: the user's override if any, else the file (for Mira, the preset's file). */
export function deskPrompt(desk, settings, preset = null) {
  const o = settings.desks?.[desk.id]?.prompt;
  return (o && o.trim()) || defaultPrompt(desk, preset) || `You are the ${desk.name} desk of the Aetheria Workbench.`;
}

/** The file's text: prompts/<desk>.md, or for Mira the preset's file (`preset` from miraPreset; without it, the standard text). */
export function defaultPrompt(desk, preset = null) {
  if (desk.id === "mira" && preset && MIRA_PERSONAS[preset]) return promptFile(MIRA_PERSONAS[preset].file) || promptFile("mira");
  return promptFile(desk.file || desk.id);
}

/** Thinking on or off for this desk, honouring the user's override. */
export function deskThinking(desk, settings) {
  const o = settings.desks?.[desk.id]?.thinking;
  return typeof o === "boolean" ? o : !!desk.thinking;
}

/**
 * Which Kokoro voice reads on this desk: the desk's own override, else
 * Mira's when she is on the stage of every desk, else the desk's default.
 */
export function deskVoice(desk, settings) {
  const o = settings.desks?.[desk.id]?.voice;
  if (o) return o;
  if (settings.miraEverywhere !== false && settings.stage !== false) return settings.voices.mira;
  return settings.voices[desk.voice] || settings.voices.default;
}
