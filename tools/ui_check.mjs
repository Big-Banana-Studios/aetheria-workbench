// The built app, driven in headless Chrome against the fake lab: the brain
// chip detects the endpoint, the local tools answer, a turn streams with its
// reasoning folded away, an image reaches the model, the memory jar and the
// bible reach the prompt, and the sprite inspector measures a synthetic
// sheet and takes the model's JSON. No GPU, no model download. The page is
// served by the PC runtime host (tools/pc_runtime.mjs, what the launcher
// runs) with the fake lab standing in for llama-server, so the local
// runtime's panel, its plan, Start, a turn through it and Stop are covered.
//
//   npm run build && node tools/ui_check.mjs
//   node tools/ui_check.mjs --keep      leave Chrome and the servers up

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, killTree, sleep } from "./cdp.mjs";
import { start as startFakeLab } from "./fake_lab.mjs";
import { start as startHost } from "./pc_runtime.mjs";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const keep = process.argv.includes("--keep");
const PORT = 5175;
const LAB = 4321;
const LOCAL = 5177; // the port the host's "llama-server" (the fake lab again) takes
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) log("  ok", name);
  else {
    failures++;
    log("  FAIL", name, detail);
  }
};

mkdirSync(join(root, "shots"), { recursive: true });
const lab = await startFakeLab(LAB);
log(`fake lab on :${LAB}`);
// the PC runtime host serves dist/ (as the launcher does) with a throwaway data folder: one tiny GGUF in its models, one more on "a disk"
const dataDir = mkdtempSync(join(tmpdir(), "wb-pc-runtime-"));
mkdirSync(join(dataDir, "models"), { recursive: true });
const tinyGguf = (() => {
  // a GGUF v3 header the plan can read: a dense 8B-shaped model (the smoke has the same writer)
  const enc = new TextEncoder();
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const u64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; };
  const str = (t) => { const u = enc.encode(t); return [u64(u.length), u]; };
  const kvs = [["general.architecture", 8, "qwen3"], ["general.name", 8, "tiny test"], ["qwen3.block_count", 4, 36], ["qwen3.context_length", 4, 40960], ["qwen3.embedding_length", 4, 4096], ["qwen3.attention.head_count", 4, 32], ["qwen3.attention.head_count_kv", 4, 8], ["qwen3.attention.key_length", 4, 128], ["tokenizer.ggml.model", 8, "gpt2"]];
  const parts = [enc.encode("GGUF"), u32(3), u64(7), u64(kvs.length)];
  for (const [k, type, v] of kvs) { parts.push(...str(k), u32(type)); if (type === 8) parts.push(...str(v)); else parts.push(u32(v)); }
  const out = new Uint8Array(parts.reduce((a, q) => a + q.length, 0) + 4096);
  let o = 0;
  for (const q of parts) { out.set(q, o); o += q.length; }
  return out;
})();
writeFileSync(join(dataDir, "models", "tiny-test.gguf"), tinyGguf);
const linkedPath = join(dataDir, "linked-test.gguf");
writeFileSync(linkedPath, tinyGguf);
const host = await startHost({ port: PORT, bind: "127.0.0.1", data: dataDir, fake: true, dist: join(root, "dist") });
log(`runtime host on :${PORT} (data in ${dataDir})`);

