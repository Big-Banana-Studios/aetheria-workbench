// The PC runtime host: what the Android shell's LlamaServer plugin is on the
// phone, as a Node process on the PC. It serves the built app from dist/
// (the launcher's job before) and, under /runtime/<method>, the same
// contract src/native.js speaks to the plugin: list, download, link and
// delete GGUF models; read a model's header for the launch plan; start and
// stop a real llama-server.exe (llama.cpp's own Windows build: CUDA, Vulkan
// or CPU) on 127.0.0.1; install one of those builds from llama.cpp's GitHub
// releases; and report the machine (RAM, the card, its memory). The browser
// cannot spawn a process, so this is the part of the PC app that can.
//
//   node tools/pc_runtime.mjs [--port 4173] [--bind 0.0.0.0] [--data <dir>] [--dist dist]
//                             [--server <llama-server.exe>] [--verbose] [--fake-server]
//
// Data lives in %LOCALAPPDATA%\AetheriaWorkbench (models/, llama/<backend>/,
// runtime.json), never in the repo. The static files go to anyone on the
// LAN (the phone can open the PC's app, as vite preview --host allowed); the
// /runtime API answers loopback callers only, from this app's own origin.
// --fake-server (the ui_check) spawns tools/fake_lab.mjs as the "server".

import { createServer } from "node:http";
import { createReadStream, createWriteStream, existsSync, statSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, openSync, readSync, closeSync, rmSync, truncateSync } from "node:fs";
import { join, resolve, basename, dirname, extname, isAbsolute, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

// ---------------------------------------------------------------- pure helpers (tested in tools/smoke.mjs)

/** The backends "auto" tries, in order: the card first, then any GPU through Vulkan, then the CPU. */
export const BACKENDS = ["cuda", "vulkan", "cpu"];
export const RELEASES_API = "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10";

/** Which backends a llama.cpp build carries, from the ggml DLLs beside its llama-server (every build can run on the CPU). */
export function backendsOfFiles(names) {
  const set = new Set(names.map((n) => String(n).toLowerCase()));
  const out = [];
  if (set.has("ggml-cuda.dll") || set.has("libggml-cuda.so")) out.push("cuda");
  if (set.has("ggml-vulkan.dll") || set.has("libggml-vulkan.so")) out.push("vulkan");
  out.push("cpu");
  return out;
}

/** The release zips for a backend on Windows x64, by the release's tag (llama.cpp's naming on 2026-09-13). */
export function releaseAssets(tag, backend, { cuda = "12.4" } = {}) {
  if (backend === "cuda") return [`llama-${tag}-bin-win-cuda-${cuda}-x64.zip`, `cudart-llama-bin-win-cuda-${cuda}-x64.zip`];
  if (backend === "vulkan") return [`llama-${tag}-bin-win-vulkan-x64.zip`];
  if (backend === "cpu") return [`llama-${tag}-bin-win-cpu-x64.zip`];
  throw new Error(`no release build for ${backend}`);
}

/** The newest numbered release (bNNNN) among GitHub's list that ships the Windows Vulkan build: {tag, url, assets:{name: url}}. */
export function pickRelease(list) {
  for (const r of list || []) {
    if (!/^b\d+$/.test(r.tag_name || "")) continue;
    const assets = Object.fromEntries((r.assets || []).map((a) => [a.name, { url: a.browser_download_url, size: a.size }]));
    if (Object.keys(assets).some((n) => /-bin-win-vulkan-x64\.zip$/.test(n))) return { tag: r.tag_name, url: r.html_url, at: r.published_at, assets };
  }
  return null;
}

/**
 * The launch flags for a build: the plan's spellings are the phone's
 * checkout (2026-09-08: `--load-mode none|mmap`); an older build takes
 * `--no-mmap` and nothing for mmap; `--cpu-moe` only where it exists.
 */
export function translateArgs(args, supports) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--load-mode") {
      const v = args[++i];
      if (supports.loadMode) out.push(a, v);
      else if (v === "none") out.push("--no-mmap");
      continue;
    }
    if (a === "--cpu-moe" && !supports.cpuMoe) continue;
    out.push(a);
  }
  return out;
}

/** The projector beside a vision model, by the catalog's naming: `<stem>-mmproj*.gguf`, the stem being the file name without its quant suffix. */
export function mmprojFor(modelName, siblings) {
  const stem = modelName
    .replace(/[-_.]?(Q\d|IQ\d|BF16|F16|F32).*$/i, "")
    .replace(/\.gguf$/i, "")
    .toLowerCase();
  if (!stem) return null;
  return siblings.find((n) => n.toLowerCase().startsWith(`${stem}-mmproj`) && /\.gguf$/i.test(n)) || null;
}

