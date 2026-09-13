// The Kokoro side of the voice audition: the same three Mira lines read by
// Nicole and the other female Kokoro voices (the baseline the Qwen3-TTS
// voices are judged against), plus a clean reference clip of Nicole with
// its transcript, for Qwen3-TTS voice cloning ("a more emotive Nicole").
//
//   node tools/kokoro_audition.mjs [--out ../voice-audition] [--voices af_nicole,af_heart,af_bella,af_sarah]
//
// Kokoro runs here as in make_package.mjs (kokoro-js on onnxruntime-node,
// the model cached by Transformers.js after the first run).

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWav } from "../src/openmic/wav.js";
import { LINES, REF } from "./audition_lines.mjs";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const out = resolve(root, opt("out", join("..", "voice-audition")));
const voices = opt("voices", "af_nicole,af_heart,af_bella,af_sarah").split(",").map((v) => v.trim()).filter(Boolean);
mkdirSync(out, { recursive: true });

const { KokoroTTS } = await import("kokoro-js");
console.log("loading Kokoro…");
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });

async function render(text, voice, speed = 1) {
  const audio = await tts.generate(text, { voice, speed });
  return Buffer.from(encodeWav(audio.audio, audio.sampling_rate));
}

// the reference clips for cloning (Nicole, and Bella since she won): speed 1, one calm line, the transcript beside each
for (const ref of opt("refs", "af_nicole,af_bella").split(",").map((v) => v.trim()).filter(Boolean)) {
  writeFileSync(join(out, `ref-${ref}.wav`), await render(REF, ref));
  writeFileSync(join(out, `ref-${ref}.txt`), REF);
  console.log(`wrote ref-${ref}.wav`);
}

for (const voice of voices) {
  for (const [key, text] of LINES) {
    const name = `kokoro-${voice}-${key}.wav`;
    writeFileSync(join(out, name), await render(text, voice));
    console.log("wrote", name);
  }
}
console.log(`done: ${voices.length} voices × ${LINES.length} lines in ${out}`);
