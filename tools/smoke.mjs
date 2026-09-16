// Node-only checks that need no browser and no GPU: the cube data is sound,
// the think-tag parser splits a stream correctly, the sentence splitter and
// the speech cleaner behave, the prompts and the bible exist, and the sprite
// manifest builder produces Mira's shape from a synthetic measurement.
//
//   npm run check

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const ok = (name) => {
  passed++;
  console.log("  ok", name);
};

// ---------------------------------------------------------------- cube
const cube = JSON.parse(readFileSync(join(root, "public/data/aetheria-cube.json"), "utf8"));
assert.equal(cube.frequencies.length, 27);
const hz = cube.frequencies.map((f) => f.hz);
assert.deepEqual(hz.slice(0, 9), [174, 285, 396, 417, 528, 639, 741, 852, 963]);
assert.deepEqual(hz.slice(9, 18), [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150]);
assert.deepEqual(hz.slice(18), [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336]);
for (let i = 1; i < 9; i++) {
  assert.equal(hz[9 + i] - hz[9 + i - 1], 243, "HEART step");
  assert.equal(hz[18 + i] - hz[18 + i - 1], 354, "HEAD step");
}
const sq = cube.loshu.square;
for (const line of [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]) assert.equal(line.reduce((a, i) => a + sq[i], 0), 15, "magic line");
const walks = Object.fromEntries(cube.walks.map((w) => [w.key, w]));
assert.equal(walks.A.steps.length, 27);
assert.equal(walks.B.steps.length, 27);
assert.equal(walks.C.steps.length, 27);
assert.equal(walks.O.steps.length, 29);
assert.equal(walks.CAB.steps.length, 81);
assert.equal(walks.CABI.steps.length, 110);
for (const k of ["A", "B", "C"]) assert.equal(new Set(walks[k].steps).size, 27, `walk ${k} is a permutation`);
const source = cube.frequencies.findIndex((f) => f.hz === 2178);
assert.equal(walks.O.steps.filter((i) => i === source).length, 3, "Ouroboros crosses SOURCE three times");
assert.equal(walks.O.steps[0], source);
assert.equal(walks.O.steps[28], source);
assert.equal(new Set(walks.O.steps).size, 27, "Ouroboros visits all 27");
assert.equal(cube.frequencies[walks.C.steps[0]].hz, 528, "Vortex starts at the GUT centre");
assert.equal(cube.frequencies[walks.B.steps[0]].hz, 174);
assert.equal(cube.frequencies[walks.B.steps[1]].hz, 1206);
assert.equal(cube.frequencies[walks.B.steps[2]].hz, 3504);
assert.equal(cube.frequencies.filter((f) => f.stone).length, 27, "every frequency carries a stone");
assert.equal(cube.frequencies.find((f) => f.hz === 2178).stone.holder, "Nine-Fingers"); // heart_05, position 5, the SOURCE
assert.equal(cube.frequencies.find((f) => f.hz === 528).stone.holder, "Sister Anka"); // gut_05
assert.equal(cube.frequencies.find((f) => f.hz === 6336).stone.holder, "The Custodian"); // head_09
ok("cube data: 27 frequencies, the formulas, the square, the walks, the stones");

// ---------------------------------------------------------------- think parser
const { ThinkParser, stripThink } = await import("../src/think.js");
{
  let text = "";
  let think = "";
  const p = new ThinkParser((t) => (text += t), (r) => (think += r));
  for (const chunk of ["<thi", "nk>let me ", "reason</th", "ink>\n\nThe answer", " is 4.", " <think>more</think> done"]) p.push(chunk);
  p.close();
  assert.equal(think, "let me reasonmore");
  assert.equal(text, "The answer is 4. done");
  assert.equal(stripThink("<think>x</think>  hi"), "hi");
  ok("think parser splits a streamed <think> block, even across chunk boundaries");
}

// ---------------------------------------------------------------- splitter + speech cleaner
const { SentenceSplitter } = await import("../src/splitter.js");
{
  const out = [];
  const s = new SentenceSplitter((x) => out.push(x));
  s.push("Dr. Lewis wrote 3.5 pages. Then he stopped! Really?");
  s.close();
  assert.deepEqual(out, ["Dr. Lewis wrote 3.5 pages.", "Then he stopped!", "Really?"]);
  ok("sentence splitter respects abbreviations and decimals");
  const { chunkLong, cleanForSpeech } = await import("../src/speech.js");
  const long = Array.from({ length: 12 }, (_, i) => `clause number ${i + 1} goes on for a while with words in it`).join(", ") + ".";
  const parts = chunkLong(long);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 240), `chunks: ${parts.map((p) => p.length)}`);
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long);
  assert.deepEqual(chunkLong("Short one."), ["Short one."]);
  assert.equal(cleanForSpeech("Hello there 😂👍🏽 friend"), "Hello there friend");
  assert.equal(cleanForSpeech("Goddamn, that goddamned goddamnit thing. goddammit, Godfrey."), "God-damn, that god-damned god-damnit thing. god-dammit, Godfrey.", "goddamn is said god-damn, case kept, other god-words alone");
  assert.equal((await import("../src/spelling.js")).spokenSpelling("god-damn already"), "god-damn already", "already spelled stays");
  // no asterisk reaches the phonemizer: action beats go, emphasis keeps its words, nested and unclosed markers and snake_case names are handled
  const spoken = {
    "*sighs* Long day. **Nobody** asked, *really*.": "Long day. Nobody asked, really.",
    "**Qwen3_8B** is fine. I *really* mean it. *takes a drag*": "Qwen3 8B is fine. I really mean it.",
    "Rain again.\n*leans on the wall*\nNobody wrote a list.": "Rain again.\nNobody wrote a list.",
    "*unclosed emphasis here": "unclosed emphasis here",
    "**bold with *inner* bit** and __under__ too": "bold with inner bit and under too",
    "3 * 4 is 12, and a * on its own": "3 times 4 is 12, and a on its own",
    "*You* did this.": "You did this.",
  };
  for (const [raw, want] of Object.entries(spoken)) {
    const got = cleanForSpeech(raw);
    assert.equal(got, want, raw);
    assert.ok(!/[*_]/.test(got), raw);
  }
  const { similar } = await import("../src/thoughts.js");
  assert.ok(similar("The street is quiet tonight.", "the street is quiet tonight"));
  assert.ok(similar("Rain again. The street is quiet tonight.", "The street is quiet again tonight, rain or not."));
  assert.ok(!similar("Twenty-seven of them. Nobody wrote a list.", "The bag was on the floor when I woke up."));
  ok("speech chunks long sentences with nothing lost, drops emoji, and reads no asterisks (beats dropped, emphasis kept); her unprompted lines are checked for repeats");
  // the read-aloud state machine with a stub worker: the player going dry while the worker is still synthesizing is not the end of the turn
  {
    const { Speech } = await import("../src/speech.js");
    const posted = [];
    let handler = null;
    globalThis.Worker = class {
      constructor() {
        setTimeout(() => this.onmessage({ data: { type: "ready", voices: { bf_emma: {} }, voice: "bf_emma" } }), 0);
        handler = this;
      }
      postMessage(m) {
        posted.push(m);
      }
      terminate() {}
    };
    const sp = new Speech({ voices: { default: "bf_emma" }, ttsDevice: "cpu", ttsSpeed: 1 });
    sp.player.unlock = async () => {};
    sp.player.enqueue = () => {};
    sp.player.stop = () => {};
    const events = [];
    for (const n of ["speaking", "idle", "error"]) sp.addEventListener(n, () => events.push(n));
    await sp.speak("Sentence one is here. Sentence two is here. Sentence three is here.");
    const says = posted.filter((m) => m.type === "say");
    assert.equal(says.length, 3);
    assert.ok(sp.speaking);
    const id = says[0].id;
    handler.onmessage({ data: { type: "audio", id, seq: 0, audio: new Float32Array(8) } });
    sp.player.onChunkEnd(id, 0);
    sp.player.onDrained(); // dry while chunks 1 and 2 are still owed
    assert.ok(sp.speaking && !events.includes("idle"), "still speaking while the worker is behind");
    handler.onmessage({ data: { type: "error", id, seq: 1, message: "TTS: bad chunk" } }); // one chunk fails; the rest still plays
    handler.onmessage({ data: { type: "audio", id, seq: 2, audio: new Float32Array(8) } });
    sp.player.onChunkEnd(id, 2);
    sp.player.onDrained();
    assert.ok(!sp.speaking && events.at(-1) === "idle" && events.includes("error"));
    delete globalThis.Worker;
    ok("read-aloud stays live across a dry player and a failed chunk, idle only after the last one");
  }
}
{
  // cleanForSpeech lives beside browser-only imports; test the same rules inline
  const src = readFileSync(join(root, "src/speech.js"), "utf8");
  assert.match(src, /stripThink\(md\)/);
  assert.match(src, /Code block omitted/);
  ok("speech cleaner strips think blocks and code before Kokoro");
}

