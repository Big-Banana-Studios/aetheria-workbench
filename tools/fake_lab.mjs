// A fake OpenAI-compatible endpoint for tools/ui_check.mjs: GET /v1/models,
// and a streaming POST /v1/chat/completions that sends reasoning_content
// deltas, an inline <think> block, markdown with a code block, a usage
// record, and reports what it was sent (images, the thinking switch, the
// model) so the client's plumbing can be checked end to end with no GPU.
// The open-mic and Suno answers are in the desks' shapes (real life, no
// game lore; a three-verse song with the short style line and the spec).
//
//   node tools/fake_lab.mjs [port]      (default 4321)

import { createServer } from "node:http";

const PORT = Number(process.argv[2] || process.env.FAKE_LAB_PORT || 4321);
const MODELS = ["fake-qwen3.8-27b", "fake-vision-vl", "fake-embed"];

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the voice server's shape too (tools/qwen_tts_server.py): a tone per request, its length from the text, so the engine path can be checked with no model
let ttsClips = 0;
function toneWav(text) {
  const sr = 24000;
  const n = Math.round(sr * Math.min(3, 0.25 + 0.012 * String(text).length));
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(sr, 24);
  pcm.writeUInt32LE(sr * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 600, (n - i) / 2400);
    pcm.writeInt16LE(Math.round(Math.sin((i / sr) * 2 * Math.PI * 220) * 0.2 * env * 32767), 44 + i * 2);
  }
  return pcm;
}

const BIT1 = "## Bit 1 — the landlord\nMy landlord calls it a cozy studio. {pace} Cozy. It's a hallway with a lease. {aside: That bulb over the mic has been buzzing all night like it wants a word. It knows something.} He showed me the window and the window showed me a wall. (beat) {deadpan} Southern exposure, he said. To the wall.";
const BIT2 = (extra = "") => `## Bit 2 — unlimited\nMy phone plan is unlimited.${extra} With a footnote. {aside} The floor is sticky in a way that means something happened here. The footnote says unlimited means twenty gigs. {shriek} That's not unlimited, that's a bucket! {deadpan} You don't get to call a bucket the ocean.`;
const SET = (extra = "") => `# Rent\n\n${BIT1}\n\n${BIT2(extra)}\n\n> It's a hallway with a lease.\n`;

const SPEC = "dark synthwave with post-punk bones, late-80s production; 92 BPM, 4/4, half-time, dragging swing; D minor, modal, sparse chords, chromatic bass walk; female alto, half-spoken verses, belted chorus, rasp on the high notes, dry and close-mic'd; verses: muted bass, brushed drums, one detuned synth; chorus: gang vocals, wall of analog pads, live kit; bridge: strip to piano and rain; tape saturation, wide stereo pads, sidechained, no autotune, vinyl noise under the intro; intro 8 bars → V1 → PC → C → V2 → PC → C → V3 stripped → bridge drop-out → final double chorus → outro; bitter → defiant → tender; no EDM drops, no rap, no fade-out; spoken-word verses with an audible smirk, chorus sung straight";
const STYLE = "dark synthwave, 92 BPM, half-spoken female alto, tape-saturated, bitter to tender";

function song({ duet = false, verses = 3 } = {}) {
  const v1 = duet ? "[Voice 1] " : "";
  const v2 = duet ? "[Voice 2] " : "";
  const chorus = "[Chorus: anthemic, layered harmonies]\nIt's a hallway with a lease\nIt's a hallway with a lease";
  const parts = [
    "[Intro: vinyl noise, one synth]\nRain on the window, a key that sticks",
    `[Verse 1: half-spoken, tense]\n${v1}The landlord calls it cozy, calls it bright\nOne window facing somebody's wall\nThe fridge hums E flat all through the night\nI pay for every inch of hall`,
    "[Pre-Chorus: build]\nAnd he's smiling when he says it",
    chorus,
    `[Verse 2: half-spoken, wry]\n${v2}He raised the rent and fixed the door\nSaid the market's what the market wants\nI sleep beside the radiator's roar\nI count the ceiling's little haunts`,
    "[Pre-Chorus: build]\nAnd he's smiling when he says it",
    chorus,
  ];
  if (verses >= 3) parts.push("[Verse 3: stripped, quiet]\nI kept the candle, never lit\nI'm saving it for moving day\nThe orange light outside won't quit\nIt makes the whole street look the same");
  parts.push("[Bridge: whispered over piano]\nCozy is a word for small", "[Final Chorus: double, everyone in]\nIt's a hallway with a lease\nIt's a hallway with a lease", "[Outro: spoken word]\n[spoken word] Bless his heart.");
  return `# Cozy Studio\n\nHook: it's a hallway with a lease\nScheme: ABAB\n\n\`\`\`lyrics\n${parts.join("\n")}\n\`\`\`\n\n\`\`\`style\n${STYLE}\n\`\`\`\n\n\`\`\`spec\n${SPEC}\n\`\`\`\n`;
}

