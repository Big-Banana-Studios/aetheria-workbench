// Embeddings for the project files: EmbeddingGemma (ONNX) through
// Transformers.js, in a worker so chunking a folder of PDFs never stalls the
// transcript. Queries and documents take the prompts the model card asks for.
//
// in : {type:'load', model, device} {type:'embed', id, texts, kind:'query'|'doc'}
// out: {type:'progress', ...} {type:'ready', model, device, dim} {type:'vectors', id, dim, data:Float32Array}
//      {type:'error', id?, message}

import "./ort-paths.js";
import { pipeline } from "@huggingface/transformers";

let extractor = null;
let loaded = null;
let chain = Promise.resolve();
const post = (m, t) => self.postMessage(m, t);

async function load({ model, device = "wasm" }) {
  try {
    extractor = await pipeline("feature-extraction", model, {
      device,
      dtype: device === "webgpu" ? "fp32" : "q8",
      progress_callback: (p) => post({ type: "progress", model: "embeddinggemma", ...p }),
    });
    const probe = await extractor("title: none | text: hello", { pooling: "mean", normalize: true });
    loaded = { model, device, dim: probe.dims[probe.dims.length - 1] };
    post({ type: "ready", ...loaded });
  } catch (e) {
    post({ type: "error", message: `Embedding model failed to load: ${e.message}` });
  }
}

const PREFIX = {
  query: "task: search result | query: ",
  doc: "title: none | text: ",
};

async function embed({ id, texts, kind = "doc" }) {
  if (!extractor) return post({ type: "error", id, message: "embedder not loaded" });
  try {
    const dim = loaded.dim;
    const out = new Float32Array(texts.length * dim);
    const BATCH = 8;
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map((t) => PREFIX[kind] + t);
      const t = await extractor(batch, { pooling: "mean", normalize: true });
      const data = t.data;
      out.set(data.subarray ? data.subarray(0, batch.length * dim) : Float32Array.from(data).subarray(0, batch.length * dim), i * dim);
      t.dispose?.();
    }
    post({ type: "vectors", id, dim, data: out }, [out.buffer]);
  } catch (e) {
    post({ type: "error", id, message: `Embedding: ${e.message}` });
  }
}

self.onmessage = ({ data }) => {
  if (data.type === "load") chain = chain.then(() => load(data));
  else if (data.type === "embed") chain = chain.then(() => embed(data));
};
