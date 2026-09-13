// Settings, persisted to localStorage as one JSON blob, per device - the
// endpoint, the model and the key never leave this browser. Same approach as
// Mira (`companion.settings`), and the lab block is mirrored into Mira's own
// key so the companion, when it is served from the same origin (GitHub Pages
// project sites share `big-banana-studios.github.io`), fronts the same box.
// Mira also reads this blob directly at boot when she has nothing of her
// own (`adoptFromWorkbench` there): `workbench.settings.lab` and
// `workbench.settings.desks.mira.prompt`. Those two keys stay as they are.

const KEY = "workbench.settings";
const MIRA_KEY = "companion.settings";

export const REGIMES = {
  GUT: { name: "GUT", colour: "#ff8a3c", district: "Undercity", word: "ember" },
  HEART: { name: "HEART", colour: "#ff4f8b", district: "Street Market", word: "rose" },
  HEAD: { name: "HEAD", colour: "#37e6f0", district: "The Stack", word: "white light" },
};

export const DEFAULTS = {
  lab: { url: "", model: "", apiKey: "" }, // url: the OpenAI-compatible base, e.g. https://<id>.laresprime.olares.com/v1
  brain: "auto", // auto (try the lab, fall back) | lab | device
  thinkSwitch: "auto", // auto | template (chat_template_kwargs only) | tag (/think /no_think only) | none
  temperature: 0.7,
  maxTokens: 2048,
  contextTurns: 24, // how many recent turns go to the model
  theme: "district", // district | paper
  ambience: false, // the 432 Hz bed and the rain; off by default here, it is a work tool
  ambienceVolume: 35,
  rain: true,
  voices: { default: "bf_emma", mira: "af_bella" }, // Kokoro voice ids; the Reader's best British voice, and Mira's own (Bella, Alisha's pick on 2026-09-12; Nicole before)
  ttsSpeed: 1.0,
  ttsDevice: "auto", // auto (GPU) | cpu
  // Mira's voice engine: Qwen3-TTS cloning Bella (the audition's pick) where it is available, Kokoro otherwise.
  // auto: Qwen for the stage and packages (rendered ahead, cached), Kokoro for live replies; qwen: everywhere she speaks; kokoro: never Qwen
  ttsEngine: "auto",
  qwenUrl: "http://127.0.0.1:8123", // tools/qwen_tts_server.py on the PC; on the phone the in-app runtime's llama-tts answers instead
  voiceInput: "ptt", // ptt (hold the mic) | vad (hands-free)
  sensitivity: 50,
  sttModel: "tiny", // moonshine tiny | base
  hermesWebhook: "", // a Discord webhook URL, for "send to Hermes"
  searchModel: "", // a LiteLLM model that can search the web (e.g. perplexity/sonar); blank = offline
  miraUrl: "", // blank = auto: ../aetheria-companion/ beside this app, else the public site
  embedModel: "onnx-community/embeddinggemma-300m-ONNX",
  ragChunks: 6,
  desks: {}, // per-desk overrides: { [id]: { thinking, prompt, voice, regime, frequency } }
  native: { model: "", port: 8080, ctx: 32768, autoStart: true, backend: "auto", keepAlive: true, loadMode: "auto", cpuMoe: "auto" }, // loadMode/cpuMoe: how the model is loaded and where a MoE keeps its experts (src/launch.js); the in-app llama.cpp runtime (Android shell only); keepAlive: a foreground service holds the server up while the app is in the background (Mira in Chrome uses it)
  // Mira on the stage
  stage: true, // the stage across the top of the desk
  chatView: "compact", // compact: the last few messages under the stage | full: the whole history, the stage steps aside
  miraEverywhere: true, // on every desk (off: only on hers)
  stageScene: true, // the street behind her
  stageStorm: true, // rain, gusts, lightning
  stageSmoke: true, // a smoke break and a nap when it has been quiet a long while
  miraInitiate: true, // she speaks up herself after a quiet spell
  miraBarks: true, // her quick reactions while she reads what you sent (a bubble over the stage, spoken if the voice is loaded)
  miraLength: "auto", // auto (full on the lab, short on a small model) | short | full
  miraPersona: "auto", // her desk's persona preset: auto (long on the lab or an in-app model of 12B+, standard otherwise) | short | standard | long; an edited prompt (desks.mira.prompt) wins
  // her open mic (the stage overlay): the room's crowd reactions, the rain, the 432 Hz bed, the stage shape
  openmic: { roomVolume: 15, room: true, rain: true, rainInside: true, bed: false, aspect: "auto", smoke: true, video: "auto" }, // video: auto (the stage's own MP4, else the browser's WebM) | mp4 | webm; // room: the crowd and the club bed (off: silence between her lines); rainInside: the rain muffled, heard from inside the club; smoke: a drag between bits on the stage, and while she waits
  debug: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw);
    if (s.voices?.mira === "af_nicole" && !s.voiceBella) {
      // her voice moved from Nicole to Bella (2026-09-12): an install still on the old default follows, once; a later choice of Nicole stays
      s.voices.mira = "af_bella";
      s.voiceBella = true;
    }
    return {
      ...structuredClone(DEFAULTS),
      ...s,
      lab: { ...DEFAULTS.lab, ...(s.lab || {}) },
      voices: { ...DEFAULTS.voices, ...(s.voices || {}) },
      native: { ...DEFAULTS.native, ...(s.native || {}) },
      openmic: { ...DEFAULTS.openmic, ...(s.openmic || {}) },
      desks: s.desks || {},
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    console.warn("settings not saved", e);
  }
  syncToMira(s);
}

