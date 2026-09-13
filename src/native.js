// The local runtime (phase two). Two places run llama.cpp's server for the
// app, behind one contract here:
//
// - the phone: inside the Capacitor Android shell a native plugin,
//   LlamaServer, runs llama-server as a subprocess (arm64, OpenCL/CPU),
//   bound to 127.0.0.1 (kind "plugin");
// - the PC: tools/pc_runtime.mjs, the Node process that serves the app,
//   runs llama.cpp's own Windows build (CUDA, Vulkan or CPU) the same way and
//   answers under /runtime/<method> on the page's own origin (kind "host").
//
// `probe()` at boot finds which one is here (neither on GitHub Pages or the
// dev server); `available()` says so; `isApp()` is the phone only, for the
// things only the shell does (llama-tts, saving into Downloads).
//
// Contract (android/.../LlamaServerPlugin.java and tools/pc_runtime.mjs):
//   status()                      -> {running, port, model, backend, pid, uptime, foreground, log, download:{name, loaded, total, active}, install? (PC)}
//   listModels()                  -> {dir, models:[{name, path, size, linked?}]}
//   download({url, name})         -> {path, size}; progress through "download" events (plugin) or status().download (both)
//   pickModel()                   -> {name, path, size} or {cancelled}; the system picker; the phone copies the file in, the PC uses it where it is
//   deleteModel({name})           -> {}; a linked file on the PC is only forgotten
//   start({model, port, ctx, backend, args, foreground}) -> {port, model, backend, pid}
//   stop()                        -> {}
//   device()                      -> {soc, ram, gpu, backends:[opencl|vulkan|cpu] (phone) | [cuda|vulkan|cpu] (PC), vram? (PC)}
//   readHead({model, bytes})      -> {data (base64), size, bytes}: the first bytes of a model, its GGUF header, for the launch plan
//   ttsStatus({model?})           -> {ready, binary, model, mmproj, speaker, error}: Mira's voice on the phone (llama-tts); never ready on the PC
//   tts({text, model?, lang?, frames?, backend?}) -> {wav (base64 WAV, 24 kHz), ms}: one clip (phone)
//   PC only: installServer({backend}), cancelInstall(), servers(), setServer({backend, path}), pickServer(), forgetServer({backend}),
//            linkModel({path}), abortDownload(), releases(), openFolder({which})

import { Capacitor, registerPlugin } from "@capacitor/core";
import { parseGgufHead } from "./gguf.js";
import { planLaunch } from "./launch.js";

const LlamaServer = registerPlugin("LlamaServer");
const BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";

export const NATIVE_DEFAULTS = { model: "", port: 8080, ctx: 32768, autoStart: true, backend: "auto", keepAlive: true, loadMode: "auto", cpuMoe: "auto" };

let kind = null; // "plugin" | "host" | null
let hostInfo = null;

