// WAV in and out, for the cutscene package: one 16-bit PCM mono file per
// line at Kokoro's 24 kHz. Pure: Node and the browser both use it.

/** Float32 samples (-1..1) to a RIFF/WAVE ArrayBuffer, 16-bit PCM, one channel. */
export function encodeWav(samples, sampleRate = 24000) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true);
  }
  return buf;
}

/** The reverse, for the audio cache and the tests: {samples: Float32Array, sampleRate}. */
export function decodeWav(buf) {
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let o = 12;
  let sampleRate = 24000;
  let bits = 16;
  let channels = 1;
  while (o + 8 <= v.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      channels = v.getUint16(o + 10, true);
      sampleRate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (id === "data") {
      const n = Math.floor(size / (bits / 8) / channels);
      const out = new Float32Array(n);
      const d = o + 8;
      for (let i = 0; i < n; i++) {
        const at = d + i * channels * (bits / 8);
        out[i] = bits === 16 ? v.getInt16(at, true) / 32768 : bits === 8 ? (v.getUint8(at) - 128) / 128 : v.getFloat32(at, true);
      }
      return { samples: out, sampleRate };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error("WAV has no data chunk");
}