// ---------------------------------------------------------------- lab client shapes
const lab = readFileSync(join(root, "src/lab.js"), "utf8");
assert.match(lab, /chat_template_kwargs/);
assert.match(lab, /reasoning_content/);
assert.match(lab, /stream_options/);
ok("lab client sends the thinking switch and reads reasoning_content");
// every call goes through labFetch, which names the address space for a plain-http LAN box from an https page (Mira's rule)
assert.match(lab, /targetAddressSpace/);
assert.match(lab, /export function blockedByMixedContent/);
assert.equal((lab.match(/\bfetch\(/g) || []).length, 1, "one bare fetch, inside labFetch");
assert.ok(!readFileSync(join(root, "src/brain.js"), "utf8").includes("mixedContent("), "brain.js asks blockedByMixedContent, not the plain rule");
ok("lab client reaches a LAN box through Chrome's local-network permission; only labFetch calls fetch");

// ---------------------------------------------------------------- settings: endpoint normalisation (pure function, evaluated without a DOM)
{
  const src = readFileSync(join(root, "src/settings.js"), "utf8");
  const fn = new Function(src.slice(src.indexOf("export function isLoopbackHost"), src.indexOf("/**\n * Mixed content")).replaceAll("export function", "function") + "\nreturn endpoints;")();
  assert.equal(fn("https://abc.laresprime.olares.com/v1").chat, "https://abc.laresprime.olares.com/v1/chat/completions");
  assert.equal(fn("http://khadas.local:4000/v1/chat/completions").models, "http://khadas.local:4000/v1/models");
  assert.equal(fn("khadas.local:4000").base, "http://khadas.local:4000/v1");
  assert.equal(fn(""), null);
  ok("endpoint normalisation: bare host, /v1 base, Mira's full chat URL");
  // where the box lives decides how the browser is asked (lab.js): loopback as it is, the LAN through Chrome's permission, the internet as mixed content
  assert.deepEqual([fn("http://127.0.0.1:8080/v1").loopback, fn("http://127.0.0.1:8080/v1").lan], [true, false]);
  assert.deepEqual([fn("localhost:8080").loopback, fn("http://192.168.1.20:8080").lan, fn("http://10.0.0.5:4000").lan, fn("khadas.local:4000").lan, fn("http://khadas:4000").lan], [true, true, true, true, true]);
  assert.deepEqual([fn("https://abc.laresprime.olares.com/v1").lan, fn("https://abc.laresprime.olares.com/v1").loopback, fn("http://8.8.8.8/v1").lan], [false, false, false]);
  ok("endpoints tell loopback, the LAN and the internet apart");
}

// ---------------------------------------------------------------- her persona presets (pure part of desks.js)
{
  const src = readFileSync(join(root, "src/desks.js"), "utf8");
  const mod = new Function(src.slice(src.indexOf("export const MIRA_PERSONAS"), src.indexOf("export const DESKS")).replaceAll("export ", "") + "\nreturn { MIRA_PERSONAS, bigBrain, miraPreset };")();
  const lab = { live: "lab", info: { model: "unsloth/Qwen3.8-27B-GGUF:Q4_K_M" } };
  const nat = (model) => ({ live: "native", info: { model } });
  assert.equal(mod.miraPreset({ miraPersona: "auto" }, lab), "core");
  assert.equal(mod.miraPreset({ miraPersona: "long" }, lab), "long");
  assert.equal(mod.miraPreset({ miraPersona: "core" }, nat("Qwen3-4B-Q4_K_M.gguf")), "core");
  assert.equal(mod.miraPreset({}, nat("Qwen3-14B-Q4_K_M.gguf")), "long");
  assert.equal(mod.miraPreset({}, nat("gemma-3-12b-it-Q4_K_M.gguf")), "long");
  assert.equal(mod.miraPreset({}, nat("Qwen3-30B-A3B-Q4_K_M.gguf")), "long");
  assert.equal(mod.miraPreset({}, nat("Qwen3-8B-Q4_K_M.gguf")), "standard");
  assert.equal(mod.miraPreset({}, nat("Qwen3-4B-Q4_K_M.gguf")), "standard");
  assert.equal(mod.miraPreset({}, { live: "device", info: { model: "Gemma 4 E2B" } }), "standard");
  assert.equal(mod.miraPreset({}, { live: "none", info: {} }), "standard");
  assert.equal(mod.miraPreset({ miraPersona: "short" }, lab), "short");
  assert.equal(mod.miraPreset({ miraPersona: "standard" }, lab), "standard");
  assert.equal(mod.miraPreset({ miraPersona: "long" }, nat("Qwen3-4B-Q4_K_M.gguf")), "long");
  const words = {};
  const tokens = {};
  for (const [k, p] of Object.entries(mod.MIRA_PERSONAS)) {
    const text = readFileSync(join(root, `prompts/${p.file}.md`), "utf8");
    assert.match(text, /^You are Mira\. You live in the Aetheria Workbench with Joe and Alisha/, `${k}: the core premise (the friend in the Workbench, not the courier)`);
    // the core's traits, the guardrail, the box-art wink with no game lore, the jar, and no comedian named (Mira's own rule), in every length
    assert.match(text, /Stoic/, `${k}: stoic`);
    assert.match(text, /Sailor's mouth/, `${k}: the mouth`);
    assert.match(text, /Bob Ross eyes/, `${k}: the eyes`);
    assert.match(text, /never a slur|never slurs/i, `${k}: the guardrail`);
    assert.match(text, /box art/, `${k}: the box-art wink`);
    assert.match(text, /memory jar/i, `${k}: the jar`);
    assert.match(text, /not angry|never bitter|no self-pity|never self-pity/, `${k}: entertained, not angry, no self-pity`);
    assert.match(text, /[Nn]ever name a comedian|No naming comedians/, `${k}: no comedian named, as a rule`);
    assert.doesNotMatch(text, /Carlin|Stanhope|Hicks|Pryor|Katt|Williams|Murphy/i, `${k} names no comedians`);
    assert.doesNotMatch(text, /Undercity|courier from Paperless|scanners?\b|Frank the ferret|envelope patch/i, `${k}: no game lore`);
    if (k === "core") assert.match(text, /## Sample replies/, "the core carries the calibration samples");
    else assert.match(text, /"Sheesh\." "Get a load of this guy\."/, `${k}: the quick reactions, quoted from barks.js`);
    // the same files on the Mira side (personas/) stay PG-13; these copies are rated M since 0.3.18 and the Workbench is the lead, so they diverge on purpose: same premise, the mouth paragraph theirs
    const twin = `C:/Users/jobo1/Desktop/MIRA/aetheria-companion/personas/${p.file}.md`;
    assert.match(text, /rated M/i, `${k}: rated M here`);
    if (existsSync(twin)) assert.equal(readFileSync(twin, "utf8").split("\n")[0], text.split("\n")[0], `${k} shares its premise line with Mira's personas/${p.file}.md`);
    words[k] = text.split(/\s+/).length;
    tokens[k] = Math.round(text.length / 4.2);
  }
  assert.ok(words.short < words.standard && words.standard < words.long && words.long < words.core, JSON.stringify(words));
  assert.ok(tokens.short + 220 <= 700, `short fits the phone budget (${tokens.short} + 220)`);
  assert.ok(tokens.long >= 800 && tokens.long <= 1200, `long is a bible (${tokens.long})`);
  assert.ok(tokens.core >= 2000 && tokens.core <= 3200, `the core is the whole thing (${tokens.core})`);
  // the stage prompt: the same friend with the leash off, a dive bar, story bits, no game lore; the linter and Suno follow the updated brief
  const mic = readFileSync(join(root, "prompts/open-mic.md"), "utf8");
  assert.match(mic, /^You are Mira, on the stage of a dive-bar open mic/);
  assert.match(mic, /The mouth on you\./);
  assert.match(mic, /^Fuck it: gather round the dumpster fire/m, "the default stage voice (the dumpster fire, 0.3.21)");
  assert.match(mic, /does not say please and does not bend the knee/, "the badass bitch");
  assert.match(mic, /The filth has no off switch/, "the mouth, no off switch");
  assert.match(mic, /^- Nothing soft: no apology/m, "the no-softening rule of a bit");
  assert.match(mic, /lil dick energy/, "she calls it out");
  assert.match(mic, /Never name a comedian/);
  assert.doesNotMatch(mic, /Undercity|Frank the ferret|envelope patch|the Paperless Act/); // the lore it tells her to leave out is named once, as a rule
  assert.match(readFileSync(join(root, "prompts/open-mic-linter.md"), "utf8"), /9\. lore:[\s\S]*11\. mouth:[\s\S]*12\. soft:[\s\S]*mouth\|soft"/);
  assert.match(mic, /^The mouth on you./m, "the stage prompt puts the mouth on");
  assert.match(mic, /\{aside: the remark\}/, "the inline aside form");
  assert.ok(existsSync(join(root, "src/openmic/recorder.js")) && existsSync(join(root, "node_modules/mp4-muxer/package.json")), "the stage recorder and its muxer");
  const suno = readFileSync(join(root, "prompts/suno.md"), "utf8");
  assert.match(suno, /Three verses minimum, always/);
  assert.match(suno, /```style\n[\s\S]*```spec\n/, "the style line and the spec are two blocks");
  assert.match(suno, /400 to 900 characters/);
  ok(`her persona preset: the core on the lab, long on a 12B+ in-app model, standard otherwise, a choice wins; four files, four lengths (${tokens.short}/${tokens.standard}/${tokens.long}/${tokens.core} tokens), the core's traits in each; the stage, the linter and Suno on the updated brief`);
}

// ---------------------------------------------------------------- the stage voice dials and the bench numbers
{
  const { VOICES, applyVoice, voiceOf } = await import("../src/openmic/voices.js");
  const { measure, benchTable } = await import("../src/openmic/bench.js");
  const mic = readFileSync(join(root, "prompts/open-mic.md"), "utf8");
  assert.match(voiceOf(mic), /^Who you are up here\.\nFuck it: gather round the dumpster fire/, "the file's voice sits between the markers");
  assert.match(VOICES.gloves.text, /^Who you are up here\.\nGloves off\. You are a woman who gives no fucks/, "the 0.3.15 default survives as the gloves dial");
  // no sample bits in the stage prompt (0.3.21): the old two ran 0.2 swears per 100 words and set the register, and a 4B pastes any sample back as the set; the register is checked in words instead
  assert.match(mic, /^The register, checked\./m, "the register check replaces the sample bits");
  assert.doesNotMatch(mic, /^\(Story bit|^\(The surgical gear|^\(The open/m, "no sample bits to copy");
  assert.match(mic, /A \(beat\) is rare: two a bit at most/, "the beat rule");
  assert.match(mic, /three or more in every bit/, "the mouth's floor per bit");
  // the register lines live in mira-core.md (the lab's persona); the bench guards their mouth so they cannot go beige unnoticed
  const core = readFileSync(join(root, "prompts/mira-core.md"), "utf8");
  const lines = core.slice(core.indexOf("**On stage (the leash off"));
  const sm = measure("# x\n\n## Bit 1 — x\n" + lines.split("\n").slice(1).join("\n"));
  assert.ok(sm.swearsPer100 >= 1.5 && sm.swearWords >= 5, `the core's stage lines swear like the stage says (${sm.swearsPer100}/100, ${sm.swearWords} distinct)`);
  for (const [k, v] of Object.entries(VOICES)) {
    const swapped = applyVoice(mic, v.text);
    assert.equal(voiceOf(swapped).trim(), v.text.trim(), `${k} swaps in`);
    assert.ok(swapped.includes("The rules of a bit.") && swapped.includes("The register, checked."), `${k} keeps the rules and the samples`);
    assert.match(v.text, /Never a slur/, `${k} keeps the guardrail`);
  }
  const m = measure("# T\n\n## Bit 1 — x\nThe fucking landlord calls it cozy. It smells like a wet dog in a warm car. {aside: The light buzzes.} Shit, I paid for it.\n");
  assert.ok(m.isSet && m.swears === 2 && m.swearWords === 2 && m.similes === 1 && m.senses >= 2 && m.soft === 0 && m.words > 10, JSON.stringify(m));
  assert.equal(measure("# T\n\n## Bit 1 — x\nShit. But seriously, folks. Just kidding.\n").soft, 2, "the bench counts the softeners");
  assert.equal(measure("# T\n\n## Bit 1 — x\nGod-damn it. Goddamn. Damn.\n").swears, 3, "the bench counts god-damn either way");
  assert.match(benchTable([{ name: "x", m }]), /\| \*\*x\*\* \| \d+ \|/);
  ok("the stage voice dials swap into the prompt cleanly and the bench measures a set");
}

// ---------------------------------------------------------------- her memory jar tag (pure part of memory.js)
{
  const { takeJar, JAR_PROTOCOL, JAR_TAG } = await import("../src/memory.js");
  assert.deepEqual(takeJar("Evening. Coffee's on.\n[jar: we're on her desk tonight; they said evening first]"), { text: "Evening. Coffee's on.", notes: ["we're on her desk tonight; they said evening first"], pending: false });
  assert.deepEqual(takeJar("Evening. Coffee's on. [jar: half a no"), { text: "Evening. Coffee's on.", notes: [], pending: true }, "a half-streamed tag is held back");
  assert.deepEqual(takeJar("No tag here."), { text: "No tag here.", notes: [], pending: false });
  assert.equal(takeJar("[jar: one] middle [jar: two]").notes.length, 2);
  assert.match(JAR_PROTOCOL, /\[jar: the note\]/);
  assert.ok(JAR_TAG.global);
  ok("her jar tag: stripped from the reply, the note kept, a half-streamed tag held back");
}

// ---------------------------------------------------------------- her quick reactions (the bank, the classifier, the cycling)
{
  const { BARKS, BARK_MOODS, classify, bark } = await import("../src/barks.js");
  for (const [k, shelf] of Object.entries(BARKS)) {
    assert.ok(shelf.length >= 4 && shelf.every((l) => l.length <= 48 && /[.!?]$/.test(l)), `${k}: short spoken lines`);
    assert.ok(BARK_MOODS[k], `${k} has a mood`);
  }
  const kind = (t, o = {}) => classify(t, { force: true, ...o })?.kind;
  assert.equal(kind("x".repeat(900)), "paste");
  assert.equal(kind("look https://example.com/a"), "link");
  assert.equal(kind("my dad died last night"), "bad");
  assert.equal(kind("I got the job!"), "good");
  assert.equal(kind("this is fucking ridiculous"), "swear");
  assert.equal(kind("WHY IS THIS BROKEN AGAIN"), "shout");
  assert.equal(kind("hello there!!!"), "shout");
  assert.equal(kind("what time is it?"), "question");
  assert.equal(kind("morning"), "generic");
  assert.equal(kind("morning", { images: 1 }), "image");
  assert.equal(kind("", { kind: "slow" }), "slow");
  assert.equal(classify("morning", { force: true }).mood, "amused");
  // a specific kind speaks most of the time, a plain message seldom
  let specific = 0;
  let plain = 0;
  for (let i = 0; i < 400; i++) {
    if (classify("my dad died")) specific++;
    if (classify("morning")) plain++;
  }
  assert.ok(specific > 220 && specific < 340, `specific ${specific}/400`);
  assert.ok(plain > 20 && plain < 110, `plain ${plain}/400`);
  // the shelf cycles before it repeats
  const seen = new Set();
  globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = v; } };
  for (let i = 0; i < BARKS.heckle.length; i++) seen.add(bark("heckle"));
  assert.equal(seen.size, BARKS.heckle.length, "no repeat inside one cycle");
  delete globalThis.localStorage;
  ok("her quick reactions: a bank of short spoken lines with moods, classified by what the message is, cycling without repeats");
}

// ---------------------------------------------------------------- her stage (Mira's renderer, scene and manifest, copied unchanged; the stroll)
{
  const renderer = readFileSync(join(root, "src/sprite/renderer.js"), "utf8");
  const scene = readFileSync(join(root, "src/scene/scene.js"), "utf8");
  const stage = readFileSync(join(root, "src/stage.js"), "utf8");
  const manifest = JSON.parse(readFileSync(join(root, "public/assets/sprites/courier/courier.json"), "utf8"));
  assert.match(renderer, /_strollSteps\(\)/);
  assert.match(renderer, /get strolling\(\)/);
  assert.match(renderer, /this\.standY = this\.groundY \+ Math\.round\(\(this\.vh - this\.groundY\) \* 0\.55\)/);
  assert.match(scene, /resize\(vw, vh, groundY, charH = 144, standY = groundY\)/);
  assert.match(stage, /!this\.renderer\.strolling/);
  assert.ok(manifest.gestures.stroll && Array.isArray(manifest.gestures.stroll.crossings), "gestures.stroll tunables");
  // the smoke clips run slower (5 fps since 2026-09-11, in Mira's copy too); the comedy stage's drag borrows them, with a longer gap between bits
  for (const [k, c] of Object.entries(manifest.clips)) if (k.startsWith("smoke_")) assert.equal(c.fps, 5, `${k} at 5 fps`);
  const stageSrc = readFileSync(join(root, "src/openmic/stage.js"), "utf8");
  assert.match(stageSrc, /stage_drag: \[\{ clip: "smoke_southeast"/);
  assert.match(stageSrc, /smoke: this\.smoking/);
  assert.match(readFileSync(join(root, "src/openmic/performance.js"), "utf8"), /export const SMOKE_GAP = 4\.4/);
  assert.ok(Array.isArray(manifest.states.idle.stroll_every) && Array.isArray(manifest.states.idle_long.stroll_every), "stroll_every on idle and the smoke break");
  ok("her stage: the lowered placement, the generated stroll, and the smoke break waits for it");
}

// ---------------------------------------------------------------- prompts, bible, icons
for (const id of ["research", "writing", "paperless", "physics", "aetheria", "mira", "mira-short", "mira-long", "mira-core", "open-mic", "open-mic-linter", "suno"]) assert.ok(existsSync(join(root, `prompts/${id}.md`)), `prompts/${id}.md`);
{
  // every desk's prompt file sits where the loader looks (prompts/<file || id>.md); the stage desk (id openmic, file open-mic) ran on a one-line fallback before 0.3.14
  const src = readFileSync(join(root, "src/desks.js"), "utf8");
  const at = src.indexOf("export const DESKS");
  const desks = new Function(src.slice(at, src.indexOf("\n];", at) + 3).replace("export ", "") + "\nreturn DESKS;")();
  assert.ok(desks.length >= 8, "the desks parsed");
  for (const d of desks) assert.ok(existsSync(join(root, `prompts/${d.file || d.id}.md`)), `the ${d.id} desk's prompt file prompts/${d.file || d.id}.md`);
  assert.equal(desks.find((d) => d.id === "openmic").file, "open-mic", "the stage desk names its file");
}
const bible = readFileSync(join(root, "public/data/paperless-bible.md"), "utf8");
assert.match(bible, /On Being Kept/);
assert.match(bible, /delivery_sef/);
assert.ok(!/\b(2178|4920|528) ?Hz\b/.test(bible), "the bible carries no frequency numbers (section 14)");
for (const n of ["research", "writing", "paperless", "physics", "aetheria", "mira", "openmic", "suno"]) assert.ok(existsSync(join(root, `public/assets/desk-icons/${n}.png`)), `icon ${n}`);
// the room's recorded people (public domain, CC0, CC BY; credited) and Bella's reference clip ship with the app
for (const n of ["big-1", "big-2", "big-3", "big-4", "big-short", "clapter", "medium-1", "medium-2", "one-1", "one-2", "one-3", "one-4", "one-5", "one-6", "applause", "club-bed"]) assert.ok(existsSync(join(root, `public/assets/room/${n}.ogg`)), `room sample ${n}`);
assert.match(readFileSync(join(root, "public/assets/room/CREDITS.md"), "utf8"), /lonemonk[\s\S]*CC BY 3\.0[\s\S]*Marble Toast[\s\S]*CC0/);
assert.ok(existsSync(join(root, "public/assets/voices/bella-ref.wav")) && existsSync(join(root, "public/assets/voices/bella-ref.txt")), "Bella's reference clip");
ok("nine prompts, the bible, eight desk icons");

// ---------------------------------------------------------------- the open mic: the set parser, the timeline, the linter's local half, the diff, the exports
{
  const set = await import("../src/openmic/set.js");
  const md = "# Rates\n\n## Bit 1 — the scanner\nThey put a scanner on the door. {pace} It reads your face. It reads it twice. Nobody has ever been read once. (beat) {deadpan} It still let me in.\n\n## Bit 2 — the patch\n{aside} That light has been buzzing all night. The uniform has an envelope on the sleeve. An envelope. On a courier. In a city that banned paper. {shriek} They sewed the crime on my arm.\n\n> They sewed the crime on my arm.\nRuntime: 5:00\n";
  const s = set.parseSet(md);
  assert.equal(s.title, "Rates");
  assert.deepEqual(s.bits.map((b) => [b.n, b.title, b.lines.length, b.asides]), [[1, "the scanner", 5, 0], [2, "the patch", 7, 1]]); // 7: the aside's tag line is its own line
  assert.equal(s.pullQuote, "They sewed the crime on my arm.");
  assert.ok(s.isSet && s.words > 50 && s.runtime > 20 && s.runtime < 60, `${s.words} words, ${s.runtime} s`);
  assert.deepEqual(s.lines.map((l) => l.pose), [null, "pace", null, null, "deadpan", "aside", "aside", null, null, null, null, "shriek"]);
  assert.equal(s.lines[4].spoken, "It still let me in.", "the direction is shown, not spoken");
  assert.ok(s.lines[5].aside && !s.lines[5].text.includes("{"));
  assert.deepEqual(set.lintLocal(s), []);
  const twice = set.parseSet(md.replace("{aside} That light", "{aside} That light has been buzzing all night. {aside} The floor smells of rain. That light"));
  assert.ok(set.lintLocal(twice).some((p) => p.rule === "one aside per bit"), "two asides in a bit are caught");
  assert.ok(set.lintLocal(set.parseSet(["## Bit 1", "One. Two.", "", "## Bit 2", "Three. {aside: the bulb.} Four.", "", "## Bit 3", "Five. Six."].join(String.fromCharCode(10)))).filter((p) => p.rule === "one aside per bit").length === 2, "a bit with no aside is caught in a set of three or more");
  assert.ok(set.lintLocal(s, set.paragraphHashes(md)).some((p) => p.rule === "no repeated paragraphs"), "a paragraph from an earlier set is caught by hash");
  assert.ok(set.lintLocal(set.parseSet("## Bit 1\nOne. {wave} Two.")).some((p) => p.rule === "pose vocabulary"));
  assert.ok(set.lintLocal(set.parseSet("## Bit 1\nOne. Two. Three. Just kidding, y'all.")).some((p) => p.rule === "no softening" && /just kidding/i.test(p.note)), "a wink is caught");
  assert.equal(set.lintLocal(set.parseSet("## Bit 1\nOne. Two. But seriously, folks, be kind to each other.")).filter((p) => p.rule === "no softening").length, 1, "one note per bit, however many softeners");
  const tl = set.timeline(s, s.lines.map(() => 1.5));
  assert.equal(tl.lines.length, 12); // the aside's tag line counts too
  assert.equal(tl.lines[0].audio, "l001.wav");
  assert.ok(tl.lines[5].t > tl.lines[4].t + 1.5 + 1.0, "a bit gap and the beat after the deadpan tag");
  assert.ok(tl.duration > 12 * 1.5);
  assert.equal(set.parseSet("just one line here. and another.").bits.length, 1, "a set with no headings is one bit");
  assert.deepEqual(set.parseLines("# T\n\n1. First line.\n2. \"Second line.\"\n- third"), ["First line.", "Second line.", "third"]);
  const d = set.diffLines("a\nb\nc", "a\nc\nd");
  assert.deepEqual(d.map((x) => x.op + x.text), ["=a", "-b", "=c", "+d"]);
  assert.match(set.diffMarkdown(d), /^```diff\n  a\n- b\n  c\n\+ d\n```$/);
  assert.match(set.setMarkdown(s), /^# Rates\n\n## 1\. the scanner/);
  assert.equal(set.slugOf("They sewed the crime! On my arm"), "they-sewed-the-crime-on-my-arm");
  const wav = await import("../src/openmic/wav.js");
  const enc = wav.encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 24000);
  assert.equal(enc.byteLength, 44 + 8);
  const dec = wav.decodeWav(enc);
  assert.equal(dec.sampleRate, 24000);
  assert.ok(Math.abs(dec.samples[1] - 0.5) < 0.001 && dec.samples[2] === -0.5);
  const zip = await import("../src/openmic/zip.js");
  assert.equal(zip.crc32(new TextEncoder().encode("hello")).toString(16), "3610a686");
  const z = zip.zipStore([{ name: "performance-x/manifest.json", data: '{"a":1}' }, { name: "performance-x/audio/l001.wav", data: enc }]);
  const entries = zip.unzipStore(z);
  assert.deepEqual(entries.map((e) => [e.name, e.data.length]), [["performance-x/manifest.json", 7], ["performance-x/audio/l001.wav", 52]]);
  assert.equal(z[0], 0x50, "PK");
  // the inline aside: `{aside: remark}` carries its remark inside the braces; two sentences are one aside; the bare form still works
  {
    const s = set.parseSet("# T\n\n## Bit 1 — x\nThe rent went up. {aside: That bulb is buzzing again. It knows something.} The apartment did not. {deadpan} Southern exposure.\n\n## Bit 2 — y\nPlain line here. {aside} A bare aside. And the tag.\n");
    const b1 = s.bits[0];
    assert.equal(b1.asides, 1, "a two-sentence inline aside counts once");
    // her tag ("You can put that aside.") follows every aside as its own line: the lean, the quip, then the tag
    assert.deepEqual(b1.lines.map((l) => [l.pose, l.aside, !!l.asideCont, l.text]), [[null, false, false, "The rent went up."], ["aside", true, false, "That bulb is buzzing again."], ["aside", true, true, "It knows something."], ["aside", true, true, "You can put that aside."], [null, false, false, "The apartment did not."], ["deadpan", false, false, "Southern exposure."]]);
    assert.equal(s.bits[1].asides, 1);
    assert.equal(s.bits[1].lines.filter((l) => l.tagLine).length, 1, "the bare {aside} form gets the tag too");
    assert.ok(s.bits[1].lines.findIndex((l) => l.tagLine) === s.bits[1].lines.findIndex((l) => l.aside) + 1, "the tag comes right after the remark");
    const bare = set.parseSet("# T\n\n## Bit 1 — x\nThe rent went up. {aside: a quiet remark.} The apartment did not.\n", { asideTag: "" });
    assert.deepEqual(bare.bits[0].lines.map((l) => l.text), ["The rent went up.", "a quiet remark.", "The apartment did not."], "without the tag the remark stands alone");
    const own = set.parseSet("# T\n\n## Bit 1 — x\nThe rent went up. {aside: a quiet remark. You can put that aside.} The apartment did not.\n");
    assert.equal(own.bits[0].lines.filter((l) => /put that aside/i.test(l.text)).length, 1, "a tag the model wrote itself is not doubled");
    assert.equal(set.stripTags("A {aside: quiet remark} B {pace} C"), "A quiet remark B C");
    // 0.3.22: what a 4B does with asides on the real stage prompt, and what the parser makes of it
    const said = set.parseSet("# T\n\n## Bit 1 — x\nThe rent went up. {aside: That bulb is buzzing again.} (beat) You can put that aside. The apartment did not.\n");
    assert.deepEqual(said.bits[0].lines.map((l) => [l.pose, !!l.tagLine, l.spoken]), [[null, false, "The rent went up."], ["aside", false, "That bulb is buzzing again."], ["aside", true, "You can put that aside."], [null, false, "The apartment did not."]], "her own tag line after the braces is the tag, not a second one");
    const mid = set.parseSet("# T\n\n## Bit 1 — x\nAnd if you look up at that bulb, {aside: it's blinking again.} (beat) You realize.\n");
    assert.deepEqual(mid.bits[0].lines.map((l) => [l.pose, l.spoken]), [[null, "And if you look up at that bulb,"], ["aside", "it's blinking again."], ["aside", "You can put that aside."], [null, "You realize."]], "an aside dropped mid-sentence starts its own line; the lead-in keeps her voice");
    const back = set.parseSet("# T\n\n## Bit 1 — x\nOne. {aside: That bulb is buzzing again, like it wants a word.} Two.\n\n## Bit 2 — closer\nThree. {aside: That bulb is buzzing again, like it wants a word.} {aside: The floor is sticky.} Four.\n");
    assert.equal(back.bits[1].asides, 1, "an earlier bit's aside brought back as a tag in the closer is a callback, not an aside");
    assert.deepEqual(back.bits[1].lines.map((l) => [l.pose, l.aside, l.spoken]), [[null, false, "Three."], [null, false, "That bulb is buzzing again, like it wants a word."], ["aside", true, "The floor is sticky."], ["aside", true, "You can put that aside."], [null, false, "Four."]]);
    const notes = set.parseSet("# T\n\n## Bit 1 — x\nOne. Two.\n\n***\n\n*   **Bit 1:** Added: {aside: The bulb.}\n*   **Closer:** Connected all three asides.\n");
    assert.equal(notes.bits.length, 1, "a notes list after the set is not a bit");
    assert.equal(notes.lines.filter((l) => l.aside).length, 0, "and its asides are not performed");
    assert.equal(set.parseSet("# T\n\n## Bit 1 — x\nOne. {aside: The bulb again.} (You can put that aside.) Two.\n").bits[0].lines.filter((l) => /put that aside/i.test(l.text)).length, 1, "the tag written as a direction is not shown twice");
    assert.deepEqual(set.lintLocal(s), [], "the inline form trips no local rule");
    // the runtime against the minutes asked for: short flagged (extend the bits), long flagged (cut), on target quiet, no target no rule
    assert.ok(set.lintLocal(s, [], { target: s.runtime * 2 }).some((p) => p.rule === "runtime" && /extend the bits/.test(p.note)), "a short set is flagged");
    assert.ok(set.lintLocal(s, [], { target: s.runtime / 2 }).some((p) => p.rule === "runtime" && /cut/.test(p.note)), "a long set is flagged");
    assert.ok(!set.lintLocal(s, [], { target: s.runtime }).some((p) => p.rule === "runtime"), "on target passes");
    assert.ok(set.timeline(s, s.lines.map(() => 1)).lines.filter((l) => l.pose === "aside").length === 5, "the timeline carries the remarks and the tags as aside lines (3 in bit 1, 2 in bit 2)");
  }
  const song = await import("../src/openmic/song.js");
  const SPEC = "dark synthwave with post-punk bones, late-80s production; 92 BPM, 4/4, half-time; D minor, modal, sparse chords; female alto, half-spoken verses, belted chorus, dry and close-mic'd; verses: muted bass, brushed drums; chorus: gang vocals, wall of analog pads; bridge: piano and rain; tape saturation, wide stereo pads, no autotune, vinyl noise under the intro; intro 8 bars → V1 → PC → C → V2 → PC → C → V3 stripped → bridge drop-out → final double chorus; bitter → defiant → tender; no EDM drops, no rap, no fade-out";
  const lyr = (n) => ["[Intro: vinyl noise]\nRain on the window", "[Verse 1: half-spoken, tense]\nThe landlord calls it cozy", "[Chorus: anthemic]\nIt's a hallway with a lease", "[Verse 2: wry]\nHe raised the rent", "[Chorus: anthemic]\nIt's a hallway with a lease", n >= 3 ? "[Verse 3: stripped]\nI kept the candle" : "", "[Bridge: whispered over piano]\nCozy is a word for small", "[Final Chorus: double]\nIt's a hallway with a lease", "[Outro: spoken word]\n[spoken word] Bless his heart."].filter(Boolean).join("\n");
  const songMd = (n, style = "dark synthwave, 92 BPM, half-spoken female alto", spec = SPEC) => `# Cozy Studio\n\nHook: it's a hallway with a lease\nScheme: ABAB\n\n\`\`\`lyrics\n${lyr(n)}\n\`\`\`\n\n\`\`\`style\n${style}\n\`\`\`\n\n\`\`\`spec\n${spec}\n\`\`\`\n`;
  const sg = song.parseSong(songMd(3));
  assert.ok(sg.isSong && sg.hook === "it's a hallway with a lease" && sg.scheme === "ABAB" && /^dark synthwave/.test(sg.style) && sg.spec === SPEC, "the three blocks parse");
  assert.equal(song.verses(sg.lyrics), 3);
  assert.equal(song.choruses(sg.lyrics).length, 3, "[Chorus] twice and [Final Chorus] once");
  assert.deepEqual(song.sections(sg.lyrics)[1], { name: "Verse 1: half-spoken, tense", base: "Verse 1", descriptor: "half-spoken, tense" });
  assert.deepEqual(song.checkSong(sg), [], "a full song passes");
  assert.deepEqual(song.songRejects(sg), []);
  assert.deepEqual(song.specGaps(SPEC), []);
  // the rules: three verses at least (rejected outright), the two lengths, the clauses, the hook, descriptors, artists, long form
  const two = song.parseSong(songMd(2));
  assert.ok(song.songRejects(two).some((n) => /only 2 verses/.test(n)), "two verses are rejected");
  assert.ok(song.checkSong(two).some((n) => /only 2 verses/.test(n)));
  assert.ok(song.songRejects(song.parseSong(songMd(3).replace(/```spec[\s\S]*?```/, ""))).some((n) => /no spec block/.test(n)));
  assert.ok(song.checkSong({ ...sg, style: "x".repeat(121) }).some((n) => /121 characters/.test(n)));
  assert.ok(song.checkSong({ ...sg, spec: SPEC.slice(0, 300) }).some((n) => /300 characters/.test(n)));
  assert.ok(song.checkSong({ ...sg, spec: "dark synthwave, late-80s, female alto, tape saturation, no rap" }).some((n) => /missing a BPM/.test(n)));
  assert.ok(song.checkSong({ ...sg, lyrics: sg.lyrics.replace("[Chorus: anthemic]\nIt's a hallway with a lease", "[Chorus: anthemic]\nSomething else") }).some((n) => /hook is missing from 1 of 3/.test(n)));
  assert.ok(song.checkSong({ ...sg, lyrics: sg.lyrics.replace(/\[([^\]:]+):[^\]]*\]/g, "[$1]") }).some((n) => /no section descriptors/.test(n)));
  assert.ok(song.checkSong({ ...sg, spec: `${SPEC}; sounds like Depeche Mode` }).some((n) => /names an artist/.test(n)));
  const four = songMd(3).replace("[Bridge:", "[Verse 4: more]\nfour\n[Bridge:");
  assert.equal(song.checkSong(song.parseSong(four)).filter((n) => /long form off/.test(n)).length, 1, "a fourth verse notes long form off");
  assert.deepEqual(song.checkSong(song.parseSong(four), { longForm: true }), [], "and passes with long form on");
  assert.ok(song.specKey(SPEC) && song.specKey(SPEC) === song.specKey(SPEC.toUpperCase()), "the library key ignores case");
  const ui = readFileSync(join(root, "src/ui.js"), "utf8");
  const alias = new Function(ui.slice(ui.indexOf("export function modelAlias"), ui.indexOf("export function escapeHtml")).replace("export function", "function") + "\nreturn modelAlias;")();
  assert.equal(alias("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL"), "Qwen3.8-27B · UD-Q4_K_XL");
  assert.equal(alias("Qwen3-8B-Q4_K_M.gguf"), "Qwen3-8B · Q4_K_M");
  assert.equal(alias("gemma-3-4b-it-Q4_K_M.gguf"), "gemma-3-4b-it · Q4_K_M");
  assert.equal(alias("fake-qwen3.8-27b"), "fake-qwen3.8-27b");
  assert.equal(alias("Gemma 4 E2B q4f16"), "Gemma 4 E2B q4f16");
  assert.equal(alias(""), "");
  ok("open mic: the set parser, the pose tags, the local linter, the timeline, the diff, WAV and zip round trips, the song checks, the model alias");
}

// ---------------------------------------------------------------- the stage's manifest and the panels helper
{
  const stage = readFileSync(join(root, "src/openmic/stage.js"), "utf8");
  const manifest = JSON.parse(readFileSync(join(root, "public/assets/sprites/courier/courier.json"), "utf8"));
  for (const clip of ["walk_right", "walk_left", "walk_down", "idle_southeast", "idle_southwest", "resonate_down", "idle_down", "sleep_down", "idle_right"]) assert.ok(manifest.clips[clip], `the stage gestures use clip ${clip}`);
  for (const g of ["stage_enter", "stage_pace", "stage_lean", "stage_shriek", "stage_deadpan", "stage_aside", "stage_beat", "stage_bow"]) assert.ok(stage.includes(`${g}:`), g);
  assert.ok(!readFileSync(join(root, "src/sprite/renderer.js"), "utf8").includes("MicScene"), "renderer.js is still Mira's unchanged copy; the stage subclasses it");
  const css = readFileSync(join(root, "src/style.css"), "utf8");
  assert.match(css, /#brain-chip \{[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*overflow: hidden/);
  assert.match(css, /#brain-text \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /max-height: min\(92vh, var\(--vvh, 100dvh\)\)/, "dialogs size to the visual viewport");
  assert.match(readFileSync(join(root, "src/diagnostics.js"), "utf8"), /"Ping"/);
  ok("the stage's clips exist in her manifest; renderer.js untouched; the chip, the phone rules and the ping label are in place");
}

// ---------------------------------------------------------------- sprite manifest (pure part)
{
  const src = readFileSync(join(root, "src/tools/sprites.js"), "utf8");
  const mod = await import("../src/tools/sprites.js");
  // a synthetic 3x4 sheet of 32 px frames, RPG Maker layout, every frame drawn
  const w = 96;
  const h = 128;
  const data = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 3; c++)
      for (let y = 6; y < 30; y++)
        for (let x = 8; x < 24; x++) {
          const i = ((r * 32 + y) * w + c * 32 + x) * 4;
          data.data[i] = 200;
          data.data[i + 1] = 100;
          data.data[i + 2] = 50;
          data.data[i + 3] = 255;
        }
  const m = mod.measureSheet(data);
  assert.equal(m.frameW, 32);
  assert.equal(m.frameH, 32);
  assert.equal(m.columns, 3);
  assert.equal(m.rows, 4);
  assert.equal(m.emptyFrames, 0);
  assert.equal(m.characterHeight, 24);
  assert.equal(m.feetY, 29);
  const man = mod.buildManifest("hero.png", m, null);
  assert.equal(man.meta.frame, 32);
  assert.equal(man.meta.atlas, "hero.png");
  assert.deepEqual(Object.keys(man.clips), ["walk_down", "walk_left", "walk_right", "walk_up"]);
  assert.deepEqual(man.clips.walk_down.frames.map((f) => f.x), [0, 32, 64, 32]);
  assert.equal(man.states.listening.clip, "walk_down");
  const vis = mod.parseVisionJson('Sure:\n```json\n{"character":"a courier","clips":[{"name":"idle_down","facing":"down","frames":[1],"fps":6,"loop":true}]}\n```');
  assert.equal(vis.clips[0].name, "idle_down");
  const man2 = mod.buildManifest("hero.png", m, vis);
  assert.equal(man2.meta.character, "a courier");
  assert.deepEqual(man2.clips.idle_down.frames, [{ x: 32, y: 0 }]);
  assert.equal(man2.states.idle.clip, "idle_down");
  assert.match(src, /mouth/);
  ok("sprite inspector measures a 3x4 sheet and builds Mira's manifest shape");
}


// ---------------------------------------------------------------- the in-app runtime's launch plan: the GGUF header reader and the plan (pure)
{
  const { parseGgufHead, isMoe, kvBytes } = await import("../src/gguf.js");
  const { planLaunch, GB, LOAD_FLAGS, BIG_CTX } = await import("../src/launch.js");
  // a tiny GGUF v3 writer: [key, type, value] triples; strings (8), u32 (4), bool (7), arrays of strings (9)
  const enc = new TextEncoder();
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const u64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; };
  const str = (t) => { const u = enc.encode(t); return [u64(u.length), u]; };
  const gguf = (kvs, version = 3) => {
    const parts = [enc.encode("GGUF"), u32(version), u64(7), u64(kvs.length)];
    for (const [k, type, v] of kvs) {
      parts.push(...str(k), u32(type));
      if (type === 8) parts.push(...str(v));
      else if (type === 4) parts.push(u32(v));
      else if (type === 9) { parts.push(u32(8), u64(v.length)); for (const t of v) parts.push(...str(t)); }
      else if (type === 7) parts.push(Uint8Array.of(v ? 1 : 0));
    }
    const out = new Uint8Array(parts.reduce((a, q) => a + q.length, 0));
    let o = 0;
    for (const q of parts) { out.set(q, o); o += q.length; }
    return out;
  };
  const moeFile = gguf([
    ["general.architecture", 8, "qwen3moe"], ["general.name", 8, "Qwen3 30B-A3B"], ["general.file_type", 4, 15],
    ["qwen3moe.block_count", 4, 48], ["qwen3moe.context_length", 4, 40960], ["qwen3moe.embedding_length", 4, 2048],
    ["qwen3moe.attention.head_count", 4, 32], ["qwen3moe.attention.head_count_kv", 4, 4], ["qwen3moe.attention.key_length", 4, 128],
    ["qwen3moe.expert_count", 4, 128], ["qwen3moe.expert_used_count", 4, 8], ["qwen3moe.expert_feed_forward_length", 4, 768],
    ["tokenizer.ggml.model", 8, "gpt2"], ["tokenizer.ggml.tokens", 9, ["a", "b", "c"]], ["general.after_the_tokenizer", 7, true],
  ]);
  const h = parseGgufHead(moeFile);
  assert.equal(h.version, 3);
  assert.equal(h.arch, "qwen3moe");
  assert.equal(h.name, "Qwen3 30B-A3B");
  assert.equal(h.expertCount, 128);
  assert.equal(h.expertUsedCount, 8);
  assert.equal(h.blockCount, 48);
  assert.equal(h.headCountKv, 4);
  assert.equal(h.keyLength, 128);
  assert.equal(h.truncated, false);
  assert.equal(h.keysRead, 12, "stops at the tokenizer keys");
  assert.ok(isMoe(h));
  assert.equal(kvBytes(h, 32768), 48 * 32768 * 4 * 256 * 2);
  const cut = parseGgufHead(moeFile.subarray(0, 90)); // past the architecture, inside the next key
  assert.equal(cut.arch, "qwen3moe");
  assert.equal(cut.truncated, true, "a short buffer is reported, not thrown");
  assert.equal(parseGgufHead(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])).error, "not a GGUF file");
  assert.match(parseGgufHead(gguf([["general.architecture", 8, "llama"]], 1)).error, /version 1/);
  const dense = parseGgufHead(gguf([["general.architecture", 8, "qwen3"], ["qwen3.block_count", 4, 36], ["qwen3.attention.head_count", 4, 32], ["qwen3.attention.head_count_kv", 4, 8], ["qwen3.attention.key_length", 4, 128]]));
  assert.ok(!isMoe(dense));
  ok("gguf: the header reader takes the architecture, the experts and the cache shape, and stops before the tokenizer");

  const ram = 23.5 * GB; // a 24 GB phone as Android reports it
  const both = ["opencl", "cpu"];
  // the 30B-A3B on the ROG: fits on disk, tight with the cache, so mapped as before, with the experts on the CPU
  const a = planLaunch({ size: 18556686912, ram, head: h, backends: both, prefs: { ctx: 32768 } });
  assert.equal(a.zone, "tight");
  assert.equal(a.load, "mapped");
  assert.equal(a.backend, "auto");
  assert.equal(a.ctx, 32768);
  assert.ok(a.cpuMoe && a.args.includes("--cpu-moe"));
  assert.deepEqual(a.args.slice(0, 2), LOAD_FLAGS.mapped);
  assert.match(a.summary, /17\.3 GB, MoE \(128 experts, 8 active\) · fits in 23\.5 GB, tight with a 32768 context · mapped from storage \(mmap\) · GPU \(auto\), experts on the CPU · context 32768/);
  // an 8B at Q4: comfortable, so read into memory once, no MoE flag
  const b = planLaunch({ size: 5027784512, ram, head: dense, backends: both, prefs: { ctx: 32768 } });
  assert.equal(b.zone, "comfortable");
  assert.equal(b.load, "resident");
  assert.deepEqual(b.args, LOAD_FLAGS.resident);
  assert.equal(b.cpuMoe, false);
  // gpt-oss-120b on the phone: bigger than the RAM, so mapped, CPU build, the context capped, an 8-bit cache; "resident" is overruled with a note
  const c = planLaunch({ size: 63 * GB, ram, head: h, backends: both, prefs: { ctx: 32768, loadMode: "resident" } });
  assert.equal(c.zone, "big");
  assert.equal(c.load, "mapped");
  assert.equal(c.backend, "cpu");
  assert.equal(c.ctx, BIG_CTX);
  assert.ok(c.args.includes("-ctk") && c.args.includes("q8_0"));
  assert.ok(!c.args.includes("--cpu-moe"), "no experts flag on the CPU build");
  assert.ok(c.notes.some((n) => /mapped from storage instead/.test(n)) && c.notes.some((n) => /Bigger than the phone's memory/.test(n)));
  // the dials: off leaves the experts on the GPU; on puts the flag on a dense model too; a forced CPU backend never gets it
  assert.equal(planLaunch({ size: 18556686912, ram, head: h, backends: both, prefs: { cpuMoe: "off" } }).cpuMoe, false);
  assert.equal(planLaunch({ size: 5027784512, ram, head: dense, backends: both, prefs: { cpuMoe: "on" } }).cpuMoe, true);
  assert.equal(planLaunch({ size: 18556686912, ram, head: h, backends: both, prefs: { backend: "cpu" } }).cpuMoe, false);
  assert.equal(planLaunch({ size: 5027784512, ram, head: dense, backends: both, prefs: { loadMode: "mapped" } }).load, "mapped");
  // nothing known: the plain flags, no crash
  const u = planLaunch({});
  assert.equal(u.zone, "unknown");
  assert.deepEqual(u.args, LOAD_FLAGS.mapped);
  assert.match(u.summary, /size unknown · memory unknown/);
  // a phone whose APK only packed the CPU build: no GPU, so no experts flag even for a MoE
  assert.equal(planLaunch({ size: 18556686912, ram, head: h, backends: ["cpu"], prefs: {} }).cpuMoe, false);
  ok("launch plan: resident when it fits with room, mapped when tight, CPU + capped context when bigger than the RAM, the experts on the CPU for a MoE on the GPU");

  // ---- the PC: a discrete card with its own memory decides the layer split; the phone's plan is unchanged when vram is 0
  const pcRam = 15.7 * GB; // this laptop: 16 GB of RAM, a 16 GB card
  const vram = 15.99 * GB;
  const pcB = ["cuda", "vulkan", "cpu"];
  // an 8B Q4 (4.7 GB) and a 32k cache fit the card whole: no -ngl in the args (the host adds -ngl 99), the card named in the summary
  const p1 = planLaunch({ size: 5027784512, ram: pcRam, vram, head: dense, backends: pcB, prefs: { ctx: 32768 }, pc: true });
  assert.equal(p1.ngl, null);
  assert.ok(!p1.args.includes("-ngl"));
  assert.match(p1.summary, /GPU \(auto 16\.0 GB card\)/);
  // a 21B Q4_K_M (12.85 GB): the weights and the cache do not fit 16 GB: most layers on the card, the rest on the CPU, said so
  const wide = { ...dense, blockCount: 48 };
  const p2 = planLaunch({ size: 12852818432, ram: pcRam, vram, head: wide, backends: pcB, prefs: { ctx: 32768 }, pc: true });
  assert.ok(p2.ngl > 20 && p2.ngl < 48, `ngl ${p2.ngl}`);
  assert.equal(p2.args[p2.args.indexOf("-ngl") + 1], String(p2.ngl));
  assert.match(p2.summary, new RegExp(`GPU \\(auto 16\\.0 GB card\\), ${p2.ngl} of 48 layers`));
  assert.ok(p2.notes.some((n) => /do not fit the card's 16\.0 GB/.test(n)));
  assert.equal(p2.zone, "tight"); // and the RAM side: mapped
  assert.equal(p2.load, "mapped");
  // a MoE with the experts on the CPU: the card holds the attention, no layer split
  const p3 = planLaunch({ size: 18556686912, ram: 63 * GB, vram, head: h, backends: pcB, prefs: { ctx: 32768 }, pc: true });
  assert.equal(p3.ngl, null);
  assert.ok(p3.cpuMoe && p3.args.includes("--cpu-moe"));
  assert.match(p3.summary, /experts on the CPU/);
  // bigger than the PC's RAM: mapped, capped, 8-bit cache, but the card stays (the phone's plan switched to the CPU build)
  const p4 = planLaunch({ size: 40 * GB, ram: pcRam, vram, head: wide, backends: pcB, prefs: { ctx: 32768 }, pc: true });
  assert.equal(p4.zone, "big");
  assert.equal(p4.backend, "auto");
  assert.equal(p4.ctx, BIG_CTX);
  assert.ok(p4.args.includes("-ngl") && p4.ngl < 48);
  assert.ok(p4.notes.some((n) => /Bigger than this PC's memory/.test(n)));
  // the CPU backend asked for: no layer arithmetic, no card in the summary
  const p5 = planLaunch({ size: 12852818432, ram: pcRam, vram, head: wide, backends: pcB, prefs: { backend: "cpu" }, pc: true });
  assert.equal(p5.ngl, null);
  assert.match(p5.summary, /· CPU ·/);
  // the phone (no vram): exactly the plan before
  const p6 = planLaunch({ size: 18556686912, ram, head: h, backends: both, prefs: { ctx: 32768 } });
  assert.deepEqual(p6.args, a.args);
  assert.equal(p6.summary, a.summary);
  ok("launch plan on the PC: the card's memory sets the layer split, a MoE keeps its experts on the CPU, a big model keeps the card, the phone's plan is unchanged");
}

// ---------------------------------------------------------------- the PC runtime host: the pure parts (tools/pc_runtime.mjs)
{
  const host = await import("./pc_runtime.mjs");
  assert.deepEqual(host.backendsOfFiles(["llama-server.exe", "ggml-cuda.dll", "ggml-base.dll", "ggml-cpu-haswell.dll"]), ["cuda", "cpu"]);
  assert.deepEqual(host.backendsOfFiles(["llama-server.exe", "ggml-vulkan.dll"]), ["vulkan", "cpu"]);
  assert.deepEqual(host.backendsOfFiles(["llama-server.exe", "ggml-cpu.dll"]), ["cpu"]);
  assert.deepEqual(host.releaseAssets("b10936", "cuda"), ["llama-b10936-bin-win-cuda-12.4-x64.zip", "cudart-llama-bin-win-cuda-12.4-x64.zip"]);
  assert.deepEqual(host.releaseAssets("b10936", "vulkan"), ["llama-b10936-bin-win-vulkan-x64.zip"]);
  assert.deepEqual(host.releaseAssets("b10936", "cpu"), ["llama-b10936-bin-win-cpu-x64.zip"]);
  assert.throws(() => host.releaseAssets("b1", "rocm"));
  // GitHub's list: a tagged nightly with no Windows zips is skipped, the first bNNNN with them wins
  const rel = host.pickRelease([
    { tag_name: "v0.4.0", assets: [{ name: "nightly-tag.txt", browser_download_url: "x", size: 7 }] },
    { tag_name: "b10936", html_url: "u", published_at: "2026-09-13", assets: [{ name: "llama-b10936-bin-win-vulkan-x64.zip", browser_download_url: "v", size: 1 }, { name: "llama-b10936-bin-win-cuda-12.4-x64.zip", browser_download_url: "c", size: 2 }] },
  ]);
  assert.equal(rel.tag, "b10936");
  assert.equal(rel.assets["llama-b10936-bin-win-cuda-12.4-x64.zip"].url, "c");
  assert.equal(host.pickRelease([{ tag_name: "v0.4.0", assets: [] }]), null);
  // the plan's flags on an older build: --load-mode none becomes --no-mmap, mmap is the default and goes, --cpu-moe stays where it exists
  assert.deepEqual(host.translateArgs(["--load-mode", "none", "--cpu-moe"], { loadMode: false, cpuMoe: true }), ["--no-mmap", "--cpu-moe"]);
  assert.deepEqual(host.translateArgs(["-ctk", "q8_0", "--load-mode", "mmap"], { loadMode: false, cpuMoe: true }), ["-ctk", "q8_0"]);
  assert.deepEqual(host.translateArgs(["--load-mode", "none", "--cpu-moe"], { loadMode: true, cpuMoe: false }), ["--load-mode", "none"]);
  assert.equal(host.mmprojFor("gemma-3-4b-it-Q4_K_M.gguf", ["gemma-3-4b-it-Q4_K_M.gguf", "gemma-3-4b-it-mmproj-F16.gguf"]), "gemma-3-4b-it-mmproj-F16.gguf");
  assert.equal(host.mmprojFor("Qwen3-8B-Q4_K_M.gguf", ["Qwen3-8B-Q4_K_M.gguf"]), null);
  const cmd = host.serverCommand({ exe: "C:\\llama\\llama-server.exe", backend: "cuda", modelPath: "D:\\Models\\x-Q4_K_M.gguf", port: 8080, ctx: 32768, extra: ["--load-mode", "none", "-ngl", "30"], supports: { loadMode: false, cpuMoe: true }, siblings: ["x-Q4_K_M.gguf", "x-mmproj-F16.gguf"] });
  assert.deepEqual(cmd.slice(0, 3), ["C:\\llama\\llama-server.exe", "-m", "D:\\Models\\x-Q4_K_M.gguf"]);
  assert.ok(cmd.includes("--jinja") && cmd.includes("--reasoning-format") && cmd.includes("--no-mmap"));
  assert.equal(cmd[cmd.indexOf("-ngl") + 1], "30", "the plan's layer count is kept, no -ngl 99 on top");
  assert.equal(cmd.filter((x) => x === "-ngl").length, 1);
  assert.equal(cmd[cmd.indexOf("--mmproj") + 1], "D:\\Models\\x-mmproj-F16.gguf");
  const cpu = host.serverCommand({ exe: "s", backend: "cpu", modelPath: "m.gguf", port: 1, ctx: 4096 });
  assert.equal(cpu[cpu.indexOf("-ngl") + 1], "0");
  const gpu = host.serverCommand({ exe: "s", backend: "vulkan", modelPath: "m.gguf", port: 1, ctx: 4096 });
  assert.equal(gpu[gpu.indexOf("-ngl") + 1], "99");
  assert.ok(host.looksLikePath("D:\\Models\\a.gguf") && host.looksLikePath("/home/j/a.gguf") && !host.looksLikePath("https://x/a.gguf") && !host.looksLikePath("D:\\a.txt"));
  ok("pc runtime: backends from the DLLs, the release zips by name, the flags translated for an older build, the command line, a path in the URL box");
}

console.log(`\n${passed} checks passed`);
