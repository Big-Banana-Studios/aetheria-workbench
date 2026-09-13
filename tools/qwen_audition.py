"""
The Qwen3-TTS side of the voice audition: Mira's three lines (tools/audition_lines.mjs)
read by every female preset of the CustomVoice model, with and without an
instruct; by voices designed from her core description (VoiceDesign); and by a
clone of Kokoro's Nicole (the Base model, from the reference clip
tools/kokoro_audition.mjs wrote). Then an index.html with a player per clip so
the voices can be judged side by side, Kokoro's rows included.

  D:\\qwen-tts\\venv\\Scripts\\python.exe tools\\qwen_audition.py [--out ..\\voice-audition]
      [--models custom,design,clone] [--size 1.7B] [--voices Vivian,Serena,Ono_Anna,Sohee]
      [--index-only]

Models are downloaded to HF_HOME (D:\\qwen-tts\\hf) on the first run. Each model
is loaded, used and freed in turn, so a 16 GB GPU is plenty.
"""

import argparse
import gc
import html
import json
import os
import re
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HOME", r"D:\qwen-tts\hf")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

FEMALE = ["Vivian", "Serena", "Ono_Anna", "Sohee"]

# CustomVoice: the preset's timbre, the instruct steers emotion, pace and tone
INSTRUCTS = {
    "plain": "",
    "dry": "Dry, amused and deadpan, like a friend talking at a kitchen table at midnight: unhurried, confident, a little raspy, not performing.",
    "stage": "A comedian on a small club stage: swagger, playful, husky, every line lands with a smirk; builds up and then drops flat for the punchline.",
}

# VoiceDesign: the whole voice from a description, written from prompts/mira-core.md
DESIGNS = {
    "kitchen": "A woman in her thirties speaking American English, low to mid register with a slight rasp, dry and amused, talking like a friend at a kitchen table at midnight: confident, unhurried, no performance.",
    "stage": "An American female comedian on a small club stage: husky alto, swagger, playful and cheerfully filthy, builds each line and drops to deadpan for the punch.",
    "steady": "A warm, steady American woman in her thirties, calm after a hard day, plain-spoken, a little tired, kind without softness, a smile you can hear in the voice.",
}


def read_lines():
    """The lines and the reference text from tools/audition_lines.mjs (the Node side reads the same file)."""
    src = (HERE / "audition_lines.mjs").read_text(encoding="utf-8")
    lines = re.findall(r'\["(\w+)",\s*"((?:[^"\\]|\\.)*)"\]', src)
    lines = [(k, bytes(v, "utf-8").decode("unicode_escape")) for k, v in lines]
    ref = re.search(r'export const REF = "((?:[^"\\]|\\.)*)"', src).group(1)
    return lines, ref


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def free(model):
    del model
    gc.collect()
    import torch

    torch.cuda.empty_cache()


def save(out, name, wav, sr):
    import soundfile as sf

    sf.write(str(out / name), wav, sr)
    print("  wrote", name, f"({len(wav) / sr:.1f}s)")