export function start(port = PORT) {
  const server = createServer(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "GET" && req.url.endsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, model: "fake-qwen3-tts", voice: "bella", device: "fake", clips: ttsClips }));
    }
    if (req.method === "POST" && req.url.endsWith("/v1/audio/speech")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      let j = {};
      try {
        j = JSON.parse(body);
      } catch {
        /* a tone anyway */
      }
      ttsClips++;
      const wav = toneWav(j.input || j.text || "");
      await sleep(60);
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wav.length, "X-Cache": "miss" });
      return res.end(wav);
    }
    if (req.method === "GET" && req.url.endsWith("/v1/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: MODELS.map((id) => ({ id, object: "model" })) }));
    }
    if (req.method === "POST" && req.url.endsWith("/v1/chat/completions")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      let j = {};
      try {
        j = JSON.parse(body);
      } catch {
        res.writeHead(400);
        return res.end("bad json");
      }
      const last = j.messages?.[j.messages.length - 1];
      const images = Array.isArray(last?.content) ? last.content.filter((p) => p.type === "image_url").length : 0;
      const userText = Array.isArray(last?.content) ? last.content.find((p) => p.type === "text")?.text || "" : String(last?.content || "");
      const thinking = j.chat_template_kwargs?.enable_thinking;
      const system = j.messages?.[0]?.role === "system" ? j.messages[0].content : "";
      const hasBible = /paperless-bible/.test(system);
      const hasJar = /Memory jar/.test(system);
      const hasFiles = /Project files/.test(system);
      const hasCube = /Aetheria cube/.test(system);
      const openMic = /dive-bar open mic|open mic/i.test(system);
      const id = `chatcmpl-${Date.now()}`;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const send = (delta, extra = {}) => res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: j.model, choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`);
      const stream = async (reply, n = 24) => {
        for (const piece of reply.match(new RegExp(`[\\s\\S]{1,${n}}`, "g")) || []) {
          send({ content: piece });
          await sleep(3);
        }
      };
      // sprite inspector: answer with JSON
      if (/sprite sheet named/i.test(userText)) {
        await stream('```json\n{"character": "a fake courier", "notes": "synthetic sheet", "clips": [{"name": "idle_down", "facing": "down", "frames": [1], "fps": 6, "loop": true}, {"name": "walk_left", "facing": "left", "frames": [3,4,5,4], "fps": 8, "loop": true}]}\n```');
      } else if (/only react out loud/i.test(system)) {
        // her quick reaction, riffed by the model
        await stream("Sheesh, someone's keyboard is stuck.");
      } else if (/linter for a stand-up set/i.test(system)) {
        // the open-mic linter: one note the first time a set mentions "restated", clean otherwise
        const bad = /restated/i.test(userText);
        await stream(bad ? '{"ok": false, "problems": [{"bit": 2, "rule": "agree", "note": "bit 2 restates the thesis; cut the second sentence"}], "rewrite": "Cut the restated thesis in bit 2 and land the tag on the last word."}' : '{"ok": true, "problems": [], "rewrite": ""}');
      } else if (openMic && /heckle from the room/i.test(userText)) {
        await stream("You paid to be here. I get paid. {deadpan} One of us made a decision tonight.");
      } else if (openMic && /one-liner pack/i.test(userText)) {
        await stream("# Twenty from the bar\n\n1. My landlord calls it a cozy studio. It's a hallway with a lease.\n2. Unlimited data, with a footnote longer than the Bible.\n3. Thoughts and prayers is a receipt for doing nothing.\n4. My password needs a symbol and an emotion. It's Derek2019.\n5. A dog says unlimited and means it, right up to the face-eating.\n");
      } else if (openMic && /punch-up|rewrite this set/i.test(userText)) {
        await stream(`${SET()}\n## Notes\n- cut: restated thesis (bit 2)\n- added: tag (bit 1)\n- kept: the hallway with a lease\n`);
      } else if (openMic) {
        // a set in the desk's shape; the fake linter flags the second one asked for with "restated" in it
        const restated = /restated/i.test(userText) ? " We are all pretending we have it together, restated. We are all pretending we have it together." : "";
        await stream(SET(restated));
      } else if (/lyrics and style prompts for Suno/i.test(system)) {
        // a rewrite request, or "two verses" in the brief, decides the verse count: the desk's linter rejects a song under three
        const rewrite = /linter rejected this song/i.test(userText);
        const verses = !rewrite && /two verses/i.test(userText) ? 2 : 3;
        await stream(song({ duet: /duet/i.test(userText), verses }));
      } else if (/Memory jar\. To save/.test(system)) {
        // her desk: a mood tag first, a jar line last, as her protocol asks
        await stream("[amused] Evening, from the fake lab. Coffee's on, the sink can wait, and that parking-lot light is doing its warrant-photo thing again. [jar: we're on her desk tonight; they said evening first]");
      } else {
        for (const r of ["Let me ", "think about ", "this."]) {
          send({ reasoning_content: r });
          await sleep(8);
        }
        const text = `<think>inline reasoning here</think>Hello from the **fake lab** (${j.model}). You said: "${userText.slice(0, 60).replace(/"/g, "'")}". I see ${images} image(s). Thinking switch: ${thinking === undefined ? "unset" : thinking}. Context: ${[hasBible && "bible", hasJar && "jar", hasFiles && "files", hasCube && "cube"].filter(Boolean).join(",") || "plain"}.\n\nA formula: $E = mc^2$\n\n\`\`\`js\nconsole.log("copy me");\n\`\`\`\n\nQ: What is 2+2?\nA: 4\n\nQ: Capital of France?\nA: Paris\n`;
        await stream(text, 7);
      }
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: j.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: j.model, choices: [], usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    res.writeHead(404);
    res.end("not found");
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("fake_lab.mjs")) {
  start().then(() => console.log(`fake lab on http://127.0.0.1:${PORT}/v1`));
}
