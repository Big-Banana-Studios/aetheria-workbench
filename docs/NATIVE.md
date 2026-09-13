# The in-app runtime (phase two)

Agreed 2026-09-08: no browser needed on Android. The workbench's own `dist/`
runs inside a Capacitor shell, and a native plugin runs llama.cpp's server
inside the app on the phone's GPU. This file is the plan and the build
recipe; it is updated as each step lands.

## Architecture

```
┌──────────────── Android app (Capacitor) ─────────────────┐
│  WebView  http://localhost/  (dist/, the same site)        │
│     brain.js ── native.js ── LlamaServer plugin (Kotlin)   │
│                                   │ ProcessBuilder         │
│                     libllamaserver.so  (llama-server, arm64, OpenCL/Vulkan)
│                        ⇅ http://127.0.0.1:8080/v1  (OpenAI-compatible)
│  models: <external files>/models/*.gguf  (downloaded by the plugin)
└────────────────────────────────────────────────────────────┘
```

- The WebView's scheme is `http` (`capacitor.config.json` →
  `server.androidScheme`), so a fetch to `http://127.0.0.1` is never mixed
  content. `usesCleartextTraffic` is on for that one host.
- The brain gains a third backend, **native**: `native.js` asks the plugin
  for a running server (starting one with the preferred model if needed) and
  the existing lab client (`lab.js`) talks to it. Streaming, thinking switch,
  images and stats all work unchanged, because llama-server speaks the same
  protocol as the Olares instance.
- The server binary ships as a "native library" named `libllamaserver.so` in
  `jniLibs/arm64-v8a/`, with legacy packaging on so the installer extracts it
  to `nativeLibraryDir`, where the app may execute it. ggml's backend
  libraries ship beside it the same way.
- Voice: phase 2 keeps the web workers (Kokoro, Moonshine, Silero run on
  WASM in the WebView; WebGPU where the WebView has it). Phase 3 replaces
  them with sherpa-onnx through the same plugin so speech no longer depends
  on the WebView's GPU access.

## Plugin contract

```
status()                       -> {running, healthy, phase, port, model, backend, pid, uptime, foreground, log, download}
listModels()                   -> {dir, models: [{name, path, size}]}
download({url, name})          -> {path, size}; event "download" {name, loaded, total, done}
pickModel()                    -> {name, path, size} or {cancelled}
deleteModel({name})            -> {}
start({model, port, ctx, backend, args, foreground}) -> {port, model, backend, pid, foreground}
stop()                         -> {}
device()                       -> {soc, ram, gpu, backends: ["opencl", "vulkan", "cpu"]}
readHead({model, bytes})       -> {data (base64), size, bytes}: the first bytes of a model (its GGUF header, 1 MB by default, 8 MB at most)
```

The process lives in `LlamaRuntime` (one per app process, so a server
started before the activity was recreated is still found) and, with
`foreground` (the default; Settings → Native runtime → keep the server up),
`LlamaServerService` holds it: a special-use foreground service with one
notification (the model, the port, a Stop button), started by the plugin
just before the model loads, while the app is in front as Android 12+
requires, and let go when the plugin stops the server, the button is
pressed, or the server dies. Without it Android kills the app in the
background and the server with it, which is how Mira in Chrome (talking to
`http://127.0.0.1:8080/v1`) lost her brain. Android 13+ asks once for the
notification permission; the service runs either way.

`start` runs:

```
libllamaserver.so -m <path> --host 127.0.0.1 --port <port> -c <ctx> -ngl 99
    --jinja --reasoning-format deepseek -fa on --api-key none
```

with `LD_LIBRARY_PATH=<nativeLibraryDir>` and the GPU backend chosen by
`backend`: `auto` tries OpenCL, then Vulkan, then CPU, and remembers what
worked. The plugin tails the process's stdout into a ring buffer for
`status().log`, and stops the process when the app is destroyed.

## How a model is loaded (0.3.19)

Before `start`, the app reads the model's GGUF header through `readHead`
(`src/gguf.js`: the architecture, the expert count, the layer and head counts)
and `src/launch.js` plans the launch from it, the file's size and the phone's
RAM (`device().ram`). Two settings under Native runtime, both `auto`:

