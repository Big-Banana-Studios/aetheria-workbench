"""
Mira's voice on the PC: Qwen3-TTS (the 1.7B Base model) cloning Kokoro's Bella from
public/assets/voices/bella-ref.wav in timbre-only mode (the "clone-bella-xvec" row of
the audition, Alisha's pick), behind a small OpenAI-shaped speech endpoint the
Workbench and tools/make_package.mjs call:

  POST /v1/audio/speech   {"input": "text", "voice": "bella", "speed": 1.0}  -> audio/wav (24 kHz mono 16-bit)
                          with X-Cache hit|miss, X-Audio-Seconds, X-Compute-Seconds, X-Batch
  GET  /health            -> {"ok": true, "model": "...", "voice": "bella", "device": "cuda:0", "rtf": 1.8, "batch": 6, "queue": 0}

  D:\qwen-tts\venv\Scripts\python.exe tools\qwen_tts_server.py [--port 8123] [--size 1.7B] [--voice bella]
      [--ref public/assets/voices/bella-ref.wav] [--cache .cache/qwen] [--frames-per-word 12] [--batch 6]

Clips are cached on disk by voice, speed and text hash, like the browser's cache, so a
replay costs nothing. The generation is capped in frames from the word count (the
model does not always emit its stop token; the cap ends a runaway). CORS is open, so
the page served from GitHub Pages can reach 127.0.0.1 through Chrome's local-network
permission, the way it reaches the lab.

The GPU runs one generate call at a time, but that call takes a batch: the requests
waiting when it frees up go through together (up to --batch: six ran at 1.8x real time on a
4090 Laptop where one ran at 0.5x). That is how the
Workbench gets the 1.7B ahead of real time: it keeps a few sentences in flight, the
way Kokoro's worker runs ahead, and one pass answers them all. One request at a time
behaves exactly as before; --batch 1 turns the batching off.
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ.setdefault("HF_HOME", r"D:\qwen-tts\hf")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8123)
ap.add_argument("--size", default="1.7B")
ap.add_argument("--voice", default="bella")
ap.add_argument("--ref", default=str(ROOT / "public" / "assets" / "voices" / "bella-ref.wav"))
ap.add_argument("--cache", default=str(ROOT / ".cache" / "qwen"))
ap.add_argument("--frames-per-word", type=float, default=12.0, help="the generation cap: 12.5 frames a second of speech; a word runs about five, so twelve leaves room")
ap.add_argument("--xvec", default="1", help="1: timbre only (the audition's -xvec rows); 0: copy the reference's delivery too")
ap.add_argument("--batch", type=int, default=6, help="requests that are waiting go through the GPU together, up to this many; 1 is one at a time")
args = ap.parse_args()

CACHE = Path(args.cache)
CACHE.mkdir(parents=True, exist_ok=True)
STATE = {"model": None, "prompt": None, "loaded": False, "error": "", "clips": 0, "seconds": 0.0, "compute": 0.0, "batches": 0, "batched": 0}
QUEUE = []  # jobs waiting for the GPU: {"text", "cap", "ev", then "wav"/"sr"/"dt"/"batch" or "error"}
QCOND = threading.Condition()


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def clean(text):
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    return t[:1200]


def key_for(text, speed):
    return f"{args.voice}-{speed:.2f}-{hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]}"


def cap_for(text):
    return int(96 + args.frames_per_word * max(1, len(text.split())))


def load():
    import torch
    from qwen_tts import Qwen3TTSModel

    ref = Path(args.ref)
    if not ref.exists():
        raise FileNotFoundError(f"no reference clip at {ref}")
    ref_text = ref.with_suffix(".txt").read_text(encoding="utf-8").strip() if ref.with_suffix(".txt").exists() else ""
    model_id = f"Qwen/Qwen3-TTS-12Hz-{args.size}-Base"
    log("loading", model_id)
    t0 = time.time()
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    model = Qwen3TTSModel.from_pretrained(model_id, device_map=device, dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32)
    prompt = model.create_voice_clone_prompt(ref_audio=str(ref), ref_text=ref_text, x_vector_only_mode=args.xvec not in ("0", "false", "no"))
    STATE.update(model=model, prompt=prompt, loaded=True, model_id=model_id, device=device)
    log(f"ready in {time.time() - t0:.0f}s: {args.voice} from {ref.name} ({'timbre only' if args.xvec not in ('0', 'false', 'no') else 'delivery and all'}), batch {args.batch}")
    # warm the graph once, off the clock: one clip, then a pair the way a batch goes
    wavs, sr = model.generate_voice_clone(text="Coffee's on.", language="English", voice_clone_prompt=prompt, max_new_tokens=64)
    log(f"warm: {len(wavs[0]) / sr:.1f}s of audio")
    if args.batch > 1:
        model.generate_voice_clone(text=["Coffee's on.", "The sink can wait."], language=["English", "English"], voice_clone_prompt=prompt, max_new_tokens=64)
    threading.Thread(target=worker, daemon=True).start()


def worker():
    """The GPU's loop: take what is waiting (up to the batch), one generate call, hand each job its wav."""
    model = STATE["model"]
    prompt = STATE["prompt"]
    while True:
        with QCOND:
            while not QUEUE:
                QCOND.wait()
            jobs = QUEUE[: max(1, args.batch)]
            del QUEUE[: len(jobs)]
        texts = [j["text"] for j in jobs]
        cap = max(j["cap"] for j in jobs)
        t0 = time.time()
        try:
            if len(texts) == 1:
                wavs, sr = model.generate_voice_clone(text=texts[0], language="English", voice_clone_prompt=prompt, max_new_tokens=cap)
            else:
                wavs, sr = model.generate_voice_clone(text=texts, language=["English"] * len(texts), voice_clone_prompt=prompt, max_new_tokens=cap)
            dt = time.time() - t0
            for j, w in zip(jobs, wavs):
                j.update(wav=w, sr=sr, dt=dt, batch=len(jobs))
            STATE["batches"] += 1
            STATE["batched"] += len(jobs)
        except Exception as e:  # noqa: BLE001
            for j in jobs:
                j["error"] = e
        for j in jobs:
            j["ev"].set()


