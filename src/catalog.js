// Models the in-app runtime offers with one tap. Every URL was checked on
// 2026-09-08 (HTTP 200, the byte counts below). All are ungated GGUF files
// from Unsloth's Hugging Face repos, Q4_K_M unless said. A vision model
// comes with its projector, saved beside it under the model's own name so
// the plugin pairs them (`<stem>-mmproj-F16.gguf`).

const HF = "https://huggingface.co";

export const CATALOG = [
  {
    // Mira's voice, not a brain: llama-tts reads sets and replies as Bella, cloned from a clip (Settings → Voice → engine).
    // The official llama.cpp build of the 1.7B Base model; the 0.6B pair (lighter, the phone's pick) is converted on the PC
    // and pushed (voice-model/README.md), until a public copy exists. Checked 2026-09-12 (HTTP 200, the byte counts below).
    id: "qwen3-tts-1.7b",
    name: "Qwen3-TTS 1.7B, Mira's voice",
    file: "Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf",
    url: `${HF}/ggml-org/Qwen3-TTS-12Hz-1.7B-Base-GGUF/resolve/main/Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf`,
    bytes: 1035965280,
    mmproj: { file: "Qwen3-TTS-12Hz-1.7B-Base-mmproj-Q8_0.gguf", url: `${HF}/ggml-org/Qwen3-TTS-12Hz-1.7B-Base-GGUF/resolve/main/mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf`, bytes: 446422912 },
    tag: "voice",
    voice: true,
    note: "Her Bella clone, in-app, for the stage and packages (rendered ahead; slower than real time). Not a chat model.",
  },
  {
    id: "qwen3-4b",
    name: "Qwen3 4B",
    file: "Qwen3-4B-Q4_K_M.gguf",
    url: `${HF}/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf`,
    bytes: 2497281312,
    tag: "start here",
    note: "Quick to download, fast on the phone, thinking mode switches on and off. The first thing to try.",
  },
  {
    id: "qwen3-8b",
    name: "Qwen3 8B",
    file: "Qwen3-8B-Q4_K_M.gguf",
    url: `${HF}/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf`,
    bytes: 5027784512,
    tag: "daily driver",
    note: "The sensible everyday model on a phone with 12 GB or more.",
  },
  {
    id: "gemma3-4b-vision",
    name: "Gemma 3 4B with vision",
    file: "gemma-3-4b-it-Q4_K_M.gguf",
    url: `${HF}/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf`,
    bytes: 2489894016,
    mmproj: { file: "gemma-3-4b-it-mmproj-F16.gguf", url: `${HF}/unsloth/gemma-3-4b-it-GGUF/resolve/main/mmproj-F16.gguf`, bytes: 851251328 },
    tag: "sees images",
    note: "Looks at image drops and sprite sheets. No thinking mode.",
  },
  {
    id: "qwen3-14b",
    name: "Qwen3 14B",
    file: "Qwen3-14B-Q4_K_M.gguf",
    url: `${HF}/unsloth/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf`,
    bytes: 9001753984,
    note: "Slower, better. Wants 16 GB or more.",
  },
  {
    id: "qwen25-vl-7b",
    name: "Qwen2.5-VL 7B with vision",
    file: "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
    url: `${HF}/unsloth/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf`,
    bytes: 4683072384,
    mmproj: { file: "Qwen2.5-VL-7B-Instruct-mmproj-F16.gguf", url: `${HF}/unsloth/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/mmproj-F16.gguf`, bytes: 1354163040 },
    tag: "sees images",
    note: "Stronger vision than Gemma 3 4B, for the sprite inspector.",
  },
  {
    id: "gemma3-12b-vision",
    name: "Gemma 3 12B with vision",
    file: "gemma-3-12b-it-Q4_K_M.gguf",
    url: `${HF}/unsloth/gemma-3-12b-it-GGUF/resolve/main/gemma-3-12b-it-Q4_K_M.gguf`,
    bytes: 7300778336,
    mmproj: { file: "gemma-3-12b-it-mmproj-F16.gguf", url: `${HF}/unsloth/gemma-3-12b-it-GGUF/resolve/main/mmproj-F16.gguf`, bytes: 854200448 },
    tag: "sees images",
    note: "Vision and a bigger brain. Wants 16 GB or more.",
  },
  {
    id: "qwen3-30b-a3b",
    name: "Qwen3 30B-A3B (MoE)",
    file: "Qwen3-30B-A3B-Q4_K_M.gguf",
    url: `${HF}/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf`,
    bytes: 18556686912,
    tag: "24 GB phone",
    note: "18.6 GB on disk, only 3B active per token: fits the ROG and runs quickly for its size.",
  },
];

/** What the catalog needs on disk for an entry: the model, and its projector if it has one. */
export function partsOf(entry) {
  return entry.mmproj ? [{ url: entry.url, file: entry.file, bytes: entry.bytes }, { url: entry.mmproj.url, file: entry.mmproj.file, bytes: entry.mmproj.bytes }] : [{ url: entry.url, file: entry.file, bytes: entry.bytes }];
}
