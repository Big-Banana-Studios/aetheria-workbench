// Read-aloud: Kokoro-82M in Mira's TTS worker, sentences split as they go
// (Mira's splitter), scheduled through Mira's worklet-backed player. One
// pinned voice per desk - Mira's own for Mira, the Reader's best British voice
// for everything else - and think blocks, code and markdown never reach it.
//
// A long reply is many chunks: sentences, and long sentences cut at a clause
// (Kokoro keeps about 510 phonemes and silently drops the rest). `speaking`
// stays true until the last chunk has played or failed, even when the
// synthesis runs behind the playback and the player goes dry in between; a
// chunk the worker never answers for trips a watchdog that drops the worker
// so the next reply reloads it instead of staying silent for good.

import { Player } from "./audio/player.js";
import { spokenSpelling } from "./spelling.js";
import { SentenceSplitter } from "./splitter.js";
import { stripThink } from "./think.js";
import { decodeWav } from "./openmic/wav.js";

const MAX_CHUNK = 240; // characters per chunk handed to Kokoro
const STALL_MS = 90000; // the worker owes chunks and has said nothing for this long: it is stuck
const QWEN_TTL = 30000; // how long a probe of the Qwen voice (up or down) is trusted before asking again
const QWEN_AHEAD = 6; // sentences in flight to the PC's voice server at once (it batches them on the GPU: six ran at 1.8x real time on the 4090 where one ran at 0.5x); the phone's runtime takes one at a time
const QWEN_LEAD_MAX = 10000; // the longest a reply waits for a lead before it starts anyway, ms
const WORD_SECONDS = 0.42; // a first guess at a word of hers, before the reply's own clips say

// ./native.js pulls Capacitor in and ./lab.js the endpoint rules: both are loaded on first use, so the Node checks can import this file as before
let _native = null;
async function nativeApi() {
  if (!_native) _native = (await import("./native.js")).native;
  return _native;
}
async function labFetchFn() {
  return (await import("./lab.js")).labFetch;
}

/** Linear resampling: a clip that is not 24 kHz, or a slower read (the phone's Qwen clip stretched, as the PC server does). */
function resampleLinear(samples, from, to) {
  if (from === to || !samples.length) return samples;
  const n = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.min(samples.length - 1, Math.floor(x));
    const k = Math.min(samples.length - 1, j + 1);
    const f = x - j;
    out[i] = samples[j] * (1 - f) + samples[k] * f;
  }
  return out;
}

