// Small DOM helpers shared by the app.

export const $ = (id) => document.getElementById(id);

let toastTimer = 0;
export function toast(text, { error = false, ms = null } = {}) {
  const t = $("toast");
  if (!t) return;
  t.textContent = text;
  t.classList.toggle("error", error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms ?? (error ? 7000 : 2600));
}

/**
 * Hand the user a file. On the web an `<a download>`; inside the app on the
 * phone the WebView's own download never delivers, so the plugin writes the
 * file into Downloads/AetheriaWorkbench, streamed in one-megabyte pieces (a
 * video is hundreds of megabytes; one string cannot cross the bridge).
 * Resolves when the file is out; `onProgress(done, total)` in bytes.
 */
export function download(filename, text, type = "text/markdown;charset=utf-8", onProgress = null) {
  const blob = text instanceof Blob ? text : new Blob([text], { type });
  return saveOnPhone(filename, blob, onProgress).then((saved) => {
    if (saved) return saved;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { path: filename, bytes: blob.size, web: true };
  });
}

const CHUNK = 1 << 20;

/** Base64 of a buffer, in pieces, without one giant string in between. */
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return btoa(bin);
}

/** The file into the phone's Downloads through the native plugin, in pieces; false on the web, or when the plugin is not there. */
async function saveOnPhone(filename, blob, onProgress = null) {
  let native;
  try {
    ({ native } = await import("./native.js")); // Capacitor, loaded on first use (the Node checks import this file)
    if (!native.isApp()) return false; // the Android shell only: the PC runtime has no Downloads bridge, the browser saves
  } catch {
    return false;
  }
  let id = null;
  try {
    const mime = blob.type || "application/octet-stream";
    const begun = await native.downloadBegin({ name: filename, mime });
    id = begun.id;
    for (let off = 0; off < blob.size; off += CHUNK) {
      const piece = await blob.slice(off, Math.min(blob.size, off + CHUNK)).arrayBuffer();
      await native.downloadChunk({ id, data: toBase64(piece) });
      onProgress?.(Math.min(blob.size, off + CHUNK), blob.size);
    }
    const r = await native.downloadEnd({ id });
    toast(`saved: ${r.path || filename} (${(blob.size / 1048576).toFixed(1)} MB)`, { ms: 6000 });
    return r;
  } catch (e) {
    if (id) native.downloadEnd({ id, abort: true }).catch(() => {});
    toast(`could not save on the phone (${e.message}); trying the browser`, { error: true, ms: 6000 });
    return false;
  }
}

export function fmtBytes(b) {
  if (!b && b !== 0) return "?";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

export function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * A short alias for a model name, for the header chip: the org prefix and
 * the GGUF suffix go, the quant stays after a dot.
 *   unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL -> Qwen3.8-27B · UD-Q4_K_XL
 *   Qwen3-8B-Q4_K_M.gguf                 -> Qwen3-8B · Q4_K_M
 * The full string stays in the chip's tooltip.
 */
export function modelAlias(name) {
  let s = String(name || "").trim();
  if (!s) return "";
  s = s.replace(/^.*\//, "");
  let quant = "";
  const colon = s.indexOf(":");
  if (colon >= 0) {
    quant = s.slice(colon + 1);
    s = s.slice(0, colon);
  }
  s = s.replace(/\.gguf$/i, "").replace(/[-_.]?GGUF$/i, "");
  const m = /[-_]((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|F16|F32|BF16))$/i.exec(s);
  if (m && !quant) {
    quant = m[1];
    s = s.slice(0, -m[0].length);
  }
  return quant ? `${s} · ${quant}` : s;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** A download progress list, Mira's gate list in miniature. */
export class DownloadPanel {
  constructor(el) {
    this.el = el;
    this.files = new Map();
    this._hide = 0;
  }

  progress(p) {
    if (!p.file) return;
    const key = `${p.model}/${p.file}`;
    const f = this.files.get(key) || { loaded: 0, total: 0, done: false, model: p.model, file: p.file };
    if (p.status === "progress") {
      f.loaded = p.loaded || 0;
      f.total = p.total || f.total;
    } else if (p.status === "done") {
      f.done = true;
      if (f.total) f.loaded = f.total;
    } else if (p.status === "initiate") f.total = p.total || f.total;
    this.files.set(key, f);
    this.render();
  }

  render() {
    let loaded = 0;
    let total = 0;
    let allDone = true;
    const rows = [];
    for (const f of this.files.values()) {
      loaded += f.loaded;
      total += f.total;
      if (!f.done) allDone = false;
      rows.push(`<li class="${f.done ? "done" : ""}"><span>${escapeHtml(f.model)}: ${escapeHtml(f.file.split("/").pop())}</span><span>${f.total ? `${(f.loaded / 1048576).toFixed(0)} / ${(f.total / 1048576).toFixed(0)} MB` : f.done ? "cached" : "…"}</span></li>`);
    }
    const pct = total ? Math.min(100, (loaded / total) * 100) : 0;
    this.el.hidden = false;
    this.el.innerHTML = `<div class="dl-head"><b>Downloading models</b><span>${(loaded / 1048576).toFixed(0)} of ${(total / 1048576).toFixed(0)} MB</span></div><div class="bar"><div style="width:${pct.toFixed(1)}%"></div></div><ul>${rows.slice(-8).join("")}</ul><p class="fine">Cached by the browser; the next launch is instant and works offline.</p>`;
    clearTimeout(this._hide);
    if (allDone && rows.length) this._hide = setTimeout(() => (this.el.hidden = true), 4000);
  }
}
