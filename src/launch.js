// The local runtime's launch plan (pure, tested in tools/smoke.mjs). Given
// the model's size and header, the machine's RAM (and, on a PC with a card,
// its VRAM) and the backends that are here, it decides how llama-server
// loads the model, where a mixture of experts keeps its experts, how many
// layers a discrete card takes, and says so in a sentence for the settings
// panel. Two settings drive it, both "auto" by default:
//
//   loadMode  auto | resident | mapped
//     resident: the weights are read into memory once (llama.cpp's no-mmap;
//               `--load-mode none` on the build we ship, `--no-mmap` on an
//               older PC build: tools/pc_runtime.mjs translates) and the OS
//               cannot page them out, so the speed stays steady. It must fit.
//     mapped:   memory-mapped from storage (the default llama.cpp behaviour):
//               a model bigger than the RAM still runs, slowly, as the OS
//               pages the weights in and out.
//     auto:     resident when the model, its KV cache and a reserve fit in
//               the RAM with room; mapped when it is tight or too big.
//   cpuMoe    auto | on | off
//     `--cpu-moe` keeps the expert weights on the CPU and sends the attention
//     and dense layers to the GPU. auto: on for a mixture of experts on a GPU
//     backend; on: any model on a GPU backend; off: never.
//
// On the phone (one memory shared by the CPU and the GPU) a model bigger
// than the memory also gets the CPU build (GPU buffers cannot be paged), the
// context capped, and an 8-bit KV cache. On a PC with a discrete card the
// card's memory decides how many layers it takes (`-ngl N`); the rest stay
// on the CPU, and a model bigger than the RAM is mapped and capped the same
// way but keeps the card.

import { isMoe, kvBytes } from "./gguf.js";

export const GB = 1073741824;
export const LOAD_MODES = ["auto", "resident", "mapped"];
export const CPU_MOE_MODES = ["auto", "on", "off"];
/** The flag spelling for each load mode, for the llama.cpp we ship (2026-09-08; `--no-mmap` is the deprecated twin of `none`). */
export const LOAD_FLAGS = { resident: ["--load-mode", "none"], mapped: ["--load-mode", "mmap"] };
export const BIG_CTX = 8192;

const gb = (b) => (b / GB).toFixed(1); // the same binary gigabytes as ui.js fmtBytes, so the numbers match the model list

/**
 * @param {object} o
 * @param {number} o.size      the model file's bytes (0 = unknown)
 * @param {number} o.ram       the machine's total RAM in bytes (0 = unknown)
 * @param {number} o.vram      a discrete card's memory in bytes (0 = none or unknown: shared memory, an iGPU, the phone)
 * @param {object|null} o.head parseGgufHead() of the file, or null
 * @param {string[]} o.backends the server builds here, e.g. ["opencl", "cpu"] (phone) or ["cuda", "vulkan", "cpu"] (PC)
 * @param {object} o.prefs     settings.native: {ctx, backend, loadMode, cpuMoe}
 * @param {boolean} o.pc       the PC runtime (the wording, and a big model keeps the card)
 */
