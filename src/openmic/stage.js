// The open-mic stage: a full-screen overlay where Mira performs a set.
// Mira's own SpriteRenderer draws her (renderer.js is still the unchanged
// copy from the companion): this file subclasses it to swap her street
// for the open-mic room (mic-scene.js) and to draw the subtitles on the
// real canvas, and it extends her manifest with the stage-only poses as
// gestures over the `speaking` state, so her mouth keeps following the
// voice while she paces, leans, shrieks, freezes and bows.
//
// The performance (performance.js) drives it: every line arrives with its
// pose tag; an aside dims the light and slows the voice; the shriek flares
// the aura and the light; the deadpan freezes her for the tag and the room
// laughs on the drop; the end of the set is a bow. Record starts both
// exports at once and plays the set from the top; when it ends the video
// clip and the cutscene package are downloaded.

import { SpriteRenderer } from "../sprite/renderer.js";
import { MicScene } from "./mic-scene.js";
import { Performance, BIT_GAP, SMOKE_GAP } from "./performance.js";
import { pushPanel } from "../panels.js";
import { $, toast, download } from "../ui.js";
import { parseSet, slugOf, fmtRuntime } from "./set.js";

const BASE = import.meta.env.BASE_URL || "/";

/** The stage-only states, as gestures over `speaking` (STAGE_SPRITES.md lists the frames they stand in for). */
export const STAGE_GESTURES = {
  stage_enter: [{ clip: "walk_right", from: "offleft", to: 0, fps: 14 }, { clip: "idle_down", dur: 0.4 }],
  stage_pace: [{ clip: "walk_right", to: 26, fps: 11 }, { clip: "idle_right", dur: 0.35 }, { clip: "walk_left", to: -18, fps: 11 }, { clip: "walk_down", frames: [1], hold: -1 }],
  stage_lean: [{ clip: "idle_southeast", dur: 0.5 }, { clip: "walk_down", frames: [1], hold: -1 }],
  stage_shriek: [{ clip: "resonate_down", frames: [1, 2, 3], fps: 9, hold: 3 }],
  stage_deadpan: [{ clip: "idle_down", frames: [0], hold: -1 }],
  stage_aside: [{ clip: "idle_southwest", dur: 0.45 }, { clip: "idle_down", frames: [0, 1], fps: 2, hold: -1 }],
  stage_beat: [{ clip: "idle_down", frames: [2], hold: -1 }],
  stage_bow: [{ clip: "sleep_down", frames: [0, 1], fps: 4, hold: 1.6 }, { clip: "idle_down", dur: 0.6 }],
  // a drag on the cigarette, three-quarter to the room, at the clip's own (slowed) pace: between bits, and while she waits
  stage_drag: [{ clip: "smoke_southeast", dur: 3.6 }, { clip: "idle_down", dur: 0.3 }],
  stage_drag_l: [{ clip: "smoke_southwest", dur: 3.6 }, { clip: "idle_down", dur: 0.3 }],
};

/** The idle fidgets on the stage: with the cigarette, a drag comes round often. */
const IDLE_FIDGETS = { smoke: ["stage_drag", "glance", "stage_drag_l", "lookaway", "stage_drag"], plain: ["glance", "lookup", "lookaway"] };
const IDLE_FIDGET_EVERY = { smoke: [7, 14], plain: [12, 25] };

/** Mira's manifest with the stage gestures added, the street habits (the stroll, the smoke break) off, and the cigarette in her idle when `smoke` is on. */
export function stageManifest(m, { smoke = true } = {}) {
  const c = JSON.parse(JSON.stringify(m));
  c.gestures = { ...(c.gestures || {}), ...STAGE_GESTURES };
  if (c.states?.idle) {
    c.states.idle.stroll_every = null;
    c.states.idle.fidgets = IDLE_FIDGETS[smoke ? "smoke" : "plain"];
    c.states.idle.fidget_every = IDLE_FIDGET_EVERY[smoke ? "smoke" : "plain"];
  }
  if (c.states?.idle_long) c.states.idle_long.after_seconds = 1e9;
  if (c.states?.asleep) c.states.asleep.after_seconds = 1e9;
  return c;
}

