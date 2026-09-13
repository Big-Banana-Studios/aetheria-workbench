// On-device fallback brain: Gemma 4 E2B (ONNX, WebGPU), text plus an optional
// image, for when the lab endpoint is unreachable. Cut down from Mira's
// llm.worker.js: no audio, no cached KV across turns (a desk turn carries its
// own history and is rendered fresh each time), the same load / fallback /
// lost-device handling.
//
// in : {type:'load', dtype, device}
//      {type:'turn', id, messages:[{role, content:string}], image?:{data,width,height}, thinking, maxNewTokens, temperature}
//      {type:'interrupt'}
// out: {type:'progress', model, ...} {type:'ready', dtype, device} {type:'info', message}
//      {type:'first_token', id} {type:'token', id, text} {type:'done', id, text, tokens, interrupted, ms}
//      {type:'error', id?, message}

import "./ort-paths.js";
import { AutoProcessor, Gemma4ForConditionalGeneration, TextStreamer, InterruptableStoppingCriteria, RawImage } from "@huggingface/transformers";

const GEMMA_ID = "onnx-community/gemma-4-E2B-it-ONNX";
const LOST = /device.*lost|lost.*device|DEVICE_LOST|GPUDevice|device is destroyed|Invalid device|GPU process/i;

let processor = null;
let model = null;
let dtype = "q4f16";
let device = "webgpu";
let stopping = null;
let busy = false;
let lastLoad = null;
let reloading = false;

const post = (m) => self.postMessage(m);
const progress = (p) => post({ type: "progress", model: "gemma-4-e2b", ...p });

async function load(data) {
  lastLoad = data;
  dtype = data.dtype || "q4f16";
  device = data.device || "webgpu";
  try {
    processor = await AutoProcessor.from_pretrained(GEMMA_ID, { progress_callback: progress });
    const attempt = async (dt) => {
      post({ type: "info", message: `loading Gemma 4 E2B ${dt} on ${device}` });
      model = await Gemma4ForConditionalGeneration.from_pretrained(GEMMA_ID, { dtype: dt, device, progress_callback: progress });
      dtype = dt;
    };
    try {
      await attempt(dtype);
    } catch (e) {
      if (dtype === "q4f16" && /f16|float16|half/i.test(e.message)) {
        post({ type: "info", message: `q4f16 failed (${e.message}); falling back to q4` });
        await attempt("q4");
      } else throw e;
    }
    post({ type: "info", message: "warming up" });
    const warm = processor.apply_chat_template([{ role: "user", content: [{ type: "text", text: "hi" }] }], { add_generation_prompt: true, enable_thinking: false });
    const inputs = await processor(warm, null, null, { add_special_tokens: false });
    await model.generate({ ...inputs, max_new_tokens: 1, do_sample: false });
    post({ type: "ready", dtype, device });
  } catch (e) {
    post({ type: "error", message: `Model failed to load: ${e.message}` });
  }
}

async function turn({ id, messages, image, thinking, maxNewTokens, temperature }) {
  const msgs = messages.map((m) => ({ role: m.role, content: [{ type: "text", text: String(m.content ?? "") }] }));
  if (image) {
    const last = msgs[msgs.length - 1];
    if (last?.role === "user") last.content.unshift({ type: "image" });
  }
  const prompt = processor.apply_chat_template(msgs, { add_generation_prompt: true, enable_thinking: !!thinking });
  const rawImage = image ? new RawImage(image.data, image.width, image.height, 4) : null;
  const inputs = await processor(prompt, rawImage, null, { add_special_tokens: false });
  const promptLen = inputs.input_ids.dims[1];
  let tokens = 0;
  let first = true;
  const streamer = new TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (piece) => {
      if (first) {
        first = false;
        post({ type: "first_token", id });
      }
      post({ type: "token", id, text: piece });
    },
    token_callback_function: () => {
      tokens++;
    },
  });
  stopping = new InterruptableStoppingCriteria();
  const t = Number(temperature);
  const sampling = t > 0 ? { do_sample: true, temperature: t, top_k: 50, top_p: 0.9, repetition_penalty: 1.05 } : { do_sample: false, repetition_penalty: 1.05 };
  const out = await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens || 1024,
    ...sampling,
    streamer,
    stopping_criteria: stopping,
    return_dict_in_generate: true,
  });
  const seq = out.sequences.data;
  const reply = processor.tokenizer.decode(Array.from(seq.slice(promptLen)), { skip_special_tokens: true });
  try {
    await out.past_key_values?.dispose?.();
  } catch {
    /* ignore */
  }
  return { text: reply, tokens, interrupted: !!stopping.interrupted };
}

async function reloadAfterLoss() {
  post({ type: "info", message: "the GPU device was lost; reloading the model" });
  reloading = true;
  try {
    model = null;
    await load(lastLoad);
  } finally {
    reloading = false;
  }
}

async function runTurn(data, attempt = 0) {
  busy = true;
  const t0 = performance.now();
  try {
    const r = await turn(data);
    post({ type: "done", id: data.id, ...r, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    console.error(e);
    if (attempt < 1 && !stopping?.interrupted && LOST.test(String(e.message))) {
      try {
        await reloadAfterLoss();
        busy = false;
        return runTurn(data, attempt + 1);
      } catch (e2) {
        post({ type: "error", id: data.id, message: `Generation: ${e.message}; reload failed: ${e2.message}` });
      }
    } else {
      post({ type: "error", id: data.id, message: `Generation: ${e.message}` });
    }
  } finally {
    busy = false;
    stopping = null;
  }
}

self.onmessage = async ({ data }) => {
  switch (data.type) {
    case "load":
      await load(data);
      return;
    case "interrupt":
      stopping?.interrupt();
      return;
    case "turn":
      if (!model || reloading) {
        post({ type: "error", id: data.id, message: reloading ? "the model is being rebuilt; try again in a moment" : "the model is still loading" });
        return;
      }
      if (busy) {
        post({ type: "error", id: data.id, message: "a turn is already running; stop it first" });
        return;
      }
      await runTurn(data);
      return;
  }
};