/** The whole llama-server command line for a start: what the Android launcher builds, with the PC's differences. */
export function serverCommand({ exe, backend, modelPath, port, ctx, extra = [], supports = {}, siblings = [] }) {
  const cmd = [exe, "-m", modelPath, "--host", "127.0.0.1", "--port", String(port), "-c", String(ctx), "--jinja", "--reasoning-format", "deepseek", "-fa", "auto"];
  const args = translateArgs(extra, supports);
  const hasNgl = args.includes("-ngl") || args.includes("--n-gpu-layers") || args.includes("--gpu-layers");
  // the CPU backend on a GPU build: no layers on the card; a GPU backend: everything, unless the plan sized it
  if (backend === "cpu") cmd.push("-ngl", "0");
  else if (!hasNgl) cmd.push("-ngl", "99");
  const mm = mmprojFor(basename(modelPath), siblings);
  if (mm) cmd.push("--mmproj", join(dirname(modelPath), mm));
  cmd.push(...args);
  return cmd;
}

/** A path typed into the download box instead of a URL: an absolute Windows or POSIX path ending in .gguf. */
export function looksLikePath(s) {
  const t = String(s || "").trim();
  return /\.gguf$/i.test(t) && (/^[a-zA-Z]:[\\/]/.test(t) || t.startsWith("\\\\") || t.startsWith("/"));
}

// ---------------------------------------------------------------- the host

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".gguf": "application/octet-stream",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".zip": "application/zip",
};

function parseArgs(argv) {
  const o = { port: 4173, bind: "0.0.0.0", data: "", dist: join(root, "dist"), server: "", verbose: false, fake: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === "--port") o.port = Number(v());
    else if (a === "--bind") o.bind = v();
    else if (a === "--data") o.data = resolve(v());
    else if (a === "--dist") o.dist = resolve(v());
    else if (a === "--server") o.server = resolve(v());
    else if (a === "--verbose") o.verbose = true;
    else if (a === "--fake-server") o.fake = true;
  }
  return o;
}

export function defaultDataDir() {
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(os.homedir(), "AppData", "Local"), "AetheriaWorkbench");
  return join(os.homedir(), ".aetheria-workbench");
}