- **Loading** (`settings.native.loadMode`): `resident` reads the weights into
  memory once (`--load-mode none`, the old `--no-mmap`), which Android cannot
  page out, so the speed stays steady; `mapped` memory-maps them
  (`--load-mode mmap`, llama.cpp's default), which is how a model bigger than
  the RAM still runs, slowly, from storage. `auto` is resident when the model,
  its KV cache at the chosen context and a reserve fit with room, mapped when
  it is tight or too big.
- **Mixture-of-experts weights** (`settings.native.cpuMoe`): `--cpu-moe` keeps
  the experts on the CPU and sends attention and the dense layers to the GPU.
  `auto` adds it for a MoE on a GPU backend; `on` for any model there; `off`
  never.

A model bigger than the phone's memory also gets the CPU build (a GPU build
has to hold the whole model in memory), the context capped at 8192 and an
8-bit KV cache (`-ctk q8_0 -ctv q8_0`). The plan's sentence sits under the
model picker and changes as you pick; `status().log` shows the exact command
line. The flag spellings are those of the llama.cpp we ship (2026-09-08),
where `--no-mmap`/`--mlock` still work but warn. Untested on the phone so far:
`--cpu-moe` with the OpenCL build (the 30B-A3B gets it by default now; the
Mixture-of-experts setting turns it off), and a resident load's start time.
## Building llama-server for the phone

Toolchain, installed 2026-09-08 through the SDK manager into
`%LOCALAPPDATA%\Android\Sdk`: `cmdline-tools` (15859902), **NDK
28.2.13676358**, **CMake 3.31.6** (with its Ninja). Sources cloned shallow
into `~/aetheria-native/` (`C:\Users\jobo1\aetheria-native`): `llama.cpp`,
`OpenCL-Headers`, `OpenCL-ICD-Loader`. They live outside the repo because
this repo's path has a space in it and the ICD loader's CMake passes linker
script paths unquoted; `NATIVE_SRC` overrides the location.

`native/build_android.sh` does the whole thing from Git Bash, following
llama.cpp's `docs/backend/OPENCL.md` and `docs/build.md`:

1. copies the OpenCL headers into the NDK sysroot and builds the ICD loader
   for arm64 (`ANDROID_STL=c++_shared`, platform 24), copying `libOpenCL.so`
   into the sysroot's `aarch64-linux-android` lib dir, so the OpenCL variant
   links;
2. configures and builds `llama-server` three times with the Android options
   the project recommends (`GGML_NATIVE=OFF`, `GGML_OPENMP=OFF`,
   `GGML_LLAMAFILE=OFF`, `GGML_CPU_KLEIDIAI=ON`, `LLAMA_OPENSSL=OFF`,
   `LLAMA_CURL=OFF`, static libs): `build-opencl` (`GGML_OPENCL=ON`,
   Adreno kernels on), `build-vulkan` (`GGML_VULKAN=ON`, best effort: it
   needs a host C++ compiler for the shader generator), `build-cpu`.

```
bash native/build_android.sh            # all three
bash native/build_android.sh opencl     # one
node tools/pack_native.mjs              # -> android/app/src/main/jniLibs/arm64-v8a/libllamaserver_<backend>.so
npx cap sync android
cd android && ./gradlew assembleDebug   # -> app/build/outputs/apk/debug/app-debug.apk
```

`tools/pack_native.mjs` names each binary `libllamaserver_<backend>.so` so
the installer extracts it (legacy jniLibs packaging is on in
`app/build.gradle`) and the plugin can execute it from `nativeLibraryDir`.

Known risk: a regular app can only load the vendor's `libOpenCL.so` if the
device lists it in `/vendor/etc/public.libraries.txt`, and a subprocess
started from `nativeLibraryDir` lives in the linker's default namespace,
which is stricter still. Qualcomm devices generally expose the library; the
plugin also puts `/vendor/lib64` on the server's `LD_LIBRARY_PATH`. If the
ROG refuses it, two fallbacks exist and the plugin tries them in order: the
Vulkan build (`libvulkan.so` is a system library, reachable from anywhere),
then CPU with KleidiAI. If OpenCL turns out to work in-process but not as a
subprocess, plan B is to build the server as a shared library (compile
`server.cpp` with `-Dmain=llama_server_main`, a small JNI shim, `raise(SIGINT)`
to stop) and run it on a thread inside the app, where public vendor
libraries are allowed. `device()` reports which backends actually started.

## Models

Downloaded by the plugin into `getExternalFilesDir("models")`, resumable
(HTTP Range), with progress events the workbench shows in its download panel.
First candidates for the ROG (24 GB RAM):

| Model | Size Q4_K_M | Notes |
|---|---|---|
| Qwen3-8B | ~5 GB | the sensible daily driver |
| Qwen3-14B | ~9 GB | slower, better |
| Qwen2.5-VL-7B | ~5 GB + mmproj | vision for the sprite inspector and image drops (`--mmproj`) |
| Gemma 3 12B | ~7 GB | vision-capable, alternative |
| Qwen3-30B-A3B | ~18 GB | MoE: fits, and only 3B active, so fast for its size |

The workbench's hardware probe (Settings → Hardware) gains a native section
with the SoC, RAM, and which backend started, and recommends a model from
this table.

## PC app