class StageRenderer extends SpriteRenderer {
  constructor(canvas, manifest, atlas, extra) {
    super(canvas, manifest, atlas, extra);
    this.scene = new MicScene();
    this.scene.setMoodTable(this.moods);
    this.resize();
    this.caption = null; // the line on screen: {text, aside, direction}
    this.card = null; // a title card: {title, sub}
    this.hint = "";
  }

  _draw() {
    super._draw();
    if (!this.W) return;
    const c = this.ctx;
    const dpr = this.W / (this.canvas.clientWidth || this.W);
    const px = Math.max(11, Math.round(Math.min(this.W / 24, this.H / 34)));
    c.save();
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    if (this.card) {
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(0, 0, this.W, this.H);
      c.fillStyle = "rgba(255,138,60,0.95)";
      c.font = `700 ${Math.round(px * 1.5)}px system-ui, sans-serif`;
      c.fillText(this.card.title, this.W / 2, this.H * 0.42);
      if (this.card.sub) {
        c.fillStyle = "rgba(234,225,232,0.8)";
        c.font = `${px}px system-ui, sans-serif`;
        c.fillText(this.card.sub, this.W / 2, this.H * 0.42 + px * 1.8);
      }
    }
    if (this.caption?.text) {
      const cap = this.caption;
      c.font = `${cap.aside || cap.direction ? "italic " : ""}${cap.direction ? "" : "600 "}${px}px system-ui, sans-serif`;
      const lines = wrap(c, cap.text, this.W * 0.86);
      const lh = px * 1.3;
      const h = lines.length * lh + px * 0.9;
      const y0 = this.H - h - Math.round(8 * dpr);
      c.fillStyle = "rgba(6,6,14,0.72)";
      c.fillRect(this.W * 0.04, y0, this.W * 0.92, h);
      c.fillStyle = cap.direction ? "rgba(164,172,171,0.9)" : cap.aside ? "rgba(255,214,150,0.95)" : "rgba(234,225,232,1)";
      lines.forEach((l, i) => c.fillText(l, this.W / 2, y0 + px * 0.55 + (i + 1) * lh - lh * 0.25));
    } else if (this.hint) {
      c.font = `${px}px system-ui, sans-serif`;
      c.fillStyle = "rgba(164,172,171,0.75)";
      c.fillText(this.hint, this.W / 2, this.H - Math.round(14 * dpr));
    }
    c.restore();
  }
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const out = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      out.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) out.push(cur);
  return out.slice(0, 4);
}