def load(model_id):
    import torch
    from qwen_tts import Qwen3TTSModel

    print(f"loading {model_id}…")
    t0 = time.time()
    m = Qwen3TTSModel.from_pretrained(model_id, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    print(f"  loaded in {time.time() - t0:.0f}s")
    return m


def run_custom(out, lines, size, voices):
    model = load(f"Qwen/Qwen3-TTS-12Hz-{size}-CustomVoice")
    try:
        for spk in voices:
            for ikey, instruct in INSTRUCTS.items():
                for lkey, text in lines:
                    name = f"custom{size.replace('.', '')}-{spk}-{ikey}-{lkey}.wav"
                    if (out / name).exists():
                        continue
                    t0 = time.time()
                    wavs, sr = model.generate_custom_voice(text=text, language="English", speaker=spk, instruct=instruct)
                    print(f"  {spk}/{ikey}/{lkey}: {time.time() - t0:.1f}s")
                    save(out, name, wavs[0], sr)
    finally:
        free(model)


def run_design(out, lines, size):
    model = load(f"Qwen/Qwen3-TTS-12Hz-{size}-VoiceDesign")
    try:
        for dkey, instruct in DESIGNS.items():
            for lkey, text in lines:
                name = f"design-{dkey}-{lkey}.wav"
                if (out / name).exists():
                    continue
                t0 = time.time()
                wavs, sr = model.generate_voice_design(text=text, language="English", instruct=instruct)
                print(f"  design/{dkey}/{lkey}: {time.time() - t0:.1f}s")
                save(out, name, wavs[0], sr)
    finally:
        free(model)


def run_clone(out, lines, size, ref_text):
    """Every ref-<voice>.wav in the folder (Kokoro's Nicole, Bella, …) cloned twice: delivery and all, and timbre only (-xvec)."""
    refs = sorted(out.glob("ref-*.wav"))
    if not refs:
        print("no reference clip; run tools/kokoro_audition.mjs first", file=sys.stderr)
        return
    model = load(f"Qwen/Qwen3-TTS-12Hz-{size}-Base")
    tag = "clone" if size == "1.7B" else f"clone{size.replace('.', '')}"  # clone06B-… for the phone-sized model
    try:
        for ref in refs:
            who = ref.stem[len("ref-") :].replace("af_", "").replace("bf_", "")
            text_file = ref.with_suffix(".txt")
            rt = text_file.read_text(encoding="utf-8").strip() if text_file.exists() else ref_text
            for mode, xvec in ((who, False), (f"{who}-xvec", True)):
                if all((out / f"{tag}-{mode}-{lkey}.wav").exists() for lkey, _ in lines):
                    continue
                prompt = model.create_voice_clone_prompt(ref_audio=str(ref), ref_text=rt, x_vector_only_mode=xvec)
                for lkey, text in lines:
                    name = f"{tag}-{mode}-{lkey}.wav"
                    if (out / name).exists():
                        continue
                    t0 = time.time()
                    wavs, sr = model.generate_voice_clone(text=text, language="English", voice_clone_prompt=prompt)
                    print(f"  clone/{mode}/{lkey}: {time.time() - t0:.1f}s")
                    save(out, name, wavs[0], sr)
    finally:
        free(model)


def write_index(out, lines):
    """One page: a row per voice variant, a player per line, Kokoro's rows first."""
    keys = [k for k, _ in lines]
    rows = {}
    for f in sorted(out.glob("*.wav")):
        if f.name.startswith("ref-"):
            continue
        m = re.match(r"^(.*)-(%s)\.wav$" % "|".join(keys), f.name)
        if not m:
            continue
        rows.setdefault(m.group(1), {})[m.group(2)] = f.name
    order = sorted(rows, key=lambda r: (0 if r.startswith("kokoro") else 1 if r.startswith("clone-") else 2 if r.startswith("clone") else 3 if r.startswith("design") else 4, r))
    notes = {
        "kokoro": "Kokoro, as in the app today (af_nicole is Mira's voice).",
        "clone06B": "The same clone through the 0.6B Base model, the size that would go on the phone.",
        "clone": "Qwen3-TTS Base, cloning a Kokoro voice (Nicole; Bella, the pick) from a twelve-second clip, \"a more emotive Bella\"; -xvec keeps only the timbre and lets the model choose the delivery.",
        "design": "Qwen3-TTS VoiceDesign, the voice written from her core description (kitchen / stage / steady).",
        "custom": "Qwen3-TTS CustomVoice presets, the four female voices; plain, or steered by an instruct (dry / stage).",
    }
    parts = [
        "<!doctype html><meta charset=utf-8><title>Mira voice audition</title>",
        "<style>body{font:14px system-ui;margin:20px;background:#14151f;color:#e8e6ef}table{border-collapse:collapse}td,th{border:1px solid #333;padding:6px 8px;vertical-align:top}th{text-align:left;background:#1d1e2b}audio{width:230px}h2{margin-top:28px}.n{color:#9a98a8;font-size:12px}</style>",
        "<h1>Mira voice audition</h1>",
        "<p class=n>Three lines from her core (the stack trace, the gray day, the stage), one row per voice. Kokoro first, then the Qwen3-TTS clone of Nicole, the designed voices, the presets.</p>",
        "<p class=n>" + " · ".join(f"<b>{k}</b>: {html.escape(v)}" for k, v in notes.items()) + "</p>",
        "<table><tr><th>voice</th>" + "".join(f"<th>{k}</th>" for k in keys) + "</tr>",
    ]
    for r in order:
        parts.append(f"<tr><th>{html.escape(r)}</th>" + "".join(f"<td><audio controls preload=none src=\"{rows[r][k]}\"></audio></td>" if k in rows[r] else "<td></td>" for k in keys) + "</tr>")
    parts.append("</table>")
    parts.append("<h2>The lines</h2><ol>" + "".join(f"<li><b>{k}</b>: {html.escape(t)}</li>" for k, t in lines) + "</ol>")
    parts.append("<h2>The instructs and designs</h2><ul>" + "".join(f"<li><b>instruct {k}</b>: {html.escape(v) or '(none)'}</li>" for k, v in INSTRUCTS.items()) + "".join(f"<li><b>design {k}</b>: {html.escape(v)}</li>" for k, v in DESIGNS.items()) + "</ul>")
    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
    print(f"index.html: {len(order)} voices")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT.parent / "voice-audition"))
    ap.add_argument("--models", default="custom,design,clone")
    ap.add_argument("--size", default="1.7B")
    ap.add_argument("--voices", default=",".join(FEMALE))
    ap.add_argument("--index-only", action="store_true")
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    lines, ref_text = read_lines()
    if not a.index_only:
        models = [m.strip() for m in a.models.split(",") if m.strip()]
        voices = [v.strip() for v in a.voices.split(",") if v.strip()]
        if "custom" in models:
            run_custom(out, lines, a.size, voices)
        if "design" in models:
            run_design(out, lines, "1.7B")  # VoiceDesign only ships at 1.7B
        if "clone" in models:
            run_clone(out, lines, a.size, ref_text)
    write_index(out, lines)


if __name__ == "__main__":
    main()
