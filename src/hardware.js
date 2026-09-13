// Hardware probe and the recommended profile. Everything a browser will say
// about the machine it is on: platform, cores, memory (Chrome caps the
// number at 8 GB, so a 24 GB phone reports "8 or more"), the WebGPU adapter
// (vendor, architecture, fp16 shaders, buffer limits), storage quota, and
// whether the lab answered. From that, a profile: which brain, which dtype,
// where the voice runs, a reply cap, and a model to pick from the lab's list.

export async function probeHardware() {
  const ua = navigator.userAgentData;
  const out = {
    platform: ua?.platform || navigator.platform || "unknown",
    mobile: ua?.mobile === true || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent),
    cores: navigator.hardwareConcurrency || null,
    memoryGB: navigator.deviceMemory || null, // capped at 8 by Chrome
    online: navigator.onLine,
    secure: location.protocol === "https:" || location.hostname === "localhost",
    gpu: null,
    storage: null,
  };
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) out.storage = { quotaGB: +(est.quota / 1073741824).toFixed(1), usedGB: +(est.usage / 1073741824).toFixed(2), persisted: await navigator.storage.persisted?.() };
  } catch {
    /* ignore */
  }
  if ("gpu" in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (adapter) {
        let info = adapter.info || null;
        if (!info && adapter.requestAdapterInfo) {
          try {
            info = await adapter.requestAdapterInfo();
          } catch {
            /* ignore */
          }
        }
        out.gpu = {
          ok: true,
          vendor: info?.vendor || "",
          architecture: info?.architecture || "",
          device: info?.device || "",
          description: info?.description || "",
          f16: adapter.features.has("shader-f16"),
          maxBufferGB: +(adapter.limits.maxBufferSize / 1073741824).toFixed(2),
          maxStorageBindingGB: +(adapter.limits.maxStorageBufferBindingSize / 1073741824).toFixed(2),
          isFallback: !!adapter.isFallbackAdapter,
        };
      } else out.gpu = { ok: false, reason: "no adapter" };
    } catch (e) {
      out.gpu = { ok: false, reason: e.message };
    }
  } else out.gpu = { ok: false, reason: "no WebGPU" };
  return out;
}

/** A readable name for the GPU. */
export function gpuName(g) {
  if (!g?.ok) return g?.reason || "none";
  const parts = [g.description, g.vendor, g.architecture].filter(Boolean);
  return parts.length ? parts[0] + (g.architecture && !g.description ? "" : g.architecture ? ` (${g.architecture})` : "") : "WebGPU adapter";
}

/**
 * Pick a lab model from the endpoint's list. Prefers the brief's Qwen3.8-27B,
 * then anything that looks like a vision-capable Qwen, then the largest
 * parameter count in the name, then the first.
 */
export function pickLabModel(ids, current = "") {
  if (!ids?.length) return current;
  if (current && ids.includes(current)) return current;
  const score = (id) => {
    const s = id.toLowerCase();
    let n = 0;
    if (/qwen3\.8|qwen3_8|qwen-3\.8/.test(s)) n += 100;
    if (/qwen/.test(s)) n += 30;
    if (/vl|vision|omni/.test(s)) n += 15;
    const b = /(\d+(?:\.\d+)?)b\b/.exec(s);
    if (b) n += Math.min(50, Number(b[1]));
    if (/embed|whisper|tts|rerank|kokoro|moonshine/.test(s)) n -= 200;
    return n;
  };
  return [...ids].sort((a, b) => score(b) - score(a))[0];
}

/**
 * The recommended profile for this hardware.
 * @param {object} hw from probeHardware()
 * @param {{labOk:boolean, models?:string[], currentModel?:string}} lab
 */
export function recommend(hw, lab) {
  const notes = [];
  const p = { brain: "auto", ttsDevice: "auto", maxTokens: 2048, thinkingDefault: null, deviceDtype: "q4f16", labModel: lab.currentModel || "" };
  const g = hw.gpu;
  if (lab.labOk) {
    p.brain = "auto";
    p.labModel = pickLabModel(lab.models, lab.currentModel);
    notes.push(`The lab answered: use it. Model: ${p.labModel || "(pick one)"}.`);
  } else {
    notes.push("The lab did not answer; the on-device model is the fallback until it does.");
  }
  if (!g?.ok) {
    p.brain = lab.labOk ? "lab" : "auto";
    p.ttsDevice = "cpu";
    notes.push(`No WebGPU (${g?.reason || "unknown"}): the on-device model cannot run here; Kokoro runs on the CPU.`);
  } else {
    p.deviceDtype = g.f16 ? "q4f16" : "q4";
    if (!g.f16) notes.push("No fp16 shaders: the on-device model uses the larger q4 files.");
    if (hw.mobile) {
      p.ttsDevice = "cpu";
      p.maxTokens = 1024;
      p.thinkingDefault = false;
      notes.push("A phone: the voice runs on the CPU so the GPU keeps the model, replies are capped at 1024 tokens, and thinking mode is off by default; Android's GPU watchdog resets the device on long bursts (see Mira's README).");
      if (hw.memoryGB >= 8) notes.push("Memory reports 8 GB or more (Chrome caps the number): the full 3.5 GB on-device model fits. Choose 'light' if the browser is evicting it.");
      notes.push("To use a big phone's RAM properly, run a native llama.cpp server on the phone (Termux, or an app that exposes an OpenAI-compatible port) and point the lab endpoint at http://localhost:<port>/v1. The README has the recipe.");
    } else {
      if (g.maxBufferGB >= 2 && (g.description || "").match(/nvidia|amd|radeon|geforce|rtx|arc/i)) notes.push(`Discrete GPU (${gpuName(g)}): the on-device model and Kokoro on WebGPU are fine. Force the discrete GPU for the browser on a laptop with two.`);
      else if (/intel|iris|uhd|integrated/i.test(gpuName(g))) {
        p.ttsDevice = "cpu";
        notes.push(`Integrated GPU (${gpuName(g)}): the on-device model will be slow; prefer the lab. Kokoro on the CPU.`);
      } else notes.push(`GPU: ${gpuName(g)}.`);
    }
  }
  if (hw.storage && hw.storage.quotaGB < 6) notes.push(`Only ${hw.storage.quotaGB} GB of browser storage: the on-device model may not fit. Free space or use the lab.`);
  if (!hw.secure) notes.push("Not a secure context: the mic, WebGPU and the service worker need https or localhost.");
  return { profile: p, notes };
}