export class MicStage extends EventTarget {
  /**
   * @param {{speech: object, settings: object}} o
   */
  constructor({ speech, settings }) {
    super();
    this.speech = speech;
    this.settings = settings;
    this.root = $("mic");
    this.canvas = $("mic-canvas");
    this.box = $("mic-box");
    this.renderer = null;
    this.perf = null;
    this.set = null;
    this.style = "";
    this.open = false;
    this._pop = null;
    this._tick = 0;
    this._loading = null;
    this.aspect = "auto";
    this._bind();
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /** Whether she smokes on the stage (Settings → Open mic): her idle fidgets, and the drag between bits with its longer gap. */
  get smoking() {
    return this.settings.openmic?.smoke !== false;
  }

  setSmoke(on) {
    const idle = this.renderer?.m?.states?.idle;
    if (idle) {
      idle.fidgets = IDLE_FIDGETS[on ? "smoke" : "plain"];
      idle.fidget_every = IDLE_FIDGET_EVERY[on ? "smoke" : "plain"];
    }
    if (this.perf) this.perf.bitGap = on ? SMOKE_GAP : BIT_GAP;
  }

  /** The atlas and the manifest, once. */
  load() {
    if (this._loading) return this._loading;
    this._loading = (async () => {
      const dir = `${BASE}assets/sprites/courier/`;
      const manifest = stageManifest(await (await fetch(`${dir}courier.json`)).json(), { smoke: this.smoking });
      const atlas = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("could not load the courier atlas"));
        img.src = `${dir}${manifest.meta.atlas}`;
      });
      this.renderer = new StageRenderer(this.canvas, manifest, atlas, { mouth: null });
      this.renderer.setAuraColour("#ff8a3c");
      this.renderer.setRegime("GUT");
    })();
    this._loading.catch(() => (this._loading = null));
    return this._loading;
  }

  _bind() {
    $("mic-close").addEventListener("click", () => this.close());
    $("mic-play").addEventListener("click", () => this.play());
    $("mic-pause").addEventListener("click", () => this.pause());
    $("mic-skip").addEventListener("click", () => this.perf?.skipBit());
    $("mic-rec").addEventListener("click", () => (this.perf?.recording ? this.stopRecord() : this.record()));
    $("mic-pkg").addEventListener("click", () => this.exportPackage());
    $("mic-audio").addEventListener("click", () => this.exportAudio());
    $("mic-room-on").addEventListener("change", (e) => {
      this.settings.openmic.room = e.target.checked;
      this.perf?.setRoomEnabled(this.settings.openmic.room);
      this.emit("settings");
    });
    // the stage's audio panel: the rain, inside or out, and the 432 bed, kept in the same settings as Settings → Open mic
    $("mic-rain-on").addEventListener("change", (e) => {
      this.settings.openmic.rain = e.target.checked;
      this.perf?.setRain(this.settings.openmic.rain);
      this.emit("settings");
    });
    $("mic-rain-inside").addEventListener("change", (e) => {
      this.settings.openmic.rainInside = e.target.checked;
      this.perf?.setRainInside(this.settings.openmic.rainInside);
      this.emit("settings");
    });
    $("mic-bed-on").addEventListener("change", (e) => {
      this.settings.openmic.bed = e.target.checked;
      this.perf?.setBed(this.settings.openmic.bed);
      this.emit("settings");
    });
    $("mic-video").addEventListener("change", (e) => {
      this.settings.openmic.video = e.target.value;
      this.emit("settings");
    });
    $("mic-aspect").addEventListener("click", () => this.setAspect(this.box.dataset.aspect === "9:16" ? "16:9" : "9:16"));
    $("mic-room").addEventListener("input", (e) => {
      this.settings.openmic.roomVolume = Number(e.target.value);
      this.perf?.setRoomVolume(this.settings.openmic.roomVolume / 100);
      this.emit("settings");
    });
    const heckle = () => {
      const t = $("mic-heckle").value.trim();
      if (!t) return;
      $("mic-heckle").value = "";
      this.emit("heckle", t);
    };
    $("mic-heckle-send").addEventListener("click", heckle);
    $("mic-heckle").addEventListener("keydown", (e) => e.key === "Enter" && heckle());
  }

  /** Put a set on the stage. `style` is the Suno style prompt if the set became a song. */
  async show(set, { style = "" } = {}) {
    if (!set?.isSet) return toast("No set to perform yet. /five writes one.", { error: true });
    this.set = set;
    this.style = style || "";
    this.root.hidden = false;
    this.open = true;
    this._pop?.();
    this._pop = pushPanel("mic", () => this.close());
    this.setAspect(this.settings.openmic.aspect || "auto");
    $("mic-title").textContent = set.title;
    $("mic-room").value = this.settings.openmic.roomVolume ?? 15;
    $("mic-room-on").checked = this.settings.openmic.room !== false;
    $("mic-rain-on").checked = this.settings.openmic.rain !== false;
    $("mic-rain-inside").checked = this.settings.openmic.rainInside !== false;
    $("mic-bed-on").checked = !!this.settings.openmic.bed;
    $("mic-video").value = this.settings.openmic.video || "auto";
    this._status(`${set.bits.length} bit${set.bits.length === 1 ? "" : "s"} · ~${fmtRuntime(set.runtime)}`);
    try {
      await this.load();
    } catch (e) {
      toast(`stage: ${e.message}`, { error: true });
      return this.close();
    }
    this.perf?.destroy();
    this.perf = new Performance(set, {
      speech: this.speech,
      voice: this.settings.voices.mira,
      speed: this.settings.ttsSpeed || 1,
      roomVolume: (this.settings.openmic.roomVolume ?? 15) / 100,
      room: this.settings.openmic.room !== false,
      style: this.style,
      bed: !!this.settings.openmic.bed,
      rain: this.settings.openmic.rain !== false,
      rainInside: this.settings.openmic.rainInside !== false,
      smoke: this.smoking,
    });
    this.setSmoke(this.smoking); // the setting may have changed since the manifest was loaded
    this._wire(this.perf);
    const r = this.renderer;
    r.caption = null;
    r.card = { title: set.title, sub: set.pullQuote ? `“${set.pullQuote}”` : "" };
    r.hint = "";
    r.resize();
    r.start();
    r.setState("idle");
    r.gesture("stage_enter");
    $("mic-pose").textContent = "idle";
    this._buttons();
    clearInterval(this._tick);
    this._tick = setInterval(() => {
      if (!this.renderer) return;
      this.renderer.setMouth(this.perf?.state === "playing" ? this.perf.level() : 0);
    }, 33);
    this.emit("open", set);
  }

  _wire(p) {
    p.addEventListener("line", (e) => this._onLine(e.detail));
    p.addEventListener("line-end", (e) => this._onLineEnd(e.detail));
    p.addEventListener("bit", (e) => {
      $("mic-pose").textContent = `bit ${e.detail.bit}`;
      this.renderer.caption = null;
      if (this.smoking) {
        // between bits: a drag, facing whichever side of the room, while the gap runs
        this.renderer.gesture(Math.random() < 0.5 ? "stage_drag" : "stage_drag_l");
        $("mic-pose").textContent = "smoke";
      }
    });
    p.addEventListener("state", (e) => {
      const st = e.detail;
      this._buttons();
      if (st === "playing") {
        const r = this.renderer;
        r.card = null;
        // wherever she was (walking in, pacing), the set starts at the mic
        r.seq = null;
        r.frameSubset = null;
        r.x = 0;
        r.setState("speaking");
      } else if (st === "paused") {
        this.renderer.setState("idle");
        this._status("paused");
      } else if (st === "idle") {
        this.renderer.setState("idle");
        this.renderer.caption = null;
        this._status("");
      }
    });
    p.addEventListener("done", () => this._onDone());
    p.addEventListener("buffering", (e) => this._onBuffering(e.detail));
    p.addEventListener("buffered", () => this._onBuffered());
    p.addEventListener("progress", (e) => {
      if (this._buffering) this._status(`${this._bufferWhy} · ${e.detail.ready} of ${e.detail.total} lines ready`);
    });
    p.addEventListener("error", (e) => {
      toast(`stage: ${e.detail}`, { error: true, ms: 6000 });
      this._status(e.detail);
    });
  }

  /**
   * The voice is behind the set (the phone's Qwen renders slower than real
   * time): before the first line, and whenever the playhead catches the
   * renderer, she takes a drag until enough is ready, the caption clears
   * and the room shifts now and then. With smoking off she leans on the
   * mic instead.
   */
  _onBuffering({ index, seconds, need }) {
    this._buffering = true;
    this._bufferWhy = index === 0 ? `warming up the voice (${Math.round(seconds)} of ${need} s)` : `the voice is catching up (${Math.round(seconds)} s ready)`;
    const r = this.renderer;
    r.caption = null;
    $("mic-pose").textContent = this.smoking ? "smoke" : "wait";
    this._status(this._bufferWhy);
    const drag = () => {
      if (!this._buffering || !this.renderer) return;
      if (this.smoking) this.renderer.gesture(Math.random() < 0.5 ? "stage_drag" : "stage_drag_l");
      else this.renderer.gesture("stage_lean");
      if (Math.random() < 0.5) this.perf?.room?.murmur(0.25);
      this._dragTimer = setTimeout(drag, 4200);
    };
    clearTimeout(this._dragTimer);
    drag();
  }

  _onBuffered() {
    this._buffering = false;
    clearTimeout(this._dragTimer);
    const r = this.renderer;
    if (r?.seq && /^stage_(drag|drag_l|lean)$/.test(r.seq.name)) {
      r.seq = null;
      r.frameSubset = null;
      r._play("idle_down");
    }
    this._status("");
  }

  _onLine({ index, line }) {
    const r = this.renderer;
    const s = r.scene;
    r.caption = { text: line.text, aside: line.aside, direction: line.direction };
    if (!line.direction) this.perf.room?.setTalking(true);
    $("mic-pose").textContent = line.pose || (line.direction ? "beat" : `bit ${line.bit}`);
    this._status(`bit ${line.bit} · line ${index + 1} of ${this.set.lines.length}`);
    s.setLight(line.aside ? 0.45 : 1);
    r.aura.target = 0.4;
    switch (line.pose) {
      case "pace":
        r.gesture("stage_pace");
        break;
      case "lean":
        r.gesture("stage_lean");
        break;
      case "shriek":
        r.gesture("stage_shriek");
        r.aura.target = 0.95;
        r.pulse(1.5);
        s.setLight(1.35);
        this.perf.room?.murmur(0.35);
        break;
      case "deadpan":
        r.gesture("stage_deadpan");
        break;
      case "aside":
        r.gesture("stage_aside");
        break;
      default:
        if (line.direction) r.gesture("stage_beat");
        else if (r.seq && /^stage_(deadpan|lean|aside|beat|pace|drag|drag_l)$/.test(r.seq.name)) {
          // a held pose ends when a plain line begins
          r.seq = null;
          r.frameSubset = null;
          r._play("idle_down");
        }
        r.nod();
    }
  }

  _onLineEnd({ index, line }) {
    const room = this.perf.room;
    room?.setTalking(false);
    const next = this.set.lines[index + 1];
    const bitEnds = !next || next.bit !== line.bit;
    if (bitEnds) {
      room?.laugh(0.9);
      this.renderer.scene.react(0.9);
    } else if (line.pose === "deadpan") {
      room?.laugh(0.65);
      this.renderer.scene.react(0.6);
    } else if (line.pose === "shriek") {
      room?.laugh(0.4);
      this.renderer.scene.react(0.4);
    }
    if (line.aside) this.renderer.scene.setLight(1);
  }

  async _onDone() {
    const r = this.renderer;
    r.caption = null;
    r.scene.setLight(1);
    r.aura.target = 0.4;
    r.gesture("stage_bow");
    this.perf.room?.setTalking(false);
    this.perf.room?.laugh(1);
    this.perf.room?.applaud(1);
    r.scene.react(1);
    $("mic-pose").textContent = "bow";
    this._status("the end");
    this._buttons();
    setTimeout(() => this.renderer?.setState("idle"), 2600);
    if (this.perf.recording) await this._finishRecording();
    this.emit("done");
  }

  _buttons() {
    const st = this.perf?.state || "idle";
    $("mic-play").hidden = st === "playing";
    $("mic-pause").hidden = st !== "playing";
    $("mic-play").textContent = st === "paused" ? "▶ Resume" : st === "done" ? "▶ Again" : "▶ Play set";
    $("mic-rec").textContent = this.perf?.recording ? "■ Stop recording" : "● Record";
    $("mic-rec").classList.toggle("on", !!this.perf?.recording);
  }

  _status(t) {
    $("mic-status").textContent = t || "";
  }

  setAspect(a) {
    const want = a === "auto" ? (innerWidth < innerHeight ? "9:16" : "16:9") : a;
    this.box.dataset.aspect = want;
    $("mic-aspect").textContent = want;
    this.aspect = a;
    this.renderer?.resize();
  }

  async play() {
    if (!this.perf) return;
    try {
      if (!this.speech.ready && !this.perf.synth) this._status("loading the voice (Kokoro, once)…");
      await this.perf.play();
    } catch (e) {
      toast(`stage: ${e.message}`, { error: true });
    }
  }

  pause() {
    this.perf?.pause();
  }

  /** Record: both exports, from the top. */
  async record() {
    if (!this.perf) return;
    await this.perf.init();
    this._status("starting the recorder…");
    const type = await this.perf.startRecording(this.canvas, 30, { format: this.settings.openmic.video || "auto" });
    if (!type) return toast("This browser cannot record the canvas (no MediaRecorder, or no format that delivers).", { error: true });
    this._buttons();
    this._status(`recording ${type.split(";")[0]}…`);
    this.perf.stop();
    await this.play();
  }

  async stopRecord() {
    await this._finishRecording();
    this._buttons();
  }

  /** Record's three outputs, in turn: the video clip, the whole set as one WAV, the cutscene package. Each is announced as it lands. */
  async _finishRecording() {
    const r = await this.perf.stopRecording();
    if (!r || !r.blob.size) this._status("nothing recorded (the browser's recorder delivered no data)");
    else {
      const name = `performance-${slugOf(this.set.title)}.${r.ext}`;
      const mb = (r.blob.size / 1048576).toFixed(1);
      this._status(`saving ${name} (${mb} MB)…`);
      await download(name, r.blob, r.type, (done, total) => this._status(`saving ${name}: ${Math.round((done / total) * 100)}% of ${mb} MB`)).catch((e) => toast(`video: ${e.message}`, { error: true }));
      this._status(`saved ${name} (${mb} MB)`);
      this.emit("recorded", { name, blob: r.blob });
    }
    // the whole set as one audio file, and the package: every clip was synthesized while the set played, so both are quick
    await this.exportAudio();
    await this.exportPackage();
  }

  /** The whole set as one audio file: every line rendered (the phone's Qwen voice or Kokoro, cached) and laid on the timeline, the voice alone; into Downloads on the phone. */
  async exportAudio() {
    if (!this.perf) return null;
    const out = $("mic-export-status");
    try {
      await this.perf.init();
      const a = await this.perf.stitch((n, total) => (out.textContent = `rendering line ${n} of ${total}…`));
      await download(a.name, a.blob, "audio/wav", (done, total) => (out.textContent = `saving ${a.name}: ${Math.round((done / total) * 100)}%`));
      out.textContent = `${a.name}: ${fmtRuntime(a.seconds)}, ${(a.bytes / 1048576).toFixed(1)} MB, the voice alone on the set's timeline.`;
      this.emit("audio", a);
      return a;
    } catch (e) {
      out.textContent = `audio: ${e.message}`;
      toast(`audio: ${e.message}`, { error: true });
      return null;
    }
  }

  async exportPackage() {
    if (!this.perf) return null;
    const out = $("mic-export-status");
    try {
      await this.perf.init();
      const pkg = await this.perf.package((n, total) => (out.textContent = `synthesizing line ${n} of ${total}…`));
      await download(pkg.name, pkg.blob, "application/zip", (done, total) => (out.textContent = `saving ${pkg.name}: ${Math.round((done / total) * 100)}%`));
      out.textContent = `${pkg.name}: ${pkg.count} files, ${(pkg.bytes / 1048576).toFixed(1)} MB. Unzip into the game's cutscene/ folder (or user://performances/).`;
      this.emit("packaged", pkg);
      return pkg;
    } catch (e) {
      out.textContent = `package: ${e.message}`;
      toast(`package: ${e.message}`, { error: true });
      return null;
    }
  }

  /** A quick reaction on the stage, before the model's two lines: the caption, a lean, the room shifting. */
  quip(line) {
    if (!this.open || !this.renderer || !line) return;
    const r = this.renderer;
    r.card = null;
    r.caption = { text: line, aside: false, direction: false };
    if (this.perf?.state !== "playing") {
      r.gesture("stage_lean");
      this.perf?.room?.murmur(0.3);
    }
    clearTimeout(this._quipTimer);
    this._quipTimer = setTimeout(() => {
      if (r.caption?.text === line) r.caption = null;
    }, 2600);
  }

  /** Crowd work: perform a reply right now, in the room, without leaving the set. */
  async perform(text) {
    if (!this.open || !this.renderer) return;
    const mini = parseSet(text);
    if (!mini.lines.length) return;
    for (const l of mini.lines) if (!l.pose) l.pose = "lean";
    const main = this.perf;
    if (main?.state === "playing") main.pause();
    const p = new Performance(mini, { speech: this.speech, voice: this.settings.voices.mira, speed: this.settings.ttsSpeed || 1, roomVolume: (this.settings.openmic.roomVolume ?? 15) / 100, room: this.settings.openmic.room !== false, rain: false });
    if (main?.synth) p.synth = main.synth;
    const keep = this.perf;
    this.perf = p;
    this._wire(p);
    p.addEventListener("done", () => {
      p.destroy();
      this.perf = keep;
      this._buttons();
    });
    await p.play(0);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    clearInterval(this._tick);
    const pop = this._pop;
    this._pop = null;
    pop?.();
    this.perf?.destroy();
    this.perf = null;
    this.renderer?.stop();
    if (this.renderer) {
      this.renderer.caption = null;
      this.renderer.card = null;
    }
    this.emit("close");
  }
}
