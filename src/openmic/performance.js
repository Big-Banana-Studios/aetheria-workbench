// A performance: a set played as a timeline, one Kokoro clip per line, on
// its own audio graph (the worklet player, the room, a low rain bed) so
// the stage can be paused, skipped and recorded without touching the
// desk's read-aloud. Every clip is cached by text hash (IndexedDB, the
// `audio` store) so replaying or re-recording a set never synthesizes a
// line twice, and the same clips become the cutscene package: manifest,
// set.md and one 24 kHz WAV per line, zipped in the browser. The video
// clip is canvas.captureStream plus this graph's stream into MediaRecorder.

import { Player } from "../audio/player.js";
import { Music } from "../audio/music.js";
import { Room } from "./room.js";
import { StageRecorder } from "./recorder.js";
import { store } from "../store.js";
import { timeline, setMarkdown, slugOf } from "./set.js";
import { encodeWav } from "./wav.js";
import { zipStore } from "./zip.js";

export const GAP = 0.35; // seconds between lines
export const BEAT = 0.9; // after a tag, a shriek, or a bare direction
export const BIT_GAP = 1.2; // between bits
export const SMOKE_GAP = 4.4; // between bits when she smokes on the stage: room for a drag (stage.js stage_drag) and a beat
export const ASIDE_SPEED = 0.85; // the aside is read slower