export class Speech extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.worker = null;
    // Mira's Qwen3-TTS voice (Bella, cloned; the audition's pick): the PC's tools/qwen_tts_server.py or the phone's llama-tts.
    // Probed on demand and remembered for a while; Kokoro is the fallback whenever it is not there or a clip fails.
    this.qwen = { ok: false, kind: null, checkedAt: 0, error: "" };
    this.lastEngine = null; // "qwen" | "kokoro": what made the last clip (tests, diagnostics)
    this._qwenAbort = null;
    this.player = new Player({
      sampleRate: 24000,
      onChunkStart: (id, seq) => this.emit("sentence", { id, seq }),
      onChunkEnd: (id) => {
        if (id === this.id) this.pending = Math.max(0, this.pending - 1);
      },
      onDrained: () => this._maybeIdle(),
    });
    this.kokoroReady = false;
    this._loading = null;
    this.voices = {};
    this.voice = settings.voices.default;
    this.speaking = false;
    this.id = 0;
    this.pending = 0; // chunks of this turn not yet played (or failed)
    this._sent = 0; // chunks posted to the worker this turn
    this._synth = 0; // chunks the worker answered this turn, audio or error
    this._watch = 0;
    this._settle = 0;
    this._synths = new Map(); // id -> {resolve, reject}: clips asked for one at a time by the stage (synth), outside a turn
    this._synthId = 1e9;
    if (typeof document !== "undefined") {
      // the phone suspends the output while the app is away; bring it back
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && this.player.ctx?.state === "suspended") this.player.ctx.resume().catch(() => {});
      });
    }
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /** A voice is ready: Kokoro loaded, or the Qwen engine answered lately. */
  get ready() {
    return this.kokoroReady || (this.qwen.ok && Date.now() - this.qwen.checkedAt < QWEN_TTL);
  }

  /** Whether the Qwen voice is wanted for `purpose` ("stage": clips rendered ahead; "reply": live speech), by Settings → Voice → engine. */
  _wantQwen(purpose) {
    const e = this.settings.ttsEngine || "auto";
    if (e === "kokoro") return false;
    if (e === "qwen") return true;
    return purpose === "stage";
  }

  /** Is the Qwen voice there? The phone's runtime (llama-tts and a model pair) or the PC's server; the answer is kept for a while. */
  async _qwenCheck() {
    if (Date.now() - this.qwen.checkedAt < QWEN_TTL) return this.qwen.ok;
    let ok = false;
    let kind = null;
    let error = "";
    try {
      const native = await nativeApi();
      if (native.isApp()) {
        // the phone's shell: llama-tts. The PC runtime has no voice; its Qwen server (below) does
        const st = await native.ttsStatus(this.settings.native?.ttsModel || "");
        ok = !!st.ready;
        kind = "native";
        error = st.error || "";
      } else {
        const url = String(this.settings.qwenUrl || "").replace(/\/+$/, "");
        if (url) {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 2500);
          try {
            const r = await (await labFetchFn())(`${url}/health`, { signal: ctl.signal });
            const j = await r.json();
            ok = !!j.ok;
            kind = "server";
            error = j.error || "";
          } finally {
            clearTimeout(t);
          }
        }
      }
    } catch (e) {
      error = e.message;
    }
    const was = this.qwen.ok;
    this.qwen = { ok, kind, checkedAt: Date.now(), error };
    if (ok !== was) this.emit("engine", { qwen: ok, kind, error });
    return ok;
  }

  /** One clip through the Qwen voice: {samples (24 kHz), sampleRate, ms}. Throws when it fails; the caller falls back to Kokoro. */
  async _qwenSynth(text, { speed = 1, signal = null } = {}) {
    const t0 = performance.now();
    let samples;
    let rate;
    if (this.qwen.kind === "native") {
      const r = await (await nativeApi()).tts({ text, model: this.settings.native?.ttsModel || "", backend: this.settings.native?.ttsBackend || "cpu" });
      const bin = atob(r.wav);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      ({ samples, sampleRate: rate } = decodeWav(buf.buffer));
    } else {
      const url = String(this.settings.qwenUrl || "").replace(/\/+$/, "");
      const r = await (await labFetchFn())(`${url}/v1/audio/speech`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: text, voice: "bella", speed }), signal });
      if (!r.ok) throw new Error(`voice server ${r.status}`);
      ({ samples, sampleRate: rate } = decodeWav(await r.arrayBuffer()));
      speed = 1; // the server applied it
    }
    if (rate !== 24000) {
      samples = resampleLinear(samples, rate, 24000);
      rate = 24000;
    }
    if (Math.abs(speed - 1) > 0.01) samples = resampleLinear(samples, 24000 * speed, 24000); // the phone's clip: a slower read by stretching, as the server does
    return { samples, sampleRate: 24000, ms: Math.round(performance.now() - t0) };
  }

  /** Bring the voice up (downloads Kokoro the first time). */
  ensure() {
    if (this.kokoroReady) return Promise.resolve();
    if (this._loading) return this._loading;
    this._loading = (async () => {
      await this.player.unlock();
      await new Promise((resolve, reject) => {
        this.worker = new Worker(new URL("./workers/tts.worker.js", import.meta.url), { type: "module" });
        this.worker.onmessage = ({ data }) => {
          switch (data.type) {
            case "progress":
              this._armWatch();
              this.emit("download", data);
              break;
            case "info":
              this._armWatch();
              this.emit("info", data.message);
              break;
            case "ready":
              this.kokoroReady = true;
              this.voices = data.voices || {};
              if (!this.voices[this.voice]) this.voice = data.voice;
              this.emit("ready", data);
              resolve();
              break;
            case "audio":
              if (data.id === this.id) {
                this._synth++;
                this._armWatch();
                this.player.enqueue(data.id, data.seq, data.audio);
              } else if (this._synths.has(data.id)) {
                this._synths.get(data.id).resolve({ samples: data.audio, sampleRate: data.sampleRate || 24000, ms: data.ms });
                this._synths.delete(data.id);
              }
              break;
            case "error":
              if (!this.ready) reject(new Error(data.message));
              else if (this._synths.has(data.id)) {
                this._synths.get(data.id).reject(new Error(data.message));
                this._synths.delete(data.id);
              } else {
                if (data.id === this.id) {
                  // that chunk is not coming; the rest still plays
                  this._synth++;
                  this.pending = Math.max(0, this.pending - 1);
                  this._armWatch();
                  this._maybeIdle();
                }
                this.emit("error", data.message);
              }
              break;
          }
        };
        this.worker.onerror = (e) => reject(new Error(e.message || "voice worker failed"));
        const device = this.settings.ttsDevice === "cpu" || !("gpu" in navigator) ? "wasm" : "webgpu";
        this.worker.postMessage({ type: "load", engine: "kokoro", device, voice: this.voice, speed: this.settings.ttsSpeed });
      });
    })();
    this._loading.catch(() => {
      this._loading = null;
    });
    return this._loading;
  }

  /** Say a reply. `voice` is a Kokoro id; falls back to the desk default. With the Qwen engine chosen for replies, Bella's clone reads it sentence by sentence instead. */
  async speak(text, voice = null) {
    const clean = cleanForSpeech(text);
    if (!clean) return;
    if (this._wantQwen("reply") && (await this._qwenCheck())) return this._speakQwen(clean);
    await this.ensure();
    this.stop();
    if (this.player.ctx?.state === "suspended") await this.player.ctx.resume().catch(() => {});
    if (voice && voice !== this.voice) this.setVoice(voice);
    this.id++;
    const id = this.id;
    let seq = 0;
    this.pending = 0;
    this._sent = 0;
    this._synth = 0;
    const say = (s) => {
      this.pending++;
      this._sent++;
      this.worker.postMessage({ type: "say", id, seq: seq++, text: s });
    };
    const splitter = new SentenceSplitter(
      (s) => {
        for (const c of chunkLong(s)) say(c);
      },
      { minChars: 12 },
    );
    splitter.push(clean);
    splitter.close();
    if (!this._sent) return;
    this.lastEngine = "kokoro";
    this.speaking = true;
    this._armWatch();
    this.emit("speaking");
  }

  /**
   * The reply through the Qwen voice, the way Kokoro flows: the sentences
   * are rendered ahead, several in flight at once on the PC (the server
   * batches them on the GPU; the phone's runtime takes one at a time),
   * handed to the player in order, and the player is held back until the
   * lead covers the shortfall: from the throughput so far (audio seconds
   * per wall second) and the words still to render, the seconds of audio
   * that must be in hand before the rest can keep up, capped at
   * QWEN_LEAD_MAX. Faster than real time (a batching server) means no wait
   * at all. stop() aborts what is in flight. A failed sentence is skipped;
   * if the engine fails outright the reply is read by Kokoro instead.
   * `qwenStats` says what happened, for the diagnostics and the checks.
   */
  async _speakQwen(clean) {
    await this.player.unlock();
    this.stop();
    if (this.player.ctx?.state === "suspended") await this.player.ctx.resume().catch(() => {});
    this.id++;
    const id = this.id;
    const parts = [];
    const splitter = new SentenceSplitter(
      (s) => {
        for (const c of chunkLong(s)) parts.push(c);
      },
      { minChars: 12 },
    );
    splitter.push(clean);
    splitter.close();
    if (!parts.length) return;
    this.pending = parts.length;
    this._sent = parts.length;
    this._synth = 0;
    this.lastEngine = "qwen";
    this.speaking = true;
    this._armWatch();
    this.emit("speaking");
    const ctl = (this._qwenAbort = new AbortController());
    const ahead = this.qwen.kind === "server" ? QWEN_AHEAD : 1;
    const speed = this.settings.ttsSpeed ?? 1;
    const wordsOf = (s) => s.split(/\s+/).filter(Boolean).length;
    const totalWords = parts.reduce((a, p) => a + wordsOf(p), 0);
    const t0 = performance.now();
    const stats = (this.qwenStats = { ahead, parts: parts.length, rendered: 0, renderedSeconds: 0, renderedWords: 0, leadMs: 0, rate: 0, need: 0, order: [], failed: 0 });
    const done = new Map(); // seq -> samples, or null for a failed one, until its turn
    let next = 0; // the next seq the player gets
    let seqNext = 0; // the next seq to ask for
    let inflight = 0;
    // what is ready goes to the player, in order
    const flush = () => {
      while (done.has(next)) {
        const s = done.get(next);
        done.delete(next);
        if (s) {
          this.player.enqueue(id, next, s);
          stats.order.push(next);
        }
        next++;
      }
    };
    // enough of a lead? Always once playing or once everything is in; otherwise from the throughput so far
    const leadOk = () => {
      if (next > 0 || this._synth >= parts.length) return true;
      const elapsed = (performance.now() - t0) / 1000;
      const rate = (stats.rate = stats.renderedSeconds / Math.max(0.5, elapsed));
      if (rate >= 1) return true;
      const perWord = stats.renderedWords ? stats.renderedSeconds / stats.renderedWords : WORD_SECONDS;
      const remaining = (totalWords - stats.renderedWords) * perWord;
      stats.need = remaining * (1 / Math.max(rate, 0.05) - 1);
      const ok = stats.renderedSeconds >= stats.need || elapsed * 1000 >= QWEN_LEAD_MAX;
      if (!ok) this.emit("buffering", { seconds: stats.renderedSeconds, need: stats.need });
      return ok;
    };
    const release = () => {
      if (!leadOk()) return;
      if (next === 0) {
        stats.leadMs = Math.round(performance.now() - t0);
        this.emit("buffering", { done: true, seconds: stats.renderedSeconds });
      }
      flush();
    };
    const pump = () => {
      const limit = seqNext === 0 ? 1 : ahead; // the first sentence alone, for the quickest start; then the window
      while (inflight < limit && seqNext < parts.length && id === this.id && !ctl.signal.aborted) {
        const seq = seqNext++;
        inflight++;
        this._qwenSynth(parts[seq], { speed, signal: ctl.signal })
          .then((r) => {
            if (id !== this.id) return;
            stats.rendered++;
            stats.renderedSeconds += r.samples.length / 24000;
            stats.renderedWords += wordsOf(parts[seq]);
            done.set(seq, r.samples);
          })
          .catch(async (e) => {
            if (id !== this.id || ctl.signal.aborted) return;
            stats.failed++;
            done.set(seq, null);
            this.pending = Math.max(0, this.pending - 1);
            if (stats.failed === 1 && seq === 0) {
              // the engine is down: the whole reply goes to Kokoro instead
              this.qwen = { ...this.qwen, ok: false, error: e.message };
              this.emit("info", `the Qwen voice failed (${e.message}); Kokoro reads this one`);
              this.speaking = false;
              const rest = parts.join(" ");
              this.settings.ttsEngine === "qwen" ? await this._speakKokoro(rest) : await this.speak(rest);
              return;
            }
            this.emit("error", `voice: ${e.message}`);
          })
          .finally(() => {
            if (id !== this.id) return;
            inflight--;
            this._synth++;
            this._armWatch();
            release();
            this._maybeIdle();
            pump();
          });
      }
    };
    pump();
  }

  /** Kokoro, regardless of the engine setting (the fallback path). */
  async _speakKokoro(clean) {
    const saved = this.settings.ttsEngine;
    this.settings.ttsEngine = "kokoro";
    try {
      await this.speak(clean);
    } finally {
      this.settings.ttsEngine = saved;
    }
  }

  /**
   * One clip, for the stage: the samples of `text` in `voice` at `speed`,
   * not played. Through the Qwen voice straight away (several at once are
   * fine: the PC's server batches them; see synthAhead); through Kokoro
   * serialised, so the worker's speed and voice are the ones asked for.
   * `cancel` (stop) throws the Kokoro queue away, so a pending clip is
   * rejected then; the caller asks again.
   */
  async synth(text, voice = null, { speed = null } = {}) {
    const clean = cleanForSpeech(text);
    if (!clean) return { samples: new Float32Array(0), sampleRate: 24000, ms: 0 };
    if (this._wantQwen("stage") && (await this._qwenCheck())) {
      // Bella's clone for the stage: rendered ahead and cached by the caller, so slower than real time is fine
      try {
        const r = await this._qwenSynth(clean, { speed: speed ?? this.settings.ttsSpeed ?? 1 });
        this.lastEngine = "qwen";
        return r;
      } catch (e) {
        this.qwen = { ...this.qwen, ok: false, error: e.message };
        this.emit("info", `the Qwen voice failed (${e.message}); Kokoro instead`);
      }
    }
    const run = async () => {
      await this.ensure();
      this.lastEngine = "kokoro";
      if (voice && voice !== this.voice) this.setVoice(voice);
      const want = speed ?? this.settings.ttsSpeed ?? 1;
      if (want !== this._speed) {
        this.setSpeed(want);
        this._speed = want;
      }
      const id = ++this._synthId;
      return new Promise((resolve, reject) => {
        this._synths.set(id, { resolve, reject });
        this.worker.postMessage({ type: "say", id, seq: 0, text: clean });
      });
    };
    this._synthQueue = (this._synthQueue || Promise.resolve()).then(run, run);
    return this._synthQueue;
  }

  /** How many stage clips may be asked for at once: the PC's voice server batches, so several; Kokoro and the phone's runtime take one at a time. */
  synthAhead() {
    return this._wantQwen("stage") && this.qwen.ok && this.qwen.kind === "server" ? QWEN_AHEAD : 1;
  }

  stop() {
    clearTimeout(this._watch);
    clearTimeout(this._settle);
    this.pending = 0;
    this._sent = 0;
    this._synth = 0;
    this._qwenAbort?.abort();
    this._qwenAbort = null;
    for (const [id, p] of this._synths) {
      p.reject(new Error("cancelled"));
      this._synths.delete(id);
    }
    this.worker?.postMessage({ type: "cancel" });
    this.player.stop();
    this.id++;
    if (this.speaking) {
      this.speaking = false;
      this.emit("idle");
    }
  }

  setVoice(v) {
    this.voice = v;
    this.worker?.postMessage({ type: "set_voice", voice: v });
  }

  setSpeed(v) {
    this.worker?.postMessage({ type: "set_speed", speed: v });
  }

  /** Idle once every chunk of the turn has played or failed; a dry player mid-turn is the synthesis running behind. */
  _maybeIdle() {
    if (!this.speaking) return;
    if (this.pending <= 0) return this._finish();
    if (this._synth < this._sent) return; // the worker still owes chunks; the player fills again when they come
    // everything is synthesized yet something still counts as pending: a chunk may be in flight to the player, so give it a moment
    clearTimeout(this._settle);
    this._settle = setTimeout(() => {
      if (this.speaking && !this.player.playing && this._synth >= this._sent) this._finish();
    }, 1500);
  }

  _finish() {
    clearTimeout(this._watch);
    clearTimeout(this._settle);
    this.pending = 0;
    this.speaking = false;
    this.emit("idle");
  }

  /** While the worker owes chunks, a long silence from it means it is stuck: drop it, and the next reply reloads it. */
  _armWatch() {
    clearTimeout(this._watch);
    if (!this.speaking || this._synth >= this._sent) return;
    this._watch = setTimeout(() => {
      if (!this.speaking || this._synth >= this._sent) return;
      this.emit("error", "the voice stopped answering; it reloads on the next reply");
      this._dropWorker();
      this._finish();
    }, STALL_MS);
  }

  _dropWorker() {
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
    this.kokoroReady = false;
    this._loading = null;
    this.player.stop();
  }
}