def synth(text, speed):
    """The WAV bytes for `text`, from the cache or the GPU's queue, with the numbers: (data, cached, audio seconds, compute seconds, batch). `speed` is applied by resampling (Kokoro-style), a modest range."""
    import numpy as np
    import soundfile as sf

    k = key_for(text, speed)
    f = CACHE / f"{k}.wav"
    if f.exists():
        data = f.read_bytes()
        return data, True, float(sf.info(io.BytesIO(data)).duration), 0.0, 0
    words = max(1, len(text.split()))
    job = {"text": text, "cap": cap_for(text), "ev": threading.Event()}
    with QCOND:
        QUEUE.append(job)
        QCOND.notify()
    if not job["ev"].wait(timeout=240):
        raise TimeoutError("the voice took too long")
    if "error" in job:
        raise job["error"]
    wav = np.asarray(job["wav"], dtype=np.float32)
    sr = job["sr"]
    seconds = len(wav) / sr
    if abs(speed - 1.0) > 0.01:
        # a slower or faster read: resample the clip (pitch moves a little, as Kokoro's speed does not; kept modest)
        n = int(len(wav) / speed)
        wav = np.interp(np.linspace(0, len(wav) - 1, n), np.arange(len(wav)), wav).astype(np.float32)
    peak = float(np.abs(wav).max()) if len(wav) else 0.0
    if peak > 0:
        wav = wav * min(1.0, 0.85 / peak)  # a touch under full scale, near Kokoro's level
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    data = buf.getvalue()
    f.write_bytes(data)
    STATE["clips"] += 1
    STATE["seconds"] += seconds
    STATE["compute"] += job["dt"] / job["batch"]  # the pass's time, shared out over the batch
    log(f"{seconds:.1f}s in {job['dt']:.1f}s (batch {job['batch']}, {STATE['seconds'] / max(STATE['compute'], 1e-6):.2f}x so far) · {words} words, cap {job['cap']} · {text[:60]!r}")
    return data, False, seconds, job["dt"], job["batch"]


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Expose-Headers", "X-Cache, X-Audio-Seconds, X-Compute-Seconds, X-Batch")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health") or self.path == "/":
            return self._json(
                200,
                {
                    "ok": STATE["loaded"],
                    "error": STATE["error"],
                    "model": STATE.get("model_id"),
                    "voice": args.voice,
                    "device": STATE.get("device"),
                    "clips": STATE["clips"],
                    "seconds": round(STATE["seconds"], 1),
                    "compute": round(STATE["compute"], 1),
                    "rtf": round(STATE["seconds"] / STATE["compute"], 2) if STATE["compute"] else None,
                    "batch": args.batch,
                    "batches": STATE["batches"],
                    "queue": len(QUEUE),
                },
            )
        if self.path.startswith("/v1/models"):
            return self._json(200, {"object": "list", "data": [{"id": f"qwen3-tts-{args.size}-{args.voice}", "object": "model"}]})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/v1/audio/speech"):
            return self._json(404, {"error": "not found"})
        if not STATE["loaded"]:
            return self._json(503, {"error": STATE["error"] or "the voice is still loading"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            j = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:  # noqa: BLE001
            return self._json(400, {"error": f"bad json: {e}"})
        text = clean(j.get("input") or j.get("text"))
        if not text:
            return self._json(400, {"error": "input is empty"})
        speed = float(j.get("speed") or 1.0)
        speed = max(0.7, min(1.4, speed))
        try:
            data, cached, seconds, compute, batch = synth(text, speed)
        except Exception as e:  # noqa: BLE001
            log("error:", repr(e))
            return self._json(500, {"error": str(e)})
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Cache", "hit" if cached else "miss")
        self.send_header("X-Audio-Seconds", f"{seconds:.2f}")
        self.send_header("X-Compute-Seconds", f"{compute:.2f}")
        self.send_header("X-Batch", str(batch))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *a):
        pass  # our own log lines say more


def main():
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"qwen tts server on http://127.0.0.1:{args.port} (voice {args.voice}, size {args.size}, batch {args.batch}); loading the model…")
    try:
        load()
    except Exception as e:  # noqa: BLE001
        STATE["error"] = str(e)
        log("failed to load:", repr(e))
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
