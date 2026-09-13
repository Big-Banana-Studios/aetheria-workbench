// A GGUF header reader, pure and small. The in-app runtime plans a launch
// from a few keys at the top of the model file: the architecture, the expert
// count (a mixture of experts or not), and the layer and head counts that
// size the KV cache. The plugin hands over the first megabyte (readHead) and
// this reads key by key until the tokenizer keys begin, which is where the
// big arrays start. Spec: ggml/docs/gguf.md, versions 2 and 3 (64-bit
// lengths); a version 1 file is reported and otherwise left alone.

const T = { UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5, FLOAT32: 6, BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12 };
const SCALAR_SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.p = 0;
    this.td = new TextDecoder();
  }
  need(n) {
    if (this.p + n > this.b.byteLength) throw new RangeError("truncated");
  }
  u32() {
    this.need(4);
    const v = this.dv.getUint32(this.p, true);
    this.p += 4;
    return v;
  }
  u64() {
    this.need(8);
    const v = this.dv.getBigUint64(this.p, true);
    this.p += 8;
    return Number(v);
  }
  scalar(type) {
    const n = SCALAR_SIZE[type];
    this.need(n);
    let v;
    switch (type) {
      case T.UINT8: v = this.dv.getUint8(this.p); break;
      case T.INT8: v = this.dv.getInt8(this.p); break;
      case T.UINT16: v = this.dv.getUint16(this.p, true); break;
      case T.INT16: v = this.dv.getInt16(this.p, true); break;
      case T.UINT32: v = this.dv.getUint32(this.p, true); break;
      case T.INT32: v = this.dv.getInt32(this.p, true); break;
      case T.FLOAT32: v = this.dv.getFloat32(this.p, true); break;
      case T.BOOL: v = this.dv.getUint8(this.p) !== 0; break;
      case T.UINT64: v = Number(this.dv.getBigUint64(this.p, true)); break;
      case T.INT64: v = Number(this.dv.getBigInt64(this.p, true)); break;
      case T.FLOAT64: v = this.dv.getFloat64(this.p, true); break;
      default: throw new TypeError(`gguf: unknown value type ${type}`);
    }
    this.p += n;
    return v;
  }
  str() {
    const n = this.u64();
    this.need(n);
    const s = this.td.decode(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  /** A value of `type`; arrays are skipped, not kept (only their shape comes back). */
  value(type) {
    if (type === T.STRING) return this.str();
    if (type !== T.ARRAY) return this.scalar(type);
    const elem = this.u32();
    const count = this.u64();
    if (elem in SCALAR_SIZE) {
      this.need(count * SCALAR_SIZE[elem]);
      this.p += count * SCALAR_SIZE[elem];
    } else {
      for (let i = 0; i < count; i++) this.value(elem);
    }
    return { array: true, type: elem, length: count };
  }
}

/**
 * The keys the runtime cares about, from the first bytes of a GGUF. Never
 * throws on a short buffer: `truncated` says the read stopped early, and
 * whatever came before it is filled in.
 */
export function parseGgufHead(bytes) {
  const out = { version: 0, tensorCount: 0, kvCount: 0, keysRead: 0, arch: "", name: "", fileType: null, expertCount: 0, expertUsedCount: 0, blockCount: 0, contextLength: 0, embeddingLength: 0, headCount: 0, headCountKv: 0, keyLength: 0, valueLength: 0, truncated: false, error: "" };
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const r = new Reader(u8);
  try {
    r.need(4);
    if (!(u8[0] === 0x47 && u8[1] === 0x47 && u8[2] === 0x55 && u8[3] === 0x46)) {
      out.error = "not a GGUF file";
      return out;
    }
    r.p = 4;
    out.version = r.u32();
    if (out.version < 2) {
      out.error = `GGUF version ${out.version} is too old to read`;
      return out;
    }
    out.tensorCount = r.u64();
    out.kvCount = r.u64();
    const arch = () => out.arch;
    for (let i = 0; i < out.kvCount; i++) {
      const key = r.str();
      const type = r.u32();
      // the tokenizer's arrays are the bulk of the header; everything the plan needs came before them
      if (key.startsWith("tokenizer.") && arch()) break;
      const v = r.value(type);
      out.keysRead++;
      if (typeof v === "object" && v?.array) continue;
      if (key === "general.architecture") out.arch = String(v);
      else if (key === "general.name") out.name = String(v);
      else if (key === "general.file_type") out.fileType = Number(v);
      else if (arch() && key.startsWith(`${arch()}.`)) {
        const k = key.slice(arch().length + 1);
        if (k === "expert_count") out.expertCount = Number(v) || 0;
        else if (k === "expert_used_count") out.expertUsedCount = Number(v) || 0;
        else if (k === "block_count") out.blockCount = Number(v) || 0;
        else if (k === "context_length") out.contextLength = Number(v) || 0;
        else if (k === "embedding_length") out.embeddingLength = Number(v) || 0;
        else if (k === "attention.head_count") out.headCount = Number(v) || 0;
        else if (k === "attention.head_count_kv") out.headCountKv = Number(v) || 0;
        else if (k === "attention.key_length") out.keyLength = Number(v) || 0;
        else if (k === "attention.value_length") out.valueLength = Number(v) || 0;
      }
    }
  } catch (e) {
    if (e instanceof RangeError) out.truncated = true;
    else out.error = e.message;
  }
  return out;
}

/** A mixture of experts: the header names more than one expert. */
export function isMoe(head) {
  return (head?.expertCount || 0) > 1;
}

/**
 * Bytes the KV cache takes at `ctx` tokens, from the header's shape (layers x
 * tokens x KV heads x (key + value dims) x bytes per element), or null when
 * the header did not say enough. Half precision by default; 1 for an 8-bit
 * cache.
 */
export function kvBytes(head, ctx, bytesPerElem = 2) {
  if (!head?.blockCount || !ctx) return null;
  const heads = head.headCountKv || head.headCount;
  const headDim = head.keyLength || (head.embeddingLength && head.headCount ? head.embeddingLength / head.headCount : 0);
  if (!heads || !headDim) return null;
  const vDim = head.valueLength || headDim;
  return head.blockCount * ctx * heads * (headDim + vDim) * bytesPerElem;
}