/** Kokoro keeps about 510 phonemes of a chunk: a long sentence is cut at a clause, else at a space. Nothing is lost. */
export function chunkLong(sentence, max = MAX_CHUNK) {
  const out = [];
  let rest = String(sentence || "").trim();
  while (rest.length > max) {
    const win = rest.slice(0, max);
    let cut = -1;
    for (const sep of [", ", "; ", ": ", " — ", " – ", ") ", " - "]) cut = Math.max(cut, win.lastIndexOf(sep));
    if (cut < max * 0.4) cut = win.lastIndexOf(" ");
    if (cut < max * 0.4) cut = max - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Markdown and code out; prose in. Never a think block, never an emoji. */
/**
 * Markdown emphasis and stage directions, gone before the phonemizer sees
 * them (it says "asterisk" for every stray star). A starred fragment that
 * stands on its own as a sentence (*sighs*, *takes a drag*: the model's
 * action beats, which the persona forbids and nobody wants read out) is
 * dropped whole; emphasis inside a sentence keeps its words. Nested and
 * mismatched markers, underscores inside names (Qwen3_8B) and an unclosed
 * star are all handled, so no asterisk or underscore is left to be read.
 */
export function stripEmphasis(t) {
  // an action beat: starred, alone between sentence ends (or the text's ends), short, no sentence of its own inside
  const beat = /(^|[.!?…]["')\]]?[ \t]+|\n[ \t]*)\*{1,2}[ \t]*([^*\n]{1,80}?)[ \t]*\*{1,2}(?=[ \t]*(?:$|\n|[.!?,;:]|[A-Z"'(]))/gm;
  t = t.replace(beat, (m, lead, inner) => (/[.!?]\s+\S/.test(inner) ? m : lead));
  // underscores joining letters and digits are separators, not emphasis: Qwen3_8B reads as "Qwen3 8B"
  t = t.replace(/(?<=[\p{L}\p{N}])_+(?=[\p{L}\p{N}])/gu, " ");
  // paired markers, innermost first, the same run closing what opened it
  const pair = /(\*{1,3}|_{1,3})(?=\S)([^*_]+?)(?<=\S)\1/g;
  for (let i = 0; i < 6 && pair.test(t); i++) t = t.replace(pair, "$2");
  t = t.replace(/~~([^~]+)~~/g, "$1").replace(/==([^=]+)==/g, "$1");
  // arithmetic keeps its meaning
  t = t.replace(/(?<=\d)\s*\*\s*(?=\d)/g, " times ");
  // whatever is left unpaired is noise
  t = t.replace(/\*+/g, "").replace(/(?<!\S)_+|_+(?!\S)/g, "");
  return t;
}

export function cleanForSpeech(md) {
  let t = stripThink(md);
  t = t.replace(/```[\s\S]*?```/g, " Code block omitted. ");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  t = t.replace(/^\s*>\s?/gm, "");
  t = t.replace(/^\s*\|?[\s:|-]+\|\s*$/gm, ""); // table rules
  t = t.replace(/\|/g, ", ");
  t = stripEmphasis(t);
  t = spokenSpelling(t); // goddamn → god-damn: the two beats she means
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, " $1 ").replace(/\\\[([\s\S]*?)\\\]/g, " $1 ").replace(/\\\(([\s\S]*?)\\\)/g, " $1 ");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{200D}\u{20E3}]/gu, ""); // emoji: the phonemizer has nothing to say for them
  t = t.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  return t;
}
