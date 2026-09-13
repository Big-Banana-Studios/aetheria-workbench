// Copies the llama-server binaries built for Android (docs/NATIVE.md) into
// the APK's jniLibs as libllamaserver_<backend>.so, plus any shared
// libraries beside them, so the installer extracts them to nativeLibraryDir
// and LlamaServerPlugin can run them.
//
//   node tools/pack_native.mjs [--src <path to llama.cpp>]
// The default is ~/aetheria-native/llama.cpp, where native/build_android.sh
// builds (a path without spaces; see the note in that script).

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcArg = process.argv.indexOf("--src");
const src = srcArg > 0 ? process.argv[srcArg + 1] : process.env.NATIVE_SRC ? join(process.env.NATIVE_SRC, "llama.cpp") : join(homedir(), "aetheria-native", "llama.cpp");
const out = join(root, "android", "app", "src", "main", "jniLibs", "arm64-v8a");
mkdirSync(out, { recursive: true });

// llvm-strip from the NDK: the build carries debug info (about 195 MB); stripped it is a fraction of that
function findStrip() {
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
  const ndkDir = join(sdk, "ndk");
  if (!existsSync(ndkDir)) return null;
  const versions = readdirSync(ndkDir).sort();
  for (const v of versions.reverse()) {
    for (const host of ["windows-x86_64", "linux-x86_64", "darwin-x86_64"]) {
      const p = join(ndkDir, v, "toolchains", "llvm", "prebuilt", host, "bin", process.platform === "win32" ? "llvm-strip.exe" : "llvm-strip");
      if (existsSync(p)) return p;
    }
  }
  return null;
}
const strip = findStrip();

let packed = 0;
for (const backend of ["opencl", "vulkan", "cpu"]) {
  const bin = join(src, `build-${backend}`, "bin");
  const server = join(bin, "llama-server");
  if (!existsSync(server)) {
    console.log(`pack_native: no ${backend} build (${server})`);
    continue;
  }
  const dest = join(out, `libllamaserver_${backend}.so`);
  copyFileSync(server, dest);
  if (strip) {
    const r = spawnSync(strip, ["--strip-all", dest], { stdio: "inherit" });
    if (r.status !== 0) console.warn("pack_native: strip failed; shipping unstripped");
  }
  console.log(`pack_native: ${backend}  ${(statSync(server).size / 1048576).toFixed(1)} MB -> libllamaserver_${backend}.so (${(statSync(dest).size / 1048576).toFixed(1)} MB${strip ? ", stripped" : ""})`);
  packed++;
  // llama-tts, when the build made it: Mira's Qwen3-TTS voice on the phone (LlamaRuntime.ttsBinary)
  const tts = join(bin, "llama-tts");
  if (existsSync(tts)) {
    const tdest = join(out, `libllamatts_${backend}.so`);
    copyFileSync(tts, tdest);
    if (strip) spawnSync(strip, ["--strip-all", tdest], { stdio: "inherit" });
    console.log(`pack_native:   + llama-tts -> libllamatts_${backend}.so (${(statSync(tdest).size / 1048576).toFixed(1)} MB)`);
  } else console.log(`pack_native:   (no llama-tts in the ${backend} build; rebuild with native/build_android.sh for her voice on the phone)`);
  for (const f of readdirSync(bin)) {
    if (f.endsWith(".so") && !f.startsWith("libllamaserver")) {
      // a shared ggml/llama build: ship its libraries beside the binary (later backends overwrite same-named files)
      copyFileSync(join(bin, f), join(out, f));
      console.log(`pack_native:   + ${f}`);
    }
  }
}
if (!packed) {
  console.error("pack_native: nothing packed. Build llama-server for Android first (docs/NATIVE.md).");
  process.exit(1);
}
console.log(`pack_native: ${packed} backend(s) into ${out}. Now: npx cap sync android && cd android && gradlew assembleDebug`);
