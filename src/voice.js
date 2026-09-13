// Voice input: Silero VAD finds the utterance, Moonshine transcribes it, the
// words land in the composer. Both workers are Mira's, unchanged. Push to
// talk by default (hold the mic button); hands-free in Settings.

import { Mic } from "./audio/mic.js";
import { vadThresholds } from "./settings.js";

export class VoiceInput extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.vad = null;
    this.stt = null;
    this.mic = null;
    this.ready = false;
    this._loading = null;
    this.listening = false;
    this._pending = new Map();
    this._id = 0;
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  ensure() {
    if (this.ready) return Promise.resolve();
    if (this._loading) return this._loading;
    this._loading = (async () => {
      const gpu = "gpu" in navigator && navigator.gpu ? "webgpu" : "wasm";
      const vadReady = new Promise((resolve, reject) => {
        this.vad = new Worker(new URL("./workers/vad.worker.js", import.meta.url), { type: "module" });
        this.vad.onmessage = ({ data }) => {
          switch (data.type) {
            case "progress":
              this.emit("download", data);
              break;
            case "ready":
              resolve();
              break;
            case "speech_start":
              this.emit("speech_start");
              break;
            case "speech_end":
              this.emit("speech_end", data.seconds);
              this._transcribe(data.audio);
              break;
            case "speech_cancel":
              this.emit("speech_cancel");
              break;
            case "error":
              reject(new Error(data.message));
              this.emit("error", data.message);
              break;
          }
        };
        this.vad.postMessage({ type: "load" });
      });
      const sttReady = new Promise((resolve, reject) => {
        this.stt = new Worker(new URL("./workers/stt.worker.js", import.meta.url), { type: "module" });
        this.stt.onmessage = ({ data }) => {
          switch (data.type) {
            case "progress":
              this.emit("download", data);
              break;
            case "ready":
              resolve();
              break;
            case "transcript": {
              const p = this._pending.get(data.id);
              this._pending.delete(data.id);
              this.emit("transcript", { text: data.text, ms: data.ms });
              p?.(data.text);
              break;
            }
            case "error":
              if (data.id != null) this._pending.delete(data.id);
              reject(new Error(data.message));
              this.emit("error", data.message);
              break;
          }
        };
        this.stt.postMessage({ type: "load", device: gpu, model: this.settings.sttModel || "tiny" });
      });
      await Promise.all([vadReady, sttReady]);
      this.mic = new Mic((chunk) => this.vad?.postMessage({ type: "audio", buffer: chunk }, [chunk.buffer]));
      await this.mic.start();
      this.applySettings();
      this.ready = true;
    })();
    this._loading.catch(() => {
      this._loading = null;
    });
    return this._loading;
  }

  applySettings() {
    const th = vadThresholds(this.settings.sensitivity);
    this.vad?.postMessage({ type: "config", config: { mode: this.settings.voiceInput === "vad" ? "vad" : "ptt", start: th.start, exit: th.exit, barge: th.barge, playing: false } });
  }

  _transcribe(audio) {
    const id = ++this._id;
    this._pending.set(id, null);
    this.stt.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  }

  /** Hands-free: the VAD runs until stop(). */
  async start() {
    await this.ensure();
    this.listening = true;
    this.vad.postMessage({ type: "reset" });
    this.applySettings();
    this.emit("listening", true);
  }

  async pttDown() {
    await this.ensure();
    this.listening = true;
    this.vad.postMessage({ type: "config", config: { mode: "ptt" } });
    this.vad.postMessage({ type: "ptt_down" });
    this.emit("listening", true);
  }

  pttUp() {
    this.vad?.postMessage({ type: "ptt_up" });
    this.listening = false;
    this.emit("listening", false);
  }

  stop() {
    this.listening = false;
    this.vad?.postMessage({ type: "reset" });
    this.emit("listening", false);
  }

  level() {
    return this.mic?.level() || 0;
  }
}