/** Start the host. Resolves to {server, close, api, port} once it listens. */
export async function start(opts = {}) {
  const o = { ...parseArgs([]), ...opts };
  const dataDir = o.data || defaultDataDir();
  const modelsDir = join(dataDir, "models");
  const llamaDir = join(dataDir, "llama");
  for (const d of [dataDir, modelsDir, llamaDir]) mkdirSync(d, { recursive: true });
  const cfgPath = join(dataDir, "runtime.json");
  const cfg = { links: [], servers: {}, ...(existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {}) };
  const saveCfg = () => writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const log = (...a) => {
    if (o.verbose) console.log(new Date().toISOString().slice(11, 19), ...a);
  };

  // ------------------------------------------------------------ the server process
  const LOG_LINES = 300;
  const rt = { proc: null, phase: "stopped", port: 0, model: "", backend: "", exe: "", startedAt: 0, log: [], error: "" };
  const logLine = (line) => {
    rt.log.push(line);
    if (rt.log.length > LOG_LINES) rt.log.splice(0, rt.log.length - LOG_LINES);
    log("[server]", line);
  };
  const tail = (n) => rt.log.slice(-n).join(" | ");
  /** Why a start failed, from the log: the last line that names an error (an unknown architecture, no memory), else the last three lines. */
  const reason = () => {
    const recent = rt.log.slice(-60).filter((l) => !/^\[host\]/.test(l));
    const hit = [...recent].reverse().find((l) => /error|unknown|failed|cannot|could not|not enough|out of memory|no such file|address already in use/i.test(l) && !/cleaning up|exiting due to/i.test(l));
    return hit ? hit.replace(/^\S+:\s*/, "").trim() : tail(3);
  };
  const running = () => !!rt.proc && rt.proc.exitCode === null && !rt.proc.killed;

  const dl = { name: "", loaded: 0, total: 0, active: false, abort: false };
  const inst = { backend: "", tag: "", file: "", loaded: 0, total: 0, active: false, phase: "", error: "", abort: false };

  // ------------------------------------------------------------ builds of llama.cpp on this PC
  const helpCache = new Map(); // exe -> {supports, version}
  function probeExe(exe) {
    const key = `${exe}:${statSync(exe).mtimeMs}`;
    if (helpCache.has(key)) return helpCache.get(key);
    let help = "";
    let version = "";
    try {
      const h = spawnSync(exe, ["--help"], { encoding: "utf8", timeout: 20000, windowsHide: true, cwd: dirname(exe) });
      help = `${h.stdout || ""}\n${h.stderr || ""}`;
      const v = spawnSync(exe, ["--version"], { encoding: "utf8", timeout: 20000, windowsHide: true, cwd: dirname(exe) });
      version = (`${v.stdout || ""}\n${v.stderr || ""}`.match(/version:\s*(\S+(?:\s*\([^)]*\))?)/) || [])[1] || "";
    } catch (e) {
      help = "";
      version = `? (${e.message})`;
    }
    const info = { supports: { loadMode: /--load-mode/.test(help), cpuMoe: /--cpu-moe/.test(help), fit: /\s--fit\b/.test(help), mmproj: /--mmproj/.test(help) }, version };
    helpCache.set(key, info);
    return info;
  }
  const exeName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  /** Every llama-server on this PC: the one on the command line, the installed ones, the ones the user pointed at, the Desktop's, the PATH's. */
  function builds() {
    const dirs = [];
    const add = (exe, how) => {
      if (!exe || !existsSync(exe)) return;
      const dir = dirname(resolve(exe));
      if (dirs.some((d) => d.dir.toLowerCase() === dir.toLowerCase())) return;
      let names = [];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      dirs.push({ dir, exe: resolve(exe), how, backends: backendsOfFiles(names), tag: readTag(dir) });
    };
    if (o.fake) return [{ dir: root, exe: "fake", how: "fake", backends: ["cuda", "cpu"], tag: "fake" }];
    if (o.server) add(o.server, "command line");
    if (process.env.LLAMA_SERVER) add(process.env.LLAMA_SERVER, "LLAMA_SERVER");
    for (const b of BACKENDS) add(join(llamaDir, b, exeName), `installed (${b})`);
    for (const [b, p] of Object.entries(cfg.servers)) add(p, `chosen (${b})`);
    add(join(os.homedir(), "Desktop", "llama.cpp", exeName), "Desktop\\llama.cpp");
    try {
      const w = spawnSync(process.platform === "win32" ? "where" : "which", ["llama-server"], { encoding: "utf8", timeout: 5000, windowsHide: true });
      for (const line of String(w.stdout || "").split(/\r?\n/)) add(line.trim(), "PATH");
    } catch {
      /* no where */
    }
    return dirs;
  }
  function readTag(dir) {
    try {
      return JSON.parse(readFileSync(join(dir, "aetheria-install.json"), "utf8")).tag || "";
    } catch {
      return "";
    }
  }
  /** The builds that can run `backend`, best first: chosen or installed for exactly it, then any build that carries it. */
  function candidates(backend) {
    const all = builds();
    const list = backend === "auto" ? BACKENDS : [backend];
    const out = [];
    for (const b of list) {
      const exact = all.filter((x) => x.backends.includes(b) && (x.how === `chosen (${b})` || x.how === `installed (${b})` || x.how === "command line" || x.how === "LLAMA_SERVER"));
      const rest = all.filter((x) => x.backends.includes(b) && !exact.includes(x));
      // a GPU build stands in for the CPU only when no CPU-only build is here
      const ordered = b === "cpu" ? [...exact, ...rest].sort((p, q) => p.backends.length - q.backends.length) : [...exact, ...rest];
      for (const x of ordered) if (!out.some((y) => y.exe === x.exe && y.backend === b)) out.push({ ...x, backend: b });
    }
    return out;
  }

  // ------------------------------------------------------------ the machine
  let gpuCache = null;
  function gpu() {
    if (gpuCache && Date.now() - gpuCache.at < 60000) return gpuCache;
    let name = "";
    let vram = 0;
    try {
      const r = spawnSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 5000, windowsHide: true });
      const line = String(r.stdout || "").split(/\r?\n/)[0] || "";
      const m = line.match(/^(.*),\s*(\d+)\s*$/);
      if (m) {
        name = m[1].trim();
        vram = Number(m[2]) * 1048576;
      }
    } catch {
      /* no nvidia-smi */
    }
    if (!name && process.platform === "win32") {
      try {
        const r = spawnSync("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join '; '"], { encoding: "utf8", timeout: 15000, windowsHide: true });
        name = String(r.stdout || "").trim();
      } catch {
        /* none */
      }
    }
    gpuCache = { name, vram, at: Date.now() };
    return gpuCache;
  }

  // ------------------------------------------------------------ models
  const safeName = (n) => {
    const s = basename(String(n || "")).replace(/[^\w.\-+ ()\[\]]/g, "_");
    if (!/\.gguf$/i.test(s)) throw new Error("the name should end in .gguf");
    return s;
  };
  function listModels() {
    const out = [];
    for (const f of readdirSync(modelsDir)) {
      if (!/\.gguf$/i.test(f)) continue;
      try {
        out.push({ name: f, path: join(modelsDir, f), size: statSync(join(modelsDir, f)).size, linked: false });
      } catch {
        /* gone meanwhile */
      }
    }
    for (const p of cfg.links) {
      if (!existsSync(p)) continue;
      const name = basename(p);
      if (out.some((m) => m.name === name)) continue;
      out.push({ name, path: p, size: statSync(p).size, linked: true });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  function modelPath(name) {
    const m = listModels().find((x) => x.name === name);
    if (!m) throw new Error(`no model called ${name}`);
    return m.path;
  }

  async function download({ url, name }) {
    if (dl.active) throw new Error("a download is already running");
    if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("the download needs an http(s) URL");
    const file = safeName(name || decodeURIComponent(String(url).split("/").pop().split("?")[0]));
    const dest = join(modelsDir, file);
    const part = `${dest}.part`;
    let have = existsSync(part) ? statSync(part).size : 0;
    Object.assign(dl, { name: file, loaded: have, total: 0, active: true, abort: false });
    try {
      const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: "follow" });
      if (res.status === 416) {
        renameSync(part, dest);
        return { path: dest, size: statSync(dest).size, resumed: true };
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(res.url || url).host}`);
      if (res.status === 200 && have) {
        // the server ignored the range: start over
        truncateSync(part, 0);
        have = 0;
        dl.loaded = 0;
      }
      const len = Number(res.headers.get("content-length") || 0);
      const range = res.headers.get("content-range");
      dl.total = range ? Number(range.split("/")[1]) || 0 : have + len;
      const out = createWriteStream(part, { flags: have ? "a" : "w" });
      for await (const chunk of res.body) {
        if (dl.abort) throw new Error("cancelled");
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
        dl.loaded += chunk.length;
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
      if (dl.total && dl.loaded < dl.total) throw new Error(`the download stopped at ${dl.loaded} of ${dl.total} bytes; run it again to resume`);
      renameSync(part, dest);
      return { path: dest, size: statSync(dest).size };
    } finally {
      dl.active = false;
    }
  }

  function readHead({ model, bytes = 1 << 20 }) {
    const p = modelPath(model);
    const size = statSync(p).size;
    const n = Math.min(Math.max(1, Number(bytes) || 1 << 20), 8 << 20, size);
    const fd = openSync(p, "r");
    try {
      const buf = Buffer.alloc(n);
      const got = readSync(fd, buf, 0, n, 0);
      return { data: buf.subarray(0, got).toString("base64"), size, bytes: got };
    } finally {
      closeSync(fd);
    }
  }

  function linkModel({ path }) {
    const p = resolve(String(path || "").trim().replace(/^"|"$/g, ""));
    if (!/\.gguf$/i.test(p)) throw new Error("the file should be a .gguf");
    if (!existsSync(p)) throw new Error(`no file at ${p}`);
    const name = basename(p);
    const clash = listModels().find((m) => m.name === name && m.path.toLowerCase() !== p.toLowerCase());
    if (clash) throw new Error(`a model called ${name} is already here (${clash.path}); rename one of them`);
    if (!cfg.links.some((x) => x.toLowerCase() === p.toLowerCase()) && !p.toLowerCase().startsWith(modelsDir.toLowerCase() + sep)) {
      cfg.links.push(p);
      saveCfg();
    }
    return { name, path: p, size: statSync(p).size, linked: true };
  }

  /** A native file dialog through PowerShell (STA; a topmost invisible owner so it comes to the front). Resolves the path, or "" when cancelled. */
  function pickFile({ filter, title }) {
    if (process.platform !== "win32") throw new Error("the file dialog is Windows only here; type the path instead");
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing",
      "$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; $f.ShowInTaskbar = $false; $f.Opacity = 0; $f.StartPosition = 'CenterScreen'; $f.Size = New-Object System.Drawing.Size(1, 1); $f.Show(); $f.Activate()",
      `$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = '${filter.replace(/'/g, "''")}'; $d.Title = '${title.replace(/'/g, "''")}'; $d.CheckFileExists = $true; $d.Multiselect = $false`,
      "if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }",
      "$f.Close()",
    ].join("; ");
    return new Promise((res, rej) => {
      const p = spawn("powershell", ["-NoProfile", "-STA", "-Command", ps], { windowsHide: true });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", rej);
      p.on("close", (code) => (code === 0 || out ? res(out.trim()) : rej(new Error(err.trim().split("\n")[0] || `the file dialog failed (${code})`))));
    });
  }

  async function pickModel() {
    const p = await pickFile({ filter: "GGUF models (*.gguf)|*.gguf|All files (*.*)|*.*", title: "Aetheria Workbench: pick a GGUF model" });
    if (!p) return { cancelled: true };
    return linkModel({ path: p });
  }

  function deleteModel({ name }) {
    const m = listModels().find((x) => x.name === name);
    if (!m) throw new Error(`no model called ${name}`);
    if (running() && rt.model === name) throw new Error("stop the server first");
    if (m.linked) {
      cfg.links = cfg.links.filter((x) => x.toLowerCase() !== m.path.toLowerCase());
      saveCfg();
      return { forgotten: true, path: m.path };
    }
    unlinkSync(m.path);
    if (existsSync(`${m.path}.part`)) unlinkSync(`${m.path}.part`);
    return { deleted: true };
  }

  // ------------------------------------------------------------ start / stop
  function kill() {
    const p = rt.proc;
    if (!p) return;
    rt.proc = null;
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else p.kill("SIGTERM");
    } catch {
      /* gone */
    }
  }
  async function waitHealthy(port, timeoutMs) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (!running()) return false;
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 1500);
        const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctl.signal }).finally(() => clearTimeout(t));
        if (r.status === 200) return true;
      } catch {
        /* not yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }
  function launch(c, modelFile, port, ctx, extra) {
    let cmd;
    let cwd = c.dir;
    if (o.fake) {
      cmd = [process.execPath, join(root, "tools", "fake_lab.mjs"), String(port)];
      cwd = root;
    } else {
      const info = probeExe(c.exe);
      let siblings = [];
      try {
        siblings = readdirSync(dirname(modelFile));
      } catch {
        /* none */
      }
      cmd = serverCommand({ exe: c.exe, backend: c.backend, modelPath: modelFile, port, ctx, extra, supports: info.supports, siblings });
    }
    logLine(`[host] ${cmd.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
    const env = { ...process.env, PATH: `${c.dir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH || ""}` };
    const p = spawn(cmd[0], cmd.slice(1), { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    rt.proc = p;
    let buf = "";
    const pump = (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) if (l.trim()) logLine(l);
    };
    p.stdout.on("data", pump);
    p.stderr.on("data", pump);
    p.on("error", (e) => logLine(`[host] could not start: ${e.message}`));
    p.on("exit", (code, sig) => {
      if (buf.trim()) logLine(buf);
      buf = "";
      logLine(`[host] server exited with ${code ?? sig}`);
      if (rt.proc === p) {
        rt.proc = null;
        if (rt.phase === "running") {
          rt.phase = "stopped";
          rt.error = `the server exited (${code ?? sig})`;
        }
      }
    });
    return p;
  }
  let starting = null;
  async function startServer({ model, port = 8080, ctx = 32768, backend = "auto", args = [] }) {
    if (starting) throw new Error("a start is already running");
    starting = (async () => {
      await stopServer();
      const modelFile = modelPath(model);
      const cands = candidates(backend);
      if (!cands.length) throw new Error(backend === "auto" ? "no llama-server on this PC yet: install llama.cpp's CUDA, Vulkan or CPU build in Settings, or point the runtime at a llama-server.exe you have" : `no llama-server build for ${backend} on this PC: install it in Settings`);
      rt.phase = "starting";
      rt.model = model;
      rt.error = "";
      rt.log.length = 0; // this start's lines only, as the phone's runtime does
      let lastError = "";
      for (const c of cands) {
        try {
          rt.backend = c.backend;
          rt.exe = c.exe;
          launch(c, modelFile, port, ctx, args);
          if (await waitHealthy(port, 300000)) {
            Object.assign(rt, { phase: "running", port, startedAt: Date.now() });
            return { port, model, backend: c.backend, pid: rt.proc.pid, exe: c.exe, foreground: false };
          }
          lastError = `${c.backend}: ${running() ? `the server did not answer /health in time (${tail(2)})` : reason()}`;
        } catch (e) {
          lastError = `${c.backend}: ${e.message}`;
        }
        logLine(`[host] backend ${c.backend} failed: ${lastError}`);
        kill();
      }
      rt.phase = "stopped";
      rt.backend = "";
      rt.error = lastError;
      throw new Error(lastError || "could not start");
    })();
    try {
      return await starting;
    } finally {
      starting = null;
    }
  }
  async function stopServer() {
    if (!rt.proc) {
      rt.phase = "stopped";
      return {};
    }
    const p = rt.proc;
    kill();
    await new Promise((r) => {
      if (p.exitCode !== null) return r();
      const t = setTimeout(r, 5000);
      p.once("exit", () => {
        clearTimeout(t);
        r();
      });
    });
    rt.phase = "stopped";
    rt.backend = "";
    return {};
  }

  // ------------------------------------------------------------ installing a build
  let releasesCache = null;
  async function releases() {
    if (releasesCache && Date.now() - releasesCache.at < 600000) return releasesCache.pick;
    const r = await fetch(RELEASES_API, { headers: { "User-Agent": `aetheria-workbench/${VERSION}`, Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`GitHub answered ${r.status} for the release list`);
    const pick = pickRelease(await r.json());
    if (!pick) throw new Error("no Windows build in llama.cpp's last ten releases");
    releasesCache = { pick, at: Date.now() };
    return pick;
  }
  async function fetchTo(url, dest) {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": `aetheria-workbench/${VERSION}` } });
    if (!res.ok) throw new Error(`${res.status} for ${basename(dest)}`);
    inst.total = Number(res.headers.get("content-length") || 0);
    inst.loaded = 0;
    const out = createWriteStream(dest);
    for await (const chunk of res.body) {
      if (inst.abort) throw new Error("cancelled");
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      inst.loaded += chunk.length;
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  }
  function unzip(zip, dir) {
    // Windows ships bsdtar, which opens zips; Git's GNU tar on the PATH does not, so the system one is named
    const sysTar = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
    let r = spawnSync(sysTar, ["-xf", zip, "-C", dir], { encoding: "utf8", timeout: 600000, windowsHide: true });
    if (r.status !== 0 && process.platform === "win32") r = spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`], { encoding: "utf8", timeout: 600000, windowsHide: true });
    if (r.status !== 0) throw new Error(`could not unzip ${basename(zip)}: ${(r.stderr || r.stdout || "").trim().split("\n")[0]}`);
    // a zip with one folder at the top: lift its files up beside the others
    const top = readdirSync(dir);
    if (!top.includes(exeName)) {
      for (const d of top) {
        const sub = join(dir, d);
        if (statSync(sub).isDirectory() && existsSync(join(sub, exeName))) {
          for (const f of readdirSync(sub)) renameSync(join(sub, f), join(dir, f));
          rmSync(sub, { recursive: true, force: true });
        }
      }
    }
  }
  async function installServer({ backend = "cuda", cuda = "12.4" }) {
    if (inst.active) throw new Error("an install is already running");
    if (!BACKENDS.includes(backend)) throw new Error(`no release build for ${backend}`);
    if (process.platform !== "win32") throw new Error("the installer fetches llama.cpp's Windows builds; on this platform build llama.cpp yourself and point the runtime at llama-server");
    Object.assign(inst, { backend, tag: "", file: "", loaded: 0, total: 0, active: true, phase: "release", error: "", abort: false });
    try {
      const rel = await releases();
      inst.tag = rel.tag;
      const names = releaseAssets(rel.tag, backend, { cuda });
      const dir = join(llamaDir, backend);
      const fresh = join(llamaDir, `${backend}.new`);
      rmSync(fresh, { recursive: true, force: true });
      mkdirSync(fresh, { recursive: true });
      for (const n of names) {
        const a = rel.assets[n];
        if (!a) throw new Error(`release ${rel.tag} has no ${n}`);
        inst.file = n;
        inst.phase = "download";
        const zip = join(llamaDir, n);
        await fetchTo(a.url, zip);
        inst.phase = "unzip";
        unzip(zip, fresh);
        unlinkSync(zip);
      }
      if (!existsSync(join(fresh, exeName))) throw new Error(`the zip had no ${exeName}`);
      writeFileSync(join(fresh, "aetheria-install.json"), JSON.stringify({ tag: rel.tag, backend, assets: names, at: new Date().toISOString(), cuda: backend === "cuda" ? cuda : undefined }, null, 2));
      if (running() && rt.exe.toLowerCase().startsWith(dir.toLowerCase())) await stopServer();
      rmSync(dir, { recursive: true, force: true });
      renameSync(fresh, dir);
      helpCache.clear();
      inst.phase = "done";
      return { backend, tag: rel.tag, dir, exe: join(dir, exeName) };
    } catch (e) {
      inst.phase = "failed";
      inst.error = e.message;
      throw e;
    } finally {
      inst.active = false;
    }
  }
  function setServer({ backend, path }) {
    const p = resolve(String(path || "").trim().replace(/^"|"$/g, ""));
    if (!existsSync(p)) throw new Error(`no file at ${p}`);
    if (basename(p).toLowerCase() !== exeName) throw new Error(`that is not ${exeName}`);
    const carries = backendsOfFiles(readdirSync(dirname(p)));
    const b = backend && backend !== "auto" ? backend : carries[0];
    if (!carries.includes(b)) throw new Error(`that build has no ${b} backend (it carries ${carries.join(", ")})`);
    cfg.servers[b] = p;
    saveCfg();
    helpCache.clear();
    return { backend: b, path: p, backends: carries };
  }
  async function pickServer({ backend = "auto" } = {}) {
    const p = await pickFile({ filter: "llama-server (llama-server.exe)|llama-server.exe|Programs (*.exe)|*.exe", title: "Aetheria Workbench: pick llama.cpp's llama-server.exe" });
    if (!p) return { cancelled: true };
    return setServer({ backend, path: p });
  }
  function forgetServer({ backend }) {
    delete cfg.servers[backend];
    saveCfg();
    return {};
  }
  function servers() {
    return {
      builds: builds().map((b) => ({ ...b, version: o.fake ? "fake" : probeExe(b.exe).version })),
      chosen: cfg.servers,
      installDir: llamaDir,
    };
  }

  // ------------------------------------------------------------ the API
  function status() {
    const up = running();
    return {
      host: "pc",
      version: VERSION,
      running: up,
      healthy: up && rt.phase === "running",
      phase: up ? rt.phase : "stopped",
      port: up ? rt.port : 0,
      model: up ? rt.model : "",
      backend: up ? rt.backend : "",
      exe: up ? rt.exe : "",
      pid: up ? rt.proc.pid : 0,
      uptime: up && rt.startedAt ? Date.now() - rt.startedAt : 0,
      foreground: false,
      error: rt.error,
      log: rt.log.join("\n"),
      download: { name: dl.name, loaded: dl.loaded, total: dl.total, active: dl.active },
      install: { backend: inst.backend, tag: inst.tag, file: inst.file, loaded: inst.loaded, total: inst.total, active: inst.active, phase: inst.phase, error: inst.error },
      dataDir,
      modelsDir,
    };
  }
  function device() {
    const g = gpu();
    const all = builds();
    const backends = BACKENDS.filter((b) => all.some((x) => x.backends.includes(b)));
    return {
      host: "pc",
      device: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      soc: `${(os.cpus()[0]?.model || "CPU").replace(/\s+/g, " ").trim()} · ${os.cpus().length} threads`,
      ram: os.totalmem(),
      availRam: os.freemem(),
      gpu: g.name,
      vram: g.vram,
      backends,
      builds: all.map((b) => ({ dir: b.dir, backends: b.backends, how: b.how, tag: b.tag })),
      modelsDir,
      dataDir,
      node: process.version,
    };
  }
  function openFolder({ which = "models" } = {}) {
    const dir = which === "data" ? dataDir : which === "llama" ? llamaDir : modelsDir;
    if (process.platform === "win32") spawn("explorer.exe", [dir], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else spawn(process.platform === "darwin" ? "open" : "xdg-open", [dir], { detached: true, stdio: "ignore" }).unref();
    return { dir };
  }

  const api = {
    status: async () => status(),
    device: async () => device(),
    servers: async () => servers(),
    releases: async () => releases(),
    listModels: async () => ({ dir: modelsDir, models: listModels() }),
    readHead: async (b) => readHead(b),
    download: async (b) => download(b),
    abortDownload: async () => {
      dl.abort = true;
      return {};
    },
    pickModel: async () => pickModel(),
    linkModel: async (b) => linkModel(b),
    deleteModel: async (b) => deleteModel(b),
    start: async (b) => startServer(b),
    stop: async () => stopServer(),
    installServer: async (b) => installServer(b),
    cancelInstall: async () => {
      inst.abort = true;
      return {};
    },
    setServer: async (b) => setServer(b),
    pickServer: async (b) => pickServer(b),
    forgetServer: async (b) => forgetServer(b),
    openFolder: async (b) => openFolder(b),
    ttsStatus: async () => ({ ready: false, error: "on the PC Mira's voice is tools/qwen_tts_server.py (Settings → Voice), not the runtime" }),
    tts: async () => {
      throw new Error("no llama-tts in the PC runtime; the Qwen voice server or Kokoro reads");
    },
  };
  const GETS = new Set(["status", "device", "servers", "releases", "listModels"]);

  // ------------------------------------------------------------ http
  const isLoopback = (addr) => /^(127\.|::1$|::ffff:127\.)/.test(String(addr || ""));
  const originOk = (req) => {
    const origin = req.headers.origin;
    if (!origin) return req.headers["sec-fetch-site"] === undefined || req.headers["sec-fetch-site"] === "same-origin" || req.headers["sec-fetch-site"] === "none";
    try {
      const u = new URL(origin);
      return /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i.test(u.hostname) && Number(u.port || (u.protocol === "https:" ? 443 : 80)) === o.port;
    } catch {
      return false;
    }
  };
  const json = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
  };
  const readBody = (req) =>
    new Promise((res, rej) => {
      let s = "";
      req.on("data", (d) => {
        s += d;
        if (s.length > 1 << 20) rej(new Error("body too big"));
      });
      req.on("end", () => res(s));
      req.on("error", rej);
    });

  async function runtime(req, res, method) {
    if (!isLoopback(req.socket.remoteAddress)) return json(res, 403, { error: "the runtime API answers this PC only" });
    if (!originOk(req)) return json(res, 403, { error: "the runtime API answers this app only" });
    const fn = api[method];
    if (!fn) return json(res, 404, { error: `no runtime method ${method}` });
    if (req.method !== "POST" && !(req.method === "GET" && GETS.has(method))) return json(res, 405, { error: "POST" });
    let body = {};
    try {
      const raw = req.method === "POST" ? await readBody(req) : "";
      body = raw ? JSON.parse(raw) : {};
    } catch (e) {
      return json(res, 400, { error: `bad JSON: ${e.message}` });
    }
    try {
      json(res, 200, (await fn(body)) ?? {});
    } catch (e) {
      log("[api]", method, "failed:", e.message);
      json(res, 500, { error: e.message || String(e) });
    }
  }

  function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath.split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    let file = resolve(o.dist, `.${rel}`);
    if (!file.toLowerCase().startsWith(resolve(o.dist).toLowerCase())) return json(res, 403, { error: "outside" });
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (!extname(rel)) file = join(o.dist, "index.html"); // a route, not a file: the app
      else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("not found");
      }
    }
    if (!existsSync(file)) return json(res, 404, { error: "no dist/index.html: run npm run build" });
    const st = statSync(file);
    const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
    const hashed = /[\\/]assets[\\/]/.test(file) && /-[\w-]{8,}\.\w+$/.test(basename(file));
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache", "Last-Modified": st.mtime.toUTCString() };
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && st.size > 0) {
      let a = range[1] === "" ? Math.max(0, st.size - Number(range[2])) : Number(range[1]);
      let b = range[1] === "" || range[2] === "" ? st.size - 1 : Math.min(st.size - 1, Number(range[2]));
      if (a > b || a >= st.size) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${a}-${b}/${st.size}`, "Content-Length": b - a + 1 });
      if (req.method === "HEAD") return res.end();
      return createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { ...headers, "Content-Length": st.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => {
    const url = req.url || "/";
    const m = /^\/runtime\/([A-Za-z]+)\/?(?:\?.*)?$/.exec(url);
    if (m) return runtime(req, res, m[1]);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end();
    }
    try {
      serveStatic(req, res, url);
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });
  await new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(o.port, o.bind, res);
  });
  const close = async () => {
    await stopServer();
    await new Promise((r) => server.close(r));
  };
  return { server, close, api, port: o.port, dataDir, modelsDir };
}

// ---------------------------------------------------------------- main
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  let host;
  try {
    host = await start(o);
  } catch (e) {
    if (e.code === "EADDRINUSE") {
      console.error(`Port ${o.port} is taken: another Aetheria Workbench (or something else) is listening on it. Close that one, or run with --port <other>.`);
      process.exit(2);
    }
    throw e;
  }
  console.log(`Aetheria Workbench ${VERSION} on http://localhost:${host.port}/  (models: ${host.modelsDir})`);
  const bye = async () => {
    await host.close().catch(() => {});
    process.exit(0);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(sig, bye);
  process.on("exit", () => host.api.stop().catch(() => {}));
}