/** One call to the PC host: POST /runtime/<method> with a JSON body; the host answers the plugin's shapes, or {error}. */
async function hostCall(method, body = null, { timeoutMs = 0 } = {}) {
  const ctl = timeoutMs ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(`${BASE}runtime/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), signal: ctl?.signal, cache: "no-store" });
    const text = await r.text();
    let j;
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`the runtime host answered ${r.status}: ${text.slice(0, 120)}`);
    }
    if (!r.ok || j.error) throw new Error(j.error || `the runtime host answered ${r.status}`);
    return j;
  } finally {
    if (t) clearTimeout(t);
  }
}

export const native = {
  /** Which runtime is here after probe(): "plugin" (the Android shell), "host" (the PC runtime), or null. */
  get kind() {
    return kind;
  },
  get hostInfo() {
    return hostInfo;
  },
  /** Find the runtime, once, before the brain looks for it. The phone answers at once; the PC host is one short request; elsewhere nothing. */
  async probe() {
    if (kind) return kind;
    try {
      if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("LlamaServer")) return (kind = "plugin");
    } catch {
      /* not the shell */
    }
    if (typeof location === "undefined" || !/^https?:$/.test(location.protocol)) return null;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(`${BASE}runtime/status`, { signal: ctl.signal, cache: "no-store" }).finally(() => clearTimeout(t));
      if (r.ok) {
        const j = await r.json();
        if (j && j.host === "pc") {
          hostInfo = j;
          kind = "host";
        }
      }
    } catch {
      /* no host: GitHub Pages, the dev server, a file */
    }
    return kind;
  },
  available() {
    if (kind) return true;
    try {
      // before probe() ran (or in a test that never boots): the phone's answer is synchronous
      return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("LlamaServer");
    } catch {
      return false;
    }
  },
  /** The Android shell itself (the plugin): llama-tts, Downloads, the foreground service. False on the PC host. */
  isApp() {
    return kind === "plugin" || (kind === null && this.available());
  },
  platform() {
    return Capacitor.getPlatform();
  },
  base(port = 8080) {
    return `http://127.0.0.1:${port}/v1`;
  },
  _call(method, body) {
    if (kind === "host") return hostCall(method, body);
    return LlamaServer[method](body);
  },
  status() {
    return kind === "host" ? hostCall("status") : LlamaServer.status();
  },
  listModels() {
    return kind === "host" ? hostCall("listModels") : LlamaServer.listModels();
  },
  deleteModel(name) {
    return this._call("deleteModel", { name });
  },
  device() {
    return kind === "host" ? hostCall("device") : LlamaServer.device();
  },
  readHead(model, bytes = 1 << 20) {
    return this._call("readHead", { model, bytes });
  },
  stop() {
    return kind === "host" ? hostCall("stop") : LlamaServer.stop();
  },
  start({ model, port = 8080, ctx = 32768, backend = "auto", args = [], foreground = true }) {
    return this._call("start", { model, port, ctx, backend, args, foreground });
  },
  /** Mira's voice on the phone: is llama-tts here with a Qwen3-TTS model pair and Bella's clip? (Never on the PC: the Qwen server there.) */
  ttsStatus(model = "") {
    return this._call("ttsStatus", { model });
  },
  /** A small file into the phone's Downloads/AetheriaWorkbench in one call: {uri, path, bytes}. Big ones go in pieces (below). Phone only. */
  saveDownload: ({ name, mime = "application/octet-stream", data }) => LlamaServer.saveDownload({ name, mime, data }),
  /** A file in pieces: begin -> {id, path}; chunk({id, data}) in order; end({id}) -> {uri, path, bytes} (or end({id, abort: true})). Phone only. */
  downloadBegin: ({ name, mime = "application/octet-stream" }) => LlamaServer.downloadBegin({ name, mime }),
  downloadChunk: ({ id, data }) => LlamaServer.downloadChunk({ id, data }),
  downloadEnd: ({ id, abort = false }) => LlamaServer.downloadEnd({ id, abort }),
  /** One clip of `text` as Bella through llama-tts: {wav: base64 WAV, ms}. Slower than real time; the stage renders ahead and caches. Phone only. */
  tts({ text, model = "", lang = "en", frames = 0, backend = "auto" }) {
    return this._call("tts", { text, model, lang, frames, backend });
  },
  download(url, name, onProgress) {
    return this._withProgress(name, onProgress, () => this._call("download", { url, name }));
  },
  /** A GGUF already on the device: the system picker; the phone copies it into the app's models (the server needs a plain path), the PC uses it in place. */
  pickModel(onProgress) {
    return this._withProgress(null, onProgress, () => (kind === "host" ? hostCall("pickModel") : LlamaServer.pickModel()));
  },
  /** The plugin's "download" events, plus a status poll every second so a missed event never leaves the screen blank; the host has the poll only. */
  async _withProgress(name, onProgress, run) {
    const h = kind === "host" ? null : await LlamaServer.addListener("download", (e) => onProgress?.(e));
    let last = null;
    const timer = setInterval(async () => {
      try {
        const d = (await this.status()).download;
        if (d?.active && (!name || d.name === name)) onProgress?.((last = { ...d, done: false }));
      } catch {
        /* the next tick */
      }
    }, kind === "host" ? 500 : 1000);
    try {
      const r = await run();
      if (kind === "host" && last && onProgress) onProgress({ ...last, loaded: last.total || last.loaded, done: true });
      return r;
    } finally {
      clearInterval(timer);
      h?.remove();
    }
  },
  _heads: new Map(),
  /** The model's size and parsed GGUF header (the first megabyte through the runtime), cached by name. */
  async inspect(model) {
    if (this._heads.has(model)) return this._heads.get(model);
    const { data, size } = await this.readHead(model);
    const bin = atob(data || "");
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const info = { model, size: Number(size) || 0, head: parseGgufHead(u8) };
    this._heads.set(model, info);
    return info;
  },
  /** How this model would be started here with these settings: {backend, ctx, args, load, zone, moe, cpuMoe, ngl, notes, summary} (src/launch.js). */
  async plan(model, prefs = NATIVE_DEFAULTS) {
    const [dev, info] = await Promise.all([this.device().catch(() => null), this.inspect(model).catch((e) => ({ model, size: 0, head: null, error: e.message }))]);
    const plan = planLaunch({ size: info.size, ram: Number(dev?.ram) || 0, vram: Number(dev?.vram) || 0, head: info.head, backends: dev?.backends || [], prefs, pc: kind === "host" });
    if (info.error) plan.notes.unshift(`Could not read the model's header (${info.error}).`);
    else if (info.head?.error) plan.notes.unshift(`The model's header: ${info.head.error}.`);
    return plan;
  },
  /** Plan, then start: the plan's backend, context and flags. Resolves to the start result with the plan attached. */
  async startPlanned(model, prefs = NATIVE_DEFAULTS) {
    const plan = await this.plan(model, prefs);
    const r = await this.start({ model, port: prefs.port || 8080, ctx: plan.ctx, backend: plan.backend, args: plan.args, foreground: prefs.keepAlive !== false });
    return { ...r, plan };
  },
  /** Running server, or start one with the preferred (else the first) model. */
  async ensureServer(prefs = NATIVE_DEFAULTS) {
    const st = await this.status();
    if (st.running) return st;
    const { models } = await this.listModels();
    const brains = models.filter((m) => !/tts/i.test(m.name));
    const model = prefs.model && brains.some((m) => m.name === prefs.model) ? prefs.model : brains[0]?.name;
    if (!model) throw new Error(kind === "host" ? "no model on this PC yet: Settings → Local runtime → pick a GGUF on the disk or download one" : "no model downloaded yet: Settings → Native runtime → download a GGUF");
    return this.startPlanned(model, prefs);
  },
  // ---------------------------------------------------------------- the PC host only
  /** llama.cpp's Windows build for a backend from its GitHub releases into the runtime's folder; progress in status().install. */
  installServer(backend, onProgress) {
    return this._withInstallProgress(onProgress, () => hostCall("installServer", { backend }));
  },
  cancelInstall: () => hostCall("cancelInstall"),
  /** The builds on this PC: {builds:[{dir, exe, how, backends, version, tag}], chosen:{backend: path}, installDir}. */
  servers: () => hostCall("servers"),
  releases: () => hostCall("releases"),
  setServer: (backend, path) => hostCall("setServer", { backend, path }),
  pickServer: (backend = "auto") => hostCall("pickServer", { backend }),
  forgetServer: (backend) => hostCall("forgetServer", { backend }),
  /** A GGUF on the PC's disk by path, used where it is. */
  linkModel: (path) => hostCall("linkModel", { path }),
  abortDownload: () => hostCall("abortDownload"),
  openFolder: (which = "models") => hostCall("openFolder", { which }),
  async _withInstallProgress(onProgress, run) {
    const timer = setInterval(async () => {
      try {
        const i = (await this.status()).install;
        if (i?.active) onProgress?.(i);
      } catch {
        /* the next tick */
      }
    }, 500);
    try {
      return await run();
    } finally {
      clearInterval(timer);
    }
  },
};
