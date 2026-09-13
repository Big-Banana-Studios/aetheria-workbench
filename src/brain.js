// The brains, in the brief's priority order: the lab (any OpenAI-compatible
// endpoint, LiteLLM on the Olares by default), then the on-device Gemma 4 E2B
// when the LAN box cannot be reached. Auto-detect on boot; the chip in the
// header says which one is live. Every turn streams; think tokens are split
// off here so the transcript can fold them away and the voice never reads them.

import { endpoints, saveSettings } from "./settings.js";
import { listModels, streamChat, explainFetchError, blockedByMixedContent } from "./lab.js";
import { ThinkParser } from "./think.js";
import { native } from "./native.js";

export class Brain extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.live = "none"; // lab | native | device | none
    this.info = { model: null, latency: null, models: [], labError: null, nativeError: null, native: null, gpu: null, deviceStatus: "idle" };
    this.stats = { firstTokenMs: null, tokPerSec: null, totalMs: null, tokens: null, lastError: null, at: null };
    this.worker = null;
    this._workerReady = null;
    this._turn = null;
    this.abort = null;
    this.busy = false;
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /** Which brain answers: the lab, then the in-app runtime, then the device. */
  async detect() {
    const s = this.settings;
    const e = endpoints(s.lab.url);
    this.info.labError = null;
    this.info.nativeError = null;
    if (s.brain !== "device" && s.brain !== "native" && e) {
      if (blockedByMixedContent(s.lab.url)) {
        // an https page and a plain http box this browser will not relax for (lab.js); loopback and, in Chrome, the LAN go through
        this.info.labError = "mixed content: this https page cannot call a plain http endpoint in this browser (see Diagnostics)";
      } else {
        try {
          const { ids, ms } = await listModels({ models: e.models, apiKey: s.lab.apiKey, timeoutMs: 4000 });
          this.info.models = ids;
          this.info.latency = ms;
          if (!s.lab.model && ids.length) {
            s.lab.model = ids[0];
            saveSettings(s);
          }
          this.live = "lab";
          this.info.model = s.lab.model;
          this.emit("status", this.status());
          return this.status();
        } catch (err) {
          this.info.labError = explainFetchError(err, e.models);
        }
      }
    } else if (s.brain !== "device" && s.brain !== "native" && !e) {
      this.info.labError = "no endpoint set";
    }
    // the in-app runtime (the Android shell): llama-server on 127.0.0.1
    if (s.brain !== "lab" && s.brain !== "device" && native.available()) {
      try {
        const st = await native.ensureServer(s.native);
        const base = native.base(st.port || s.native.port);
        const { ids, ms } = await listModels({ models: `${base}/models`, apiKey: "none", timeoutMs: 8000 });
        this.info.native = { port: st.port || s.native.port, model: st.model, models: ids };
        this.info.latency = ms;
        this.live = "native";
        this.info.model = st.model || ids[0] || "llama-server";
        this.emit("status", this.status());
        return this.status();
      } catch (err) {
        this.info.nativeError = String(err?.message || err);
      }
    } else if (s.brain === "native" && !native.available()) {
      this.info.nativeError = "the in-app runtime is only in the Android app";
    }
    if (s.brain === "lab" || s.brain === "native") {
      this.live = "none";
      this.info.model = null;
      this.emit("status", this.status());
      return this.status();
    }
    const gpu = await checkWebGPU();
    this.info.gpu = gpu;
    this.live = gpu.ok ? "device" : "none";
    this.info.model = gpu.ok ? "Gemma 4 E2B" : null;
    this.emit("status", this.status());
    return this.status();
  }

  status() {
    return { live: this.live, model: this.info.model, latency: this.info.latency, labError: this.info.labError, nativeError: this.info.nativeError, native: this.info.native, gpu: this.info.gpu, deviceStatus: this.info.deviceStatus, models: this.info.models };
  }

  /** The endpoint a lab-style turn goes to: the LAN box, or the in-app server. */
  _wire() {
    const s = this.settings;
    if (this.live === "native") {
      const base = native.base(this.info.native?.port || s.native?.port || 8080);
      return { chat: `${base}/chat/completions`, apiKey: "none", model: this.info.native?.model || this.info.model };
    }
    const e = endpoints(s.lab.url);
    return { chat: e.chat, apiKey: s.lab.apiKey, model: s.lab.model };
  }

  /** The Test connection button: hit /v1/models, report latency and the list. */
  async test() {
    const s = this.settings;
    const e = endpoints(s.lab.url);
    if (!e) return { ok: false, error: "No endpoint set." };
    if (blockedByMixedContent(s.lab.url)) return { ok: false, error: explainFetchError(new TypeError("Failed to fetch"), e.models), mixed: true };
    try {
      const { ids, ms } = await listModels({ models: e.models, apiKey: s.lab.apiKey, timeoutMs: 8000 });
      this.info.models = ids;
      this.info.latency = ms;
      return { ok: true, ms, models: ids };
    } catch (err) {
      return { ok: false, error: explainFetchError(err, e.models) };
    }
  }

  /** True if the current brain can look at an image. */
  get canSee() {
    return this.live !== "none";
  }

  /**
   * One turn. `messages` are {role, content:string}; `image` is
   * {dataUrl, imageData} or null and rides on the last user message.
   * Resolves {text, reasoning, interrupted}. Streams through onDelta/onReasoning.
   */
  async chat({ messages, image = null, images = null, thinking = null, onDelta, onReasoning, temperature, maxTokens }) {
    const pics = images?.length ? images : image ? [image] : [];
    image = pics[0] || null;
    if (this.busy) throw new Error("a turn is already running; press Esc to stop it");
    if (this.live === "none") {
      const why = [this.info.labError && `lab: ${this.info.labError}`, this.info.nativeError && `in-app: ${this.info.nativeError}`, `on-device: ${this.info.gpu?.reason || "no WebGPU"}`].filter(Boolean).join("; ");
      throw new Error(`No brain is live (${why}). Set an endpoint in Settings, or use a WebGPU browser for the on-device model.`);
    }
    this.busy = true;
    this.abort = new AbortController();
    const t0 = performance.now();
    this.stats = { firstTokenMs: null, tokPerSec: null, totalMs: null, tokens: null, lastError: null, at: Date.now(), brain: this.live };
    let visible = "";
    let reasoning = "";
    const parser = new ThinkParser(
      (t) => {
        visible += t;
        onDelta?.(t);
      },
      (r) => {
        reasoning += r;
        onReasoning?.(r);
      },
    );
    try {
      if (this.live === "lab" || this.live === "native") {
        const s = this.settings;
        const w = this._wire();
        const r = await streamChat({
          chat: w.chat,
          apiKey: w.apiKey,
          model: w.model,
          messages: toOpenAI(messages, pics),
          signal: this.abort.signal,
          onDelta: (c) => parser.push(c),
          onReasoning: (c) => {
            reasoning += c;
            onReasoning?.(c);
          },
          temperature: temperature ?? s.temperature,
          maxTokens: maxTokens ?? s.maxTokens,
          thinking,
          thinkSwitch: s.thinkSwitch,
        });
        parser.close();
        const tokens = r.usage?.completion_tokens ?? r.chunks;
        this.stats.firstTokenMs = r.firstTokenMs;
        this.stats.totalMs = r.ms;
        this.stats.tokens = tokens;
        this.stats.tokPerSec = r.decodeMs && tokens > 1 ? +((tokens - 1) / (r.decodeMs / 1000)).toFixed(1) : null;
        this.stats.usage = r.usage || null;
        return { text: visible.trim(), reasoning: reasoning.trim(), interrupted: false, finish: r.finish };
      }
      // on-device
      await this.ensureWorker();
      const r = await this._deviceTurn({ messages, image, thinking, temperature: temperature ?? this.settings.temperature, maxTokens: maxTokens ?? this.settings.maxTokens, onDelta: (c) => parser.push(c) });
      parser.close();
      this.stats.firstTokenMs = r.firstTokenMs;
      this.stats.totalMs = Math.round(performance.now() - t0);
      this.stats.tokens = r.tokens;
      this.stats.tokPerSec = r.firstTokenMs != null && r.tokens > 1 ? +((r.tokens - 1) / ((this.stats.totalMs - r.firstTokenMs) / 1000)).toFixed(1) : null;
      return { text: visible.trim(), reasoning: reasoning.trim(), interrupted: r.interrupted };
    } catch (e) {
      if (e.name === "AbortError") {
        parser.close();
        return { text: visible.trim(), reasoning: reasoning.trim(), interrupted: true };
      }
      this.stats.lastError = String(e.message || e);
      this.emit("error", this.stats.lastError);
      throw e;
    } finally {
      this.busy = false;
      this.abort = null;
      this.emit("stats", this.stats);
    }
  }

  stop() {
    this.abort?.abort();
    this.worker?.postMessage({ type: "interrupt" });
  }

  // ---------------------------------------------------------------- device

  ensureWorker() {
    if (this._workerReady) return this._workerReady;
    this.info.deviceStatus = "loading";
    this.emit("status", this.status());
    this._workerReady = new Promise((resolve, reject) => {
      this.worker = new Worker(new URL("./workers/llm.worker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = ({ data }) => {
        switch (data.type) {
          case "progress":
            this.emit("download", data);
            break;
          case "info":
            this.emit("info", data.message);
            break;
          case "ready":
            this.info.deviceStatus = "ready";
            this.info.model = `Gemma 4 E2B ${data.dtype}`;
            this.emit("status", this.status());
            resolve();
            break;
          case "first_token":
            if (this._turn && this._turn.id === data.id) this._turn.first = performance.now();
            break;
          case "token":
            if (this._turn && this._turn.id === data.id) this._turn.onDelta(data.text);
            break;
          case "done":
            if (this._turn && this._turn.id === data.id) {
              const t = this._turn;
              this._turn = null;
              t.resolve({ tokens: data.tokens, interrupted: data.interrupted, firstTokenMs: t.first ? Math.round(t.first - t.t0) : null });
            }
            break;
          case "error":
            if (data.id != null && this._turn && this._turn.id === data.id) {
              const t = this._turn;
              this._turn = null;
              t.reject(new Error(data.message));
            } else if (this.info.deviceStatus === "loading") {
              this.info.deviceStatus = "failed";
              this._workerReady = null;
              this.emit("status", this.status());
              reject(new Error(data.message));
            } else this.emit("error", data.message);
            break;
        }
      };
      this.worker.onerror = (e) => {
        this.info.deviceStatus = "failed";
        this._workerReady = null;
        reject(new Error(e.message || "model worker failed"));
      };
      const gpu = this.info.gpu || { ok: true, f16: true };
      this.worker.postMessage({ type: "load", dtype: gpu.f16 === false ? "q4" : "q4f16", device: "webgpu" });
    });
    return this._workerReady;
  }

  _deviceTurn({ messages, image, thinking, temperature, maxTokens, onDelta }) {
    return new Promise((resolve, reject) => {
      const id = Date.now();
      this._turn = { id, resolve, reject, onDelta, t0: performance.now(), first: null };
      const img = image?.imageData ? { data: image.imageData.data, width: image.imageData.width, height: image.imageData.height } : null;
      this.worker.postMessage({ type: "turn", id, messages, image: img, thinking: !!thinking, temperature, maxNewTokens: Math.min(maxTokens || 1024, 2048) });
    });
  }
}

/** Our message list to the wire format; the images go on the last user turn. */
function toOpenAI(messages, images = []) {
  const out = messages.map((m) => ({ role: m.role, content: m.content }));
  const pics = (images || []).filter((p) => p?.dataUrl);
  if (pics.length) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role !== "user") continue;
      out[i].content = [{ type: "text", text: out[i].content }, ...pics.map((p) => ({ type: "image_url", image_url: { url: p.dataUrl } }))];
      break;
    }
  }
  return out;
}

export async function checkWebGPU() {
  if (!("gpu" in navigator)) return { ok: false, reason: "no WebGPU in this browser (Chrome or Edge on desktop; Chrome 121+ on Android)" };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: "WebGPU is present but no adapter was found" };
    return { ok: true, f16: adapter.features.has("shader-f16") };
  } catch (e) {
    return { ok: false, reason: `WebGPU error: ${e.message}` };
  }
}