/** Per-desk override, merged with the desk's defaults. */
export function deskSettings(s, deskId) {
  return s.desks[deskId] || {};
}

export function setDeskSetting(s, deskId, patch) {
  s.desks[deskId] = { ...(s.desks[deskId] || {}), ...patch };
  saveSettings(s);
}

export function isLoopbackHost(host) {
  return /^(localhost|127(\.\d{1,3}){3}|\[::1\]|::1|0\.0\.0\.0)$/i.test(host || "");
}

/** A private (RFC 1918 / link-local / .local / .home) address, or a bare name: the LAN. */
export function isLanHost(host) {
  const h = String(host || "").toLowerCase();
  if (isLoopbackHost(h)) return false;
  if (/^10(\.\d{1,3}){3}$/.test(h) || /^192\.168(\.\d{1,3}){2}$/.test(h) || /^172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}$/.test(h) || /^169\.254(\.\d{1,3}){2}$/.test(h)) return true;
  return /\.(local|lan|home|internal)$/.test(h) || !h.includes(".");
}

/**
 * The endpoint as the user typed it, normalised to the three URLs the app
 * needs, plus where it lives (loopback, the LAN, or out on the internet),
 * which decides how the browser may be asked to reach it (lab.js). Accepts
 * a bare host, a base ending in /v1, or Mira's full /v1/chat/completions
 * form. The same function as Mira's.
 */
export function endpoints(url) {
  let u = (url || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/chat\/completions$/i, "").replace(/\/models$/i, "");
  if (!/\/v\d+$/i.test(u)) u += "/v1";
  let host = "";
  try {
    host = new URL(u).hostname;
  } catch {
    return null;
  }
  return { base: u, chat: `${u}/chat/completions`, models: `${u}/models`, http: /^http:\/\//i.test(u), host, loopback: isLoopbackHost(host), lan: isLanHost(host) };
}

/**
 * Mixed content: an https page cannot call a plain http box as it is.
 * Loopback is exempt (the browser treats 127.0.0.1 as secure), and Chrome
 * lets a LAN address through when the fetch names its address space; lab.js
 * (`blockedByMixedContent`) says whether this browser will refuse outright.
 */
export function mixedContent(url) {
  const e = endpoints(url);
  if (!e) return false;
  return typeof location !== "undefined" && location.protocol === "https:" && e.http && !e.loopback;
}

/** Mira reads `companion.settings.lab` = {url (full chat URL), model, apiKey}. */
export function syncToMira(s) {
  try {
    const e = endpoints(s.lab.url);
    const raw = localStorage.getItem(MIRA_KEY);
    const m = raw ? JSON.parse(raw) : {};
    m.lab = { url: e ? e.chat : "", model: s.lab.model || "", apiKey: s.lab.apiKey || "" };
    localStorage.setItem(MIRA_KEY, JSON.stringify(m));
  } catch {
    /* Mira is not here; nothing to do */
  }
}

/** If Mira has a lab endpoint and we have none, take hers. */
export function adoptFromMira(s) {
  if (s.lab.url) return false;
  try {
    const m = JSON.parse(localStorage.getItem(MIRA_KEY) || "{}");
    if (m.lab?.url) {
      s.lab = { url: m.lab.url, model: m.lab.model || "", apiKey: m.lab.apiKey || "" };
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export const IS_MOBILE =
  typeof navigator !== "undefined" && (navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));

/** Silero thresholds from the 0..100 sensitivity slider (Mira's mapping). */
export function vadThresholds(sensitivity) {
  const s = Math.max(0, Math.min(100, Number(sensitivity) || 50)) / 100;
  const start = 0.55 - 0.35 * s;
  return { start, exit: Math.max(0.05, start / 3), barge: Math.min(0.92, start + 0.4) };
}
