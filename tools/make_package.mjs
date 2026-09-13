// A cutscene package from a set, on the PC: the same parser, timeline and
// WAV writer the browser uses, with Kokoro run in Node (kokoro-js on
// onnxruntime-node, the model cached by Transformers.js after the first
// run). Used to build the sample package that ships with the game.
//
//   node tools/make_package.mjs sets/first-draft-punched.md
//   node tools/make_package.mjs sets/x.md --out "../Paperless/paperless/cutscene/samples" --voice af_bella --speed 1 --bits 3 --zip
//   node tools/make_package.mjs sets/x.md --engine qwen      (Bella through Qwen3-TTS: tools/qwen_tts_server.py must be up)
//
// Writes <out>/performance-<slug>/{manifest.json, set.md, audio/lNNN.wav}
// (and a .zip beside it with --zip). Clips are cached in .cache/audio by
// text hash, like the browser's cache, so a rerun costs nothing.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSet, timeline, setMarkdown, slugOf } from "../src/openmic/set.js";
import { encodeWav, decodeWav } from "../src/openmic/wav.js";
import { zipStore } from "../src/openmic/zip.js";
import { cleanForSpeech } from "../src/speech.js";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const file = args.find((a) => !a.startsWith("--") && !args.includes(`--${args[args.indexOf(a) - 1]?.slice(2)}`) && /\.md$/i.test(a));
if (!file) {
  console.error("usage: node tools/make_package.mjs <set.md> [--out dir] [--voice af_bella] [--speed 1] [--bits N] [--zip] [--style 'suno style prompt']");
  process.exit(2);
}
const out = resolve(opt("out", join(root, "sets", "packages")));
const voice = opt("voice", "af_bella");
const speed = Number(opt("speed", "1")) || 1;
const bitsMax = Number(opt("bits", "0")) || 0;
const style = opt("style", "");
const wantZip = args.includes("--zip");
// --engine qwen: the lines through tools/qwen_tts_server.py (Bella's Qwen3-TTS clone) instead of Kokoro; --qwen-url its address
const engine = opt("engine", "kokoro");
const qwenUrl = opt("qwen-url", "http://127.0.0.1:8123").replace(/\/+$/, "");
const cacheDir = join(root, ".cache", "audio");
mkdirSync(cacheDir, { recursive: true });

const GAP = 0.35;
const BEAT = 0.9;
const BIT_GAP = 1.2;
const ASIDE_SPEED = 0.85;

function hashText(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

let md = readFileSync(resolve(file), "utf8");
// a punched file carries a preamble and a "## Punched" section: take the set inside it
const punched = /##\s*punched\s*\n([\s\S]*?)(?=\n##\s*notes|$)/i.exec(md);
if (punched) md = punched[1];
const set = parseSet(md);
if (!set.isSet) {
  console.error("no set found in", file);
  process.exit(1);
}
if (bitsMax && set.bits.length > bitsMax) {
  set.bits = set.bits.slice(0, bitsMax);
  set.lines = set.bits.flatMap((b) => b.lines);
}
const slug = slugOf(set.title);
const dir = join(out, `performance-${slug}`);
mkdirSync(join(dir, "audio"), { recursive: true });
console.log(`${set.title}: ${set.bits.length} bits, ${set.lines.length} lines, ~${set.runtime}s read aloud`);

let tts = null;
async function synth(text, spd) {
  if (engine === "qwen") {
    const r = await fetch(`${qwenUrl}/v1/audio/speech`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: text, voice: "bella", speed: spd }) });
    if (!r.ok) throw new Error(`qwen voice server ${r.status} at ${qwenUrl} (start it: python tools/qwen_tts_server.py)`);
    const dec = decodeWav(await r.arrayBuffer());
    return { samples: dec.samples, sampleRate: dec.sampleRate };
  }
  if (!tts) {
    const { KokoroTTS } = await import("kokoro-js");
    console.log("loading Kokoro (the first run downloads it)…");
    tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
  }
  const audio = await tts.generate(text, { voice, speed: spd });
  return { samples: audio.audio, sampleRate: audio.sampling_rate };
}

const durations = [];
let n = 0;
for (let i = 0; i < set.lines.length; i++) {
  const line = set.lines[i];
  if (line.direction) {
    durations.push(null);
    continue;
  }
  const spd = +(line.aside ? speed * ASIDE_SPEED : speed).toFixed(2);
  const clean = cleanForSpeech(line.spoken);
  const key = `${engine === "qwen" ? "qwen-bella" : voice}-${spd}-${hashText(clean)}`;
  const cached = join(cacheDir, `${key}.wav`);
  let wav;
  if (existsSync(cached)) wav = readFileSync(cached).buffer.slice(0);
  else {
    const r = await synth(clean, spd);
    wav = encodeWav(r.samples, r.sampleRate);
    writeFileSync(cached, Buffer.from(wav));
  }
  const dec = decodeWav(wav);
  durations.push(dec.samples.length / dec.sampleRate);
  writeFileSync(join(dir, "audio", `l${String(i + 1).padStart(3, "0")}.wav`), Buffer.from(wav));
  n++;
  process.stdout.write(`\r  ${n} clips`);
}
console.log();
const tl = timeline(set, durations, { gap: GAP, beat: BEAT, bitGap: BIT_GAP });
const manifest = {
  title: set.title,
  slug,
  created: new Date().toISOString(),
  duration: tl.duration,
  sprite: "courier",
  stage: "undercity-open-mic",
  aura: "#ff8a3c",
  sampleRate: 24000,
  voice: engine === "qwen" ? "qwen-bella" : voice,
  pullQuote: set.pullQuote || "",
  style: style || null,
  lines: tl.lines,
};
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
writeFileSync(join(dir, "set.md"), setMarkdown(set, { style }));
console.log(`wrote ${dir} (${tl.lines.length} lines, ${tl.duration}s)`);
if (wantZip) {
  const files = [
    { name: `performance-${slug}/manifest.json`, data: JSON.stringify(manifest, null, 1) },
    { name: `performance-${slug}/set.md`, data: setMarkdown(set, { style }) },
  ];
  tl.lines.forEach((l) => l.audio && files.push({ name: `performance-${slug}/audio/${l.audio}`, data: readFileSync(join(dir, "audio", l.audio)) }));
  writeFileSync(join(out, `performance-${slug}.zip`), zipStore(files));
  console.log(`wrote ${join(out, `performance-${slug}.zip`)}`);
}
