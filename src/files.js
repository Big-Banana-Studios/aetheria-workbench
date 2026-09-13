// Project files: drop a folder of .md/.txt/.pdf on a desk, the text is
// extracted and chunked here, embedded with EmbeddingGemma in a worker, and
// searched by cosine similarity when a turn is sent. No server. If the
// embedding model cannot be loaded (no WebGPU, offline before the first
// download) the search falls back to a plain keyword score, so the feature
// degrades rather than disappears.

import { store } from "./store.js";
import { extractAny } from "./extract.js";

const CHUNK_CHARS = 900;
const OVERLAP = 150;

export class ProjectFiles extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.worker = null;
    this.embedder = null; // null = untried, false = unavailable, {dim} = ready
    this._loading = null;
    this._pending = new Map();
    this._nextId = 1;
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /** Try to bring the embedder up once. Resolves to true if it is usable. */
  async ensureEmbedder() {
    if (this.embedder) return true;
    if (this.embedder === false) return false;
    if (this._loading) return this._loading;
    this._loading = new Promise((resolve) => {
      this.worker = new Worker(new URL("./workers/embed.worker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = ({ data }) => {
        switch (data.type) {
          case "progress":
            this.emit("progress", data);
            break;
          case "ready":
            this.embedder = { dim: data.dim, device: data.device };
            this.emit("embedder", this.embedder);
            resolve(true);
            break;
          case "vectors": {
            const p = this._pending.get(data.id);
            this._pending.delete(data.id);
            p?.resolve(data);
            break;
          }
          case "error": {
            if (data.id != null && this._pending.has(data.id)) {
              const p = this._pending.get(data.id);
              this._pending.delete(data.id);
              p.reject(new Error(data.message));
            } else if (!this.embedder) {
              this.embedder = false;
              this.emit("embedder", false);
              this.emit("error", data.message);
              resolve(false);
            }
            break;
          }
        }
      };
      this.worker.onerror = (e) => {
        this.embedder = false;
        this.emit("error", e.message || "embedding worker failed");
        resolve(false);
      };
      const device = "gpu" in navigator && navigator.gpu ? "webgpu" : "wasm";
      this.worker.postMessage({ type: "load", model: this.settings.embedModel, device });
    });
    return this._loading;
  }

  _embed(texts, kind) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "embed", id, texts, kind });
    });
  }

  /** Paragraph-aware windows of about CHUNK_CHARS with a little overlap. */
  static chunk(text) {
    const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const out = [];
    let cur = "";
    for (const p of paras) {
      if (p.length > CHUNK_CHARS * 1.5) {
        if (cur) {
          out.push(cur);
          cur = "";
        }
        for (let i = 0; i < p.length; i += CHUNK_CHARS - OVERLAP) out.push(p.slice(i, i + CHUNK_CHARS));
        continue;
      }
      if ((cur + "\n\n" + p).length > CHUNK_CHARS && cur) {
        out.push(cur);
        cur = cur.slice(-OVERLAP).replace(/^\S*\s/, "") + "\n\n" + p;
      } else cur = cur ? cur + "\n\n" + p : p;
    }
    if (cur) out.push(cur);
    return out.filter((c) => c.trim().length > 40);
  }

  /**
   * Add files to a desk. Extract, chunk, embed (if possible), store.
   * @param {File[]} files
   */
  async add(files, desk) {
    const useEmbed = await this.ensureEmbedder();
    const added = [];
    for (const file of files) {
      try {
        this.emit("status", `reading ${file.name}…`);
        const ex = await extractAny(file, (done, total) => this.emit("status", `reading ${file.name}: page ${done}/${total}`));
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const chunks = ProjectFiles.chunk(ex.text);
        let vectors = null;
        if (useEmbed && chunks.length) {
          this.emit("status", `embedding ${file.name} (${chunks.length} chunks)…`);
          try {
            vectors = await this._embed(chunks, "doc");
          } catch (e) {
            this.emit("error", `embedding ${file.name}: ${e.message}`);
          }
        }
        const rec = { id, desk, name: ex.name, size: file.size, type: file.type, words: ex.words, pages: ex.pages, chunks: chunks.length, embedded: !!vectors, added: Date.now(), text: ex.text.slice(0, 200000) };
        await store.putFile(rec);
        await store.putChunks(
          chunks.map((text, i) => ({
            id: `${id}:${i}`,
            fileId: id,
            desk,
            name: ex.name,
            i,
            text,
            vec: vectors ? vectors.data.slice(i * vectors.dim, (i + 1) * vectors.dim) : null,
          })),
        );
        added.push(rec);
        this.emit("added", rec);
      } catch (e) {
        this.emit("error", `${file.name}: ${e.message}`);
      }
    }
    this.emit("status", "");
    return added;
  }

  list(desk) {
    return store.listFiles(desk);
  }

  async remove(id) {
    await store.deleteFile(id);
    this.emit("removed", id);
  }

  /**
   * The best chunks for a query on this desk.
   * @returns {Promise<{text:string,name:string,score:number}[]>}
   */
  async search(query, desk, k = 6) {
    const chunks = await store.chunksOfDesk(desk);
    if (!chunks.length) return [];
    const embedded = chunks.filter((c) => c.vec);
    if (embedded.length && (await this.ensureEmbedder())) {
      try {
        const q = await this._embed([query], "query");
        const qv = q.data;
        const scored = embedded.map((c) => ({ c, score: cosine(qv, c.vec) }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, k).map(({ c, score }) => ({ text: c.text, name: c.name, score }));
      } catch (e) {
        this.emit("error", `search: ${e.message}`);
      }
    }
    return keywordSearch(query, chunks, k);
  }
}

function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s; // both normalised
}

/** A small tf-idf-ish score when there are no vectors. */
export function keywordSearch(query, chunks, k) {
  const terms = tokens(query);
  if (!terms.length) return [];
  const df = new Map();
  const docs = chunks.map((c) => {
    const t = tokens(c.text);
    const set = new Set(t);
    for (const w of set) df.set(w, (df.get(w) || 0) + 1);
    return { c, t, set };
  });
  const N = docs.length;
  const scored = docs.map(({ c, t, set }) => {
    let score = 0;
    for (const w of terms) {
      if (!set.has(w)) continue;
      const tf = t.filter((x) => x === w).length / t.length;
      const idf = Math.log(1 + N / (df.get(w) || 1));
      score += tf * idf;
    }
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, k)
    .map(({ c, score }) => ({ text: c.text, name: c.name, score }));
}

function tokens(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

const STOP = new Set("the and for are but not you all any can had her was one our out has his how its may new now old see two way who did get let put say she too use with this that from they what when where which will would there their then than into about over after under".split(" "));
