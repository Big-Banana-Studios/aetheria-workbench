// The slash commands. Type `/` at the start of the composer for the palette.
// A command either sends a shaped prompt to the desk (`ctx.send`), shows a
// local card (`ctx.card`), or opens part of the UI. `desks` limits where a
// command appears; "*" is everywhere.

import { findFrequency, findWalk, frequencyCard, stoneCard, walkCard, cubeCard, loadCube } from "./cube.js";
import { parseFlashcards, exportFlashcards } from "../export.js";
import { keywordSearch } from "../files.js";

export const COMMANDS = [
  // ------------------------------------------------------------ everywhere
  { id: "help", desks: "*", usage: "/help", about: "list the commands on this desk", run: (ctx) => ctx.card(helpCard(ctx.desk.id), "help") },
  { id: "export", desks: "*", usage: "/export", about: "save this desk's conversation as .md", run: (ctx) => ctx.exportMd() },
  {
    id: "remember",
    desks: "*",
    usage: "/remember <note>",
    about: "put a note in the memory jar (every desk sees it)",
    run: (ctx, args) => {
      if (!args.trim()) return ctx.toast("What should I remember? /remember <note>", true);
      ctx.memory.add(args, ctx.desk.id);
      ctx.card(`Remembered: _${args.trim()}_`, "memory jar");
    },
  },
  { id: "memory", desks: "*", usage: "/memory", about: "open the memory jar", run: (ctx) => ctx.openDrawer("memory") },
  { id: "files", desks: "*", usage: "/files", about: "open the project files", run: (ctx) => ctx.openDrawer("files") },
  { id: "pdf", desks: "*", usage: "/pdf", about: "add files (PDF, Word, text) to this desk", run: (ctx) => ctx.pickFiles() },
  { id: "clear", desks: "*", usage: "/clear", about: "clear this desk's conversation", run: (ctx) => ctx.clear() },
  { id: "read", desks: "*", usage: "/read", about: "read the last reply aloud (Kokoro)", run: (ctx) => ctx.readLast() },
  { id: "stop", desks: "*", usage: "/stop", about: "stop generation and speech (Esc)", run: (ctx) => ctx.stop() },
  {
    id: "think",
    desks: "*",
    usage: "/think on|off",
    about: "thinking mode for this desk",
    run: (ctx, args) => {
      const v = /off|0|false/i.test(args) ? false : /on|1|true/i.test(args) ? true : null;
      if (v == null) return ctx.toast(`Thinking is ${ctx.thinking() ? "on" : "off"} here. /think on or /think off`);
      ctx.setThinking(v);
      ctx.toast(`Thinking ${v ? "on" : "off"} for ${ctx.desk.name}`);
    },
  },
  { id: "paper", desks: "*", usage: "/paper", about: "toggle the paper theme", run: (ctx) => ctx.toggleTheme() },
  { id: "ambience", desks: "*", usage: "/ambience", about: "toggle the 432 Hz bed and the rain", run: (ctx) => ctx.toggleAmbience() },
  { id: "handoff", desks: "*", usage: "/handoff [ask]", about: "copy a brief for Claude Code with this desk's context", run: (ctx, args) => ctx.handoff(args) },
  { id: "hermes", desks: "*", usage: "/hermes [text]", about: "post the last reply (or text) to the Hermes Discord webhook", run: (ctx, args) => ctx.hermes(args) },
  { id: "mira", desks: "*", usage: "/mira", about: "open the voice companion in its own tab", run: (ctx) => ctx.openMira() },
  { id: "stage", desks: "*", usage: "/stage", about: "Mira's stage with the last few messages under it", run: (ctx) => ctx.toggleStage() },
  { id: "chat", desks: "*", usage: "/chat", about: "the whole chat history (the stage steps aside; /stage brings it back)", run: (ctx) => ctx.toggleChat() },
  {
    id: "quiet",
    desks: "*",
    usage: "/quiet on|off",
    about: "whether Mira speaks up herself after a quiet spell",
    run: (ctx, args) => {
      const v = /off|0|false/i.test(args) ? false : /on|1|true/i.test(args) ? true : null;
      if (v == null) return ctx.toast(`She ${ctx.settings.miraInitiate !== false ? "speaks up" : "keeps quiet"} after a quiet spell. /quiet on or /quiet off`);
      ctx.settings.miraInitiate = v;
      ctx.saveSettings();
      ctx.toast(v ? "she will speak up when it has been quiet" : "she will keep quiet");
    },
  },
  { id: "brain", desks: "*", usage: "/brain auto|lab|device", about: "which brain answers", run: (ctx, args) => ctx.setBrain(args.trim() || "auto") },
  { id: "model", desks: "*", usage: "/model <name>", about: "the lab model (from /v1/models)", run: (ctx, args) => ctx.setModel(args.trim()) },
  { id: "diag", desks: "*", usage: "/diag", about: "diagnostics: brain, latency, tokens/s, last error", run: (ctx) => ctx.openDrawer("diagnostics") },

  // ------------------------------------------------------------ research
  {
    id: "claims",
    desks: ["research"],
    usage: "/claims",
    about: "a claims table (claim / evidence / confidence) from the material given",
    run: (ctx) =>
      ctx.send(
        "From the material in this conversation and the project files retrieved for it - and only from that - produce a **claims table** with the columns Claim | Evidence (quote or close paraphrase, with the source name) | Confidence (high / medium / low, with one clause on why). Then a **Sources** list: only sources that actually appear in the material. If a claim has no evidence in the material, say so in the Evidence cell rather than inventing any. Do not add outside knowledge to the table; if you want to add context, put it under a separate heading marked 'Outside the material'.",
      ),
  },
  {
    id: "sources",
    desks: ["research"],
    usage: "/sources",
    about: "a sources list drawn only from what was given",
    run: (ctx) => ctx.send("List every source that appears in the material in this conversation and the retrieved project files: title, author or origin if given, where it appears, and one line on what it contributes. Only sources present in the material; never invent a reference. Mark any citation that looks incomplete or unverifiable."),
  },
  {
    id: "search",
    desks: ["research"],
    usage: "/search <query>",
    about: "web search through the lab's search model (Settings → Research), if one is configured",
    run: (ctx, args) => ctx.webSearch(args),
  },
  {
    id: "url",
    desks: ["research", "writing", "physics"],
    usage: "/url <address>",
    about: "fetch a page's text into the project files (only works where the site allows cross-origin reads)",
    run: (ctx, args) => ctx.fetchUrl(args.trim()),
  },

  // ------------------------------------------------------------ writing
  {
    id: "outline",
    desks: ["writing"],
    usage: "/outline <title or premise>",
    about: "a chapter outline in the house style",
    run: (ctx, args) => ctx.send(`Outline a book: ${args.trim() || "(use the premise discussed above)"}. Give a one-paragraph premise, the through-line, then a chapter list where each chapter has a title, a one-line purpose, the turn it makes, and its approximate length. Hold the catalog's voice and the KDP format notes from your instructions. Flag any chapter that only exists to move the plot.`),
  },
  {
    id: "continuity",
    desks: ["writing"],
    usage: "/continuity",
    about: "check the pasted draft against the pasted bible",
    run: (ctx) => ctx.send("Continuity check. Compare the draft in this conversation against the bible (pasted or in the project files). List every contradiction with the bible: names, dates, places, who knows what when, rules of the world, established voice. Quote both sides. Then list anything the draft asserts that the bible does not cover, as 'new canon' for me to confirm or reject. No line edits, no style notes."),
  },
  { id: "proof", desks: ["writing"], usage: "/proof", about: "read the last reply aloud for proofing (the family's best editing tool)", run: (ctx) => ctx.readLast() },
  {
    id: "style",
    desks: ["writing"],
    usage: "/style",
    about: "lock the style from the pasted sample for the rest of this session",
    run: (ctx) => ctx.send("Style lock. Analyse the sample of my writing in this conversation: sentence length and rhythm, paragraph shape, diction, how it handles dialogue and interiority, what it never does. Write the result as a short style sheet with ten concrete rules and three lines from the sample that embody them. From now on hold that style in every draft on this desk, and say when a request would break it."),
  },

  // ------------------------------------------------------------ paperless
  {
    id: "dialogue",
    desks: ["paperless"],
    usage: "/dialogue <recipient> [scene]",
    about: "delivery or idle lines in the game's pool JSON, state-keyed, four lenses",
    run: (ctx, args) => {
      const [who, ...rest] = args.trim().split(/\s+/);
      if (!who) return ctx.toast("Who? /dialogue sef delivery", true);
      const scene = rest.join(" ") || "delivery";
      ctx.send(`Write the **${scene}** pool for **${who}** in the game's dialogue JSON format (see the bible: a pool keyed \`${scene}_${who.toLowerCase().replace(/[^a-z0-9_]+/g, "_")}\`, an array of variants, each with \`when\` (only the closed set of state keys), \`weight\`, and \`text\` as an array of one to three lines; the empty-\`when\` fallback at weight 0 last). For a delivery scene give the four lenses (vortex, ascent, pillar, ouroboros) plus at least two state-keyed extras (casualties_gte, temperament_band, letters_delivered, came_from). Hold the voice rules: two or three lines, concrete nouns, no speeches, no exposition, no frequency numbers, no proper nouns outside canon, no line over 90 characters. Output the JSON in one fenced block, then two sentences on what each lens chose to tell her.`);
    },
  },
  {
    id: "contract",
    desks: ["paperless"],
    usage: "/contract [walk] [n]",
    about: "a sealed-correspondence contract keyed to walk state",
    run: (ctx, args) => {
      const [walk = "vortex", n = ""] = args.trim().split(/\s+/);
      ctx.send(`Generate one contract for the sealed correspondence on the **${walk}** walk${n ? `, beat ${n}` : ""}, in the volume JSON shape from the bible: \`n\`, \`id\`, \`from\`, \`to\` (both real correspondents from the canon list, never the courier), \`pickup\` (one to two lines the sender says at the board), \`dropoff\` (one to three lines the recipient says taking it), and \`letter\` (55 to 170 words, what was actually inside, which the courier never reads). The correspondence must be about what that walk's volume is about, no two contracts in a row to the same room, the parcel stays shut, and nobody names the plot. Then a one-line note on where in the run it belongs and what state (letters_delivered band, temperament) it assumes.`);
    },
  },
  {
    id: "npc",
    desks: ["paperless"],
    usage: "/npc <name>",
    about: "an NPC bio card in the canon's shape",
    run: (ctx, args) => {
      if (!args.trim()) return ctx.toast("Who? /npc Halim", true);
      ctx.send(`Write a bio card for **${args.trim()}** as the game's data would hold it: id, name, regime and district, role (overworld / dungeon / boss / extra / crew / enemy archetype), one-line hint (the codex line), first_line, what they want and what they are wrong about, two smoke_lines in their voice, one Route line and one Person line for their idle pool, which letter they hold or which stone if canon says, and the art note (which pack, what the resonate-response pose shows). If they exist in canon, keep every established fact and mark what is new; if they are new, keep them inside the regime's look and rules and never let them explain the plot.`);
    },
  },
  { id: "sprite", desks: ["paperless", "*"], usage: "/sprite", about: "sprite-sheet inspector: drop a PNG, get a manifest in Mira's format", run: (ctx) => ctx.openSprite() },

  // ------------------------------------------------------------ physics
  { id: "socratic", desks: ["physics"], usage: "/socratic", about: "back to asking before telling (the default)", run: (ctx) => ctx.setMode("socratic") },
  { id: "worked", desks: ["physics"], usage: "/worked", about: "worked-problem mode: the full solution, step by step", run: (ctx) => ctx.setMode("worked") },
  {
    id: "flashcards",
    desks: ["physics", "research", "*"],
    usage: "/flashcards [export]",
    about: "ask for flashcards from this conversation; `export` saves the last reply's cards as a tab-separated file for Anki",
    run: (ctx, args) => {
      if (/export/i.test(args)) {
        const last = ctx.lastAssistant();
        const cards = last ? parseFlashcards(last.content) : [];
        if (!cards.length) return ctx.toast("No Q:/A: pairs in the last reply. Run /flashcards first.", true);
        const name = exportFlashcards(cards, ctx.desk.name);
        return ctx.card(`Exported ${cards.length} cards to **${name}** (tab-separated; Anki → Import).`, "flashcards");
      }
      ctx.send("Turn what we have covered in this conversation into flashcards. One fact or step per card, 8 to 20 cards, questions that force recall rather than recognition, answers under 25 words, LaTeX where a formula is the answer. Format each card exactly as:\n\nQ: <question>\nA: <answer>\n\nwith a blank line between cards and nothing else.");
    },
  },

  // ------------------------------------------------------------ aetheria
  {
    id: "walk",
    desks: ["aetheria", "paperless"],
    usage: "/walk A|B|C|CAB|O|CABI [from hz]",
    about: "walk calculator: the sequence of 27 (or 81, 29, 110) with positions and stones",
    run: async (ctx, args) => {
      await loadCube();
      const [key = "C", from] = args.trim().split(/\s+/);
      const w = findWalk(key);
      if (!w) return ctx.toast("Walks: A (Ascent), B (Pillar), C (Vortex), CAB, O (Ouroboros), CABI", true);
      const md = walkCard(w, from);
      ctx.card(md, `walk ${w.key}`);
      const first = ctx.cube().frequencies[w.steps[0]];
      if (first) ctx.setFrequency(first.hz);
    },
  },
  {
    id: "freq",
    desks: ["aetheria", "paperless"],
    usage: "/freq <hz|name>",
    about: "frequency lookup: regime, Lo Shu position, keyword, hexagram, stone, letter",
    run: async (ctx, args) => {
      await loadCube();
      const f = findFrequency(args);
      if (!f) return ctx.toast(`Nothing in the cube matches "${args.trim()}". Try 2178, or a name like Source.`, true);
      ctx.card(frequencyCard(f), `${f.hz} Hz`);
      ctx.setFrequency(f.hz);
    },
  },
  {
    id: "stone",
    desks: ["aetheria", "paperless"],
    usage: "/stone <hz|name|holder>",
    about: "which stone and regime a frequency belongs to, and who holds it",
    run: async (ctx, args) => {
      await loadCube();
      const f = findFrequency(args);
      if (!f) return ctx.toast(`Nothing in the cube matches "${args.trim()}". Try a holder like "the diver" or a number.`, true);
      ctx.card(stoneCard(f), f.stone?.id || `${f.hz} Hz`);
      ctx.setFrequency(f.hz);
    },
  },
  {
    id: "cube",
    desks: ["aetheria", "paperless"],
    usage: "/cube",
    about: "the three layers of the Lo Shu square with their frequencies",
    run: async (ctx) => {
      await loadCube();
      ctx.card(cubeCard(), "the cube");
    },
  },
  // ------------------------------------------------------------ open mic
  {
    id: "five",
    desks: ["openmic"],
    usage: "/five [minutes] [about]",
    about: "a tight set: five minutes read aloud unless a number says otherwise (/five 7 about rent), story bits and riffs alternating, checked against the minutes, the closer pays off the asides",
    run: (ctx, args) => ctx.openMic("five", args),
  },
  {
    id: "monologue",
    desks: ["openmic"],
    usage: "/monologue [minutes] [about]",
    about: "a monologue: ten minutes unless a number says otherwise, one subject followed the whole way, the bits its scenes, the asides seeding the closer",
    run: (ctx, args) => ctx.openMic("monologue", args),
  },
  {
    id: "lines",
    desks: ["openmic"],
    usage: "/lines [about]",
    about: "a one-liner pack: twenty standalone lines, star the keepers",
    run: (ctx, args) => ctx.openMic("lines", args),
  },
  {
    id: "heckle",
    desks: ["openmic"],
    usage: "/heckle <what they shouted>",
    about: "crowd work: she answers the heckle in character, two lines at most",
    run: (ctx, args) => (args.trim() ? ctx.openMic("heckle", args) : ctx.toast("What did they shout? /heckle you're not funny", true)),
  },
  {
    id: "punchup",
    desks: ["openmic"],
    usage: "/punchup [draft]",
    about: "paste a draft (here, or as the last message) and get it back with repeats cut and punchlines added, as a diff with a note per change",
    run: (ctx, args) => ctx.openMic("punchup", args),
  },
  {
    id: "clean",
    desks: ["openmic"],
    usage: "/clean on|off",
    about: "clean edit: the same set with the profanity swapped for her bar slang, for platforms that filter",
    run: (ctx, args) => {
      const v = /off|0|false/i.test(args) ? false : /on|1|true/i.test(args) ? true : null;
      if (v == null) return ctx.toast(`Clean edit is ${ctx.settings.desks.openmic?.clean ? "on" : "off"}. /clean on or /clean off`);
      ctx.setDesk({ clean: v });
      ctx.toast(v ? "clean edit on: bar slang instead of the swearing" : "clean edit off");
    },
  },
  { id: "perform", desks: ["openmic"], usage: "/perform", about: "put her on the stage with the last set (Play, Pause, Skip bit, Record, heckle box)", run: (ctx) => ctx.openMic("perform", "") },
  {
    id: "dialin",
    desks: ["openmic"],
    usage: "/dialin [about]",
    about: "dial the stage voice in: one two-minute brief through every voice (the file's, gloves off, stoic filth, two gears, raw storyteller), side by side with numbers, and a button to make the pick the desk's prompt",
    run: (ctx, args) => ctx.openMic("dialin", args),
  },
  { id: "voice", desks: ["openmic"], usage: "/voice [default|stoic|run|raw]", about: "the stage voice in force, or switch it", run: (ctx, args) => ctx.openMic("voice", args) },
  { id: "stars", desks: ["openmic"], usage: "/stars", about: "the one-liners you starred, as a card to copy", run: (ctx) => ctx.openMic("stars", "") },
  { id: "song", desks: ["openmic", "suno"], usage: "/song <hook or idea> [genre, mood, tempo]", about: "lyrics with metatags and a Suno style prompt (from the Open Mic desk: hands the last set to Suno as the material)", run: (ctx, args) => ctx.suno("song", args) },

  // ------------------------------------------------------------ suno
  { id: "frombit", desks: ["suno"], usage: "/frombit", about: "pull the last set from the Open Mic desk and keep its punchlines as the hook or the bridge", run: (ctx) => ctx.suno("frombit", "") },
  { id: "chorus", desks: ["suno"], usage: "/chorus", about: "regenerate only the chorus of the last song", run: (ctx) => ctx.suno("chorus", "") },
  { id: "darker", desks: ["suno"], usage: "/darker", about: "the last song, darker", run: (ctx) => ctx.suno("darker", "") },
  { id: "lighter", desks: ["suno"], usage: "/lighter", about: "the last song, lighter", run: (ctx) => ctx.suno("lighter", "") },
  { id: "duet", desks: ["suno"], usage: "/duet", about: "the last song as a duet, [Voice 1] and [Voice 2]", run: (ctx) => ctx.suno("duet", "") },
  { id: "aetheria", desks: ["suno"], usage: "/aetheria <hz|name>", about: "Aetheria mode: weave the frequency's regime and stone lore into the imagery", run: (ctx, args) => ctx.suno("aetheria", args) },
  { id: "versions", desks: ["suno"], usage: "/versions", about: "this song's history, latest two compared", run: (ctx) => ctx.suno("versions", "") },
  { id: "longform", desks: ["suno"], usage: "/longform [on|off]", about: "long form: four or five verses for a story song (never fewer than three)", run: (ctx, args) => ctx.suno("longform", args) },
  { id: "same", desks: ["suno"], usage: "/same <new brief>", about: "same sound, new song: the last song's style line and spec word for word, a new brief", run: (ctx, args) => ctx.suno("same", args) },
  { id: "specs", desks: ["suno"], usage: "/specs", about: "the style-spec library: every spec a song was written with, to reuse or fork", run: (ctx) => ctx.suno("specs", "") },

  {
    id: "grep",
    desks: "*",
    usage: "/grep <words>",
    about: "search the project files on this desk without asking the model",
    run: async (ctx, args) => {
      const hits = await ctx.searchFiles(args, 8);
      if (!hits.length) return ctx.toast("Nothing matched in this desk's files.", true);
      ctx.card(hits.map((h, i) => `**${i + 1}. ${h.name}** (score ${h.score.toFixed(2)})\n\n> ${h.text.replace(/\n+/g, "\n> ").slice(0, 700)}`).join("\n\n"), `grep ${args.trim()}`);
    },
  },
];

export function commandsFor(deskId) {
  return COMMANDS.filter((c) => c.desks === "*" || c.desks.includes("*") || c.desks.includes(deskId)).filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);
}

export function findCommand(deskId, name) {
  const n = String(name || "").toLowerCase();
  return commandsFor(deskId).find((c) => c.id === n) || null;
}

function helpCard(deskId) {
  const rows = commandsFor(deskId).map((c) => `| \`${c.usage}\` | ${c.about} |`);
  return ["## Commands on this desk", "", "| command | what it does |", "|---|---|", ...rows, "", "`Ctrl+Enter` sends · `Esc` stops · `Ctrl+1…8` switches desks · drop an image on the composer to send it to the vision model · drop files on the transcript to add them to the desk."].join("\n");
}

export { keywordSearch };