export function planLaunch({ size = 0, ram = 0, vram = 0, head = null, backends = [], prefs = {}, pc = false }) {
  const ctxWant = Math.max(2048, Number(prefs.ctx) || 32768);
  const want = prefs.backend || "auto";
  const loadPref = LOAD_MODES.includes(prefs.loadMode) ? prefs.loadMode : "auto";
  const moePref = CPU_MOE_MODES.includes(prefs.cpuMoe) ? prefs.cpuMoe : "auto";
  const moe = isMoe(head);
  const kv = kvBytes(head, ctxWant) ?? Math.min(2 * GB, size * 0.15);
  const known = size > 0 && ram > 0;
  const here = pc ? "this PC's" : "the phone's";
  // a model that does not even leave the system its floor cannot be held at all; resident (no paging to fall back on) wants the
  // cache and real slack on top: the OS, the browser and the server's own buffers take a few GB, and a resident model that
  // does not fit is killed rather than slowed
  const floor = Math.max(1.5 * GB, ram * 0.06);
  const room = Math.max(4 * GB, ram * 0.2);
  const zone = !known ? "unknown" : size + floor > ram ? "big" : size + kv + room <= ram ? "comfortable" : "tight";
  const notes = [];
  const args = [];
  let backend = want;
  let ctx = ctxWant;
  let load = loadPref === "auto" ? (zone === "comfortable" ? "resident" : "mapped") : loadPref;
  if (zone === "big") {
    if (load === "resident") {
      notes.push(`Loading into memory was asked for, but the model is bigger than ${here} memory, so it is mapped from storage instead.`);
      load = "mapped";
    }
    if (!vram) {
      // shared memory: a GPU buffer cannot be paged, so the CPU build is the only one that can run it
      if (want === "auto" && backends.includes("cpu")) backend = "cpu";
      else if (want !== "cpu") notes.push(`The ${want} backend was asked for; a GPU build has to hold the whole model in memory, so expect the start to fail. CPU only would run it.`);
    }
    ctx = Math.min(ctx, BIG_CTX);
    args.push("-ctk", "q8_0", "-ctv", "q8_0");
    notes.push(`Bigger than ${here} memory (${gb(size)} GB of ${gb(ram)} GB): it runs from storage, slowly${vram ? "" : ", on the CPU"}, with the context capped at ${ctx} and an 8-bit cache.`);
  } else if (zone === "tight" && load === "resident") {
    notes.push(`Loaded into memory as asked, but ${gb(size)} GB plus the cache leaves little of the ${gb(ram)} GB; if the start fails, lower the context or map it from storage.`);
  } else if (zone === "unknown") {
    notes.push("The model's header could not be read, so the plain flags are used.");
  }
  args.push(...LOAD_FLAGS[load]);
  // the GPU is in the picture unless CPU was asked for, or auto with nothing but a CPU build
  const gpu = backend !== "cpu" && (backend !== "auto" || !backends.length || backends.some((b) => b !== "cpu"));
  const cpuMoe = moePref === "off" ? false : moePref === "on" ? gpu : moe && gpu;
  if (cpuMoe) args.push("--cpu-moe");
  if (moe && !cpuMoe && gpu && moePref === "off") notes.push("The experts go to the GPU with everything else (experts on the CPU is off).");

  // a discrete card: how many layers it holds. Each layer costs its share of the weights and of the KV cache; the card keeps a
  // reserve for its own buffers and the compute scratch. With the experts on the CPU the card only holds the attention, which fits.
  let ngl = null; // null: the launcher's default (every layer); a number: that many, the rest on the CPU
  let layers = Number(head?.blockCount) || 0;
  if (gpu && vram > 0 && size > 0 && !cpuMoe) {
    const reserve = Math.max(0.75 * GB, vram * 0.08);
    const budget = vram - reserve;
    if (size + kv > budget) {
      if (layers > 0) {
        ngl = Math.max(0, Math.min(layers, Math.floor(budget / ((size + kv) / layers))));
        if (ngl < layers) {
          args.push("-ngl", String(ngl));
          notes.push(`${gb(size)} GB of weights and a ${gb(kv)} GB cache do not fit the card's ${gb(vram)} GB: ${ngl} of ${layers} layers go to the card, the rest run on the CPU, slower. A smaller context or quant puts more on the card.`);
        } else ngl = null;
      } else notes.push(`The model looks bigger than the card's ${gb(vram)} GB and its layer count is unknown, so llama.cpp decides the split.`);
    }
  }

  const sizePart = known || size ? `${gb(size)} GB${moe ? `, MoE (${head.expertCount} experts${head.expertUsedCount ? `, ${head.expertUsedCount} active` : ""})` : ""}` : moe ? "MoE" : "size unknown";
  const zonePart = zone === "comfortable" ? `fits in ${gb(ram)} GB with room` : zone === "tight" ? `fits in ${gb(ram)} GB, tight with a ${ctx} context` : zone === "big" ? `bigger than the ${gb(ram)} GB here` : "memory unknown";
  const loadPart = load === "resident" ? "loaded into memory (no mmap)" : "mapped from storage (mmap)";
  const card = vram ? ` ${gb(vram)} GB card` : "";
  const backendPart = backend === "cpu" ? "CPU" : cpuMoe ? `GPU (${backend}${card}), experts on the CPU` : ngl != null ? `GPU (${backend}${card}), ${ngl} of ${layers} layers` : `GPU (${backend}${card})`;
  const summary = `${sizePart} · ${zonePart} · ${loadPart} · ${backendPart} · context ${ctx}`;
  return { backend, ctx, args, load, zone, moe, cpuMoe, ngl, layers, kv, size, ram, vram, notes, summary };
}