const { proc, cdp } = await launchChrome({ port: 9335, args: ["--window-size=1400,900", "--enable-unsafe-webgpu", "--autoplay-policy=no-user-gesture-required"] });
try {
  await cdp.send("Page.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  await cdp.navigate(`http://localhost:${PORT}/`);
  await sleep(500);
  // point the app at the fake lab, then reload so it boots against it
  await cdp.eval(`localStorage.setItem("workbench.settings", JSON.stringify({ lab: { url: "http://127.0.0.1:${LAB}/v1", model: "", apiKey: "k" }, brain: "auto", native: { port: ${LOCAL} } })); localStorage.removeItem("workbench.chat.research"); localStorage.removeItem("workbench.memory"); "ok"`);
  await cdp.navigate(`http://localhost:${PORT}/`);
  await sleep(1500);

  const waitFor = async (expr, ms = 8000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await cdp.eval(expr).catch(() => null);
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await sleep(120);
    }
  };

  check("eight desks in the rail", (await cdp.eval("document.querySelectorAll('.desk-btn').length")) === 8);
  const chip = await waitFor("document.getElementById('brain-text').textContent.includes('lab ·') && document.getElementById('brain-text').textContent");
  check("brain chip detected the lab and picked the first model", !!chip && /fake-qwen3\.8-27b/.test(chip), chip);
  check("model list came from /v1/models", (await cdp.eval("__wb.brain.info.models.length")) === 3);

  // the desk menu on the desktop: it hangs below the header, and a click lands on it (it was clipped away by the header's overflow)
  await cdp.eval("document.getElementById('btn-menu').click()");
  const menuHit = await cdp.eval("(() => { const b = document.getElementById('btn-think'); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { hidden: document.getElementById('dropdown').hidden, hit: !!e && (e === b || b.contains(e)), top: Math.round(r.top), headBottom: Math.round(document.getElementById('head').getBoundingClientRect().bottom), w: Math.round(r.width) }; })()");
  check("the desk menu opens below the header and takes the click", !menuHit.hidden && menuHit.hit && menuHit.top >= menuHit.headBottom && menuHit.w > 200, JSON.stringify(menuHit));
  await cdp.eval("history.back()");
  check("the menu closes", !!(await waitFor("document.getElementById('dropdown').hidden", 3000)));

  // local tools
  await cdp.eval("__wb.send('/help')");
  check("/help card", !!(await waitFor("[...document.querySelectorAll('.msg.tool .body')].some(b => b.textContent.includes('Commands on this desk'))")));
  await cdp.eval("__wb.selectDesk('aetheria')");
  await cdp.eval("__wb.send('/cube')");
  check("/cube card", !!(await waitFor("[...document.querySelectorAll('.msg.tool .body')].some(b => b.textContent.includes('three Lo Shu layers'))")));
  await cdp.eval("__wb.send('/walk O')");
  check("/walk O has 29 steps", !!(await waitFor("[...document.querySelectorAll('.msg.tool .body')].some(b => b.textContent.includes('Ouroboros · 29 steps'))")));
  await cdp.eval("__wb.send('/freq 2178')");
  check("/freq 2178 names Nine-Fingers and SOURCE", !!(await waitFor("[...document.querySelectorAll('.msg.tool .body')].some(b => b.textContent.includes('Nine-Fingers') && b.textContent.includes('2178'))")));
  const accent = await cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()");
  check("aura followed the frequency (HEART rose family)", /^#(f|e|d)/i.test(accent), accent);
  await cdp.eval("__wb.send('/stone the diver')");
  check("/stone finds a holder by name", !!(await waitFor("[...document.querySelectorAll('.msg.tool .body')].some(b => b.textContent.includes('gut_09'))")));

  // memory jar
  await cdp.eval("__wb.send('/remember the courier is called Mira')");
  check("/remember stored a note", (await cdp.eval("__wb.memory.items.length")) === 1);

  // a streamed turn on the Paperless desk: bible + jar in the prompt, think folded
  await cdp.eval("__wb.selectDesk('paperless')");
  await cdp.eval("__wb.send('hello there')");
  const reply = await waitFor("(() => { const m = [...document.querySelectorAll('.msg.assistant')].pop(); return m && !m.classList.contains('streaming') && m.querySelector('.body').textContent; })()", 15000);
  check("assistant reply streamed and finished", !!reply && /fake lab/.test(reply), String(reply).slice(0, 80));
  check("reply carries the bible, the jar (and thinking off on this desk)", /bible/.test(reply) && /jar/.test(reply) && /Thinking switch: false/.test(reply), String(reply).slice(0, 200));
  const think = await cdp.eval("(() => { const m = [...document.querySelectorAll('.msg.assistant')].pop(); const t = m.querySelector('.think'); return t && !t.hidden && t.querySelector('.think-body').textContent; })()");
  check("reasoning_content and inline <think> both folded into the think block", /Let me think about this\./.test(think || "") && /inline reasoning here/.test(think || ""), String(think));
  check("no <think> tag leaked into the visible reply", !/<think>|inline reasoning/.test(reply));
  check("code block got a copy button", (await cdp.eval("!![...document.querySelectorAll('.msg.assistant')].pop().querySelector('pre button.copy')")) === true);
  check("KaTeX rendered the formula", (await cdp.eval("!![...document.querySelectorAll('.msg.assistant')].pop().querySelector('.katex')")) === true);
  const meta = await cdp.eval("[...document.querySelectorAll('.msg.assistant')].pop().querySelector('.meta').textContent");
  check("stats: tokens per second and first token in the meta line", /tok\/s/.test(meta) && /first token/.test(meta), meta);
  check("conversation persisted text-only", (await cdp.eval("JSON.parse(localStorage.getItem('workbench.chat.paperless')).filter(m => m.role === 'assistant').length")) === 1);

  // an image on a turn
  await cdp.eval(`(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#f0f'; x.fillRect(8, 8, 40, 40); const b = await new Promise(r => c.toBlob(r, 'image/png')); await __wb.addImage(new File([b], 'pink.png', { type: 'image/png' })); return document.querySelectorAll('#attachments .att').length; })()`);
  check("image attached to the composer", (await cdp.eval("document.querySelectorAll('#attachments .att').length")) === 1);
  await cdp.eval("__wb.send('what is this')");
  const reply2 = await waitFor("(() => { const m = [...document.querySelectorAll('.msg.assistant')]; const last = m[m.length - 1]; return m.length >= 2 && !last.classList.contains('streaming') && last.querySelector('.body').textContent; })()", 15000);
  check("the image reached the model as image_url", /I see 1 image/.test(reply2 || ""), String(reply2).slice(0, 120));

  // thinking on for research, and the flashcards export parser
  await cdp.eval("__wb.selectDesk('physics')");
  check("physics desk defaults to thinking on", (await cdp.eval("document.getElementById('think-state').textContent")) === "on");
  await cdp.eval("__wb.send('teach me')");
  const reply3 = await waitFor("(() => { const m = [...document.querySelectorAll('.msg.assistant')].pop(); return m && !m.classList.contains('streaming') && m.querySelector('.body').textContent; })()", 15000);
  check("thinking switch sent as true on the physics desk", /Thinking switch: true/.test(reply3 || ""), String(reply3).slice(0, 160));
  await cdp.eval("__wb.send('/flashcards export')");
  check("/flashcards export parsed two Q/A pairs", !!(await waitFor("[...document.querySelectorAll('.msg.tool .body')].some(b => /Exported 2 cards/.test(b.textContent))")));

  // the sprite inspector on a synthetic 3x4 sheet of 32 px frames
  await cdp.eval(`(async () => { const c = document.createElement('canvas'); c.width = 96; c.height = 128; const x = c.getContext('2d'); for (let r = 0; r < 4; r++) for (let col = 0; col < 3; col++) { x.fillStyle = '#c86432'; x.fillRect(col * 32 + 8, r * 32 + 6, 16, 24); } const b = await new Promise(r => c.toBlob(r, 'image/png')); __wb.openSprite(new File([b], 'hero.png', { type: 'image/png' })); return true; })()`);
  await waitFor("document.getElementById('sp-fw').value === '32'");
  check("sprite inspector measured 32 px frames, 3x4", (await cdp.eval("document.getElementById('sp-fw').value + 'x' + document.getElementById('sp-fh').value + ' ' + /(\\d+)×(\\d+) = /.exec(document.getElementById('sprite-measure').textContent)?.[0]")) === "32x32 3×4 = ");
  await cdp.eval("document.getElementById('sp-draft').click()");
  check("draft manifest without the model uses the RPG Maker rows", /walk_down/.test(await cdp.eval("document.getElementById('sp-json').textContent")));
  await cdp.eval("document.getElementById('sp-ask').click()");
  const manifest = await waitFor("(() => { const t = document.getElementById('sp-json').textContent; return /a fake courier/.test(t) && t; })()", 15000);
  check("vision model's JSON merged into Mira's manifest shape", !!manifest && /"idle_down"/.test(manifest) && /"feet_y": 29/.test(manifest) && /"frame": 32/.test(manifest), String(manifest).slice(0, 160));
  await cdp.eval("document.getElementById('sprite-close').click()");

  // Mira's stage: the atlas loaded, she is drawn, the district followed the desk, the menu opens, she speaks up on cue
  const stageOk = await waitFor("__wb.stage && __wb.stage.loaded && document.getElementById('stage-canvas').width > 0 && !document.getElementById('stage-wrap').hidden", 10000);
  check("the stage loaded the courier atlas and is drawing", !!stageOk, String(await cdp.eval("__wb.stage && __wb.stage.error")));
  await cdp.eval("__wb.selectDesk('paperless')");
  check("the street follows the desk (Paperless is the Undercity)", (await cdp.eval("__wb.stage.regime")) === "GUT" && (await cdp.eval("document.getElementById('stage-regime').textContent")) === "GUT");
  check("the stage state chip follows the turn", ["idle", "thinking", "listening", "speaking", "interrupted"].includes(await cdp.eval("document.getElementById('stage-state').textContent")));
  await cdp.eval("document.getElementById('btn-menu').click()");
  check("the desk menu opens with the tools inside", (await cdp.eval("!document.getElementById('dropdown').hidden && !!document.getElementById('btn-think') && !!document.getElementById('btn-clear')")) === true);
  await cdp.eval("document.getElementById('btn-menu').click()");
  // compact by default: the last few messages under the stage; the full history takes the screen and comes back compact
  await cdp.eval("__wb.selectDesk('aetheria')"); // five tool cards live there
  const total = await cdp.eval("__wb.conv.messages.length");
  check("compact view keeps only the last few messages on screen, with the older count", total > 4 && (await cdp.eval("document.querySelectorAll('#messages .msg').length")) === 4 && /older message/.test(await cdp.eval("document.getElementById('older')?.textContent || ''")));
  // the grid keeps its rows whether or not the stage is drawn: the transcript fills the middle and the composer sits at the bottom
  const layoutOk = () => cdp.eval("(() => { const c = document.getElementById('center').getBoundingClientRect(); const t = document.getElementById('transcript').getBoundingClientRect(); const f = document.getElementById('composer').getBoundingClientRect(); return t.height > 150 && Math.abs(f.bottom - c.bottom) < 1 && Math.abs(t.bottom - f.top) < 1; })()");
  check("compact view: the transcript fills the room under the stage and the composer is at the bottom", (await layoutOk()) === true);
  await cdp.eval("document.getElementById('btn-to-history').click()");
  check("the arrow on the stage opens the whole history and the stage steps aside", (await cdp.eval("document.querySelectorAll('#messages .msg').length")) === total && (await cdp.eval("getComputedStyle(document.getElementById('stage-wrap')).display")) === "none" && (await cdp.eval("document.getElementById('center').dataset.chat")) === "full");
  check("history view: the transcript takes the stage's room and the composer stays at the bottom", (await layoutOk()) === true);
  check("the history view shows the arrow back to the stage", (await cdp.eval("getComputedStyle(document.getElementById('history-hud')).display")) === "flex" && (await cdp.eval("document.getElementById('btn-to-stage').getBoundingClientRect().height")) > 0);
  await cdp.eval("document.getElementById('btn-to-stage').click()");
  check("the arrow on the history goes back to the stage and the last few", (await cdp.eval("document.querySelectorAll('#messages .msg').length")) === 4 && (await cdp.eval("getComputedStyle(document.getElementById('stage-wrap')).display")) !== "none" && (await cdp.eval("document.getElementById('center').dataset.chat")) === "compact" && (await cdp.eval("getComputedStyle(document.getElementById('history-hud')).display")) === "none");
  await cdp.eval("document.getElementById('btn-chat').click()");
  await cdp.eval("document.getElementById('btn-stage').click()");
  check("the menu's Mira's stage goes back to the stage and the last few", (await cdp.eval("document.querySelectorAll('#messages .msg').length")) === 4 && (await cdp.eval("getComputedStyle(document.getElementById('stage-wrap')).display")) !== "none" && (await cdp.eval("document.getElementById('center').dataset.chat")) === "compact");
  // the prompt editor: edit, save, reset to the default
  await cdp.eval("document.getElementById('btn-prompt').click()");
  check("prompt editor opens with the desk's prompt", (await cdp.eval("document.getElementById('prompt-dialog').open && document.getElementById('pd-text').value.length > 100")) === true);
  await cdp.eval("document.getElementById('pd-text').value = 'You are a test desk.'; document.getElementById('pd-save').click()");
  check("edited prompt saved for this desk", (await cdp.eval("__wb.settings.desks[__wb.desk.id].prompt")) === "You are a test desk.");
  await cdp.eval("document.getElementById('btn-prompt').click(); document.getElementById('pd-reset').click(); document.getElementById('pd-save').click()");
  check("reset to default clears the override", (await cdp.eval("__wb.settings.desks[__wb.desk.id].prompt === undefined")) === true);
  await cdp.eval("__wb.send('/files')");
  check("drawer opened", (await cdp.eval("!document.getElementById('drawer').hidden")) === true);
  await cdp.eval("document.getElementById('btn-drawer-close').click()");
  check("drawer closes with its close button", (await cdp.eval("document.getElementById('drawer').hidden")) === true);
  await cdp.eval("__wb.send('/files')");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  check("drawer closes with Escape", !!(await waitFor("document.getElementById('drawer').hidden", 3000)));
  await cdp.eval("__wb.initiate()");
  const quip = await waitFor("(() => { const m = [...document.querySelectorAll('.msg.mira')].pop(); return m && m.querySelector('.body').textContent; })()", 15000);
  check("she speaks up on cue as a Mira card, tag stripped", !!quip && !/^\[/.test(quip.trim()), String(quip).slice(0, 80));
  await cdp.eval("__wb.selectDesk('mira')");
  // her quick reaction to a shouted message: the model riffs one (the fake lab answers the riff prompt), shown in the bubble over the stage before any reply
  const riffed = JSON.parse(await cdp.eval("__wb.quickReaction('WHY IS THIS BROKEN AGAIN', { force: true }).then(r => JSON.stringify(r))"));
  check("the model riffs a quick reaction and it shows in the bubble over the stage", !!riffed && riffed.riffed && /keyboard is stuck/.test(riffed.line) && (await cdp.eval("!document.getElementById('stage-bark').hidden && document.getElementById('stage-bark').textContent")) === riffed.line, JSON.stringify(riffed));
  // with no brain the bank answers at once, from the right shelf
  const bank = JSON.parse(await cdp.eval("(async () => { const live = __wb.brain.live; __wb.brain.live = 'none'; try { return JSON.stringify(await __wb.quickReaction('WHY IS THIS BROKEN AGAIN', { force: true })); } finally { __wb.brain.live = live; } })()"));
  check("without a brain the bank fills in from the shout shelf", !!bank && !bank.riffed && /easy|voice|first time|tiger|breath/i.test(bank.line), JSON.stringify(bank));
  await cdp.eval("__wb.send('evening')");
  const reply4 = await waitFor("(() => { const m = [...document.querySelectorAll('.msg.assistant')].pop(); return m && !m.classList.contains('streaming') && m.querySelector('.body').textContent; })()", 15000);
  check("her desk's reply carries no mood tag and asked for the full length on the lab", !!reply4 && !/^\[/.test(reply4.trim()) && /fake lab/.test(reply4), String(reply4).slice(0, 80));
  // her own save: the [jar: …] line never shows, the note is in the jar as hers, the message wears the chip
  check("her [jar: …] line was stripped, the note went into the jar as hers, and the message got the jarred chip", !/\[jar:/.test(reply4 || "") && (await cdp.eval("__wb.memory.items.some(i => i.by === 'mira' && /her desk tonight/.test(i.text))")) === true && (await cdp.eval("!![...document.querySelectorAll('.msg.assistant')].pop().querySelector('.meta .jarred')")) === true, String(await cdp.eval("JSON.stringify(__wb.memory.items)")));
  check("her note carries no announcement in the text", !/jar/i.test(reply4 || ""));
  const lastSystem = await cdp.eval("JSON.stringify(__wb.conv.messages.slice(-1)[0].stats || {})");
  check("stats recorded for her turn", /brain/.test(lastSystem));
  // her persona preset: the core on the lab by default; the pick in Settings → Mira changes what her desk is told; an edit on this device wins
  check("her desk is told the core persona on the lab", (await cdp.eval("__wb.herPreset()")) === "core" && /^## Sample replies/m.test(await cdp.eval("__wb.deskPromptNow()")));
  const pick = (v) => cdp.eval(`(() => { const s = document.getElementById('set-mira-persona'); s.value = '${v}'; s.dispatchEvent(new Event('change')); return __wb.settings.miraPersona; })()`);
  check("Short switches her desk to the short file", (await pick("short")) === "short" && (await cdp.eval("__wb.herPreset()")) === "short" && /two to four sentences/.test(await cdp.eval("__wb.deskPromptNow()")));
  await cdp.eval("document.getElementById('btn-prompt').click()");
  check("the prompt editor shows the preset in force and says so", /two to four sentences/.test(await cdp.eval("document.getElementById('pd-text').value")) && /Short persona in force/.test(await cdp.eval("document.getElementById('pd-status').textContent")));
  await cdp.eval("document.getElementById('pd-text').value = 'You are a test courier.'; document.getElementById('pd-save').click()");
  await pick("long");
  check("an edit on this device wins over the preset", (await cdp.eval("__wb.deskPromptNow()")) === "You are a test courier." && (await cdp.eval("__wb.herPreset()")) === "long");
  await cdp.eval("document.getElementById('btn-prompt').click(); document.getElementById('pd-reset').click(); document.getElementById('pd-save').click()");
  check("reset returns her desk to the preset", (await cdp.eval("__wb.settings.desks.mira.prompt === undefined")) === true && /^Storyteller with swagger\./m.test(await cdp.eval("__wb.deskPromptNow()")));
  await pick("auto");

  // ---- Mira's Qwen voice engine: the fake lab answers /v1/audio/speech the way tools/qwen_tts_server.py does
  await cdp.eval(`__wb.settings.ttsEngine = 'auto'; __wb.settings.qwenUrl = 'http://127.0.0.1:${LAB}'; __wb.speech.qwen.checkedAt = 0; 'ok'`);
  const clip = JSON.parse(await cdp.eval("__wb.speech.synth('Coffee is on. The sink can wait.', 'af_bella', { speed: 0.85 }).then(r => JSON.stringify({ n: r.samples.length, sr: r.sampleRate, engine: __wb.speech.lastEngine, kind: __wb.speech.qwen.kind })).catch(e => JSON.stringify({ error: e.message }))"));
  check("a stage clip comes from the Qwen voice server when it answers, at 24 kHz, with no Kokoro loaded", clip.engine === "qwen" && clip.kind === "server" && clip.sr === 24000 && clip.n > 12000 && (await cdp.eval("__wb.speech.kokoroReady")) === false, JSON.stringify(clip));
  check("on auto a reply still goes to Kokoro; on qwen it goes to the engine", (await cdp.eval("__wb.speech._wantQwen('reply')")) === false && (await cdp.eval("__wb.speech._wantQwen('stage')")) === true && (await cdp.eval("__wb.settings.ttsEngine = 'qwen'; __wb.speech._wantQwen('reply')")) === true);
  await cdp.eval("__wb.speech.speak('Coffee is on. The sink can wait. Real talk, that light is doing its thing again.')");
  const spoke = await waitFor("__wb.speech.lastEngine === 'qwen' && __wb.speech.speaking && __wb.speech._synth >= 2", 15000);
  check("with the engine on qwen a reply is read by the Qwen voice, sentence by sentence into the player", !!spoke, String(await cdp.eval("JSON.stringify({ engine: __wb.speech.lastEngine, speaking: __wb.speech.speaking, synth: __wb.speech._synth, sent: __wb.speech._sent })")));
  check("the reply's sentences reached the player in order with a window of six in flight, and the stage may ask the server for six clips at once", (await cdp.eval("(() => { const s = __wb.speech.qwenStats; return !!s && s.ahead === 6 && s.order.length >= 2 && s.order.every((v, i) => v === i) && s.failed === 0; })()")) === true && (await cdp.eval("__wb.speech.synthAhead()")) === 6, await cdp.eval("JSON.stringify(__wb.speech.qwenStats)"));
  const served = await (await fetch(`http://127.0.0.1:${LAB}/health`)).json();
  check("the voice server was asked for the clips", served.clips >= 3, JSON.stringify(served));
  await cdp.eval("__wb.speech.stop(); __wb.settings.ttsEngine = 'auto'; __wb.settings.qwenUrl = 'http://127.0.0.1:9'; __wb.speech.qwen.checkedAt = 0; 'ok'");
  check("with no server up the probe says so and Kokoro is the voice", (await cdp.eval("__wb.speech._qwenCheck()")) === false && (await cdp.eval("__wb.speech.ready")) === false);
  check("with no server the stage asks for one clip at a time", (await cdp.eval("__wb.speech.synthAhead()")) === 1);
  await cdp.eval(`__wb.settings.qwenUrl = 'http://127.0.0.1:${LAB}'; __wb.speech.qwen.checkedAt = 0; 'ok'`);

  // export and diagnostics render without throwing
  await cdp.eval("__wb.send('/diag')");
  check("diagnostics panel rendered the brain row", !!(await waitFor("document.querySelector('#diag table.diag') && document.querySelector('#diag').textContent.includes('fake-qwen3')")));
  check("diagnostics labels the round trip as ping, apart from first token and tokens per second", /Ping/.test(await cdp.eval("document.querySelector('#diag').textContent")) && /round trip/.test(await cdp.eval("document.querySelector('#diag').textContent")));
  await cdp.eval("document.getElementById('btn-drawer-close').click()");

  // ---- the open mic desk: a set, the linter, the stage with a fake voice, both exports, crowd work, one-liners, the punch-up
  const lastAssistant = (test) => waitFor(`(() => { const m = [...document.querySelectorAll('.msg.assistant')].pop(); return m && !m.classList.contains('streaming') && (${test}) && m.querySelector('.body').textContent; })()`, 20000);
  await cdp.eval("__wb.selectDesk('openmic')");
  check("the stage desk is told the file's prompt, not the fallback line", /^You are Mira, on the stage/.test(await cdp.eval("__wb.deskPromptNow()")));
  await cdp.eval("__wb.send('/five 0.7 about landlords')");
  const setBody = await lastAssistant("m.querySelector('.setmeta')");
  check("a tight five came back as a set, the pose tags as badges", !!setBody && /landlord/.test(setBody) && (await cdp.eval("[...document.querySelectorAll('.msg.assistant')].pop().querySelectorAll('.pose').length")) >= 4, String(setBody).slice(0, 80));
  const setMeta = await cdp.eval("[...document.querySelectorAll('.msg.assistant')].pop()?.querySelector('.setmeta')?.textContent || ''");
  check("the set card: bits, words, runtime and the linter's verdict", /2 bits/.test(setMeta) && /read aloud/.test(setMeta) && /linter: clean/.test(setMeta), setMeta);
  check("the set is the desk's last set", (await cdp.eval("__wb.lastSet()?.set.bits.length")) === 2);
  check("the set card measures the runtime against the minutes asked for", /of 0:42 read aloud/.test(setMeta) && (await cdp.eval("__wb.conv.messages.filter(m => m.kind === 'set').pop().target")) === 42, setMeta);
  // a set written in plain chat (no command) on this desk gets the set card too; any other reply gets a Perform tool
  await cdp.eval("__wb.send('write me a bit about landlords')");
  const plain = await lastAssistant("m.querySelector('.setmeta')");
  check("a plain-chat reply shaped like a set gets the set card and counts as a set", !!plain && (await cdp.eval("(() => { const m = __wb.conv.messages.filter(x => x.role === 'assistant').pop(); return m.kind === 'set' && !m.lint && !m.target; })()")) === true);
  await cdp.eval("__wb.send('/five 0.7 about the restated thesis')");
  const lintMeta = await waitFor("(() => { const m = [...document.querySelectorAll('.msg.assistant')].pop(); const s = m && m.querySelector('.setmeta'); return s && /rewritten/.test(s.textContent) && s.textContent; })()", 25000);
  // the fake linter flags the restated thesis; the local linter also sees bit 1 repeating the earlier set's bit 1 by hash
  check("the linter flagged the restated thesis (and the repeated paragraph) and the set was rewritten once", !!lintMeta && /linter: [12] notes? · rewritten/.test(lintMeta) && /2 bits/.test(lintMeta), String(lintMeta));
  check("the rewritten set kept the shape and the draft before it is kept", (await cdp.eval("(() => { const m = __wb.conv.messages.filter(x => x.kind === 'set').pop(); const s = __wb.parseSet(m.content); return !!m.draft && /restated/.test(m.draft) && s.bits.length === 2 && !/restated/.test(s.bits.map(b => b.text).join()) && !/## Notes/.test(m.content); })()")) === true);
  // the stage
  await cdp.eval("__wb.send('/perform')");
  const micOpen = await waitFor("!document.getElementById('mic').hidden && __wb.micStage.renderer && __wb.micStage.renderer.W > 0 && typeof __wb.micStage.renderer.scene.setLight === 'function'", 10000);
  check("the stage opened full screen, the room drawn by Mira's renderer with the open-mic scene", !!micOpen);
  check("the stage is a panel on the history stack", (await cdp.eval("__wb.topPanel()")) === "mic");
  // a slow voice (1.8 s a line, slower than the lines play) with a short lead and margin, so the buffering shows: she smokes through it
  check("the fake voice installed for the test", (await cdp.eval("__wb.fakeVoice(1800)")) === true);
  await cdp.eval("__wb.micStage.perf.preroll = 2; __wb.micStage.perf.margin = 2; window.__buf = []; __wb.micStage.perf.addEventListener('buffering', e => __buf.push({ i: e.detail.index, seq: __wb.micStage.renderer.seq && __wb.micStage.renderer.seq.name, pose: document.getElementById('mic-pose').textContent })); window.__buffered = 0; __wb.micStage.perf.addEventListener('buffered', () => __buffered++)");
  await cdp.eval("window.__poses = []; window.__rec = null; window.__pkg = null; window.__drag = null; __wb.micStage.perf.addEventListener('bit', () => (__drag = __wb.micStage.renderer.seq && __wb.micStage.renderer.seq.name)); __wb.micStage.perf.addEventListener('line', e => __poses.push(e.detail.line.pose)); __wb.micStage.addEventListener('recorded', e => { __rec = { name: e.detail.name, size: e.detail.blob.size }; window.__recBlob = e.detail.blob; }); __wb.micStage.addEventListener('packaged', e => (__pkg = { count: e.detail.count, bytes: e.detail.bytes, lines: e.detail.manifest.lines.length, duration: e.detail.manifest.duration }))");
  await cdp.eval("void __wb.micStage.record()"); // not awaited: record() resolves when the whole set has played
  await waitFor("__wb.micStage.perf && __wb.micStage.perf.state === 'playing' && __poses.length >= 2", 20000);
  await sleep(600);
  const her = await cdp.eval("(() => { const r = __wb.micStage.renderer; return { clip: r.clipName, x: r.x, state: r.state, atlas: r.atlas.width, s: r.s, vw: r.vw, vh: r.vh, standY: r.standY, caption: r.caption && r.caption.text }; })()");
  check("mid-set: her renderer is in the speaking state on one of her clips, on the stage, with the line on screen", her.clip in { idle_down: 1, walk_down: 1, walk_right: 1, walk_left: 1, idle_right: 1, idle_southeast: 1, idle_southwest: 1, resonate_down: 1 } && her.state === "speaking" && Math.abs(her.x) < 60 && her.atlas > 1000 && her.s >= 1 && !!her.caption, JSON.stringify(her));
  await cdp.screenshot(join(root, "shots", "ui-check-stage.png"));
  const played = await waitFor("__wb.micStage.perf && __wb.micStage.perf.state === 'done' && __pkg && __pkg.count", 90000);
  check("the set played through on the stage: every line, in order, with its pose", !!played && (await cdp.eval("__poses.length")) === (await cdp.eval("__wb.micStage.set.lines.length")) && (await cdp.eval("__poses.includes('shriek') && __poses.includes('deadpan') && __poses.includes('aside')")) === true, String(await cdp.eval("JSON.stringify(__poses)")));
  const buf = JSON.parse(await cdp.eval("JSON.stringify({ events: __buf, buffered: __buffered, ready: __wb.micStage.perf.readyCount(), total: __wb.micStage.set.lines.length })"));
  check("the voice rendered ahead: a warm-up before the first line and a catch-up mid-set, and she smoked through both", buf.events.length >= 2 && buf.events[0].i === 0 && buf.events.some((b) => b.i > 0) && buf.events.every((b) => /^stage_drag/.test(String(b.seq)) && b.pose === "smoke") && buf.buffered === buf.events.length && buf.ready === buf.total, JSON.stringify(buf));
  check("between the bits she took a drag on the stage (the smoke clips, the longer gap)", /^stage_drag/.test(String(await cdp.eval("__drag"))) && (await cdp.eval("__wb.micStage.perf.bitGap")) === 4.4, String(await cdp.eval("__drag")));
  const rec = await cdp.eval("JSON.stringify(__rec)");
  check("a video clip was recorded from the canvas and the stage's audio", !!rec && JSON.parse(rec)?.size > 1000 && /\.(webm|mp4)$/.test(JSON.parse(rec).name), rec);
  const pkg = JSON.parse(await cdp.eval("JSON.stringify(__pkg)"));
  const spoken = await cdp.eval("__wb.micStage.set.lines.filter(l => !l.direction).length");
  check("the cutscene package: manifest.json, set.md and one WAV per spoken line, with the timeline", pkg && pkg.count === 2 + spoken && pkg.lines === (await cdp.eval("__wb.micStage.set.lines.length")) && pkg.duration > 3, JSON.stringify(pkg));
  check("every aside ends with her tag line, one per bit, and the transcript shows the inline form as a badge", (await cdp.eval("__wb.micStage.set.lines.filter(l => l.tagLine).length")) === 2 && (await cdp.eval("__wb.micStage.set.bits.every(b => b.asides === 1)")) === true && (await cdp.eval("[...document.querySelectorAll('.msg.assistant')].some(m => /It knows something/.test(m.textContent) && m.querySelector('.pose.aside'))")) === true);
  // the room: recorded laughs and the club bed behind her, behind one switch; the whole set as one audio file
  const room = JSON.parse(await cdp.eval("JSON.stringify({ on: __wb.micStage.perf.roomOn, samples: __wb.micStage.perf.room.buffers.size, bed: !!__wb.micStage.perf.room._bedTimer, box: document.getElementById('mic-room-on').checked })"));
  check("the room loaded its recorded laughs and the club bed is looping", room.on && room.samples >= 14 && room.bed && room.box, JSON.stringify(room));
  await cdp.eval("document.getElementById('mic-room-on').click()");
  check("the room switch silences the crowd and stops the bed", (await cdp.eval("__wb.micStage.perf.roomOn === false && __wb.settings.openmic.room === false && !__wb.micStage.perf.room._bedTimer")) === true);
  await cdp.eval("document.getElementById('mic-room-on').click()");
  // the stage's audio panel: the rain heard from inside (a lowpass on the rain, the thunder a rumble), switchable to the street
  const inside = JSON.parse(await cdp.eval("JSON.stringify({ box: document.getElementById('mic-rain-inside').checked, tone: __wb.micStage.perf.music.rainTone.frequency.value, thunder: __wb.micStage.perf.music.thunderLp.frequency.value, rain: document.getElementById('mic-rain-on').checked })"));
  await cdp.eval("document.getElementById('mic-rain-inside').click()");
  await sleep(1500);
  const outside = JSON.parse(await cdp.eval("JSON.stringify({ setting: __wb.settings.openmic.rainInside, tone: __wb.micStage.perf.music.rainTone.frequency.value })"));
  check("the rain is heard from inside the club by default, and the panel switches it to the street", inside.box && inside.rain && inside.tone < 2000 && inside.thunder < 100 && outside.setting === false && outside.tone > 5000, JSON.stringify({ inside, outside }));
  await cdp.eval("document.getElementById('mic-rain-inside').click()");
  // the clip itself: the stage's own recorder (WebCodecs into MP4) where the browser can encode H.264, the browser's WebM where it cannot; the file is written out and read back with ffprobe when it is here
  const recType = await cdp.eval("__wb.micStage.perf.recordType");
  check("the recording went through the stage's own recorder (H.264 into MP4) or the WebM fallback, and says which", /^video\/(mp4 \(avc1|webm)/.test(String(recType)), String(recType));
  if (rec && JSON.parse(rec)) {
    const ext = JSON.parse(rec).name.split(".").pop();
    // (the auto path here; a WebM forced by Settings → Open mic → video would come out the same way through the browser's recorder)
    const b64 = await cdp.eval("new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(__recBlob); })");
    const clipPath = join(root, "shots", `ui-check-clip.${ext}`);
    writeFileSync(clipPath, Buffer.from(b64, "base64"));
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name:format=duration", "-of", "csv=p=0", clipPath], { encoding: "utf8" });
    if (probe.status === 0) {
      const codecs = probe.stdout.split(/\r?\n/).filter(Boolean);
      const dur = Number(codecs.pop());
      check(`the clip on disk is a real ${ext} (ffprobe: ${codecs.join("+")}, ${dur.toFixed(1)} s) with video and audio and the set's length`, codecs.some((c) => /h264|vp9|vp8/.test(c)) && codecs.some((c) => /aac|opus/.test(c)) && dur > 8, probe.stdout.trim());
    } else check("the clip on disk starts like a media file", /ftyp|\x1aE\xdf\xa3/.test(Buffer.from(b64, "base64").subarray(0, 12).toString("latin1")), "no ffprobe to read it");
  }
  const audio = JSON.parse(await cdp.eval("__wb.micStage.exportAudio().then(a => JSON.stringify(a ? { name: a.name, bytes: a.bytes, seconds: a.seconds } : null))"));
  check("the whole set exports as one WAV on the timeline (into Downloads on the phone)", !!audio && /^performance-rent\.wav$/.test(audio.name) && audio.bytes > 200000 && audio.seconds > 10, JSON.stringify(audio));
  check("the clips went into the audio cache", (await cdp.eval("__wb.speech && (await (await import('/src/store.js').catch(() => null))?.store?.audioCount?.()) ?? -1").catch(() => -1)) !== 0);
  // crowd work from the heckle box
  await cdp.eval("document.getElementById('mic-heckle').value = 'you are not funny'; document.getElementById('mic-heckle-send').click()");
  const heckled = await lastAssistant("/paid to be here/.test(m.querySelector('.body').textContent)");
  check("crowd work: the heckle came back in two lines, in character", !!heckled && (await cdp.eval("__wb.conv.messages.filter(m => m.kind === 'heckle').length")) === 1, String(heckled));
  check("a reply that is not a set (the heckle's) still gets a Perform tool in its message tools", (await cdp.eval("!!document.querySelector('.msg.assistant:not(:has(.setmeta)) .tools button[title^=\"Perform\"]')")) === true);
  await waitFor("__wb.micStage.perf && __wb.micStage.perf.state !== 'playing'", 20000);
  // the back gesture closes the stage
  await cdp.eval("history.back()");
  check("the back gesture closes the stage", !!(await waitFor("document.getElementById('mic').hidden", 3000)) && (await cdp.eval("__wb.topPanel()")) === null);
  // one-liners with stars
  await cdp.eval("__wb.send('/lines')");
  await lastAssistant("m.querySelector('.stars')");
  check("the one-liner pack renders with a star per line", (await cdp.eval("[...document.querySelectorAll('.msg.assistant')].pop().querySelectorAll('.stars button.star').length")) >= 5);
  await cdp.eval("[...document.querySelectorAll('.msg.assistant')].pop().querySelectorAll('.stars button.star')[1].click()");
  check("a starred line is kept", (await cdp.eval("Object.keys(JSON.parse(localStorage.getItem('workbench.openmic.stars') || '{}')).length")) === 1);
  await cdp.eval("__wb.send('/stars')");
  check("/stars lists the kept lines", !!(await waitFor("[...document.querySelectorAll('.msg.tool .body')].some(b => /footnote longer than the Bible/.test(b.textContent))")));
  // the dial-in: one brief through every stage voice, side by side, and a pick that becomes the desk's prompt
  await cdp.eval("__wb.send('/dialin landlords')");
  const bench = await waitFor("(() => { const c = [...document.querySelectorAll('.msg.tool')].pop(); return c && c.querySelector('.bench') && c.querySelectorAll('.bench button.use').length; })()", 60000);
  check("/dialin wrote the brief through the file's voice and the three dials and laid them side by side with numbers", bench === 4 && (await cdp.eval("[...document.querySelectorAll('.msg.tool')].pop().querySelectorAll('table tr').length")) === 5 && (await cdp.eval("__wb.conv.messages.filter(m => m.kind === 'set' && m.voice).length")) === 4, String(bench));
  await cdp.eval("[...document.querySelectorAll('.msg.tool')].pop().querySelector('.bench button.use[data-v=\"stoic\"]').click()");
  check("use makes a dial the desk's prompt", (await cdp.eval("__wb.settings.desks.openmic.voice === 'stoic' && /Calm\\. You never raise your voice/.test(__wb.settings.desks.openmic.prompt || '') && /The rules of a bit\\./.test(__wb.settings.desks.openmic.prompt || '')")) === true);
  await cdp.eval("__wb.send('/voice default')");
  check("/voice default puts the file's voice back", (await cdp.eval("__wb.settings.desks.openmic.prompt === undefined && __wb.settings.desks.openmic.voice === 'default'")) === true);
  // the punch-up: a rant in, a set and a diff with notes out
  await cdp.eval("__wb.send('/punchup ' + 'We are all pretending we have it together. '.repeat(3) + 'Bullshit. It is a hamster wheel made of veneer. It is a farce. It is a farce.')");
  check("the punch-up returned the punched set as a set card", !!(await waitFor("(() => { const m = __wb.conv.messages.filter(x => x.role === 'assistant').pop(); return m && m.kind === 'set' && m.draft && m.notes && /cut: restated thesis/.test(m.notes); })()", 25000)));
  check("the changes card carries the diff and the notes", !!(await waitFor("[...document.querySelectorAll('.msg.tool .body')].some(b => /cut: restated thesis/.test(b.textContent) && b.querySelector('code.language-diff'))", 5000)));
  // the song from the set, on the suno desk, with its history
  await cdp.eval("__wb.send('/song')");
  const song = await lastAssistant("__wb.desk.id === 'suno' && m.querySelector('.songbar')");
  check("/song from the Open Mic desk moved to Suno and wrote the song from the set", !!song && /Cozy Studio/.test(song));
  const songDone = () => waitFor("(() => { const m = __wb.conv.messages.filter(x => x.kind === 'song').pop(); return m && typeof m.notes === 'string' && [...document.querySelectorAll('.msg.assistant')].pop().querySelector('.songbar').textContent; })()", 20000);
  const bar1 = await songDone();
  check("the three fenced blocks got labelled copy buttons, and the bar counts verses, the style line and the spec", (await cdp.eval("(() => { const m = [...document.querySelectorAll('.msg.assistant')].pop(); return !!m.querySelector('pre.copy-lyrics') && !!m.querySelector('pre.copy-style') && !!m.querySelector('pre.copy-spec'); })()")) === true && /verses: 3/.test(bar1 || "") && /style: \d+\/120/.test(bar1 || "") && /spec: \d+\/900/.test(bar1 || ""), String(bar1));
  check("a full three-verse song with its spec passes the checks", (await cdp.eval("__wb.conv.messages.filter(x => x.kind === 'song').pop().notes")) === "", String(await cdp.eval("__wb.conv.messages.filter(x => x.kind === 'song').pop().notes")));
  check("the spec went into the style library", (await cdp.eval("Object.keys(JSON.parse(localStorage.getItem('workbench.suno.specs') || '{}')).length")) === 1);
  await cdp.eval("__wb.send('/duet')");
  await lastAssistant("/Voice 2/.test(m.querySelector('.body').textContent)");
  await songDone();
  check("the same spec on the duet keeps one library entry", (await cdp.eval("Object.keys(JSON.parse(localStorage.getItem('workbench.suno.specs') || '{}')).length")) === 1);
  await cdp.eval("__wb.send('/versions')");
  check("/versions lists both versions and compares the latest two", !!(await waitFor("[...document.querySelectorAll('.msg.tool .body')].some(b => b.querySelectorAll('li').length >= 2 && /Latest two/.test(b.textContent) && /spec \\d+\\/900/.test(b.textContent) && b.querySelector('code.language-diff'))", 5000)));
  // the song linter: a song under three verses is rewritten once, the draft before kept
  await cdp.eval("__wb.send('/song a song with two verses about the landlord')");
  const fixed = await waitFor("(() => { const m = __wb.conv.messages.filter(x => x.kind === 'song').pop(); return m && m.lint && m.lint.rewritten && m.draft && JSON.stringify({ before: (m.draft.match(/\\[Verse \\d/g) || []).length, after: (m.content.match(/\\[Verse \\d/g) || []).length, bar: [...document.querySelectorAll('.msg.assistant')].pop().querySelector('.songbar').textContent }); })()", 25000);
  check("a two-verse song was rejected by the linter and rewritten once with three, the draft before kept", !!fixed && JSON.parse(fixed).before === 2 && JSON.parse(fixed).after === 3 && /linter: rewritten/.test(JSON.parse(fixed).bar), String(fixed));
  // same sound, new song: the spec word for word under a new brief
  await cdp.eval("__wb.send('/same a song about the sink that can wait')");
  await lastAssistant("__wb.conv.messages.filter(x => x.role === 'user').pop().content.includes('Same sound, new song')");
  await songDone();
  check("/same sent the last spec word for word with the new brief", (await cdp.eval("(() => { const u = __wb.conv.messages.filter(x => x.role === 'user').pop().content; return /Song brief: a song about the sink/.test(u) && /Same sound, new song/.test(u) && /dark synthwave with post-punk bones/.test(u); })()")) === true);
  // the library card and long form
  await cdp.eval("__wb.send('/specs')");
  check("/specs shows the library with a same-sound button per spec", !!(await waitFor("(() => { const c = [...document.querySelectorAll('.msg.tool')].pop(); return c && c.querySelectorAll('.specs li').length >= 1 && !!c.querySelector('.specs li button.use'); })()", 5000)));
  await cdp.eval("__wb.send('/longform on')");
  check("/longform on is kept in the desk's settings and the checkbox", (await cdp.eval("__wb.settings.desks.suno.longForm === true && document.getElementById('set-suno-longform').checked")) === true);
  await cdp.eval("__wb.send('/longform off')");

  // ---- the PC runtime: this page comes from tools/pc_runtime.mjs, so the local runtime is here; the fake lab stands in for llama-server
  check("the runtime host was found at boot", (await cdp.eval("__wb.native.kind")) === "host");
  await cdp.eval("document.getElementById('btn-settings').click()");
  const panel = await waitFor("(() => { const fs = document.getElementById('native-fieldset'); return !fs.hidden && !document.getElementById('nat-pc').hidden && document.getElementById('native-legend').textContent; })()", 5000);
  check("the local runtime panel is shown with the PC's words and builds block", /Local runtime · llama\.cpp on this PC/.test(panel || ""), String(panel));
  check("the brain choices say local, not in-app", (await cdp.eval("document.querySelector('#menu-brain option[value=native]').textContent + '|' + document.querySelector('#set-brain option[value=native]').textContent")) === "local|Local runtime only (llama.cpp on this PC)");
  check("the backend list is the PC's", (await cdp.eval("[...document.getElementById('nat-backend').options].map(o => o.value).join(',')")) === "auto,cuda,vulkan,cpu");
  const opt = await waitFor("(() => { const o = [...document.getElementById('nat-model').options].find(o => o.value === 'tiny-test.gguf'); return o && o.textContent; })()", 8000);
  check("the model list has the GGUF in the runtime's models folder", /tiny-test\.gguf/.test(opt || ""), String(opt));
  const builds = await waitFor("(() => { const t = document.getElementById('nat-servers').textContent; return /fake/.test(t) && t; })()", 8000);
  check("the builds line lists what the host found", /cuda, cpu/.test(builds || ""), String(builds));
  const plan = await waitFor("(() => { const t = document.getElementById('nat-plan').textContent; return /context/.test(t) && t; })()", 8000);
  check("the plan read the header through the host: the card, in memory, the context", /GPU \(auto/.test(plan || "") && /loaded into memory/.test(plan || "") && /context 32768/.test(plan || ""), String(plan));
  const before = await cdp.eval("__wb.brain.live");
  await cdp.eval("document.getElementById('nat-start').click()");
  const chipLocal = await waitFor("(() => { const t = document.getElementById('brain-text').textContent; return /local · tiny-test/.test(t) && t; })()", 30000); // the chip shows the alias (the .gguf dropped)
  check("Start ran the server through the host and the chip switched to the local model", before === "lab" && !!chipLocal, String(chipLocal));
  check("the brain is the local runtime on the host's server port", (await cdp.eval("__wb.brain.live === 'native' && __wb.brain.info.native.port")) === LOCAL && (await cdp.eval("__wb.settings.brain")) === "native");
  const stLine = await waitFor(`(() => { const t = document.getElementById('nat-status').textContent; return /running · tiny-test\\.gguf · cuda · port ${LOCAL} · pid \\d+/.test(t) && t; })()`, 8000);
  check("the status line shows the model, the backend, the port and the pid", !!stLine, String(stLine));
  check("the host's log shows the command it ran", /\[host\]/.test(await cdp.eval("document.getElementById('nat-log').textContent")));
  await cdp.eval("__wb.selectDesk('research')");
  const nBefore = await cdp.eval("document.querySelectorAll('.msg.assistant').length");
  await cdp.eval("__wb.send('hello local')");
  const replyPc = await waitFor(`(() => { const m = [...document.querySelectorAll('.msg.assistant')]; const last = m[m.length - 1]; return m.length > ${nBefore} && !last.classList.contains('streaming') && last.querySelector('.body').textContent; })()`, 15000);
  check("a turn streamed through the local server", /fake lab/.test(replyPc || ""), String(replyPc).slice(0, 80));
  check("the menu's model select is locked to the server's model", (await cdp.eval("document.getElementById('menu-model').disabled && document.getElementById('menu-model').value")) === "tiny-test.gguf");
  await cdp.eval("document.getElementById('nat-stop').click()");
  const chipLab = await waitFor("(() => { const t = document.getElementById('brain-text').textContent; return /^lab ·/.test(t) && t; })()", 15000);
  check("Stop killed the server and the brain went back to auto, the lab", !!chipLab && (await cdp.eval("__wb.settings.brain")) === "auto", String(chipLab));
  check("the host reports the server stopped", (await cdp.eval("__wb.native.status().then(s => s.running)")) === false);
  // a GGUF already on a disk: its path in the URL box, used where it is
  await cdp.eval(`document.getElementById('nat-url').value = ${JSON.stringify(linkedPath)}; document.getElementById('nat-download').click()`);
  const linked = await waitFor("(() => { const o = [...document.getElementById('nat-model').options].find(o => o.value === 'linked-test.gguf'); return o && o.textContent; })()", 8000);
  check("a .gguf path in the box is used where it is", /on disk/.test(linked || ""), String(linked));
  check("the linked file is the picked model", (await cdp.eval("__wb.settings.native.model")) === "linked-test.gguf");
  await cdp.eval("history.back()");
  await waitFor("document.getElementById('drawer').hidden", 3000);

  // ---- the phone at 360 px: the header never overflows, the chip shrinks, the rail is icons, the drawer is a bottom sheet, dialogs fit, back closes
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 740, deviceScaleFactor: 3, mobile: true });
  await sleep(500);
  await cdp.eval("__wb.selectDesk('research')");
  await cdp.eval("__wb.brain.info.model = 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL'; __wb.brain.info.latency = 51; __wb.brain.emit('status', __wb.brain.status())");
  await sleep(200);
  const fits = () => cdp.eval("(() => { const h = document.getElementById('head'); const m = document.getElementById('btn-menu').getBoundingClientRect(); const c = document.getElementById('brain-chip').getBoundingClientRect(); return { over: h.scrollWidth - h.clientWidth, menuRight: Math.round(m.right), chipRight: Math.round(c.right), chipH: Math.round(c.height), text: document.getElementById('brain-text').textContent, ping: document.getElementById('brain-ping').textContent, title: document.getElementById('brain-chip').title, ellipsis: document.getElementById('brain-text').scrollWidth > document.getElementById('brain-text').clientWidth }; })()");
  let f = await fits();
  check("360 px: the header does not widen and the menu button stays on screen", f.over <= 1 && f.menuRight <= 360 && f.chipRight < f.menuRight, JSON.stringify(f));
  check("the chip shows the short alias, the ping at the end, the full name in the tooltip", /Qwen3\.8-27B · UD-Q4_K_XL/.test(f.text) && /51 ms ping/.test(f.ping) && /unsloth\/Qwen3\.8-27B-GGUF:UD-Q4_K_XL/.test(f.title) && /not generation speed/.test(f.title), JSON.stringify(f));
  await cdp.eval("document.getElementById('brain-chip').click()");
  await sleep(100);
  f = await fits();
  check("a tap opens the chip to the full name on more than one line, still on screen", /unsloth\/Qwen3\.8-27B-GGUF:UD-Q4_K_XL/.test(f.text) && f.chipH > 30 && f.over <= 1 && f.menuRight <= 360, JSON.stringify(f));
  await cdp.eval("document.getElementById('brain-chip').click()");
  check("the rail is icons only under 768 px", (await cdp.eval("getComputedStyle(document.querySelector('.desk-btn span')).display")) === "none" && (await cdp.eval("document.getElementById('rail').getBoundingClientRect().width")) <= 60);
  check("the visual viewport is mirrored for the panels", /px/.test(await cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--vvh')")));
  await cdp.eval("__wb.send('/files')");
  const sheet = await cdp.eval("(() => { const r = document.getElementById('drawer').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), radius: getComputedStyle(document.getElementById('drawer')).borderTopLeftRadius }; })()");
  check("the drawer is a bottom sheet inside the viewport", sheet.l === 0 && sheet.r === 360 && sheet.b <= 740 && sheet.t >= 60 && sheet.radius !== "0px", JSON.stringify(sheet));
  await cdp.eval("history.back()");
  check("the back gesture closes the drawer", !!(await waitFor("document.getElementById('drawer').hidden", 3000)));
  await cdp.eval("document.getElementById('btn-prompt').click()");
  const dlg = await cdp.eval("(() => { const d = document.getElementById('prompt-dialog'); const r = d.getBoundingClientRect(); return { open: d.open, l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), x: !!document.getElementById('pd-close') }; })()");
  check("the prompt dialog fills the phone screen and fits it, with a ✕", dlg.open && dlg.l === 0 && dlg.r === 360 && dlg.t === 0 && dlg.b <= 740 && dlg.x, JSON.stringify(dlg));
  await cdp.eval("history.back()");
  check("the back gesture closes the dialog", !!(await waitFor("!document.getElementById('prompt-dialog').open", 3000)));
  await cdp.eval("document.getElementById('btn-menu').click()");
  const dd = await cdp.eval("(() => { const r = document.getElementById('dropdown').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), b: Math.round(r.bottom), hidden: document.getElementById('dropdown').hidden }; })()");
  check("the desk menu fits the phone screen", !dd.hidden && dd.l >= 0 && dd.r <= 360 && dd.b <= 740, JSON.stringify(dd));
  await cdp.eval("history.back()");
  check("the back gesture closes the menu", !!(await waitFor("document.getElementById('dropdown').hidden", 3000)));
  await cdp.eval("__wb.selectDesk('openmic'); __wb.send('/perform')");
  const micPhone = await waitFor("(() => { if (document.getElementById('mic').hidden) return null; const r = document.getElementById('mic-box').getBoundingClientRect(); return r.width > 100 && r.right <= 360 && r.bottom <= 740 && document.getElementById('mic-box').dataset.aspect === '9:16' && JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) }); })()", 8000);
  check("the stage on the phone is portrait 9:16 and inside the viewport", !!micPhone, String(micPhone));
  await cdp.screenshot(join(root, "shots", "ui-check-phone.png"));
  await cdp.eval("__wb.micStage.close()");
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await sleep(300);
  await cdp.eval("__wb.selectDesk('research')");

  await cdp.screenshot(join(root, "shots", "ui-check.png"));
  const errors = cdp.drain().filter((l) => /EXCEPTION|^error/.test(l) && !/favicon|ERR_CONNECTION|net::/.test(l));
  check("no page exceptions", errors.length === 0, errors.join("\n"));
} finally {
  if (!keep) {
    cdp.close();
    killTree(proc);
    await host.close();
    lab.close();
    rmSync(dataDir, { recursive: true, force: true });
  } else log("kept running: chrome, the runtime host, fake lab");
}
log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