/** A stable hash of the exact spoken text, for the cache key. */
export function hashText(s) {
  let h = 2166136261;
  const t = String(s || "");
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// MP4 (H.264 + AAC) first, one file for posting, where the browser's recorder can mux it (Chrome on Android and the desktop since
// the 130s, Safari); WebM (VP9/Opus) where it cannot. tools/to_mp4 in the README converts a WebM on the PC.
const MIME = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

export class Performance extends EventTarget {
  /**
   * @param {object} set from parseSet
   * @param {{speech: object, voice: string, speed?: number, roomVolume?: number, style?: string, bed?: boolean, rain?: boolean}} o
   */
  constructor(set, { speech, voice, speed = 1, roomVolume = 0.15, room = true, style = "", bed = false, rain = true, rainInside = true, smoke = true }) {
    super();
    this.set = set;
    this.speech = speech;
    this.voice = voice;
    this.speed = speed;
    this.style = style;
    this.roomVolume = roomVolume;
    this.roomOn = room;
    this.bedOn = bed;
    this.rainOn = rain;
    this.rainInside = rainInside;
    this.stageRec = null; // the WebCodecs recorder (recorder.js), when the browser can; else MediaRecorder below
    this.bitGap = smoke ? SMOKE_GAP : BIT_GAP; // the pause between bits: longer when she takes a drag there (the stage sets it live)
    this.clips = new Map(); // line index -> {samples, sampleRate}
    this.state = "idle"; // idle | playing | paused | done
    this.cursor = 0;
    this.runId = 0;
    this.player = null;
    this.ctx = null;
    this.dest = null;
    this.room = null;
    this.music = null;
    this._waiters = new Map();
    this._timer = null;
    this._interrupt = null;
    this._interrupted = false;
    this._resume = null;
    this._abort = false;
    /** Override for the tests: async (line) => {samples, sampleRate}. */
    this.synth = null;
    this.recorder = null;
    this._chunks = [];
    this.recordType = "";
    // the voice may be slower than real time (the phone's Qwen): clips are rendered ahead of the playhead in order, the set
    // starts once `preroll` seconds are in, and when the playhead catches the renderer it waits for `margin` seconds more
    // ("buffering"/"buffered" events: the stage has her smoke through it)
    this._inflight = new Map(); // line index -> the clip promise, so the prefetcher and the play loop never render one twice
    this._clipWaiters = [];
    this.preroll = 12;
    this.margin = 8;
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  get lines() {
    return this.set.lines;
  }

  /** Bring the audio graph up; needs a user gesture the first time. */
  async init() {
    if (this.player) {
      if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
      return;
    }
    this.player = new Player({
      sampleRate: 24000,
      onChunkStart: (id, seq) => id === this.runId && this.emit("audio-start", seq),
      onChunkEnd: (id, seq) => {
        const w = this._waiters.get(`${id}:${seq}`);
        if (w) {
          this._waiters.delete(`${id}:${seq}`);
          w();
        }
      },
    });
    await this.player.unlock();
    const ctx = (this.ctx = this.player.ctx);
    this.dest = ctx.createMediaStreamDestination();
    this.player.analyser.connect(this.dest);
    this.room = new Room(ctx, [ctx.destination, this.dest]);
    this.room.setVolume(this.roomVolume);
    this.room.setEnabled(this.roomOn);
    this.music = new Music(ctx);
    this.music.master.connect(this.dest);
    this.music.setRegime("GUT");
    this.music.setEnabled(this.bedOn); // the 432 Hz bed: off by default on the stage
    this.music.setRainSound(this.rainOn); // rain ambience, low
    this.music.setIndoors(this.rainInside); // heard from inside the club: muffled, thunder as a rumble
    this.music.setRainVolume(0.22);
    this.music.setRain(0.45);
    this.music.setThunder(false);
    this.music.setVolume(0.25);
    this.music.start();
  }

  /** Output level 0..1, for the mouth. */
  level() {
    return this.player?.level() || 0;
  }

  setRoomVolume(v) {
    this.roomVolume = v;
    this.room?.setVolume(v);
  }

  setRoomEnabled(on) {
    this.roomOn = !!on;
    this.room?.setEnabled(this.roomOn);
  }

  setBed(on) {
    this.bedOn = !!on;
    this.music?.setEnabled(this.bedOn);
  }

  setRain(on) {
    this.rainOn = !!on;
    this.music?.setRainSound(this.rainOn);
  }

  setRainInside(on) {
    this.rainInside = !!on;
    this.music?.setIndoors(this.rainInside);
  }

  _speedFor(line) {
    return +(line.aside ? this.speed * ASIDE_SPEED : this.speed).toFixed(2);
  }

  key(line) {
    return `${this.voice}|${this._speedFor(line)}|${hashText(line.spoken)}`;
  }

  /** The clip for line i: memory, then the cache, then the voice (once, however many ask). */
  async clip(i) {
    if (this.clips.has(i)) return this.clips.get(i);
    const line = this.lines[i];
    if (line.direction || !line.spoken) return null;
    if (this._inflight.has(i)) return this._inflight.get(i);
    const job = (async () => {
      const key = this.key(line);
      let c = null;
      try {
        const hit = await store.getAudio(key);
        if (hit?.samples?.length) c = { samples: hit.samples, sampleRate: hit.rate || 24000 };
      } catch {
        /* no cache; synthesize */
      }
      if (!c) {
        const r = this.synth ? await this.synth(line) : await this.speech.synth(line.spoken, this.voice, { speed: this._speedFor(line) });
        c = { samples: r.samples, sampleRate: r.sampleRate || 24000 };
        if (c.sampleRate !== 24000) c = { samples: resample(c.samples, c.sampleRate, 24000), sampleRate: 24000 };
        store.putAudio(key, c.samples, c.sampleRate, line.spoken).catch(() => {});
      }
      this.clips.set(i, c);
      return c;
    })();
    this._inflight.set(i, job);
    try {
      return await job;
    } finally {
      this._inflight.delete(i);
      for (const r of this._clipWaiters.splice(0)) r();
      this.emit("progress", { ready: this.readyCount(), total: this.lines.length });
    }
  }

  /** Lines that can play right now (directions count). */
  readyCount() {
    return this.lines.filter((l, i) => l.direction || this.clips.has(i)).length;
  }

  /** Seconds of the set ready to play from line i on, up to the first line whose clip is not in yet; `complete` when the rest all are. */
  readyAhead(i) {
    let s = 0;
    for (let j = i; j < this.lines.length; j++) {
      const l = this.lines[j];
      if (l.direction) {
        s += BEAT;
        continue;
      }
      const c = this.clips.get(j);
      if (!c) return { seconds: s, complete: false, at: j };
      s += c.samples.length / c.sampleRate + GAP;
    }
    return { seconds: s, complete: true, at: this.lines.length };
  }

  /** Render ahead of the playhead, in order; as many at once as the voice allows (the PC's Qwen server batches, so several; Kokoro one), jumping forward when the cursor passes. */
  async _prefetch(run) {
    const n = Math.max(1, Math.min(8, this.speech?.synthAhead?.() ?? 1));
    let j = this.cursor;
    const worker = async () => {
      while (run === this.runId && !this._abort) {
        if (j < this.cursor) j = this.cursor;
        if (j >= this.lines.length) return;
        const i = j++;
        const l = this.lines[i];
        if (l.direction || this.clips.has(i)) continue;
        try {
          await this.clip(i);
        } catch (e) {
          if (/cancelled/i.test(e.message)) return;
          this.emit("error", `line ${i + 1}: ${e.message}`);
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    };
    await Promise.all(Array.from({ length: n }, worker));
  }

  /** Wait until `need` seconds from line i are ready, or the rest of the set is: "buffering" while it waits, "buffered" after (the stage has her smoke through it). */
  async _buffer(run, i, need) {
    let r = this.readyAhead(i);
    if (r.complete || r.seconds >= need) return;
    this.emit("buffering", { index: i, seconds: r.seconds, need });
    while (run === this.runId && !this._abort) {
      await new Promise((resolve) => {
        this._clipWaiters.push(resolve);
        setTimeout(resolve, 1500);
      });
      r = this.readyAhead(Math.max(i, this.cursor));
      if (r.complete || r.seconds >= need) break;
    }
    if (run === this.runId && !this._abort) this.emit("buffered", { index: i, seconds: r.seconds });
  }

  /** Every clip, in order; `onProgress(done, total)`. */
  async prepare(onProgress = null) {
    const idx = this.lines.map((l, i) => (l.direction ? -1 : i)).filter((i) => i >= 0);
    let n = 0;
    for (const i of idx) {
      await this.clip(i);
      onProgress?.(++n, idx.length);
    }
  }

  durations() {
    return this.lines.map((l, i) => {
      const c = this.clips.get(i);
      return c ? c.samples.length / c.sampleRate : null;
    });
  }

  timeline() {
    return timeline(this.set, this.durations(), { gap: GAP, beat: BEAT, bitGap: this.bitGap });
  }

  // ------------------------------------------------------------ transport

  _wait(seconds) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(this._timer);
        this._interrupt = null;
        resolve();
      };
      this._timer = setTimeout(done, seconds * 1000);
      this._interrupt = done;
    });
  }

  /** Cut whatever is playing or waiting short. */
  _cut() {
    this._interrupted = true;
    this.player?.stop();
    for (const r of this._waiters.values()) r();
    this._waiters.clear();
    this._interrupt?.();
  }

  async _pausePoint() {
    while (this.state === "paused" && !this._abort) await new Promise((r) => (this._resume = r));
  }

  /** Play from `from` (default: where it stopped, or the top once done). */
  async play(from = null) {
    if (this.state === "playing") return;
    await this.init();
    if (this.state === "paused" && from == null) return this.resume();
    if (from != null) this.cursor = from;
    if (this.cursor >= this.lines.length) this.cursor = 0;
    this._abort = false;
    const run = ++this.runId;
    this.state = "playing";
    this.emit("state", "playing");
    this.emit("start", { from: this.cursor });
    let lastBit = this.cursor > 0 ? this.lines[this.cursor - 1]?.bit ?? null : null;
    try {
      // the renderer runs ahead from here; the set starts once a lead is in
      this._prefetch(run);
      await this._buffer(run, this.cursor, this.preroll);
      while (this.cursor < this.lines.length && !this._abort && run === this.runId) {
        await this._pausePoint();
        if (this._abort) break;
        const i = this.cursor;
        const line = this.lines[i];
        this._interrupted = false;
        if (!line.direction && !this.clips.has(i)) {
          // the playhead caught the renderer: she smokes until a margin is in again
          await this._buffer(run, i, this.margin);
          if (this._abort || run !== this.runId) break;
          if (this._interrupted || this.cursor !== i) continue;
        }
        if (lastBit != null && line.bit !== lastBit) {
          this.emit("bit", { bit: line.bit });
          await this._wait(this.bitGap);
          if (this._interrupted) continue;
        }
        lastBit = line.bit;
        this.emit("line", { index: i, line });
        if (line.direction) await this._wait(BEAT);
        else {
          const c = await this.clip(i);
          if (this._abort || run !== this.runId) break;
          if (this._interrupted) continue;
          if (c && c.samples.length) {
            const done = new Promise((r) => this._waiters.set(`${run}:${i}`, r));
            this.player.enqueue(run, i, c.samples.slice());
            await done;
          }
          if (!this._interrupted) {
            this.emit("line-end", { index: i, line });
            await this._wait(line.pose === "deadpan" || line.pose === "shriek" ? BEAT : GAP);
          }
        }
        if (this._interrupted) continue; // paused (replay this line) or skipped (the cursor moved)
        if (this.cursor === i) this.cursor = i + 1;
      }
    } catch (e) {
      if (!/cancelled/i.test(e.message)) this.emit("error", e.message || String(e));
    }
    if (run !== this.runId) return;
    const finished = this.cursor >= this.lines.length && !this._abort;
    this.state = finished ? "done" : "idle";
    this.emit("state", this.state);
    if (finished) this.emit("done");
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this._cut();
    this.emit("state", "paused");
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.emit("state", "playing");
    this._resume?.();
    this._resume = null;
  }

  /** Jump to the first line of the next bit (or finish on the last one). */
  skipBit() {
    const line = this.lines[this.cursor];
    if (!line) return;
    let j = this.cursor;
    while (j < this.lines.length && this.lines[j].bit === line.bit) j++;
    this.cursor = j;
    if (this.state === "playing") this._cut();
    else if (this.state === "paused") {
      this._cut();
      this.resume();
    }
    this.emit("skip", { to: j });
  }

  stop() {
    this._abort = true;
    this._cut();
    if (this.state === "paused") {
      this.state = "idle";
      this._resume?.();
      this._resume = null;
      this.emit("state", "idle");
    }
    this.cursor = 0;
  }

  // ------------------------------------------------------------ exports

  /** The cutscene package: {name, blob, manifest, count}. Synthesizes what is missing first. */
  /** The whole set as one 24 kHz clip, the voice alone: every line at its place on the timeline, silence for the gaps and the beats. */
  async stitch(onProgress = null) {
    await this.prepare(onProgress);
    const tl = this.timeline();
    const sr = 24000;
    const total = Math.round((tl.duration + 0.5) * sr);
    const out = new Float32Array(total);
    tl.lines.forEach((l, i) => {
      const c = this.clips.get(i);
      if (!l.audio || !c) return;
      const at = Math.round(l.t * sr);
      const n = Math.min(c.samples.length, total - at);
      if (n > 0) out.set(c.samples.subarray(0, n), at);
    });
    const wav = encodeWav(out, sr);
    return { name: `performance-${slugOf(this.set.title)}.wav`, blob: new Blob([wav], { type: "audio/wav" }), seconds: tl.duration, bytes: wav.byteLength };
  }

  async package(onProgress = null) {
    await this.prepare(onProgress);
    const tl = this.timeline();
    const slug = slugOf(this.set.title);
    const dir = `performance-${slug}`;
    const manifest = {
      title: this.set.title,
      slug,
      created: new Date().toISOString(),
      duration: tl.duration,
      sprite: "courier",
      stage: "undercity-open-mic",
      aura: "#ff8a3c",
      sampleRate: 24000,
      voice: this.voice,
      pullQuote: this.set.pullQuote || "",
      style: this.style || null,
      lines: tl.lines,
    };
    const files = [
      { name: `${dir}/manifest.json`, data: JSON.stringify(manifest, null, 1) },
      { name: `${dir}/set.md`, data: setMarkdown(this.set, { style: this.style }) },
    ];
    tl.lines.forEach((l, i) => {
      const c = this.clips.get(i);
      if (l.audio && c) files.push({ name: `${dir}/audio/${l.audio}`, data: encodeWav(c.samples, c.sampleRate) });
    });
    const zip = zipStore(files);
    return { name: `${dir}.zip`, blob: new Blob([zip], { type: "application/zip" }), manifest, count: files.length, bytes: zip.length };
  }

  /**
   * Start recording the stage canvas and this graph. The formats are tried
   * in order (MP4 first) and each is made to prove itself: a recorder that
   * has not delivered a chunk within a moment (a browser that claims MP4
   * but has no H.264 encoder, headless Chrome for one) is dropped for the
   * next. Resolves with the mime type that took, or "" when none did.
   */
  async startRecording(canvas, fps = 30, { format = "auto" } = {}) {
    // the stage's own recorder first: WebCodecs into a standard MP4 (recorder.js), where this browser can encode H.264; "webm" skips it
    try {
      const probe = format === "webm" ? { ok: false, why: "WebM chosen" } : await StageRecorder.probe(canvas.width, canvas.height, this.ctx.sampleRate, 2);
      if (probe.ok) {
        this.stageRec = new StageRecorder(canvas, this.dest.stream.getAudioTracks()[0], probe);
        await this.stageRec.start();
        this.recordType = `video/mp4 (${probe.video}, ${probe.audio === "opus" ? "opus" : "aac"}, ${probe.width}x${probe.height})`;
        return this.recordType;
      }
      this.emit("info", `stage recorder: ${probe.why}; the browser's own recorder instead`);
    } catch (e) {
      this.stageRec = null;
      this.emit("info", `stage recorder failed to start (${e.message}); the browser's own recorder instead`);
    }
    if (typeof MediaRecorder === "undefined" || !canvas.captureStream) return "";
    const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
    // the browser's recorder: WebM first when it was asked for (its MP4 is the one that did not play on the phone)
    const order = format === "webm" ? MIME.filter((t) => /webm/.test(t)).concat(MIME.filter((t) => !/webm/.test(t))) : MIME;
    const types = order.filter((t) => MediaRecorder.isTypeSupported?.(t));
    if (!types.length) types.push("");
    for (const type of types) {
      let rec;
      try {
        rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 4e6 } : undefined); // 4 Mbps: a five-minute set is about 150 MB, which still streams to the phone's Downloads in pieces
      } catch (e) {
        this.emit("info", `recorder: ${type || "default"} refused (${e.message})`);
        continue;
      }
      const chunks = [];
      const proved = await new Promise((resolve) => {
        let done = false;
        const settle = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(ok);
        };
        const timer = setTimeout(() => settle(false), 1800);
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size) {
            chunks.push(e.data);
            settle(true);
          }
        };
        rec.onerror = () => settle(false);
        try {
          rec.start(250);
        } catch {
          settle(false);
        }
      });
      if (!proved) {
        try {
          rec.ondataavailable = null;
          if (rec.state !== "inactive") rec.stop();
        } catch {
          /* gone already */
        }
        this.emit("info", `recorder: ${(type || "default").split(";")[0]} delivered nothing; trying the next format`);
        continue;
      }
      this.recorder = rec;
      this._chunks = chunks;
      rec.ondataavailable = (e) => e.data && e.data.size && this._chunks.push(e.data);
      this.recordType = rec.mimeType || type;
      return this.recordType;
    }
    this.emit("error", "recorder: no format delivered a frame");
    return "";
  }

  get recording() {
    return !!this.stageRec?.recording || this.recorder?.state === "recording";
  }

  /** Stop and hand back the clip: {blob, ext}. */
  async stopRecording() {
    if (this.stageRec) {
      const sr = this.stageRec;
      this.stageRec = null;
      return sr.stop();
    }
    const rec = this.recorder;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || this.recordType || "video/webm";
        resolve({ blob: new Blob(this._chunks, { type }), ext: /mp4/.test(type) ? "mp4" : "webm", type });
        this.recorder = null;
        this._chunks = [];
      };
      if (rec.state !== "inactive") rec.stop();
      else rec.onstop();
    });
  }

  destroy() {
    this.stop();
    try {
      this.room?.destroy();
      this.music?.stop();
      this.stageRec?.stop().catch(() => {});
      this.recorder?.state === "recording" && this.recorder.stop();
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.player = null;
    this.ctx = null;
  }
}

/** Linear resampling, only for a voice that is not at 24 kHz (KittenTTS is). */
export function resample(samples, from, to) {
  if (from === to) return samples;
  const n = Math.round((samples.length * to) / from);
  const out = new Float32Array(n);
  const k = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * k;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (samples[j] || 0) * (1 - f) + (samples[j + 1] || 0) * f;
  }
  return out;
}