The same shape with a sidecar: Tauri (WebView2 on Windows) or Electron, with
`llama-server.exe` (CUDA build, from llama.cpp's releases) launched by the
shell and the brain pointed at `http://127.0.0.1:8080/v1`. LM Studio and
Ollama already provide that endpoint on a PC, so this is the lowest priority.

## Order of work, and where it stands (2026-09-08)

1. **Done.** `npx cap add android`; `capacitor.config.json` with `androidScheme: http` and cleartext; `usesCleartextTraffic` and `largeHeap` in the manifest; `abiFilters arm64-v8a` and legacy jniLibs packaging in `app/build.gradle`; `android/local.properties` points at the SDK (git-ignored).
2. **Done.** `LlamaServerPlugin.java` (status, device, listModels, download with HTTP Range resume and progress events, deleteModel, start with backend fallback and a `/health` wait, stop; the process is killed with the activity), registered in `MainActivity`. First `gradlew assembleDebug` passed: `app-debug.apk`.
3. **Done.** `src/native.js`, the `native` backend in `brain.js` (lab first, then in-app, then WebGPU), `/brain native`, and Settings → Native runtime (device line, model list, context, backend, start/stop, download by URL, log tail). The hardware probe adds the plugin's SoC/RAM/backends inside the app. The web build and the headless checks still pass.
4. **Done for OpenCL and CPU; Vulkan blocked on two prerequisites.** NDK 28.2 and CMake 3.31.6 installed; `native/build_android.sh` built `build-opencl/bin/llama-server` (arm64, static, needs only libc/libm/libdl and the vendor's libOpenCL.so) and `build-cpu/bin/llama-server` (KleidiAI); `tools/pack_native.mjs` strips them with llvm-strip into `jniLibs/arm64-v8a/` (about 15 MB each) and the APK carries both. The Vulkan configure stops at `find_package(SPIRV-Headers)`: it wants the SPIRV-Headers CMake package (clone `KhronosGroup/SPIRV-Headers` and `cmake --install` it into the NDK sysroot, or pass `-DSPIRV-Headers_DIR`), and then `vulkan-shaders-gen` must be built for the host, which needs a host C++ toolchain on PATH (Visual Studio 2022 is installed; run the script from a Developer Command Prompt, or pass `-DGGML_VULKAN_SHADERS_GEN_TOOLCHAIN`). Only worth doing if OpenCL fails on the phone.
5. **Next.** Sideload `app-debug.apk` on the ROG (`bash tools/phone_check.sh`), push or download a GGUF (`bash tools/phone_check.sh push <model.gguf>`), Settings → Native runtime → Start, and measure tokens per second per backend. The first question the phone answers is whether a subprocess may load the vendor's libOpenCL.so; if not, Vulkan or plan B (in-process JNI).
6. **Done (2026-09-09).** The foreground service above, `LlamaRuntime` split out of the plugin, `foreground` on `start`, the keep-alive switch in Settings → Native runtime; release 0.2.6 (versionCode 8). Untested on the phone: that the special-use service survives the app being swiped away, and that Chrome's turn to the server goes through while the Workbench is in the background.
7. sherpa-onnx for voice (phase 3); the PC sidecar app.

## Mira's voice in-app: llama-tts (2026-09-12)

`native/build_android.sh` now builds `llama-tts` beside `llama-server` (the
same CMake tree; the target came with llama.cpp's Qwen3-TTS support, merged
2026-08-04, which the checkout of 2026-09-08 carries), and
`tools/pack_native.mjs` ships it as `libllamatts_<backend>.so`. The plugin
gained `ttsStatus({model})` and `tts({text, model, lang, frames, backend})`:
one clip per call, the binary run per line with `-m <backbone> -mm <mmproj>
-p <text> --tts-speaker-file <bella-ref.wav> -n <cap> -o <wav>`, WAV bytes
back as base64. The model pair lives in `models/` like any GGUF (a name
with "tts" in it, and its projector `<stem>-mmproj*.gguf` beside it; the
catalog's "Qwen3-TTS 1.7B" entry downloads the official pair, the 0.6B
pair is converted on the PC, see `../voice-model/README.md`). The CPU build
is the default backend for the voice: the audio decoder is a CPU graph
anyway, and OpenCL for the talker is untested. Untested on the phone as of
this note: whether `llama-tts` runs at all as a subprocess (the same
question as the server, which does), how far from real time it lands, and
whether the speaker clip is read from the files dir (copied from the web
assets on first use).

## Exports into Downloads (2026-09-12)

`saveDownload({name, mime, data: base64})` writes a file into the phone's
Downloads under `AetheriaWorkbench` through MediaStore (Android 10 and
later, no permission; the app's own Download folder before that) and
answers `{uri, path, bytes}`. `src/ui.js` `download()` goes through it
inside the app, so the stage's video, the whole-set audio and the cutscene
package all land there; on the web the `<a download>` path is unchanged.
The base64 crosses the Capacitor bridge as one string, so a long video is a
few seconds of copying; audio and packages are quick.

Since 0.3.9 the page streams a file instead of sending it whole:
`downloadBegin({name, mime}) -> {id, path}` opens the pending MediaStore
entry, `downloadChunk({id, data})` appends one base64 piece (the page sends
one megabyte at a time, in order), `downloadEnd({id})` publishes it and
answers `{uri, path, bytes}`; `downloadEnd({id, abort: true})` throws a
half-written file away. A five-minute set's video (about 150 MB at 4 Mbps)
takes a few seconds of copying that way; one string of that size never
crossed the bridge, which is why the first phone test got the package and
no video. `saveDownload` (one call) stays for small files.

## The PC runtime host (0.3.20, 2026-09-13)

The same contract on the PC, without a shell: `tools/pc_runtime.mjs` is the
Node process the launcher runs (`tools/launch_pc.cmd`, `npm run pc`). It
serves `dist/` and answers the plugin's methods under `/runtime/<method>`
(POST with a JSON body; GET for `status`, `device`, `servers`, `listModels`,
`releases`), loopback callers from the page's own origin only. `src/native.js`
probes `/runtime/status` at boot (`native.probe()`; `native.kind` is
`"plugin"` on the phone, `"host"` on the PC, null elsewhere) and routes every
call to whichever is here; `native.isApp()` is the phone only, for llama-tts
and the Downloads bridge, which the host does not have.

```
┌──────────────── the PC ───────────────────────────────────────┐
│  Chrome --app  http://localhost:4173/  (dist/)                  │
│     brain.js ── native.js ──(fetch /runtime/*)── pc_runtime.mjs │
│                                                    │ spawn      │
│                      llama-server.exe  (llama.cpp's Windows build: CUDA / Vulkan / CPU)
│                         ⇅ http://127.0.0.1:8080/v1              │
│  %LOCALAPPDATA%\AetheriaWorkbench\models\*.gguf  + linked paths (runtime.json)
│  %LOCALAPPDATA%\AetheriaWorkbench\llama\<backend>\  (installed builds)
└─────────────────────────────────────────────────────────────────┘
```

- `device()` adds `vram` (from `nvidia-smi`; 0 without an NVIDIA card),
  `builds` and the `backends` they carry, read from the ggml DLLs beside
  each `llama-server.exe` (`ggml-cuda.dll` → cuda, `ggml-vulkan.dll` →
  vulkan, every build → cpu). Builds are found in this order: `--server` /
  `LLAMA_SERVER`, the installed ones, the ones chosen by hand
  (`setServer`/`pickServer`), `Desktop\llama.cpp`, the PATH.
- `start()` runs, per candidate backend (auto: cuda, vulkan, cpu):
  `llama-server -m <path> --host 127.0.0.1 --port <port> -c <ctx> --jinja
  --reasoning-format deepseek -fa auto -ngl 99` (`-ngl 0` for the CPU
  backend; the plan's `-ngl N` kept when it sized a split), `--mmproj` for a
  projector beside the model, and the plan's flags translated for the build
  (`--help` is read once per binary: `--load-mode none` → `--no-mmap` where
  `--load-mode` is unknown, `mmap` dropped, `--cpu-moe` only where it
  exists). Then `/health` up to five minutes, the next backend on failure,
  stdout and stderr in a 300-line ring for `status().log`.
- `installServer({backend})` picks the newest `bNNNN` release on GitHub
  with the Windows zips (llama.cpp's own `latest` points at a nightly tag
  with none), downloads `llama-<tag>-bin-win-<cuda-12.4|vulkan|cpu>-x64.zip`
  (plus `cudart-llama-bin-win-cuda-12.4-x64.zip` for CUDA), unpacks with
  Windows' bsdtar (`Expand-Archive` as the fallback) into `llama\<backend>.new`,
  then swaps it in; `aetheria-install.json` beside the binary carries the
  tag. Progress in `status().install`.
- `pickModel()` and `pickServer()` open a file dialog through PowerShell
  (STA, a topmost invisible owner so it comes to the front); a picked GGUF
  is linked, not copied (`runtime.json` → `links`); `linkModel({path})`
  does the same for a typed path; `deleteModel` on a linked file only
  forgets it.
- `ttsStatus()` is never ready on the PC (the Qwen voice server in
  `tools/qwen_tts_server.py` is Mira's voice there) and the Downloads bridge
  is absent: `speech.js` and `ui.js` ask `native.isApp()` before using
  either.

Measured on this laptop (RTX 4090 Laptop 16 GB, 2026-09-13): the Desktop's
b7003 CUDA build loads an 8B Q4_0 whole on the card in under four seconds
with `--no-mmap` and answers at about 88 tokens per second; a Windows build
older than 2026 does not know the Qwen3.5 architecture, which is what the
one-click install is for.
