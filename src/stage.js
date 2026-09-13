// The stage: Mira on her street across the top of every desk. This is Mira's
// own renderer and scene (src/sprite/renderer.js, src/scene/scene.js,
// copied from the companion unchanged) with the courier atlas, driven by the
// workbench's turns instead of a microphone: listening while you type or
// hold the mic, thinking while the model works, speaking while Kokoro
// plays (the mouth follows the player's output level), idle otherwise; a
// smoke break and a nap when it has been quiet a long while. The district
// behind her follows the desk, and she walks there when it changes.

import { SpriteRenderer } from "./sprite/renderer.js";
import { REGIMES } from "./settings.js";

const BASE = import.meta.env.BASE_URL || "/";

export class Stage extends EventTarget {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} wrap the sized container the canvas fills
   * @param {object} settings
   * @param {{level?: () => number, listenLevel?: () => number}} sources output and mic levels, 0..1
   */
  constructor(canvas, wrap, settings, sources = {}) {
    super();
    this.canvas = canvas;
    this.wrap = wrap;
    this.settings = settings;
    this.sources = sources;
    this.renderer = null;
    this.state = "idle";
    this.regime = "HEART";
    this.idleSince = performance.now();
    this.quietSince = performance.now();
    this._timer = 0;
    this._ro = null;
    this.loaded = false;
    this.error = null;
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /** Fetch the atlas and start drawing. Safe to call once; failures are reported, not thrown. */
  async load() {
    if (this.loaded || this.error) return this.loaded;
    try {
      const dir = `${BASE}assets/sprites/courier/`;
      const manifest = await (await fetch(`${dir}courier.json`)).json();
      const atlas = await loadImage(`${dir}${manifest.meta.atlas}`);
      let mouth = null;
      if (manifest.mouth?.source && manifest.mouth.source !== "procedural") mouth = await loadImage(`${dir}${manifest.mouth.source}`).catch(() => null);
      this.renderer = new SpriteRenderer(this.canvas, manifest, atlas, { mouth });
      this.applySettings();
      this.renderer.setRegime(this.regime);
      this.renderer.setAuraColour(REGIMES[this.regime]?.colour || "#ff4f8b");
      this.renderer.resize();
      this.renderer.start();
      this._ro = new ResizeObserver(() => this.renderer?.resize());
      this._ro.observe(this.wrap);
      this._tick();
      this.loaded = true;
      if (!this.wrap.hidden) this.renderer.enter();
      this.emit("ready");
    } catch (e) {
      this.error = e.message || String(e);
      this.emit("error", this.error);
    }
    return this.loaded;
  }

  applySettings() {
    const s = this.settings;
    if (!this.renderer) return;
    this.renderer.setSceneEnabled(s.stageScene !== false);
    this.renderer.setStorm(s.stageStorm !== false);
    this.renderer.setStormParts({ rain: s.stageStorm !== false, gusts: s.stageStorm !== false, lightning: s.stageStorm !== false });
  }

  /** Show or hide the stage; hidden, nothing is drawn. */
  show(on) {
    this.wrap.hidden = !on;
    if (!this.renderer) return;
    if (on) {
      this.renderer.resize();
      this.renderer.start();
    } else this.renderer.stop();
  }

  get visible() {
    return !this.wrap.hidden && this.loaded;
  }

  /**
   * The desk's district. If it changed she walks off towards it and back in;
   * resolves when she is there. `colour` overrides the regime's aura colour
   * (the Aetheria desk follows the selected frequency).
   */
  async setRegime(regime, colour = null) {
    const r = REGIMES[regime] ? regime : "HEART";
    const c = colour || REGIMES[r].colour;
    const changed = r !== this.regime;
    this.regime = r;
    if (!this.renderer) return false;
    if (!changed) {
      this.renderer.setAuraColour(c);
      return true;
    }
    const ok = await this.renderer.travel(r, c);
    this.emit("regime", r);
    return ok;
  }

  /** @param {"idle"|"listening"|"thinking"|"speaking"|"interrupted"|"error"} name */
  setState(name) {
    const now = performance.now();
    if (name === "idle") this.idleSince = now;
    if (name === "idle" || name === "listening") this.quietSince = now;
    this.state = name;
    if (!this.renderer) return;
    if (name === "interrupted") this.renderer.setState("interrupted", { then: "idle" });
    else this.renderer.setState(name);
    clearTimeout(this._listenTimer);
    if (name === "listening") {
      const after = (this.renderer.m.states.listening?.long_after ?? 5) * 1000;
      this._listenTimer = setTimeout(() => this.renderer?.listenLong(), after);
    }
    this.emit("state", name);
  }

  /** Somebody typed or spoke: the quiet spell starts over. */
  touch() {
    this.quietSince = performance.now();
    this.idleSince = performance.now();
    if (this.renderer && (this.renderer.state === "idle_long" || this.renderer.state === "asleep")) this.renderer.setState("idle");
  }

  setMood(mood) {
    this.renderer?.setMood(mood);
  }

  /** The mood's gesture as her voice starts. */
  react(mood) {
    this.renderer?.react(mood || "calm");
  }

  nod() {
    this.renderer?.nod();
  }

  gesture(name) {
    this.renderer?.gesture(name);
  }

  /** Seconds since anything happened. */
  quietFor() {
    return (performance.now() - this.quietSince) / 1000;
  }

  /** The street's rain intensity right now, for the ambience. */
  get rain() {
    return this.renderer?.scene?.rain ?? 0;
  }

  set onStrike(fn) {
    if (this.renderer) this.renderer.scene.onStrike = fn;
  }

  _tick() {
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (!this.renderer || this.wrap.hidden) return;
      const out = this.state === "speaking" ? this.sources.level?.() || 0 : 0;
      this.renderer.setMouth(out);
      if (this.state === "listening") this.renderer.setListenLevel(Math.min(1, (this.sources.listenLevel?.() || 0) * 4));
      // a smoke break after a long quiet spell, and a nap if it goes on; not while she is pacing the stage (the stroll finishes first)
      if (this.state === "idle" && this.settings.stageSmoke !== false && !this.renderer.strolling) {
        const quiet = (performance.now() - this.idleSince) / 1000;
        const smoke = this.renderer.m.states.idle_long;
        const nap = this.renderer.m.states.asleep;
        if (nap?.clips?.length && quiet > (smoke?.after_seconds || 90) + (nap.after_seconds || 240)) {
          if (this.renderer.state !== "asleep") this.renderer.setState("asleep");
        } else if (smoke?.clips?.length && quiet > (smoke.after_seconds || 90)) {
          if (this.renderer.state !== "idle_long") this.renderer.setState("idle_long");
        }
      }
      this.emit("tick");
    }, 33);
  }

  destroy() {
    clearInterval(this._timer);
    this._ro?.disconnect();
    this.renderer?.stop();
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

// Mira's mood tags: the Mira desk asks the model to open every reply with one.
export const MOODS = ["calm", "happy", "curious", "concerned", "amused", "excited", "annoyed", "sassy", "tired", "thoughtful"];
const MOOD_TAG = /^\s*(?:\[[a-z]+\]\s*)+/i;

/** Split a leading mood tag off a reply: {mood, text}. */
export function takeMood(raw) {
  const head = String(raw || "").match(MOOD_TAG);
  if (!head) return { mood: null, text: raw, pending: /^\s*\[[^\]]{0,16}$/.test(raw) };
  const tags = [...head[0].matchAll(/\[([a-z]+)\]/gi)].map((m) => m[1].toLowerCase());
  return { mood: tags.find((t) => MOODS.includes(t)) || "calm", text: raw.slice(head[0].length), pending: false };
}

export const MOOD_PROTOCOL = `Protocol. Start every reply with one mood tag and a space, from [calm] [happy] [curious] [concerned] [amused] [excited] [annoyed] [sassy] [tired] [thoughtful] (sassy is cheek, annoyed is real irritation). Example: "[curious] Long day, then. What went wrong?" The tag is stripped before the reply is shown or spoken; nothing else in brackets.`;
