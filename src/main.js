// Entry point: the desks, the transcript, the composer, the drawer, and the
// wiring between the brain, the files, the voice and the tools.

import "./style.css";
import { loadSettings, saveSettings, setDeskSetting, adoptFromMira, REGIMES } from "./settings.js";
import { DESKS, deskById, deskPrompt, defaultPrompt, deskThinking, deskVoice, miraPreset, MIRA_PERSONAS, bigBrain } from "./desks.js";
import { Brain } from "./brain.js";
import { Conversation, renderMessage } from "./chat.js";
import { MemoryJar, takeJar, JAR_PROTOCOL } from "./memory.js";
import { ProjectFiles } from "./files.js";
import { Speech } from "./speech.js";
import { VoiceInput } from "./voice.js";
import { Ambience } from "./ambience.js";
import { applyTheme, regimeOfHz } from "./theme.js";
import { $, toast, download, fmtBytes, escapeHtml, modelAlias, DownloadPanel } from "./ui.js";
import { watchPanels, pushPanel, closeTop, topPanel, isPhone } from "./panels.js";
import { MicStage } from "./openmic/stage.js";
import { parseSet, parseLines, lintLocal, paragraphHashes, diffLines, diffMarkdown, fmtRuntime, stripTags, hashParagraph } from "./openmic/set.js";
import { spokenSpelling } from "./spelling.js";
import { parseSong, checkSong, songRejects, longLines, verses, specKey, STYLE_MAX, SPEC_MAX } from "./openmic/song.js";
import { VOICES, applyVoice } from "./openmic/voices.js";
import { measure as benchMeasure, benchTable } from "./openmic/bench.js";
import { exportConversation } from "./export.js";
import { buildClaudeBrief, copyText, sendToHermes } from "./handoff.js";
import { commandsFor, findCommand } from "./tools/commands.js";
import { loadCube, getCube, cubeSummary, findFrequency } from "./tools/cube.js";
import { loadSheet, measureSheet, drawOverlay, thumbnail, visionPrompt, parseVisionJson, buildManifest } from "./tools/sprites.js";
import { openCompanion } from "./mira-panel.js";
import { Stage, takeMood, MOOD_PROTOCOL } from "./stage.js";
import { pickThought, similar } from "./thoughts.js";
import { classify, bark, BARKS } from "./barks.js";
import { renderDiagnostics } from "./diagnostics.js";
import { probeHardware, recommend, gpuName } from "./hardware.js";
import { store } from "./store.js";
import { ACCEPT } from "./extract.js";
import { stripThink } from "./think.js";
import { streamChat } from "./lab.js";
import { endpoints } from "./settings.js";
import { native } from "./native.js";
import { CATALOG, partsOf } from "./catalog.js";

const BASE = import.meta.env.BASE_URL || "/";
const settings = loadSettings();
if (adoptFromMira(settings)) saveSettings(settings);

const brain = new Brain(settings);
const memory = new MemoryJar();
const files = new ProjectFiles(settings);
const speech = new Speech(settings);
const voice = new VoiceInput(settings);
const ambience = new Ambience(settings);
const dl = new DownloadPanel($("dl"));

let desk = deskById(localStorage.getItem("workbench.desk") || "research");
let conv = new Conversation(desk.id);
let stage = null;
let micStage = null;
const PROMPT_FILES = import.meta.glob("../prompts/*.md", { query: "?raw", import: "default", eager: true });
const promptText = (name) => PROMPT_FILES[Object.keys(PROMPT_FILES).find((k) => k.endsWith(`/${name}.md`))] || "";
let currentMood = "calm";
const quiet = { initiations: 0, next: 60 + Math.random() * 60, busy: false };
let attachments = []; // {dataUrl, imageData, name}
let bible = "";
let currentFrequency = settings.desks.aetheria?.frequency || null;
let drawerTab = null;
const msgEls = new Map();

/** Her persona preset in force (Settings → Mira → Persona length; auto follows the brain). deskPrompt takes it for her desk; an edit on this device still wins. */
const herPreset = () => miraPreset(settings, brain);

/** Which of her persona presets is in force, and why; under the setting and in the prompt editor. */
function personaNote() {
  const p = MIRA_PERSONAS[herPreset()];
  const auto = !settings.miraPersona || settings.miraPersona === "auto";
  const edited = !!settings.desks.mira?.prompt;
  return `${p.name} persona in force, ${p.about}${auto ? " (auto: the core on the lab, long on an in-app model of 12B or more, standard otherwise)" : " (chosen here)"}.${edited ? " Her desk's prompt was edited on this device, and that edit wins; Reset to the file returns to the preset." : ""}`;
}

// ------------------------------------------------------------------ boot

async function main() {
  watchPanels();
  await native.probe(); // the phone's plugin, or the PC runtime host serving this page; nothing on GitHub Pages
  applyRuntimeWording();
  buildRail();
  bindHead();
  bindComposer();
  bindDrawer();
  bindSettings();
  bindNative();
  bindSprite();
  bindKeys();
  bindMenu();
  bindDialogs();
  stage = new Stage($("stage-canvas"), $("stage-wrap"), settings, { level: () => speech.player.level(), listenLevel: () => voice.level() });
  bindStage();
  micStage = new MicStage({ speech, settings });
  bindMicStage();
  wireEvents();
  selectDesk(desk.id);
  registerSW();
  loadRefs();
  stage.load().then(() => applyDeskTheme());
  setInterval(() => maybeInitiate(), 1000);
  await brain.detect();
  renderChip();
  if (settings.ambience) onceGesture(() => ambience.start());
  if (brain.live === "none" && native.available()) {
    // the phone or the PC, with nothing to run yet: take them straight to the model list
    const pc = native.kind === "host";
    const why = brain.info.nativeError || "";
    status(
      pc
        ? /no model on this PC/.test(why)
          ? "No model on this PC yet. Pick a GGUF already on a disk, or download one, in Settings → Local runtime (or set the lab endpoint)."
          : `Local runtime: ${why || "not started"}. Settings → Local runtime has the llama.cpp builds and the models (or set the lab endpoint).`
        : "No model on this phone yet. Pick one to download in Settings → Native runtime (or set the lab endpoint).",
      true,
    );
    openDrawer("settings");
    $("native-fieldset").scrollIntoView({ block: "start" });
  } else status(brain.live === "none" ? "No brain is live. Set the lab endpoint in Settings, or use a WebGPU browser for the on-device model." : "");
}

function onceGesture(fn) {
  const h = () => {
    removeEventListener("pointerdown", h);
    removeEventListener("keydown", h);
    fn();
  };
  addEventListener("pointerdown", h);
  addEventListener("keydown", h);
}

async function loadRefs() {
  try {
    const r = await fetch(`${BASE}data/paperless-bible.md`);
    if (r.ok) bible = await r.text();
  } catch {
    /* the desk works without it */
  }
  loadCube().catch((e) => console.warn("cube", e));
}

function registerSW() {
  // Inside the Android app the files come from the APK and are already
  // offline; a cached index.html would outlive an update and point at
  // hashed assets that no longer exist.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || native.platform() !== "web") return;
  navigator.serviceWorker.register(`${BASE}sw.js`).catch((e) => console.warn("sw", e));
}

function wireEvents() {
  brain.addEventListener("status", renderChip);
  brain.addEventListener("download", (e) => dl.progress(e.detail));
  brain.addEventListener("info", (e) => status(e.detail));
  brain.addEventListener("error", (e) => status(e.detail, true));
  files.addEventListener("progress", (e) => dl.progress(e.detail));
  files.addEventListener("status", (e) => ($("file-status").textContent = e.detail));
  files.addEventListener("error", (e) => toast(e.detail, { error: true }));
  files.addEventListener("added", () => renderFiles());
  files.addEventListener("removed", () => renderFiles());
  files.addEventListener("embedder", (e) => ($("embed-status").textContent = e.detail ? `Embedder ready on ${e.detail.device}.` : "Embedding model unavailable here; files are searched by keyword instead."));
  speech.addEventListener("download", (e) => dl.progress(e.detail));
  speech.addEventListener("speaking", () => {
    $("btn-read").classList.add("on");
    ambience.setState("speaking");
    stage.setState("speaking");
    stage.react(currentMood);
  });
  speech.addEventListener("sentence", () => stage.nod());
  speech.addEventListener("buffering", (e) => status(e.detail.done ? "" : `voice: buffering, ${e.detail.seconds.toFixed(0)} s of ${Math.ceil(e.detail.need)} s in hand…`));
  speech.addEventListener("idle", () => {
    $("btn-read").classList.remove("on");
    if ($("status").textContent.startsWith("voice:")) status("");
    ambience.setState("idle");
    // after a quick reaction spoken while the model works, back to thinking; otherwise idle
    if (!brain.busy) stage.setState("idle");
    else stage.setState("thinking");
  });
  speech.addEventListener("ready", () => fillVoices());
  speech.addEventListener("error", (e) => toast(`voice: ${e.detail}`, { error: true }));
  voice.addEventListener("download", (e) => dl.progress(e.detail));
  voice.addEventListener("listening", (e) => {
    $("btn-mic").classList.toggle("live", !!e.detail);
    ambience.setState(e.detail ? "listening" : "idle");
    if (e.detail) stage.setState("listening");
    else if (!brain.busy && !speech.speaking) stage.setState("idle");
  });
  voice.addEventListener("speech_start", () => status("hearing you…"));
  voice.addEventListener("speech_end", () => status("transcribing…"));
  voice.addEventListener("transcript", (e) => {
    const t = e.detail.text.trim();
    status("");
    stage.touch();
    quiet.initiations = 0;
    if (!t) return;
    const inp = $("input");
    inp.value = (inp.value ? inp.value.replace(/\s*$/, " ") : "") + t;
    autosize();
    if (settings.voiceInput === "vad" && settings.desks[desk.id]?.autoSend) send(inp.value);
  });
  voice.addEventListener("error", (e) => toast(`ears: ${e.detail}`, { error: true }));
  memory.addEventListener("change", renderMemory);
}

// ------------------------------------------------------------------ desks

function buildRail() {
  const host = $("desks");
  host.innerHTML = "";
  DESKS.forEach((d, i) => {
    const b = document.createElement("button");
    b.className = "desk-btn";
    b.dataset.desk = d.id;
    b.title = `${d.name} (Ctrl+${i + 1})`;
    b.innerHTML = `<img src="${BASE}assets/desk-icons/${d.icon}" alt="" width="40" height="40" /><span>${escapeHtml(d.name)}</span>`;
    b.addEventListener("click", () => selectDesk(d.id));
    host.appendChild(b);
  });
  // on a phone the rail is icons only: a tap shows the label for a moment
  let tip = null;
  let tipTimer = 0;
  $("rail").addEventListener("pointerdown", (e) => {
    if (!isPhone()) return;
    const b = e.target.closest(".desk-btn, .rail-mini");
    if (!b) return;
    const label = b.dataset.desk ? deskById(b.dataset.desk).name : b.title;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "rail-tip";
      document.body.appendChild(tip);
    }
    const r = b.getBoundingClientRect();
    tip.textContent = label;
    tip.style.left = `${r.right + 6}px`;
    tip.style.top = `${r.top + r.height / 2}px`;
    tip.hidden = false;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => (tip.hidden = true), 1100);
  });
}

function selectDesk(id) {
  stopAll();
  micStage?.close();
  desk = deskById(id);
  localStorage.setItem("workbench.desk", desk.id);
  conv = new Conversation(desk.id);
  document.querySelectorAll(".desk-btn").forEach((b) => b.classList.toggle("on", b.dataset.desk === desk.id));
  $("desk-name").textContent = desk.name;
  $("desk-tag").textContent = desk.tagline;
  $("input").placeholder = desk.placeholder;
  $("empty-title").textContent = desk.name;
  $("empty-text").textContent = deskPrompt(desk, settings, herPreset()).split("\n").find((l) => l.trim()) || "";
  const cmds = $("empty-cmds");
  cmds.innerHTML = "";
  for (const c of commandsFor(desk.id).filter((c) => c.desks !== "*" && !c.desks.includes("*")).slice(0, 8)) {
    const b = document.createElement("button");
    b.textContent = c.usage;
    b.title = c.about;
    b.addEventListener("click", () => {
      $("input").value = c.usage.split(" ")[0] + " ";
      $("input").focus();
    });
    cmds.appendChild(b);
  }
  attachments = [];
  renderAttachments();
  renderTranscript();
  renderHead();
  applyDeskTheme();
  applyChat();
  renderDeskSettings();
  if (drawerTab === "files") renderFiles();
  $("input").focus();
}

function applyDeskTheme() {
  let regime = desk.regime;
  let colour = null;
  if (regime === "follow") {
    const f = currentFrequency ? findFrequency(currentFrequency) : null;
    regime = f?.regime || regimeOfHz(currentFrequency) || "HEART";
    colour = f?.stone?.aura_colour || f?.colour || null;
  }
  const o = settings.desks[desk.id]?.regime;
  if (o && REGIMES[o]) {
    regime = o;
    colour = null;
  }
  applyTheme(settings, { regime, colour });
  const r = REGIMES[regime] ? regime : "HEART";
  $("stage-regime").textContent = r;
  stage?.show(settings.stage !== false && (settings.miraEverywhere !== false || desk.id === "mira"));
  $("center").dataset.chat = chatFull() ? "full" : "compact";
  // she walks to the desk's district; the bed changes key when she gets there
  stage?.setRegime(r, colour).then(() => ambience.setRegime(r));
}

function setFrequency(hz) {
  currentFrequency = hz;
  setDeskSetting(settings, "aetheria", { frequency: hz });
  if (desk.id === "aetheria") applyDeskTheme();
}

function renderHead() {
  $("think-state").textContent = deskThinking(desk, settings) ? "on" : "off";
  $("btn-think").classList.toggle("on", deskThinking(desk, settings));
  $("btn-ambience").classList.toggle("on", !!settings.ambience);
  $("btn-theme").classList.toggle("on", settings.theme === "paper");
  $("btn-stage").classList.toggle("on", !chatFull() && settings.stage !== false);
  $("btn-chat").classList.toggle("on", chatFull());
  $("menu-brain").value = settings.brain;
  renderMenuModels();
}

function renderMenuModels() {
  const sel = $("menu-model");
  // the local server runs one model, listed under its file name (llama-server's own /v1/models says its path or alias, not the name)
  const current = brain.live === "native" ? brain.info.native?.model || "" : settings.lab.model || "";
  const ids = brain.live === "native" ? (current ? [current] : []) : brain.info.models || [];
  sel.innerHTML = "";
  if (!ids.length) sel.innerHTML = `<option value="">${current ? escapeHtml(current) : "(no models yet)"}</option>`;
  for (const id of ids) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
  sel.value = current;
  sel.disabled = brain.live === "native" || !ids.length;
}

function bindMenu() {
  const menu = $("dropdown");
  const btn = $("btn-menu");
  let pop = null;
  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    const p = pop;
    pop = null;
    p?.();
  };
  const open = () => {
    menu.hidden = false;
    renderHead();
    pop = pushPanel("menu", () => {
      menu.hidden = true;
      pop = null;
    });
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  menu.addEventListener("click", (e) => {
    if (e.target.closest("button")) close();
    e.stopPropagation();
  });
  addEventListener("click", close);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  $("menu-model").addEventListener("change", (e) => ctx().setModel(e.target.value));
  $("menu-brain").addEventListener("change", (e) => ctx().setBrain(e.target.value));
  $("btn-detect-brain").addEventListener("click", async () => {
    status("detecting…");
    await brain.detect();
    renderChip();
    status(brain.info.labError && brain.live !== "lab" ? `lab: ${brain.info.labError}` : "", brain.live === "none");
  });
  $("btn-desk-settings").addEventListener("click", () => {
    openDrawer("settings");
    $("set-desk-name").closest("fieldset").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  $("btn-stage").addEventListener("click", () => setView("stage"));
  $("btn-chat").addEventListener("click", () => setView("history"));
  // the prompt editor
  $("btn-prompt").addEventListener("click", openPromptDialog);
  $("pd-close").addEventListener("click", () => $("prompt-dialog").close());
  $("pd-cancel").addEventListener("click", () => $("prompt-dialog").close());
  $("pd-reset").addEventListener("click", () => {
    $("pd-text").value = defaultPrompt(desk, herPreset());
    $("pd-status").textContent = "Back to the default from the file. Save to keep it.";
  });
  $("pd-save").addEventListener("click", () => {
    const v = $("pd-text").value;
    const isDefault = v.trim() === defaultPrompt(desk, herPreset()).trim();
    setDeskSetting(settings, desk.id, { prompt: isDefault ? undefined : v });
    $("prompt-dialog").close();
    renderDeskSettings();
    $("empty-text").textContent = deskPrompt(desk, settings, herPreset()).split("\n").find((l) => l.trim()) || "";
    toast(isDefault ? `${desk.name}: prompt is the default` : `${desk.name}: prompt saved for this device`);
  });
}

function openPromptDialog() {
  $("pd-desk").textContent = desk.name;
  $("pd-text").value = deskPrompt(desk, settings, herPreset());
  const custom = !!settings.desks[desk.id]?.prompt;
  $("pd-status").textContent = custom ? "This desk uses a prompt edited on this device." : desk.id === "mira" ? `${personaNote()} Edit it here and the edit wins over the preset on this device.` : "This desk uses the default prompt from the file.";
  $("prompt-dialog").showModal();
}

/**
 * Every dialog is a panel: opening one pushes a history entry so the back
 * gesture (and the hardware back button) closes it instead of leaving the
 * app; closing it by any other route pops that entry again.
 */
function bindDialogs() {
  for (const d of document.querySelectorAll("dialog")) {
    let pop = null;
    const show = d.showModal.bind(d);
    d.showModal = () => {
      show();
      pop?.();
      pop = pushPanel(d.id, () => d.close());
    };
    d.addEventListener("close", () => {
      const p = pop;
      pop = null;
      p?.();
    });
    // a tap on the backdrop closes it too
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
    });
  }
}

/**
 * Two views, picked from the desk menu: "stage" is Mira on top with the last
 * few messages under her (how the desk starts); "history" is the whole chat,
 * the stage stepping aside. The arrow on the stage is a shortcut to the
 * history and the arrow at the top of the history is the way back; the menu
 * has both as well.
 */
function setView(view) {
  settings.chatView = view === "history" ? "full" : "compact";
  if (view === "stage" && settings.stage === false) {
    settings.stage = true;
    $("set-stage").checked = true;
  }
  saveSettings(settings);
  renderTranscript();
  applyChat();
  renderHead();
}

function applyChat() {
  const full = chatFull();
  $("center").dataset.chat = full ? "full" : "compact";
  if (!full) stage?.show(settings.stage !== false && (settings.miraEverywhere !== false || desk.id === "mira"));
  stage?.renderer?.resize();
  scrollBottom(true);
}

function bindStage() {
  $("btn-to-history").addEventListener("click", () => setView("history"));
  $("btn-to-stage").addEventListener("click", () => setView("stage"));
  stage.addEventListener("ready", () => applyChat());
  stage.addEventListener("state", (e) => ($("stage-state").textContent = e.detail));
  stage.addEventListener("error", (e) => {
    $("stage-wrap").hidden = true;
    console.warn("stage", e.detail);
  });
  stage.addEventListener("ready", () => {
    stage.onStrike = (near) => ambience.thunder(near);
  });
  stage.addEventListener("tick", () => {
    if (settings.ambience) ambience.setRain(stage.rain);
  });
  // typing is listening; a pause goes back to idle
  let typingTimer = 0;
  $("input").addEventListener("input", () => {
    stage.touch();
    if (!brain.busy && !speech.speaking && stage.state !== "listening") stage.setState("listening");
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (stage.state === "listening" && !voice.listening) stage.setState("idle");
    }, 4000);
  });
}

// What she picks up when she speaks up on her own: the thread of the last
// exchange on the desk, from a different angle each time, so the line is
// about what was just said and never the same shape twice running.
const THREAD_ANGLES = [
  "a second thought about the last thing they said, the one you did not say at the time",
  "the detail in their last message nobody would notice, and what it gives away",
  "what the last reply left out, or got wrong, in one plain line",
  "where that subject ends up if you follow it, straight-faced, all the way to the end",
  "what a person like you would actually do about it, which is not what anyone advises",
  "what that subject looks like from the step, with a smoke, on the way home",
  "the same thing said in the machine's own words, and then what those words mean",
  "a memory of yours it dragged up: one concrete thing, no moral",
  "the funny part neither of you said out loud, the bleaker the better",
  "what you'd text a friend about it at one in the morning",
  "the part of it that is about money, because it always is",
  "a confession of your own that the subject earns, before anyone can accuse you",
];
// when the desk is empty there is no thread yet: the night, the work, the street
const NIGHT_ANGLES = [
  "a dry observation about the night or the street outside",
  "something about the work in front of them, seen from where you stand",
  "a thought you have been sitting on, nothing to do with them",
  "a small thing you noticed in the last hour",
  "a memory the weather brought up",
  "something about the coffee, the desk, or what is still open at this hour",
  "a line about the hour, and what people are doing at it",
];
let angleCursor = Math.floor(Math.random() * THREAD_ANGLES.length);

/** The last user message on this desk and the reply that followed it, cut to size for the prompt. */
function lastExchange() {
  const msgs = conv.messages;
  let reply = null;
  let user = null;
  for (let i = msgs.length - 1; i >= 0 && !user; i--) {
    const m = msgs[i];
    if (!m.content?.trim() || m.role === "mira") continue;
    if (m.role === "user") user = m;
    else if (!reply) reply = m;
  }
  if (!user) return null;
  return {
    user: stripThink(user.content).slice(0, 700),
    reply: reply ? stripThink(reply.content).slice(0, 900) : "",
    who: reply?.role === "tool" ? "a card on the desk" : desk.id === "mira" ? "you" : "the desk",
  };
}

/**
 * It has been quiet. When a brain is live the model is asked for a line of
 * its own that picks up the thread of the last exchange on the desk, from
 * an angle that rotates through the list, told what she already said so it
 * does not repeat itself; a repeat, an echo of what they said, or a failure
 * falls back to one of her own quiet-spell lines (thoughts.js), which are
 * also what she says with no brain at all. No question in it. Spoken only
 * if the voice is already loaded; three times at most until somebody
 * answers.
 */
async function maybeInitiate(force = false) {
  if (!force) {
    if (settings.miraInitiate === false || !stage?.visible || document.visibilityState !== "visible" || micStage?.open) return;
    if (brain.busy || speech.speaking || voice.listening || quiet.busy || quiet.initiations >= 3) return;
    if (brain.live === "none" && Math.random() < 0.5) return;
    if (stage.quietFor() < quiet.next) return;
  }
  if (quiet.busy) return;
  quiet.busy = true;
  quiet.initiations++;
  quiet.next = 180 + Math.random() * 120;
  try {
    let line = "";
    let mood = "thoughtful";
    const said = conv.messages.filter((m) => m.role === "mira").slice(-8).map((m) => m.content);
    const ex = lastExchange();
    if (brain.live === "none") line = pickThought();
    else {
      let angle;
      if (ex) {
        angle = THREAD_ANGLES[angleCursor % THREAD_ANGLES.length];
        angleCursor += 1 + Math.floor(Math.random() * 3); // never the same angle twice running, not a fixed order either
      } else angle = NIGHT_ANGLES[Math.floor(Math.random() * NIGHT_ANGLES.length)];
      const recent = conv
        .context(6)
        .slice(0, -2)
        .map((m) => `${m.role}: ${m.content.slice(0, 160)}`)
        .join("\n");
      const thread = ex ? `\nThe last exchange there:\nthey said: "${ex.user.replace(/"/g, "'")}"\n${ex.who} answered: "${ex.reply ? ex.reply.replace(/"/g, "'") : "(nothing yet)"}"\n` : "";
      const earlier = recent ? `Earlier on the desk:\n${recent}\n` : "";
      const already = said.length ? ` You have already said these tonight; say something new, not a variation of any of them:\n${said.map((s) => `- ${s}`).join("\n")}` : "";
      const ask = ex ? `Say one or two sentences of your own that pick up that thread: ${angle}. Something new about it, not a summary of it.` : `Say one or two sentences of your own, this time ${angle}.`;
      const r = await brain.chat({
        messages: [
          { role: "system", content: `${deskPrompt(deskById("mira"), settings, herPreset())}\n\n${memory.asPrompt() ? `${memory.asPrompt()}\n\n` : ""}${MOOD_PROTOCOL}` },
          { role: "user", content: `(It has been quiet a while. You are on the ${desk.name} desk with them.\n${earlier}${thread}\n${ask} Not a comfort, not advice, no question.${already})` },
        ],
        thinking: false,
        temperature: 1.0,
        maxTokens: 160,
        onDelta: () => {},
      });
      const t = takeMood(r.text);
      line = stripThink(t.text).trim();
      mood = t.mood || "thoughtful";
      if (!line || said.some((s) => similar(s, line)) || (ex && (similar(ex.user, line) || similar(ex.reply, line)))) {
        // the model repeated itself, or echoed the exchange: one of her own thoughts instead
        line = pickThought();
        mood = "thoughtful";
      }
    }
    if (!line || said.some((s) => similar(s, line))) return; // nothing new to say: stay quiet this time
    const m = conv.push({ role: "mira", content: line, title: "unprompted", mood });
    appendMessage(m);
    currentMood = mood;
    stage.setMood(mood);
    if (speech.ready) await speech.speak(line, settings.voices.mira);
    else stage.react(mood);
    stage.touch();
  } catch (e) {
    console.warn("initiative", e);
  } finally {
    quiet.busy = false;
  }
}

// ------------------------------------------------------------------ her quick reactions

let barkTimer = 0;
let slowTimer = 0;
const RIFF_MS = 2500; // how long the model gets to riff before the bank speaks instead

/**
 * Something she says out loud while reading what you sent, before the
 * answer: the model riffs a fresh one-liner in her voice when a brain is
 * live and quick about it (a short call with the small persona, a
 * two-and-a-half-second budget); the bank in barks.js, keyed to what the
 * message is, is the fallback, and the instant one when the box is slow or
 * there is no brain. A bubble over the stage, her mood's gesture, and the
 * voice if it is already loaded and not busy. Returns the line, or null
 * when she stays quiet this time.
 */
async function quickReaction(text, { images = 0, force = false, kind = null } = {}) {
  if (settings.miraBarks === false || !stage?.visible || micStage?.open) return null;
  const c = classify(text, { images, force, kind });
  if (!c) return null;
  let line = "";
  if (c.kind !== "slow" && brain.live !== "none" && !brain.busy) line = await riff(text, c).catch(() => "");
  const riffed = !!line;
  if (!line) line = bark(c.kind);
  showBark(line, c.mood);
  return { line, riffed };
}

const RIFF_HINTS = { paste: "they pasted a wall of text", shout: "they are shouting", swear: "they swore", bad: "bad news", good: "good news", link: "they sent a link", image: "they sent a picture", question: "a question", generic: "an ordinary message" };

/** The model's own quick reaction: one short fresh line, or "" when it was slow, long, a question, or a copy of the examples. */
async function riff(text, c) {
  const examples = (BARKS[c.kind] || BARKS.generic)
    .slice(0, 3)
    .map((s) => `"${s}"`)
    .join(" ");
  const timer = setTimeout(() => brain.stop(), RIFF_MS);
  try {
    const r = await brain.chat({
      messages: [
        { role: "system", content: `${deskPrompt(deskById("mira"), settings, "short")}\n\nRight now you only react out loud, in passing, to what they just sent, the way you would reading it over their shoulder: one short line, under twelve words, no question, nothing in brackets, no mood tag, then nothing. Fresh, about this message, not one of these, which are only the kind of thing: ${examples}` },
        { role: "user", content: `(${RIFF_HINTS[c.kind] || RIFF_HINTS.generic}) ${String(text || "(a picture)").slice(0, 600)}` },
      ],
      thinking: false,
      temperature: 1.0,
      maxTokens: 24,
      onDelta: () => {},
    });
    let line = stripThink(takeMood(r.text).text)
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) || "";
    line = line.replace(/^["“]|["”]$/g, "").trim();
    if (!line || r.interrupted || line.length > 90 || /\?$/.test(line) || /[[\]{}<>*]/.test(line)) return "";
    if (!/[.!…]$/.test(line)) line += ".";
    if ((BARKS[c.kind] || []).some((s) => similar(s, line))) return "";
    return line;
  } finally {
    clearTimeout(timer);
  }
}

function showBark(line, mood = "amused") {
  const el = $("stage-bark");
  el.textContent = line;
  el.hidden = false;
  clearTimeout(barkTimer);
  barkTimer = setTimeout(() => (el.hidden = true), 2800 + line.length * 40);
  currentMood = mood;
  stage.setMood(mood);
  if (speech.ready && !speech.speaking && !voice.listening) speech.speak(line, settings.voices.mira).catch(() => {});
  else stage.react(mood);
}

/**
 * The brain chip: a short alias of the model (the org prefix and the GGUF
 * suffix go, the quant stays), the full name in the tooltip and on tap,
 * and the ping at the end, never truncated. The ping is the round trip to
 * GET /models, not generation speed: Diagnostics has the tokens per second.
 */
function renderChip() {
  const st = brain.status();
  const chip = $("brain-chip");
  const wasOpen = chip.classList.contains("open");
  chip.className = `chip ${st.live === "lab" || st.live === "native" ? "live" : st.live === "device" ? "device" : "none"}${wasOpen ? " open" : ""}`;
  const full = st.model || (st.live === "native" ? "llama-server" : st.live === "device" ? "Gemma 4 E2B" : "");
  const name = wasOpen ? full : modelAlias(full);
  const text =
    st.live === "lab"
      ? `lab · ${name || "?"}`
      : st.live === "native"
        ? `${native.kind === "host" ? "local" : "in-app"} · ${name}`
        : st.live === "device"
          ? `on-device · ${name}${st.deviceStatus === "loading" ? " · loading" : st.deviceStatus === "ready" ? "" : " · loads on first send"}`
          : "no brain";
  $("brain-text").textContent = text;
  const ping = $("brain-ping");
  const hasPing = (st.live === "lab" || st.live === "native") && st.latency != null;
  ping.hidden = !hasPing;
  ping.textContent = hasPing ? `· ${st.latency} ms ping` : "";
  chip.title = [full && `Model: ${full}`, hasPing && `Ping: ${st.latency} ms round trip to the endpoint (not generation speed; see Diagnostics)`, st.labError && `Lab: ${st.labError}`, st.nativeError && `In-app: ${st.nativeError}`, "Tap for the full name; the desk menu has Detect the brain again."].filter(Boolean).join("\n");
}

// ------------------------------------------------------------------ transcript

const COMPACT_N = 4; // messages kept on screen under the stage

function chatFull() {
  return settings.chatView === "full";
}

function renderTranscript() {
  const host = $("messages");
  host.innerHTML = "";
  msgEls.clear();
  const list = chatFull() ? conv.messages : conv.messages.slice(-COMPACT_N);
  for (const m of list) appendMessage(m, { scroll: false });
  $("empty").hidden = conv.messages.length > 0;
  renderOlder();
  scrollBottom(true);
}

/** In the compact view, a line saying how much is folded away, and the way to it. */
function renderOlder() {
  let el = $("older");
  const hidden = chatFull() ? 0 : Math.max(0, conv.messages.length - msgEls.size);
  if (!hidden) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "older";
    el.innerHTML = `<button class="ghost"></button>`;
    el.querySelector("button").addEventListener("click", () => setView("history"));
    $("messages").prepend(el);
  }
  el.querySelector("button").textContent = `▴ ${hidden} older message${hidden === 1 ? "" : "s"} · show the chat history`;
}

function appendMessage(m, { streaming = false, scroll = true } = {}) {
  const el = renderMessage(null, m, { streaming });
  if (!streaming) addMsgTools(el, m);
  $("messages").appendChild(el);
  msgEls.set(m.id, el);
  $("empty").hidden = true;
  if (!chatFull()) {
    // the compact view keeps the last few on screen; the rest stays in the conversation
    while (msgEls.size > COMPACT_N) {
      const first = msgEls.keys().next().value;
      msgEls.get(first)?.remove();
      msgEls.delete(first);
    }
    renderOlder();
  }
  if (scroll) scrollBottom();
  return el;
}

function addMsgTools(el, m) {
  renderExtras(el, m);
  if (el.querySelector(".tools")) return;
  const t = document.createElement("div");
  t.className = "tools";
  const mk = (label, title, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", fn);
    t.appendChild(b);
  };
  mk("copy", "Copy the text", () => copyText(stripThink(m.content)).then(() => toast("copied")));
  if (m.role !== "user") mk("🔈", "Read aloud", () => readMessage(m));
  if (m.role !== "user" && m.kind !== "set" && parseSet(stripThink(m.content)).isSet) mk("◈", "Perform this on the stage (any reply with a couple of spoken lines; a set with no headings is one bit)", () => performMessage(m));
  if (m.role === "user") mk("↻", "Send again", () => send(m.content));
  mk("✕", "Delete this message", () => {
    conv.messages = conv.messages.filter((x) => x.id !== m.id);
    conv.save();
    renderTranscript();
  });
  el.appendChild(t);
}

function scrollBottom(force = false) {
  const t = $("transcript");
  const near = t.scrollHeight - t.scrollTop - t.clientHeight < 160;
  if (force || near) t.scrollTop = t.scrollHeight;
}

function status(text, error = false) {
  const s = $("status");
  s.textContent = text || "";
  s.classList.toggle("error", !!error);
}

// ------------------------------------------------------------------ sending

async function buildSystem(userText) {
  const parts = [deskPrompt(desk, settings, herPreset())];
  if (desk.id === "physics") {
    const mode = settings.desks.physics?.mode || "socratic";
    parts.push(mode === "worked" ? "## Mode\nWorked-problem mode is ON: give the full solution step by step, state the answer, then one independent check. Socratic questions are off until /socratic." : "## Mode\nSocratic mode is ON (the default): ask before telling. One question at a time; give the answer only when asked outright or after two rounds of trying.");
  }
  const jar = memory.asPrompt();
  if (jar) parts.push(jar);
  if (desk.id === "paperless" && bible) parts.push("## paperless-bible.md (maintained by the user; this is canon and it outranks anything you remember)\n\n" + bible);
  if (desk.id === "aetheria") {
    const c = cubeSummary();
    if (c) parts.push(c);
    if (currentFrequency) parts.push(`The user's selected frequency right now is ${currentFrequency} Hz.`);
  }
  try {
    const list = await files.list(desk.id);
    if (list.length) {
      const hits = await files.search(userText, desk.id, settings.ragChunks);
      if (hits.length) parts.push("## Project files: passages retrieved for this turn\nCite the file name when you use one. Say plainly when they do not cover the question.\n\n" + hits.map((h) => `### ${h.name}\n${h.text}`).join("\n\n"));
      else parts.push(`## Project files on this desk\n${list.map((f) => f.name).join(", ")} (nothing relevant retrieved for this turn).`);
    }
  } catch (e) {
    console.warn("rag", e);
  }
  if (desk.id === "mira") {
    // her desk: the mood tag her stage reacts to, and room to talk on a big model. The persona preset
    // (short, standard or long; herPreset(), by the same brain unless chosen) went in at the top.
    parts.push(MOOD_PROTOCOL, JAR_PROTOCOL);
    const big = bigBrain(brain);
    const full = settings.miraLength === "full" || (settings.miraLength !== "short" && big);
    parts.push(full ? "## Length\nYou are on the big model at home, and there is time. When the subject deserves it, take eight to twelve sentences: still plain, still one thought each, still spoken. Short when short is right. Never pad." : "## Length\nThree to six sentences, as your persona says. Quips, not speeches.");
  }
  if (desk.id === "openmic") {
    if (settings.desks.openmic?.clean) parts.push("## Clean edit\nClean edit is ON for this set: every joke stays, the profanity is swapped for your bar slang, so it posts anywhere. The structure does not change.");
    const earlier = conv.messages.filter((m) => m.kind === "set").slice(-3);
    if (earlier.length) parts.push("## Already used\nThese are earlier sets from tonight; nothing in a new set repeats a paragraph, a premise or a tag from them:\n\n" + earlier.map((m) => stripTags(m.content).slice(0, 1200)).join("\n\n---\n\n"));
  }
  if (desk.id === "suno") {
    parts.push(settings.desks.suno?.longForm ? "## Verses\nLong form is ON: four or five verses for a story song, each one advancing it; never fewer than three." : "## Verses\nThree verses (Verse 1 the scene, Verse 2 the turn, Verse 3 the payoff); long form is off.");
  }
  parts.push(`## Workbench notes\nToday is ${new Date().toDateString()}. You are answering as ${brain.live === "lab" ? `the lab model ${brain.info.model}` : brain.live === "native" ? `the ${native.kind === "host" ? "local" : "in-app"} model ${brain.info.model}` : "the on-device model (Gemma 4 E2B, small; keep replies tight)"}. Replies render as markdown; code blocks get a copy button; LaTeX renders with $…$ and $$…$$.${desk.id === "mira" ? " Everything you write may be read aloud: no markdown, no lists, no emoji, and nothing in brackets except the mood tag at the start and, when you save to the jar, the [jar: …] line at the very end." : ""}`);
  return parts.join("\n\n");
}

/**
 * One turn. `opts.kind` tags the reply (set, lines, heckle, punchup, song)
 * so the transcript renders it for what it is, and `opts.after(asst, el)`
 * runs once the reply is in (the open-mic linter, the song history).
 */
async function send(text, opts = {}) {
  text = String(text || "").trim();
  if (!text && !attachments.length) return;
  if (text.startsWith("/")) return runCommand(text);
  stage.touch();
  quiet.initiations = 0;
  if (quiet.busy) {
    // she was about to speak up on her own: the user comes first
    brain.stop();
    speech.stop();
    for (let i = 0; i < 20 && brain.busy; i++) await new Promise((r) => setTimeout(r, 100));
  }
  if (brain.busy) return toast("Still answering. Esc stops it.", { error: true });
  if (brain.live === "none") {
    await brain.detect();
    renderChip();
    if (brain.live === "none") return toast(brain.info.labError ? `No brain: ${brain.info.labError}` : "No brain is live. Set the endpoint in Settings.", { error: true });
  }
  const pics = attachments.slice();
  attachments = [];
  renderAttachments();
  const inp = $("input");
  inp.value = "";
  autosize();
  const user = conv.push({ role: "user", content: text || "(image)", images: pics.length });
  appendMessage(user);
  const asst = conv.push({ role: "assistant", content: "", reasoning: "", kind: opts.kind });
  const el = appendMessage(asst, { streaming: true });
  setBusy(true);
  stage.setState("thinking");
  currentMood = "calm";
  // she reads it over your shoulder first (the model riffs, the bank fills in); and if the box then takes its time, she says so
  if (!opts.kind) await quickReaction(text, { images: pics.length });
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => brain.busy && quickReaction("", { kind: "slow", force: Math.random() < 0.6 }), 7000);
  status(brain.live === "device" && brain.info.deviceStatus !== "ready" ? "loading the on-device model (about 3.5 GB the first time)…" : "thinking…");
  let raf = 0;
  const paint = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      renderMessage(el, asst, { streaming: true });
      scrollBottom();
    });
  };
  // her desk asks for a leading mood tag; it is split off as the text streams
  const herDesk = desk.id === "mira";
  let raw = "";
  const takeIn = (t) => {
    raw += t;
    if (!herDesk) {
      asst.content += t;
      return;
    }
    const { mood, text: body, pending } = takeMood(raw);
    if (mood && !asst.mood) {
      asst.mood = mood;
      currentMood = mood;
      stage.setMood(mood);
      ambience.setMood(mood);
    }
    asst.content = pending ? "" : takeJar(body).text; // her [jar: …] line never shows, finished or half-streamed
  };
  try {
    const system = await buildSystem(text);
    const history = conv.context(settings.contextTurns).filter((m) => m.content.trim());
    const messages = [{ role: "system", content: system }, ...history];
    const r = await brain.chat({
      messages,
      images: pics,
      thinking: deskThinking(desk, settings),
      onDelta: (t) => {
        clearTimeout(slowTimer);
        takeIn(t);
        paint();
      },
      onReasoning: (t) => {
        clearTimeout(slowTimer);
        asst.reasoning += t;
        paint();
      },
    });
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(slowTimer);
    if (r.text) {
      const t = herDesk ? takeMood(r.text) : { text: r.text, mood: null };
      const j = herDesk ? takeJar(t.text) : { text: t.text, notes: [] };
      asst.content = j.text.trim() || asst.content;
      if (t.mood && !asst.mood) asst.mood = t.mood;
      if (j.notes.length) {
        // her own save: into the jar (a repeat is dropped), the "jarred" chip on the message, no announcement
        const kept = j.notes.map((n) => memory.add(n, "mira", { by: "mira" })).filter(Boolean).map((it) => it.text);
        if (kept.length) asst.jarred = kept;
      }
    }
    asst.reasoning = r.reasoning || asst.reasoning;
    asst.interrupted = !!r.interrupted;
    asst.stats = { ...brain.stats };
    // a set written in plain chat on the Open Mic desk ("write me a bit about…") gets the set card like a /five would (no linter unless asked)
    if (desk.id === "openmic" && !opts.kind && !asst.interrupted && looksLikeSet(asst.content) && parseSet(asst.content).isSet) asst.kind = "set";
    conv.save();
    renderMessage(el, asst);
    addMsgTools(el, asst);
    scrollBottom();
    status(brain.stats.tokPerSec ? `${brain.stats.tokPerSec} tok/s · first token ${brain.stats.firstTokenMs} ms` : "");
    if (opts.after && !asst.interrupted) {
      try {
        await opts.after(asst, el);
      } catch (err) {
        console.warn("after", err);
        toast(err.message, { error: true });
      }
    }
    if (settings.desks[desk.id]?.autoRead && asst.content && !opts.kind) readMessage(asst);
    else {
      stage.setState("idle");
      stage.react(asst.mood || (herDesk ? "calm" : "thoughtful"));
    }
  } catch (e) {
    cancelAnimationFrame(raf);
    asst.interrupted = true;
    conv.save();
    renderMessage(el, asst);
    addMsgTools(el, asst);
    status(e.message, true);
    toast(e.message, { error: true });
    if (e.name !== "AbortError" && !/stop/i.test(e.message)) {
      stage.setState("error");
      setTimeout(() => stage.state === "error" && stage.setState("idle"), 5000);
    }
  } finally {
    clearTimeout(slowTimer);
    setBusy(false);
    renderChip();
    if (drawerTab === "diagnostics") renderDiag();
  }
}

function setBusy(on) {
  $("btn-send").hidden = on;
  $("btn-stop").hidden = !on;
  ambience.setState(on ? "thinking" : "idle");
}

function stopAll() {
  const wasBusy = brain.busy || speech.speaking;
  brain.stop();
  speech.stop();
  if (voice.listening) voice.stop();
  if (wasBusy) stage?.setState("interrupted");
}

// ------------------------------------------------------------------ commands

async function runCommand(text) {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
  if (!m) return;
  const cmd = findCommand(desk.id, m[1]);
  $("input").value = "";
  autosize();
  hidePalette();
  if (!cmd) return toast(`No command /${m[1]} on this desk. /help lists them.`, { error: true });
  try {
    await cmd.run(ctx(), m[2] || "");
  } catch (e) {
    toast(`/${cmd.id}: ${e.message}`, { error: true });
  }
}

function ctx() {
  return {
    desk,
    memory,
    settings,
    toast: (t, e) => toast(t, { error: !!e }),
    card: (md, title) => appendMessage(conv.push({ role: "tool", content: md, title })),
    send,
    exportMd: async () => {
      const list = await files.list(desk.id);
      toast(`exported ${exportConversation({ desk, conversation: conv, memory, files: list })}`);
    },
    openDrawer,
    pickFiles: () => $("file-input").click(),
    clear: clearDesk,
    readLast: () => {
      const last = conv.lastAssistant();
      if (last) readMessage(last);
      else toast("Nothing to read yet.");
    },
    stop: stopAll,
    thinking: () => deskThinking(desk, settings),
    setThinking: (v) => {
      setDeskSetting(settings, desk.id, { thinking: v });
      renderHead();
      renderDeskSettings();
    },
    toggleTheme,
    toggleAmbience,
    toggleStage: () => setView("stage"),
    toggleChat: () => setView("history"),
    saveSettings: () => {
      saveSettings(settings);
      renderHead();
    },
    handoff,
    hermes,
    openMira: () => toast(openCompanion(settings), { ms: 5000 }),
    setBrain: (m) => {
      settings.brain = ["lab", "device", "auto", "native"].includes(m) ? m : "auto";
      saveSettings(settings);
      $("set-brain").value = settings.brain;
      brain.detect().then(renderChip);
      toast(`brain: ${settings.brain}`);
    },
    setModel: (m) => {
      if (!m) return toast(`model: ${settings.lab.model || "(none)"}`);
      settings.lab.model = m;
      saveSettings(settings);
      brain.info.model = m;
      $("set-lab-model").value = m;
      renderChip();
    },
    webSearch,
    fetchUrl,
    openSprite: () => openSprite(),
    setMode: (mode) => {
      setDeskSetting(settings, desk.id, { mode });
      toast(`${mode} mode`);
    },
    lastAssistant: () => conv.lastAssistant(),
    cube: getCube,
    setFrequency,
    searchFiles: (q, k) => files.search(q, desk.id, k),
    setDesk: (patch) => setDeskSetting(settings, desk.id, patch),
    openMic,
    suno,
  };
}

// ------------------------------------------------------------------ the open mic

/** A stage voice as the desk's prompt: a dial from voices.js swapped into the file's prompt, or the file's own back. */
function useStageVoice(key) {
  const od = deskById("openmic");
  if (key === "default") setDeskSetting(settings, "openmic", { prompt: undefined, voice: "default" });
  else if (key === "current") return toast("That is the desk's prompt already.");
  else if (VOICES[key]) setDeskSetting(settings, "openmic", { prompt: applyVoice(defaultPrompt(od), VOICES[key].text), voice: key });
  else return toast(`No voice "${key}". Voices: default, ${Object.keys(VOICES).join(", ")}.`, { error: true });
  toast(`stage voice: ${key === "default" ? "the file's" : VOICES[key].name}`);
  if (desk.id === "openmic") {
    renderDeskSettings();
    $("empty-text").textContent = deskPrompt(desk, settings, herPreset()).split("\n").find((l) => l.trim()) || "";
  }
}

/** Any reply on the stage: parsed as a set (no headings is one bit), with the Suno style if a song came from it. */
function performMessage(m) {
  const set = parseSet(stripThink(m.content));
  if (!set.isSet) return toast("Nothing to perform here: two spoken lines at least.", { error: true });
  return micStage.show(set, { style: lastStyleFor(set) });
}

/** A reply written outside the commands that is shaped like a set (bit headings, or pose tags): it gets the set card. */
function looksLikeSet(text) {
  return /^#{2,4}\s*(bit\s*)?\d/im.test(text) || /\{(pace|lean|shriek|deadpan|aside)[}:]/i.test(text);
}

/** The last set on the Open Mic desk (this conversation, or its stored one from another desk). */
function lastSet() {
  const msgs = desk.id === "openmic" ? conv.messages : new Conversation("openmic").messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant" && m.kind === "set" && m.content.trim()) {
      const set = parseSet(m.content);
      if (set.isSet) return { set, message: m };
    }
  }
  return null;
}

const STARS_KEY = "workbench.openmic.stars";
const stars = () => {
  try {
    return JSON.parse(localStorage.getItem(STARS_KEY) || "{}");
  } catch {
    return {};
  }
};
const saveStars = (s) => localStorage.setItem(STARS_KEY, JSON.stringify(s));

const MODES = {
  /** A set to a length: the minutes asked for, the words that takes (165 a minute of stage time), and the shape that fits it. */
  five: (minutes, about) => {
    const words = Math.round(minutes * 165);
    const bits = minutes <= 3 ? "three to five bits" : minutes <= 6 ? "six to eight bits" : "eight to twelve bits";
    return `A tight set of about ${fmtRuntime(minutes * 60)} read aloud${about ? ` about ${about}` : ""}: that is about ${words} words, and the runtime is computed at 150 words a minute, so write to the words, not under them (short is the common failure; when in doubt, one more beat before the tag). ${bits}, story bits told in scenes alternating with observational riffs, one concrete target per bit, one {aside: …} per bit that lands like a punchline of its own, the mouth on (every bit swears, sex and bodies said in the words people use), the gloves off (no apology, no moral, no "just kidding"; every bit ends on the knife), real life only (nothing from the game), and the closer is everything she put aside: every earlier aside comes back and connects into the final punchline, which is also the callback to bit 1. The output shape, exactly.`;
  },
  /** A monologue: one subject followed the whole way, longer, the bits its scenes. */
  monologue: (minutes, about) => {
    const words = Math.round(minutes * 165);
    return `A monologue of about ${fmtRuntime(minutes * 60)} read aloud${about ? ` about ${about}` : ""}: about ${words} words (the runtime is computed at 150 words a minute; write to the words, not under them). One subject followed the whole way, the way a special's centrepiece runs: eight to fourteen bits that are scenes of the same story or the same argument, in order, each with its own turn and tag, story bits and surgical riffs trading off inside it, the voices and act-outs of everyone in it, one {aside: …} per bit that lands like a punchline of its own, the mouth on, the gloves off (nothing softened, no moral, the knife last), real life only (nothing from the game). The closer is everything she put aside: every aside comes back and the dots connect into the final punchline, which is also the callback to the opening. The output shape, exactly: a # title, ## Bit headings for the scenes, the pull quote last.`;
  },
  lines: (about) => `A one-liner pack${about ? ` about ${about}` : ""}: twenty standalone lines as a numbered list under a # title, each its own premise and turn, the surprise in the last word, no two on the same target, none longer than twenty words, real life only. No bits, no asides, no pose tags.`,
  heckle: (text) => `(A heckle from the room: "${text.replace(/"/g, "'")}") Answer it in character, two lines at most, no heading, no title, then back to the set. Turn it on the heckler or on yourself; never on what anyone is.`,
  punchup: (draft) => `Punch-up. Here is a draft of a set. Return it in the output shape under "## Punched": every rant cut down to bits that follow the rules (premise, escalation in threes, turn, tag; punchlines shorter than setups; one target per bit; one {aside} per bit, none of the draft's extra ones; the intensity curve, never starting at the shriek), repeated paragraphs cut, restated theses cut, anything from the game cut and replaced with real life, punchlines added where a bit has none, the draft's own words kept wherever they already work. Then "## Notes": one line per change, in the form "cut: restated thesis (bit 3)", "added: tag (bit 1)", "moved: shriek to bit 4", "cut: game lore (bit 2)", "kept: the party hat on the bull".\n\n---\n\n${draft}`,
};

/**
 * The Open Mic desk's modes. A set-producing turn is followed by the
 * linter: the local checks (set.js) and a short JSON-only model call
 * (prompts/open-mic-linter.md, thinking off); a set that fails is
 * rewritten once with the notes, and the card says so.
 */
async function openMic(mode, args = "") {
  args = String(args || "").trim();
  if (desk.id !== "openmic" && mode !== "perform" && mode !== "stars") selectDesk("openmic");
  switch (mode) {
    case "five":
    case "monologue": {
      // a leading number is the minutes (/five 7 about rent; /monologue 12 about Derek); the five defaults to 5, the monologue to 10
      const m = /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)?\b\s*(.*)$/i.exec(args);
      const minutes = m ? Math.max(0.5, Math.min(30, Number(m[1]))) : mode === "five" ? 5 : 10;
      const about = (m ? m[2] : args).trim();
      const target = Math.round(minutes * 60);
      return send(MODES[mode](minutes, about), { kind: "set", after: (a, e) => lintAndFix(a, e, { target }) });
    }
    case "lines":
      return send(MODES.lines(args), { kind: "lines" });
    case "heckle":
      return send(MODES.heckle(args), {
        kind: "heckle",
        after: async (asst) => {
          if (micStage?.open) await micStage.perform(asst.content);
        },
      });
    case "punchup": {
      let draft = args;
      if (!draft) {
        // the last thing pasted, if it was not a command
        const last = [...conv.messages].reverse().find((m) => m.role === "user" && !m.content.startsWith("/") && m.content.length > 200);
        draft = last?.content || "";
      }
      if (!draft) return toast("Paste the draft after /punchup (or paste it as a message first).", { error: true, ms: 6000 });
      return send(MODES.punchup(draft), {
        kind: "punchup",
        after: async (asst, el) => {
          const m = /##\s*punched\s*\n([\s\S]*?)(?=\n##\s*notes|$)/i.exec(asst.content);
          const notes = /##\s*notes\s*\n([\s\S]*)$/i.exec(asst.content)?.[1]?.trim() || "";
          const punched = (m ? m[1] : asst.content).trim();
          const set = parseSet(punched);
          asst.draft = draft;
          asst.notes = notes;
          asst.content = punched;
          asst.kind = set.isSet ? "set" : "punchup";
          conv.save();
          renderMessage(el, asst);
          addMsgTools(el, asst);
          const diff = diffMarkdown(diffLines(draft, stripTags(punched)));
          appendMessage(conv.push({ role: "tool", title: "punch-up · the changes", content: `${notes ? notes + "\n\n" : ""}${diff}` }));
          if (set.isSet) await lintAndFix(asst, el);
        },
      });
    }
    case "perform": {
      const last = lastSet();
      if (!last) return toast("No set to perform yet. /five writes one.", { error: true });
      return micStage.show(last.set, { style: lastStyleFor(last.set) });
    }
    case "voice": {
      const key = args.toLowerCase();
      if (!key) {
        const cur = settings.desks.openmic?.voice || (settings.desks.openmic?.prompt ? "edited on this device" : "default");
        return appendMessage(conv.push({ role: "tool", title: "stage voices", content: `Now: **${cur}**.\n\n- **default**: the file's voice, gloves off (prompts/open-mic.md)\n${Object.entries(VOICES).map(([k, v]) => `- **${k}**: ${v.name}, ${v.about}`).join("\n")}\n\n\`/voice <name>\` switches; \`/dialin [about]\` writes one brief through all of them, side by side with numbers.` }));
      }
      return useStageVoice(key);
    }
    case "dialin": {
      // one two-minute brief through every stage voice, each set on its own card, then the numbers side by side
      const about = args || "rent and the landlord";
      const brief = MODES.five(2, about);
      const od = deskById("openmic");
      const base = defaultPrompt(od);
      const override = settings.desks.openmic?.prompt;
      const dials = [{ key: "default", name: "Default (the file)", about: "the voice in prompts/open-mic.md", system: base }, ...Object.entries(VOICES).map(([key, v]) => ({ key, name: v.name, about: v.about, system: applyVoice(base, v.text) }))];
      if (override && override.trim() && override.trim() !== base.trim()) dials.unshift({ key: "current", name: "Current (edited on this device)", about: "the desk's prompt as it stands", system: override });
      if (brain.live === "none") return toast("No brain is live for the dial-in.", { error: true });
      const rows = [];
      for (const d of dials) {
        status(`dial-in: ${d.name}…`);
        const asst = conv.push({ role: "assistant", content: "", kind: "set", voice: d.key });
        const el = appendMessage(asst, { streaming: true });
        let last = 0;
        try {
          const r = await brain.chat({
            messages: [
              { role: "system", content: d.system },
              { role: "user", content: brief },
            ],
            thinking: false,
            onDelta: (t) => {
              asst.content += t;
              if (performance.now() - last > 120) {
                last = performance.now();
                renderMessage(el, asst, { streaming: true });
              }
            },
          });
          asst.content = (r.text || asst.content).trim();
          asst.interrupted = !!r.interrupted;
        } catch (e) {
          asst.content = asst.content || `(failed: ${e.message})`;
          asst.interrupted = true;
        }
        asst.stats = { ...brain.stats };
        conv.save();
        renderMessage(el, asst);
        addMsgTools(el, asst);
        scrollBottom();
        rows.push({ key: d.key, name: d.name, about: d.about, m: benchMeasure(asst.content) });
        if (asst.interrupted && !asst.content.trim()) break;
      }
      status("");
      const card = conv.push({
        role: "tool",
        title: `dial-in · ${about}`,
        kind: "bench",
        rows: rows.map(({ key, name, about: a }) => ({ key, name, about: a })),
        content: `${benchTable(rows)}\n\nThe same two-minute brief through every voice, in the order above. The numbers are rough (word lists and a simile count are not a critic), but side by side over one brief they show what each dial moves. Perform any of them from its card; **use** makes a voice the desk's prompt (the prompt editor's Reset to the file undoes it), and \`/voice\` lists them.`,
      });
      return appendMessage(card);
    }
    case "stars": {
      const kept = Object.values(stars()).sort((a, b) => b.t - a.t);
      if (!kept.length) return toast("Nothing starred yet. Star lines in a /lines pack.", { error: true });
      return appendMessage(conv.push({ role: "tool", title: `starred · ${kept.length}`, content: kept.map((k, i) => `${i + 1}. ${k.text}`).join("\n") }));
    }
    default:
      return toast(`open mic: no mode ${mode}`, { error: true });
  }
}

/** The Suno style prompt made from this set, if a song was written from it (by its title). */
function lastStyleFor(set) {
  try {
    const songs = JSON.parse(localStorage.getItem(SONGS_KEY) || "{}");
    const v = Object.values(songs).find((x) => x.from === set.title)?.versions?.at(-1);
    return v ? [v.style, v.spec].filter(Boolean).join("\n\n") : "";
  } catch {
    return "";
  }
}

async function lintAndFix(asst, el, { target = null } = {}) {
  const spelled = spokenSpelling(asst.content); // house style before the linter reads it: goddamn is written god-damn, as it is said
  if (spelled !== asst.content) {
    asst.content = spelled;
    renderMessage(el, asst);
  }
  const set = parseSet(asst.content);
  if (!set.isSet) return;
  if (target) asst.target = target;
  const previous = conv.messages.filter((m) => m.kind === "set" && m.id !== asst.id).flatMap((m) => paragraphHashes(m.content));
  let problems = lintLocal(set, previous, { target: asst.target || null });
  let rewriteNote = "";
  status("the linter is reading the set…");
  try {
    const r = await brain.chat({
      messages: [
        { role: "system", content: promptText("open-mic-linter") },
        { role: "user", content: `${settings.desks.openmic?.clean ? "(Clean edit is on: skip rule 11.)\n\n" : ""}${asst.content}` },
      ],
      thinking: false,
      temperature: 0.2,
      maxTokens: 700,
      onDelta: () => {},
    });
    const j = parseJson(r.text);
    if (j && Array.isArray(j.problems)) {
      problems = problems.concat(j.problems.filter((p) => p && p.rule && p.note).map((p) => ({ rule: p.rule, bit: p.bit ?? null, note: p.note })));
      rewriteNote = j.rewrite || "";
    }
  } catch (e) {
    console.warn("linter", e);
  }
  asst.lint = { problems, rewritten: false };
  if (!problems.length) {
    status("");
    conv.save();
    renderMessage(el, asst);
    addMsgTools(el, asst);
    return;
  }
  status(`linter: ${problems.length} note${problems.length === 1 ? "" : "s"}, rewriting…`);
  try {
    const r = await brain.chat({
      messages: [
        { role: "system", content: deskPrompt(deskById("openmic"), settings) },
        { role: "user", content: `Rewrite this set so it passes the linter. ${rewriteNote}\nThe notes:\n${problems.map((p) => `- ${p.rule}${p.bit ? ` (bit ${p.bit})` : ""}: ${p.note}`).join("\n")}\n\nKeep every joke that works and the same title.${asst.target ? ` The set must run about ${fmtRuntime(asst.target)} read aloud, about ${Math.round((asst.target / 60) * 165)} words.` : ""} Return the whole set in the output shape, nothing else.\n\n---\n\n${asst.content}` },
      ],
      thinking: false,
      onDelta: () => {},
    });
    // the rewrite is the set only; a "## Notes" tail the model adds anyway is dropped
    const text = r.text.replace(/\n##\s*notes\b[\s\S]*$/i, "").trim();
    const fixed = parseSet(text);
    if (fixed.isSet && !fixed.lines.some((l) => /guardrail/i.test(l.text))) {
      asst.draft = asst.content;
      asst.content = text;
      asst.lint.rewritten = true;
    }
  } catch (e) {
    console.warn("rewrite", e);
  }
  status("");
  conv.save();
  renderMessage(el, asst);
  addMsgTools(el, asst);
}

function parseJson(text) {
  const t = String(text || "")
    .replace(/```json|```/gi, "")
    .trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = /\{[\s\S]*\}/.exec(t);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/** Under a set, a one-liner pack, a song or the style library: what it is, and what to do with it. */
function renderExtras(el, m) {
  el.querySelector(".setmeta, .songbar")?.remove();
  if (!m.kind || (m.role !== "assistant" && m.kind !== "specs" && m.kind !== "bench")) return;
  const body = el.querySelector(".body");
  if (m.kind === "set") {
    const set = parseSet(m.content);
    if (!set.isSet) return;
    const bar = document.createElement("div");
    bar.className = "setmeta";
    const lint = m.lint ? (m.lint.problems.length ? `<span class="lint" title="${escapeHtml(m.lint.problems.map((p) => `${p.rule}${p.bit ? ` (bit ${p.bit})` : ""}: ${p.note}`).join("\n"))}">linter: ${m.lint.problems.length} note${m.lint.problems.length === 1 ? "" : "s"}${m.lint.rewritten ? " · rewritten" : ""}</span>` : `<span class="lint ok">linter: clean</span>`) : "";
    bar.innerHTML = `<span>${set.bits.length} bit${set.bits.length === 1 ? "" : "s"} · ${set.words} words · ~${fmtRuntime(set.runtime)}${m.target ? ` of ${fmtRuntime(m.target)}` : ""} read aloud</span>${lint}<button class="perform">◈ Perform</button><button class="pkg">⤓ Package</button><button class="song">♪ Song</button>${m.draft ? '<button class="before">the draft before</button>' : ""}`;
    bar.querySelector(".perform").addEventListener("click", () => micStage.show(set, { style: lastStyleFor(set) }));
    bar.querySelector(".pkg").addEventListener("click", async () => {
      await micStage.show(set, { style: lastStyleFor(set) });
      micStage.exportPackage();
    });
    bar.querySelector(".song").addEventListener("click", () => suno("frombit", "", set));
    bar.querySelector(".before")?.addEventListener("click", () => appendMessage(conv.push({ role: "tool", title: "before the linter", content: m.draft })));
    body.after(bar);
  } else if (m.kind === "lines") {
    const lines = parseLines(m.content);
    if (!lines.length) return;
    const kept = stars();
    const host = document.createElement("div");
    host.className = "setmeta stars";
    let order = "original";
    const draw = () => {
      const idx = lines.map((t, i) => ({ t, i, on: !!kept[hashParagraph(t)] }));
      if (order === "starred") idx.sort((a, b) => Number(b.on) - Number(a.on) || a.i - b.i);
      host.innerHTML = `<div class="btn-row"><span>${lines.length} lines · ${idx.filter((x) => x.on).length} starred</span><button class="sort">sort: ${order}</button><button class="copy-kept">copy the starred</button></div><ol>${idx.map((x) => `<li><button class="star ${x.on ? "on" : ""}" data-h="${hashParagraph(x.t)}" title="star to keep">${x.on ? "★" : "☆"}</button><span class="n">${x.i + 1}.</span><span>${escapeHtml(x.t)}</span></li>`).join("")}</ol>`;
      host.querySelectorAll("button.star").forEach((b) =>
        b.addEventListener("click", () => {
          const h = b.dataset.h;
          const text = lines.find((t) => hashParagraph(t) === h);
          if (kept[h]) delete kept[h];
          else kept[h] = { text, t: Date.now(), desk: desk.id };
          saveStars(kept);
          draw();
        }),
      );
      host.querySelector(".sort").addEventListener("click", () => {
        order = order === "original" ? "starred" : "original";
        draw();
      });
      host.querySelector(".copy-kept").addEventListener("click", () => {
        const on = lines.filter((t) => kept[hashParagraph(t)]);
        if (!on.length) return toast("Nothing starred in this pack.", { error: true });
        copyText(on.join("\n")).then(() => toast(`copied ${on.length} line${on.length === 1 ? "" : "s"}`));
      });
    };
    draw();
    body.hidden = true; // the list with the stars replaces the plain one
    body.after(host);
  } else if (m.kind === "song") {
    const song = parseSong(m.content);
    body.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      if (code?.classList.contains("language-lyrics")) pre.classList.add("copy-lyrics");
      if (code?.classList.contains("language-style")) pre.classList.add("copy-style");
      if (code?.classList.contains("language-spec")) pre.classList.add("copy-spec");
    });
    const bar = document.createElement("div");
    bar.className = "songbar";
    const longForm = !!settings.desks.suno?.longForm;
    const counts = song.isSong ? `<span class="fine">verses: ${verses(song.lyrics)}${song.style ? ` · <span class="${song.style.length > STYLE_MAX ? "over" : ""}">style: ${song.style.length}/${STYLE_MAX}</span>` : ""}${song.spec ? ` · <span class="${song.spec.length > SPEC_MAX ? "over" : ""}">spec: ${song.spec.length}/${SPEC_MAX}</span>` : ""}</span>` : "";
    const lint = m.lint ? `<span class="lint" title="${escapeHtml((m.lint.problems || []).join("\n"))}">linter: ${m.lint.rewritten ? "rewritten" : `${m.lint.problems.length} note${m.lint.problems.length === 1 ? "" : "s"}`}</span>` : "";
    const notes = m.notes ? `<span class="fine">${escapeHtml(m.notes)}</span>` : "";
    bar.innerHTML = `<button data-m="chorus">↻ chorus only</button><button data-m="darker">darker</button><button data-m="lighter">lighter</button><button data-m="duet">duet</button><button data-m="aetheria">Aetheria mode</button><button data-m="same" title="Same sound, new song: this spec word for word, a new brief">same sound</button><button data-m="longform" title="Four or five verses for a story song, never fewer than three">long form: ${longForm ? "on" : "off"}</button><button data-m="versions">versions</button><button data-m="specs" title="The style-spec library">library</button>${m.draft ? '<button data-m="before">the draft before</button>' : ""}${counts}${lint}${notes}`;
    bar.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        const mode = b.dataset.m;
        if (mode === "aetheria") {
          const hz = prompt("Which frequency or stone? (a number, a name, or a holder)", settings.desks.aetheria?.frequency || "2178");
          if (hz) suno("aetheria", hz);
        } else if (mode === "before") appendMessage(conv.push({ role: "tool", title: "before the linter", content: m.draft }));
        else if (mode === "same") suno("same", "", { title: song.title, style: song.style, spec: song.spec });
        else suno(mode, "");
      }),
    );
    body.after(bar);
  } else if (m.kind === "bench") {
    // the dial-in: a "use" button per voice under the table
    const host = document.createElement("div");
    host.className = "setmeta bench";
    host.innerHTML = `<div class="btn-row">${(m.rows || []).map((r) => `<button class="use" data-v="${escapeHtml(r.key)}" title="${escapeHtml(r.about || "")}">use ${escapeHtml(r.name)}</button>`).join("")}</div>`;
    host.querySelectorAll("button.use").forEach((b) => b.addEventListener("click", () => useStageVoice(b.dataset.v)));
    body.after(host);
  } else if (m.kind === "specs") {
    // the style-spec library: every spec a song was written with, to reuse ("same sound, new song") or fork
    const host = document.createElement("div");
    host.className = "setmeta specs";
    const draw = () => {
      const all = Object.values(specs()).sort((a, b) => b.t - a.t);
      host.innerHTML = all.length
        ? `<ol>${all.map((s) => `<li data-id="${s.id}"><b>${escapeHtml(s.title)}</b> · ${escapeHtml(s.style)}<span class="spec">${escapeHtml(s.spec.slice(0, 240))}${s.spec.length > 240 ? "…" : ""}</span><button class="use">same sound, new song</button><button class="copy">copy spec</button><button class="del" title="Remove from the library">✕</button></li>`).join("")}</ol>`
        : '<p class="fine">The library is empty. Every song\'s spec lands here.</p>';
      host.querySelectorAll("li").forEach((li) => {
        const s = specs()[li.dataset.id];
        li.querySelector(".use").addEventListener("click", () => suno("same", "", s));
        li.querySelector(".copy").addEventListener("click", () => copyText(`${s.style}\n\n${s.spec}`).then(() => toast("spec copied")));
        li.querySelector(".del").addEventListener("click", () => {
          const rest = specs();
          delete rest[li.dataset.id];
          saveSpecs(rest);
          draw();
        });
      });
    };
    draw();
    body.hidden = true; // the list with the buttons replaces the plain one
    body.after(host);
  }
}

// ------------------------------------------------------------------ suno

const SONGS_KEY = "workbench.suno.songs";
const songs = () => {
  try {
    return JSON.parse(localStorage.getItem(SONGS_KEY) || "{}");
  } catch {
    return {};
  }
};

function lastSong() {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i];
    if (m.role === "assistant" && m.kind === "song") return m;
  }
  return null;
}

// The style-spec library: every spec a song was written with, one entry per
// distinct spec, kept with the song it came from, to reuse or fork.
const SPECS_KEY = "workbench.suno.specs";
const specs = () => {
  try {
    return JSON.parse(localStorage.getItem(SPECS_KEY) || "{}");
  } catch {
    return {};
  }
};
const saveSpecs = (s) => localStorage.setItem(SPECS_KEY, JSON.stringify(s));

function keepSpec(song, from = null) {
  if (!song.spec || !song.style) return null;
  const all = specs();
  const id = specKey(song.spec);
  all[id] = { id, title: song.title, style: song.style, spec: song.spec, from: from || all[id]?.from || null, t: all[id]?.t || Date.now() };
  saveSpecs(all);
  return all[id];
}

/**
 * After a song reply: the linter (a song under three verses, or without
 * its style or spec block, is rewritten once; the draft before is kept on
 * the message), the checks, a version in the per-song history, the spec
 * into the library.
 */
async function keepSong(asst, el, { from = "" } = {}) {
  let song = parseSong(asst.content);
  const rejects = songRejects(song);
  if (rejects.length) {
    await fixSong(asst, el, rejects);
    song = parseSong(asst.content);
  }
  const notes = checkSong(song, { longForm: !!settings.desks.suno?.longForm });
  const long = song.isSong ? longLines(song.lyrics) : [];
  if (long.length > 3) notes.push(`${long.length} lines outside 6–10 syllables (e.g. "${long[0].line}" is ${long[0].n})`);
  asst.notes = notes.length ? notes.join(" · ") : "";
  const all = songs();
  const key = (song.title || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const entry = all[key] || { title: song.title, from: from || null, versions: [] };
  if (from) entry.from = from;
  entry.versions.push({ t: Date.now(), hook: song.hook, scheme: song.scheme, lyrics: song.lyrics, style: song.style, spec: song.spec, verses: verses(song.lyrics), note: asst.notes });
  if (entry.versions.length > 20) entry.versions = entry.versions.slice(-20);
  all[key] = entry;
  localStorage.setItem(SONGS_KEY, JSON.stringify(all));
  keepSpec(song, from || entry.from);
  conv.save();
  renderMessage(el, asst);
  addMsgTools(el, asst);
}

/** The song linter's one rewrite: the desk's prompt, the reasons, the song back. */
async function fixSong(asst, el, reasons) {
  status(`song linter: ${reasons[0]}; rewriting…`);
  asst.lint = { problems: reasons, rewritten: false };
  try {
    const r = await brain.chat({
      messages: [
        { role: "system", content: deskPrompt(deskById("suno"), settings) },
        { role: "user", content: `The linter rejected this song: ${reasons.join("; ")}. Rewrite it so it passes: three verses at least (Verse 1 sets the scene, Verse 2 turns it, Verse 3 pays it off), the same title, hook and scheme, a descriptor on every section tag, the short style line and the full spec. Return the full shape, nothing else.\n\n---\n\n${asst.content}` },
      ],
      thinking: false,
      onDelta: () => {},
    });
    const fixed = parseSong(r.text);
    if (fixed.isSong && !songRejects(fixed).length) {
      asst.draft = asst.content;
      asst.content = r.text.trim();
      asst.lint.rewritten = true;
    }
  } catch (e) {
    console.warn("song rewrite", e);
  }
  status("");
  renderMessage(el, asst);
}

async function suno(mode, args = "", extra = null) {
  args = String(args || "").trim();
  if (mode === "song" && desk.id === "openmic") mode = "frombit";
  if (desk.id !== "suno") selectDesk("suno");
  const material = (set) => `Material: this stand-up set of hers. Keep its punchlines as the hook or the bridge, verbatim where they scan. This is a comedy-derived song: add the delivery clause to the spec (spoken-word verses with an audible smirk, chorus sung straight).\n\n${stripTags(set.bits.map((b) => b.text).join("\n\n"))}`;
  const last = lastSong();
  const again = (instr) => {
    if (!last) return toast("No song yet. /song <hook or idea> first.", { error: true });
    return send(`${instr}\n\n${last.content}`, { kind: "song", after: keepSong });
  };
  switch (mode) {
    case "song":
      if (!args) return toast("/song <hook, title or idea> [genre, mood, tempo]", { error: true });
      return send(`Song brief: ${args}`, { kind: "song", after: keepSong });
    case "frombit": {
      const set = extra || lastSet()?.set;
      if (!set) return toast("No set on the Open Mic desk yet. /five writes one.", { error: true });
      return send(`From a bit: write the song from this set${args ? ` (${args})` : ""}.\n\n${material(set)}`, { kind: "song", after: (a, e) => keepSong(a, e, { from: set.title }) });
    }
    case "same": {
      // same sound, new song: a spec from the card, the library, or the last song, word for word, and a new brief
      const s = extra?.spec ? extra : last ? parseSong(last.content) : null;
      if (!s?.spec) return toast("No spec to reuse yet. /song first, or pick one in /specs.", { error: true });
      const brief = args || prompt(`Same sound as "${s.title}", new song. What is it about? (a hook, a title or a one-line idea)`, "");
      if (!brief) return;
      return send(`Song brief: ${brief}\n\nSame sound, new song: reuse this style line and this spec word for word, changing only the structure clause to follow the new lyrics.\n\n\`\`\`style\n${s.style}\n\`\`\`\n\n\`\`\`spec\n${s.spec}\n\`\`\``, { kind: "song", after: keepSong });
    }
    case "longform": {
      const v = /off|0|false/i.test(args) ? false : /on|1|true/i.test(args) ? true : !settings.desks.suno?.longForm;
      setDeskSetting(settings, "suno", { longForm: v });
      $("set-suno-longform").checked = v;
      toast(v ? "long form on: four or five verses for a story song" : "long form off: three verses");
      return;
    }
    case "specs": {
      const lib = Object.values(specs()).sort((a, b) => b.t - a.t);
      return appendMessage(conv.push({ role: "tool", title: `style library · ${lib.length}`, kind: "specs", content: lib.map((s, i) => `${i + 1}. **${s.title}** · ${s.style}\n\n   ${s.spec}`).join("\n\n") || "The library is empty." }));
    }
    case "chorus":
      return again("Regenerate only the chorus of this song; every other line stays exactly as it is. Return the full shape.");
    case "darker":
      return again("This song, darker: the same hook and scheme, the imagery and the style prompt turned down into the dark. Return the full shape.");
    case "lighter":
      return again("This song, lighter: the same hook and scheme, the imagery and the style prompt lifted. Return the full shape.");
    case "duet":
      return again("This song as a duet: [Voice 1] and [Voice 2] inside the lyrics block, trading lines and sharing the chorus. Return the full shape.");
    case "aetheria": {
      await loadCube();
      const f = findFrequency(args || settings.desks.aetheria?.frequency || "2178");
      if (!f) return toast(`Nothing in the cube matches "${args}". Try 2178, or a name like Source.`, { error: true });
      const lore = `Aetheria mode. The frequency is ${f.hz} Hz: regime ${f.regime}${f.keyword ? `, keyword "${f.keyword}"` : ""}${f.stone ? `, the stone ${f.stone.id}${f.stone.holder ? ` held by ${f.stone.holder}` : ""}${f.stone.lore ? `: ${f.stone.lore}` : ""}` : ""}. Weave the regime and the stone's lore into the imagery; never name the number in the lyrics.`;
      return last ? send(`${lore}\n\nRewrite this song accordingly. Return the full shape.\n\n${last.content}`, { kind: "song", after: keepSong }) : send(`${lore}\n\nWrite a song from it${args ? "" : ""}.`, { kind: "song", after: keepSong });
    }
    case "versions": {
      const all = songs();
      const song = last ? parseSong(last.content) : null;
      const key = (song?.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const entry = all[key];
      if (!entry) return toast("No history for this song yet.", { error: true });
      const v = entry.versions;
      const rows = v.map((x, i) => `${i + 1}. ${new Date(x.t).toLocaleString()} · hook: ${x.hook || "—"} · scheme ${x.scheme || "—"} · verses ${x.verses ?? "?"} · style ${x.style.length}/${STYLE_MAX} · spec ${(x.spec || "").length}/${SPEC_MAX}${x.note ? ` · ${x.note}` : ""}`).join("\n");
      const cmp = v.length >= 2 ? `\n\n**Latest two, lyrics compared:**\n\n${diffMarkdown(diffLines(v[v.length - 2].lyrics, v[v.length - 1].lyrics))}` : "";
      return appendMessage(conv.push({ role: "tool", title: `versions · ${entry.title}`, content: `${rows}${cmp}` }));
    }
    default:
      return toast(`suno: no mode ${mode}`, { error: true });
  }
}

function bindMicStage() {
  micStage.addEventListener("heckle", (e) => {
    // she reacts before the model has the two lines ready
    micStage.quip(bark("heckle"));
    openMic("heckle", e.detail);
  });
  micStage.addEventListener("settings", () => {
    saveSettings(settings);
    $("set-mic-room").value = settings.openmic.roomVolume;
    $("set-mic-room-val").textContent = settings.openmic.roomVolume;
  });
}

function clearDesk() {
  if (!conv.messages.length) return;
  if (!confirm(`Clear the ${desk.name} conversation? The memory jar and project files stay.`)) return;
  stopAll();
  conv.clear();
  renderTranscript();
}

function toggleTheme() {
  settings.theme = settings.theme === "paper" ? "district" : "paper";
  saveSettings(settings);
  $("set-theme").value = settings.theme;
  applyDeskTheme();
  renderHead();
}

function toggleAmbience() {
  settings.ambience = !settings.ambience;
  saveSettings(settings);
  $("set-ambience").checked = settings.ambience;
  if (settings.ambience) ambience.start();
  else ambience.stop();
  renderHead();
}

async function handoff(ask) {
  const list = await files.list(desk.id);
  const brief = buildClaudeBrief({ desk, prompt: deskPrompt(desk, settings, herPreset()), conversation: conv, memory, files: list, ask, brain: brain.status() });
  const ok = await copyText(brief);
  appendMessage(conv.push({ role: "tool", title: "handoff", content: `${ok ? "Copied" : "Could not copy; here is"} a brief for Claude Code (${brief.length} characters). Paste it into the terminal.\n\n<details><summary>the brief</summary>\n\n${brief}\n\n</details>` }));
  toast(ok ? "brief copied for Claude Code" : "clipboard refused; the brief is in the transcript", { error: !ok });
}

async function hermes(text) {
  const content = (text || "").trim() || stripThink(conv.lastAssistant()?.content || "");
  if (!content) return toast("Nothing to send.", { error: true });
  try {
    const n = await sendToHermes(settings.hermesWebhook, `**${desk.name} desk** · ${new Date().toLocaleString()}\n${content}`);
    toast(`sent to Hermes (${n} message${n > 1 ? "s" : ""})`);
  } catch (e) {
    toast(e.message, { error: true });
  }
}

async function webSearch(q) {
  q = (q || "").trim();
  if (!q) return toast("/search <query>", { error: true });
  if (!settings.searchModel) return appendMessage(conv.push({ role: "tool", title: "search", content: "No search model is set. Research runs offline unless Settings → Handoff, search, Mira names a LiteLLM model that can search the web (for example a Perplexity model registered on the lab's LiteLLM). Until then, paste the page text or use /url." }));
  if (brain.live !== "lab") return toast("Search needs the lab endpoint.", { error: true });
  const e = endpoints(settings.lab.url);
  const card = conv.push({ role: "tool", title: `search · ${q}`, content: "" });
  const el = appendMessage(card, { streaming: true });
  try {
    const r = await streamChat({
      chat: e.chat,
      apiKey: settings.lab.apiKey,
      model: settings.searchModel,
      messages: [
        { role: "system", content: "You are a web search tool. Return findings as markdown: a short summary, then a list of sources with titles, URLs and one line each. Only real, current sources." },
        { role: "user", content: q },
      ],
      signal: new AbortController().signal,
      onDelta: (t) => {
        card.content += t;
        renderMessage(el, card, { streaming: true });
      },
      maxTokens: 1200,
    });
    card.content = r.text || card.content;
    conv.save();
    renderMessage(el, card);
    addMsgTools(el, card);
  } catch (err) {
    card.content += `\n\n_search failed: ${err.message}_`;
    conv.save();
    renderMessage(el, card);
  }
}

async function fetchUrl(u) {
  if (!u) return toast("/url <address>", { error: true });
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  status(`fetching ${u}…`);
  try {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const ct = r.headers.get("content-type") || "";
    const blob = await r.blob();
    const name = (new URL(u).pathname.split("/").filter(Boolean).pop() || new URL(u).hostname) + (/pdf/.test(ct) ? ".pdf" : /html/.test(ct) ? ".html" : ".txt");
    await files.add([new File([blob], name, { type: ct })], desk.id);
    toast(`added ${name} to the desk's files`);
  } catch (e) {
    toast(`Could not fetch that page from the browser (${e.message}). Most sites do not allow cross-origin reads; paste the text, or save the page and drop the file.`, { error: true, ms: 8000 });
  } finally {
    status("");
  }
}

async function readMessage(m) {
  try {
    status(speech.ready ? "" : "loading the voice (Kokoro, once)…");
    await speech.speak(m.content, deskVoice(desk, settings));
    status("");
  } catch (e) {
    toast(`voice: ${e.message}`, { error: true });
    status("");
  }
}

// ------------------------------------------------------------------ composer

function autosize() {
  const t = $("input");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight + 2, innerHeight * 0.4) + "px";
}

let paletteIdx = 0;
function showPalette(prefix) {
  const list = commandsFor(desk.id).filter((c) => c.id.startsWith(prefix.toLowerCase()));
  const p = $("palette");
  if (!list.length) return hidePalette();
  paletteIdx = Math.min(paletteIdx, list.length - 1);
  p.innerHTML = list.map((c, i) => `<div class="${i === paletteIdx ? "on" : ""}" data-id="${c.id}"><code>${escapeHtml(c.usage)}</code><span>${escapeHtml(c.about)}</span></div>`).join("");
  p.hidden = false;
  p.querySelectorAll("div").forEach((d) =>
    d.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pickPalette(d.dataset.id);
    }),
  );
}

function hidePalette() {
  $("palette").hidden = true;
}

function pickPalette(id) {
  const c = findCommand(desk.id, id);
  if (!c) return;
  const needsArgs = /<|\[/.test(c.usage);
  $("input").value = `/${c.id}${needsArgs ? " " : ""}`;
  hidePalette();
  if (!needsArgs) send($("input").value);
  else $("input").focus();
}

function bindComposer() {
  const inp = $("input");
  inp.addEventListener("input", () => {
    autosize();
    const v = inp.value;
    inp.classList.toggle("cmd", v.startsWith("/"));
    if (v.startsWith("/") && !v.includes(" ") && !v.includes("\n")) showPalette(v.slice(1));
    else hidePalette();
  });
  inp.addEventListener("keydown", (e) => {
    const p = $("palette");
    if (!p.hidden) {
      const items = [...p.querySelectorAll("div")];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        paletteIdx = (paletteIdx + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        items.forEach((d, i) => d.classList.toggle("on", i === paletteIdx));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickPalette(items[paletteIdx]?.dataset.id);
        return;
      }
      if (e.key === "Escape") {
        hidePalette();
        return;
      }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send(inp.value);
    }
  });
  inp.addEventListener("paste", (e) => {
    const items = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith("image/"));
    if (!items.length) return;
    e.preventDefault();
    for (const it of items) addImage(it.getAsFile());
  });
  $("btn-send").addEventListener("click", () => send(inp.value));
  $("btn-stop").addEventListener("click", stopAll);
  $("btn-image").addEventListener("click", () => $("image-input").click());
  $("image-input").addEventListener("change", (e) => {
    for (const f of e.target.files) addImage(f);
    e.target.value = "";
  });
  // drop: images on the composer, documents on the transcript (both accepted in both places)
  for (const zone of [$("composer"), $("transcript")]) {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", async (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      const list = await droppedFiles(e.dataTransfer);
      const imgs = list.filter((f) => f.type.startsWith("image/"));
      const docs = list.filter((f) => !f.type.startsWith("image/"));
      for (const f of imgs) addImage(f);
      if (docs.length) {
        openDrawer("files");
        await files.add(docs, desk.id);
      }
    });
  }
  // the mic: hold for push-to-talk; tap toggles hands-free
  const mic = $("btn-mic");
  let held = false;
  mic.addEventListener("pointerdown", async (e) => {
    e.preventDefault();
    if (settings.voiceInput !== "ptt") return;
    held = true;
    mic.classList.add("held");
    mic.setPointerCapture?.(e.pointerId);
    try {
      status(voice.ready ? "" : "loading the ears (Silero + Moonshine, once)…");
      await voice.pttDown();
    } catch (err) {
      toast(`mic: ${err.message}`, { error: true });
      held = false;
      mic.classList.remove("held");
    }
  });
  const up = () => {
    if (settings.voiceInput === "ptt") {
      if (!held) return;
      held = false;
      mic.classList.remove("held");
      voice.pttUp();
    }
  };
  mic.addEventListener("pointerup", up);
  mic.addEventListener("pointercancel", up);
  mic.addEventListener("click", async () => {
    if (settings.voiceInput !== "vad") return;
    try {
      if (voice.listening) voice.stop();
      else {
        status(voice.ready ? "" : "loading the ears (Silero + Moonshine, once)…");
        await voice.start();
        status("listening…");
      }
    } catch (err) {
      toast(`mic: ${err.message}`, { error: true });
    }
  });
  mic.addEventListener("contextmenu", (e) => e.preventDefault());
}

async function droppedFiles(dt) {
  const out = [];
  const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const walk = async (entry, path = "") => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      if (/\.(pdf|docx|txt|md|markdown|json|html?|csv|gd|py|js|ts|png|jpe?g|webp|gif)$/i.test(f.name)) out.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, path + entry.name + "/");
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

async function addImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  if (!brain.canSee) toast("No brain is live to look at it yet; it will be sent with the next turn.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("not an image"));
      i.src = url;
    });
    const max = 1280;
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0, c.width, c.height);
    attachments.push({ name: file.name, dataUrl: c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.9), imageData: cx.getImageData(0, 0, c.width, c.height) });
    renderAttachments();
  } catch (e) {
    toast(e.message, { error: true });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderAttachments() {
  const host = $("attachments");
  host.innerHTML = "";
  attachments.forEach((a, i) => {
    const d = document.createElement("div");
    d.className = "att";
    d.innerHTML = `<img src="${a.dataUrl}" alt="" title="${escapeHtml(a.name)}" /><button title="remove">✕</button>`;
    d.querySelector("button").addEventListener("click", () => {
      attachments.splice(i, 1);
      renderAttachments();
    });
    host.appendChild(d);
  });
}

// ------------------------------------------------------------------ head

function bindHead() {
  // a tap opens the chip to two lines with the whole model name; another folds it (or it folds itself)
  let fold = 0;
  $("brain-chip").addEventListener("click", () => {
    const chip = $("brain-chip");
    chip.classList.toggle("open");
    renderChip();
    clearTimeout(fold);
    if (chip.classList.contains("open"))
      fold = setTimeout(() => {
        chip.classList.remove("open");
        renderChip();
      }, 6000);
  });
  $("btn-think").addEventListener("click", () => ctx().setThinking(!deskThinking(desk, settings)));
  $("btn-read").addEventListener("click", () => (speech.speaking ? speech.stop() : ctx().readLast()));
  $("btn-export").addEventListener("click", () => ctx().exportMd());
  $("btn-handoff").addEventListener("click", () => handoff(""));
  $("btn-hermes").addEventListener("click", () => hermes(""));
  $("btn-mira").addEventListener("click", () => toast(openCompanion(settings), { ms: 5000 }));
  $("btn-ambience").addEventListener("click", toggleAmbience);
  $("btn-theme").addEventListener("click", toggleTheme);
  $("btn-clear").addEventListener("click", clearDesk);
}

function bindKeys() {
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.querySelector("dialog[open]")) return;
      if (micStage?.open) {
        micStage.close();
        return;
      }
      if (!$("drawer").hidden && !brain.busy && !speech.speaking) {
        closeDrawer();
        return;
      }
      stopAll();
      status("");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && /^[1-8]$/.test(e.key) && DESKS[Number(e.key) - 1]) {
      e.preventDefault();
      selectDesk(DESKS[Number(e.key) - 1].id);
      return;
    }
    if (e.key === "/" && document.activeElement !== $("input") && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || "") && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      $("input").focus();
      $("input").value = "/";
      $("input").dispatchEvent(new Event("input"));
    }
  });
}

// ------------------------------------------------------------------ drawer

let drawerPop = null;

function closeDrawer() {
  $("drawer").hidden = true;
  $("drawer-backdrop").hidden = true;
  drawerTab = null;
  setRailMini();
  const p = drawerPop;
  drawerPop = null;
  p?.();
}

function openDrawer(tab) {
  const d = $("drawer");
  if (drawerTab === tab && !d.hidden) {
    closeDrawer();
    return;
  }
  drawerTab = tab;
  if (d.hidden) drawerPop = pushPanel("drawer", () => closeDrawer());
  d.hidden = false;
  $("drawer-backdrop").hidden = false;
  d.querySelectorAll(".tabs button[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  for (const p of d.querySelectorAll(".pane")) p.hidden = p.id !== `pane-${tab}`;
  setRailMini();
  if (tab === "files") renderFiles();
  if (tab === "memory") renderMemory();
  if (tab === "settings") renderSettings();
  if (tab === "diagnostics") renderDiag();
}

function setRailMini() {
  for (const [id, tab] of [["btn-files", "files"], ["btn-memory", "memory"], ["btn-settings", "settings"], ["btn-diag", "diagnostics"]]) $(id).classList.toggle("on", drawerTab === tab && !$("drawer").hidden);
}

function bindDrawer() {
  $("btn-files").addEventListener("click", () => openDrawer("files"));
  $("btn-memory").addEventListener("click", () => openDrawer("memory"));
  $("btn-settings").addEventListener("click", () => openDrawer("settings"));
  $("btn-diag").addEventListener("click", () => openDrawer("diagnostics"));
  $("btn-drawer-close").addEventListener("click", closeDrawer);
  $("drawer-backdrop").addEventListener("click", closeDrawer);
  $("drawer")
    .querySelectorAll(".tabs button[data-tab]")
    .forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.tab)));
  // files
  const drop = $("file-drop");
  drop.addEventListener("click", () => $("file-input").click());
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    await files.add(await droppedFiles(e.dataTransfer), desk.id);
  });
  $("btn-pick-files").addEventListener("click", () => $("file-input").click());
  $("btn-pick-dir").addEventListener("click", () => $("dir-input").click());
  $("file-input").accept = ACCEPT;
  for (const id of ["file-input", "dir-input"]) {
    $(id).addEventListener("change", async (e) => {
      const list = [...e.target.files].filter((f) => /\.(pdf|docx|txt|md|markdown|json|html?|csv|gd|py|js|ts)$/i.test(f.name));
      e.target.value = "";
      if (list.length) await files.add(list, desk.id);
      else toast("No readable files (.pdf .docx .txt .md .json .html)", { error: true });
    });
  }
  // memory
  $("btn-memory-add").addEventListener("click", () => {
    const t = $("memory-new").value.trim();
    if (!t) return;
    memory.add(t, desk.id);
    $("memory-new").value = "";
  });
  $("btn-memory-export").addEventListener("click", () => download(`memory-jar-${Date.now().toString(36)}.md`, memory.asMarkdown()));
  $("btn-memory-clear").addEventListener("click", () => {
    if (confirm("Empty the memory jar?")) memory.clear();
  });
}

async function renderFiles() {
  $("files-desk").textContent = desk.name;
  const list = await files.list(desk.id);
  const host = $("file-list");
  host.innerHTML = list.length ? "" : '<p class="fine">No files on this desk yet.</p>';
  for (const f of list) {
    const d = document.createElement("div");
    d.className = "file";
    d.innerHTML = `<span class="n" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span><span class="s">${f.words} w · ${f.chunks} ch${f.embedded ? " · vec" : ""}</span><button title="remove">✕</button>`;
    d.querySelector("button").addEventListener("click", () => files.remove(f.id));
    host.appendChild(d);
  }
}

function renderMemory() {
  const host = $("memory-list");
  host.innerHTML = memory.items.length ? "" : '<p class="fine">The jar is empty.</p>';
  for (const it of [...memory.items].reverse()) {
    const d = document.createElement("div");
    d.className = "jar";
    d.innerHTML = `<textarea rows="2"></textarea><div><button class="save" title="Save">✓</button><button class="del" title="Forget">✕</button></div>`;
    const ta = d.querySelector("textarea");
    ta.value = it.text;
    d.querySelector(".save").addEventListener("click", () => memory.update(it.id, ta.value));
    d.querySelector(".del").addEventListener("click", () => memory.remove(it.id));
    host.appendChild(d);
  }
}

async function renderDiag() {
  await renderDiagnostics($("diag"), { brain, settings, files, speech, voice });
}

// ------------------------------------------------------------------ settings

const VOICE_FALLBACK = { bf_emma: "Emma (British)", bf_isabella: "Isabella (British)", bm_george: "George (British)", bm_fable: "Fable (British)", af_heart: "Heart (American)", af_bella: "Bella (American, Mira)", af_nicole: "Nicole (American)", af_sarah: "Sarah (American)", am_michael: "Michael (American)", am_fenrir: "Fenrir (American)" };

function fillVoices() {
  const voices = Object.keys(speech.voices).length ? Object.fromEntries(Object.entries(speech.voices).map(([k, v]) => [k, `${v.name} · ${v.gender || ""} ${v.language || ""}`])) : VOICE_FALLBACK;
  for (const [id, current] of [
    ["set-voice-default", settings.voices.default],
    ["set-voice-mira", settings.voices.mira],
    ["set-desk-voice", settings.desks[desk.id]?.voice || ""],
  ]) {
    const sel = $(id);
    sel.innerHTML = id === "set-desk-voice" ? `<option value="">desk default (${desk.voice === "mira" || (settings.miraEverywhere !== false && settings.stage !== false) ? "Mira's voice" : "the reading voice"})</option>` : "";
    for (const [k, label] of Object.entries(voices)) {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = `${k} · ${label}`;
      sel.appendChild(o);
    }
    sel.value = current || "";
  }
}

function renderDeskSettings() {
  $("set-desk-name").textContent = desk.name;
  $("set-desk-thinking").checked = deskThinking(desk, settings);
  $("set-desk-autoread").checked = !!settings.desks[desk.id]?.autoRead;
  $("set-desk-prompt").value = deskPrompt(desk, settings, herPreset());
  fillVoices();
}

function renderSettings() {
  $("set-lab-url").value = settings.lab.url;
  $("set-lab-key").value = settings.lab.apiKey;
  $("set-lab-model").value = settings.lab.model;
  $("set-brain").value = settings.brain;
  $("set-thinkswitch").value = settings.thinkSwitch;
  $("set-temp").value = settings.temperature;
  $("set-temp-val").textContent = Number(settings.temperature).toFixed(2);
  $("set-maxtok").value = settings.maxTokens;
  $("set-turns").value = settings.contextTurns;
  $("set-tts-speed").value = settings.ttsSpeed;
  $("set-tts-speed-val").textContent = Number(settings.ttsSpeed).toFixed(2);
  $("set-tts-device").value = settings.ttsDevice === "cpu" ? "cpu" : "auto";
  $("set-tts-engine").value = settings.ttsEngine || "auto";
  $("set-qwen-url").value = settings.qwenUrl || "";
  renderQwenNote();
  $("set-voice-input").value = settings.voiceInput;
  $("set-sens").value = settings.sensitivity;
  $("set-sens-val").textContent = settings.sensitivity;
  $("set-stt").value = settings.sttModel;
  $("set-theme").value = settings.theme;
  $("set-stage").checked = settings.stage !== false;
  $("set-mira-everywhere").checked = settings.miraEverywhere !== false;
  $("set-stage-scene").checked = settings.stageScene !== false;
  $("set-stage-storm").checked = settings.stageStorm !== false;
  $("set-stage-smoke").checked = settings.stageSmoke !== false;
  $("set-mira-initiate").checked = settings.miraInitiate !== false;
  $("set-mira-barks").checked = settings.miraBarks !== false;
  $("set-mira-length").value = settings.miraLength || "auto";
  $("set-mira-persona").value = settings.miraPersona || "auto";
  $("set-mira-persona-note").textContent = personaNote();
  $("set-ambience").checked = !!settings.ambience;
  $("set-amb-vol").value = settings.ambienceVolume;
  $("set-amb-vol-val").textContent = settings.ambienceVolume;
  $("set-rain").checked = settings.rain !== false;
  $("set-hermes").value = settings.hermesWebhook;
  $("set-search-model").value = settings.searchModel;
  $("set-mira-url").value = settings.miraUrl;
  $("set-mic-room").value = settings.openmic.roomVolume;
  $("set-mic-room-val").textContent = settings.openmic.roomVolume;
  $("set-mic-rain").checked = settings.openmic.rain !== false;
  $("set-mic-inside").checked = settings.openmic.rainInside !== false;
  $("set-mic-video").value = settings.openmic.video || "auto";
  $("set-mic-room-on").checked = settings.openmic.room !== false;
  $("set-mic-bed").checked = !!settings.openmic.bed;
  $("set-mic-smoke").checked = settings.openmic.smoke !== false;
  $("set-mic-clean").checked = !!settings.desks.openmic?.clean;
  $("set-suno-longform").checked = !!settings.desks.suno?.longForm;
  $("set-mic-aspect").value = settings.openmic.aspect || "auto";
  renderDeskSettings();
  renderModels();
  renderNative();
  store.usage().then((u) => ($("storage-info").textContent = u ? `Using ${fmtBytes(u.usage)} of ${fmtBytes(u.quota)}.${u.persisted ? " Storage is persistent." : " Storage is not marked persistent; the browser may evict the models under pressure."}` : "Storage estimate unavailable."));
}

function renderModels() {
  const ids = brain.info.models || [];
  const dlist = $("models-datalist");
  dlist.innerHTML = ids.map((m) => `<option value="${escapeHtml(m)}"></option>`).join("");
  const host = $("models-list");
  host.hidden = !ids.length;
  host.innerHTML = ids.map((m) => `<div class="${m === settings.lab.model ? "on" : ""}" data-m="${escapeHtml(m)}">${escapeHtml(m)}</div>`).join("");
  host.querySelectorAll("div").forEach((d) =>
    d.addEventListener("click", () => {
      ctx().setModel(d.dataset.m);
      renderModels();
    }),
  );
}

function bindSettings() {
  const text = (id, fn) => $(id).addEventListener("input", (e) => fn(e.target.value));
  text("set-lab-url", (v) => {
    settings.lab.url = v.trim();
    saveSettings(settings);
  });
  text("set-lab-key", (v) => {
    settings.lab.apiKey = v.trim();
    saveSettings(settings);
  });
  text("set-lab-model", (v) => {
    settings.lab.model = v.trim();
    saveSettings(settings);
    brain.info.model = settings.lab.model;
    if (brain.live === "lab") renderChip();
  });
  $("btn-test").addEventListener("click", async () => {
    const out = $("test-result");
    out.className = "test-result";
    out.textContent = "testing…";
    const r = await brain.test();
    out.className = `test-result ${r.ok ? "ok" : "bad"}`;
    out.textContent = r.ok ? `OK · ${r.ms} ms · ${r.models.length} model${r.models.length === 1 ? "" : "s"}` : `Failed: ${r.error}`;
    if (r.ok && !settings.lab.model && r.models.length) {
      settings.lab.model = r.models[0];
      saveSettings(settings);
      $("set-lab-model").value = settings.lab.model;
    }
    renderModels();
    if (r.ok) {
      await brain.detect();
      renderChip();
    }
  });
  $("btn-detect").addEventListener("click", async () => {
    await brain.detect();
    renderChip();
    renderModels();
    toast(`brain: ${brain.live}`);
  });
  $("set-brain").addEventListener("change", (e) => ctx().setBrain(e.target.value));
  $("set-thinkswitch").addEventListener("change", (e) => {
    settings.thinkSwitch = e.target.value;
    saveSettings(settings);
  });
  $("set-temp").addEventListener("input", (e) => {
    settings.temperature = Number(e.target.value);
    $("set-temp-val").textContent = settings.temperature.toFixed(2);
    saveSettings(settings);
  });
  $("set-maxtok").addEventListener("change", (e) => {
    settings.maxTokens = Math.max(128, Number(e.target.value) || 2048);
    saveSettings(settings);
  });
  $("set-turns").addEventListener("change", (e) => {
    settings.contextTurns = Math.max(2, Number(e.target.value) || 24);
    saveSettings(settings);
  });
  // desk
  $("set-desk-thinking").addEventListener("change", (e) => ctx().setThinking(e.target.checked));
  $("set-desk-autoread").addEventListener("change", (e) => setDeskSetting(settings, desk.id, { autoRead: e.target.checked }));
  $("set-desk-voice").addEventListener("change", (e) => setDeskSetting(settings, desk.id, { voice: e.target.value || undefined }));
  let promptTimer = 0;
  $("set-desk-prompt").addEventListener("input", (e) => {
    clearTimeout(promptTimer);
    promptTimer = setTimeout(() => {
      const v = e.target.value;
      setDeskSetting(settings, desk.id, { prompt: v.trim() === defaultPrompt(desk, herPreset()).trim() ? undefined : v });
    }, 500);
  });
  $("btn-prompt-reset").addEventListener("click", () => {
    setDeskSetting(settings, desk.id, { prompt: undefined });
    $("set-desk-prompt").value = defaultPrompt(desk, herPreset());
    toast("prompt reset to the file");
  });
  // voice
  $("set-voice-default").addEventListener("change", (e) => {
    settings.voices.default = e.target.value;
    saveSettings(settings);
  });
  $("set-voice-mira").addEventListener("change", (e) => {
    settings.voices.mira = e.target.value;
    saveSettings(settings);
  });
  $("set-tts-speed").addEventListener("input", (e) => {
    settings.ttsSpeed = Number(e.target.value);
    $("set-tts-speed-val").textContent = settings.ttsSpeed.toFixed(2);
    speech.setSpeed(settings.ttsSpeed);
    saveSettings(settings);
  });
  $("set-tts-engine").addEventListener("change", (e) => {
    settings.ttsEngine = e.target.value;
    saveSettings(settings);
    speech.qwen.checkedAt = 0; // probe again on the next clip
    renderQwenNote();
  });
  $("set-qwen-url").addEventListener("change", (e) => {
    settings.qwenUrl = e.target.value.trim();
    saveSettings(settings);
    speech.qwen.checkedAt = 0;
    renderQwenNote();
  });
  $("set-tts-device").addEventListener("change", (e) => {
    settings.ttsDevice = e.target.value;
    saveSettings(settings);
    toast("takes effect after a reload");
  });
  $("set-voice-input").addEventListener("change", (e) => {
    settings.voiceInput = e.target.value;
    saveSettings(settings);
    voice.applySettings();
    $("btn-mic").title = settings.voiceInput === "vad" ? "Tap to listen hands-free; tap again to stop" : "Hold to talk";
  });
  $("set-sens").addEventListener("input", (e) => {
    settings.sensitivity = Number(e.target.value);
    $("set-sens-val").textContent = settings.sensitivity;
    saveSettings(settings);
    voice.applySettings();
  });
  $("set-stt").addEventListener("change", (e) => {
    settings.sttModel = e.target.value;
    saveSettings(settings);
  });
  // Mira
  $("set-stage").addEventListener("change", (e) => {
    settings.stage = e.target.checked;
    saveSettings(settings);
    applyDeskTheme();
    renderHead();
  });
  $("set-mira-everywhere").addEventListener("change", (e) => {
    settings.miraEverywhere = e.target.checked;
    saveSettings(settings);
    applyDeskTheme();
    fillVoices();
  });
  for (const [id, key] of [["set-stage-scene", "stageScene"], ["set-stage-storm", "stageStorm"], ["set-stage-smoke", "stageSmoke"], ["set-mira-initiate", "miraInitiate"], ["set-mira-barks", "miraBarks"]]) {
    $(id).addEventListener("change", (e) => {
      settings[key] = e.target.checked;
      saveSettings(settings);
      stage?.applySettings();
      ambience.apply();
    });
  }
  $("set-mira-length").addEventListener("change", (e) => {
    settings.miraLength = e.target.value;
    saveSettings(settings);
  });
  $("set-mira-persona").addEventListener("change", (e) => {
    settings.miraPersona = e.target.value;
    saveSettings(settings);
    $("set-mira-persona-note").textContent = personaNote();
    if (desk.id === "mira") {
      renderDeskSettings();
      $("empty-text").textContent = deskPrompt(desk, settings, herPreset()).split("\n").find((l) => l.trim()) || "";
    }
  });
  $("set-suno-longform").addEventListener("change", (e) => setDeskSetting(settings, "suno", { longForm: e.target.checked }));
  // look and sound
  $("set-theme").addEventListener("change", (e) => {
    settings.theme = e.target.value;
    saveSettings(settings);
    applyDeskTheme();
    renderHead();
  });
  $("set-ambience").addEventListener("change", (e) => {
    settings.ambience = e.target.checked;
    saveSettings(settings);
    if (settings.ambience) ambience.start();
    else ambience.stop();
    renderHead();
  });
  $("set-amb-vol").addEventListener("input", (e) => {
    settings.ambienceVolume = Number(e.target.value);
    $("set-amb-vol-val").textContent = settings.ambienceVolume;
    saveSettings(settings);
    ambience.apply();
  });
  $("set-rain").addEventListener("change", (e) => {
    settings.rain = e.target.checked;
    saveSettings(settings);
    ambience.apply();
  });
  // the open mic
  $("set-mic-room").addEventListener("input", (e) => {
    settings.openmic.roomVolume = Number(e.target.value);
    $("set-mic-room-val").textContent = settings.openmic.roomVolume;
    saveSettings(settings);
    micStage?.perf?.setRoomVolume(settings.openmic.roomVolume / 100);
  });
  $("set-mic-room-on").addEventListener("change", (e) => {
    settings.openmic.room = e.target.checked;
    saveSettings(settings);
    micStage?.perf?.setRoomEnabled(settings.openmic.room);
    const box = $("mic-room-on");
    if (box) box.checked = settings.openmic.room;
  });
  $("set-mic-video").addEventListener("change", (e) => {
    settings.openmic.video = e.target.value;
    saveSettings(settings);
    const sel = $("mic-video");
    if (sel) sel.value = settings.openmic.video;
  });
  $("set-mic-inside").addEventListener("change", (e) => {
    settings.openmic.rainInside = e.target.checked;
    saveSettings(settings);
    micStage?.perf?.setRainInside(settings.openmic.rainInside);
    const box = $("mic-rain-inside");
    if (box) box.checked = settings.openmic.rainInside;
  });
  $("set-mic-rain").addEventListener("change", (e) => {
    settings.openmic.rain = e.target.checked;
    saveSettings(settings);
    micStage?.perf?.setRain(settings.openmic.rain);
  });
  $("set-mic-smoke").addEventListener("change", (e) => {
    settings.openmic.smoke = e.target.checked;
    saveSettings(settings);
    micStage?.setSmoke(settings.openmic.smoke);
  });
  $("set-mic-bed").addEventListener("change", (e) => {
    settings.openmic.bed = e.target.checked;
    saveSettings(settings);
    micStage?.perf?.setBed(settings.openmic.bed);
  });
  $("set-mic-clean").addEventListener("change", (e) => setDeskSetting(settings, "openmic", { clean: e.target.checked }));
  $("set-mic-aspect").addEventListener("change", (e) => {
    settings.openmic.aspect = e.target.value;
    saveSettings(settings);
    if (micStage?.open) micStage.setAspect(settings.openmic.aspect);
  });
  $("btn-clear-audio").addEventListener("click", async () => {
    await store.wipeAudio().catch(() => {});
    toast("audio cache cleared");
  });
  // handoff
  text("set-hermes", (v) => {
    settings.hermesWebhook = v.trim();
    saveSettings(settings);
  });
  text("set-search-model", (v) => {
    settings.searchModel = v.trim();
    saveSettings(settings);
  });
  text("set-mira-url", (v) => {
    settings.miraUrl = v.trim();
    saveSettings(settings);
  });
  // hardware
  let lastRec = null;
  $("btn-probe").addEventListener("click", async () => {
    const info = $("hw-info");
    info.textContent = "probing…";
    const hw = await probeHardware();
    const labOk = brain.live === "lab" || (await brain.test()).ok;
    lastRec = recommend(hw, { labOk, models: brain.info.models, currentModel: settings.lab.model });
    info.textContent = [
      `platform ${hw.platform}${hw.mobile ? " (mobile)" : ""} · ${hw.cores ?? "?"} cores · memory ${hw.memoryGB ? `${hw.memoryGB} GB${hw.memoryGB >= 8 ? " or more (Chrome caps the number)" : ""}` : "unknown"}`,
      `gpu ${gpuName(hw.gpu)}${hw.gpu?.ok ? ` · fp16 ${hw.gpu.f16 ? "yes" : "no"} · max buffer ${hw.gpu.maxBufferGB} GB` : ""}`,
      `storage ${hw.storage ? `${hw.storage.usedGB} of ${hw.storage.quotaGB} GB` : "?"} · ${hw.online ? "online" : "offline"} · ${hw.secure ? "secure context" : "NOT a secure context"} · lab ${labOk ? "answered" : "no answer"}`,
      `recommended: brain ${lastRec.profile.brain} · model ${lastRec.profile.labModel || "-"} · on-device ${lastRec.profile.deviceDtype} · voice on ${lastRec.profile.ttsDevice === "cpu" ? "CPU" : "GPU"} · max tokens ${lastRec.profile.maxTokens}${lastRec.profile.thinkingDefault === false ? " · thinking off by default" : ""}`,
    ].join("\n");
    if (native.available()) {
      // inside the Android shell the plugin knows the SoC, the RAM and which server builds shipped; the PC host knows the card
      const pc = native.kind === "host";
      const label = pc ? "local runtime" : "in-app runtime";
      try {
        const d = await native.device();
        const gb = d.ram / 1073741824;
        if (pc) {
          const vgb = (d.vram || 0) / 1073741824;
          info.textContent += `\n${label}: ${d.device || ""} · ${d.soc || ""} · ${gb ? `${gb.toFixed(0)} GB RAM` : ""} · ${d.gpu ? `${d.gpu}${vgb ? ` (${vgb.toFixed(0)} GB)` : ""}` : "no NVIDIA card found"} · llama.cpp backends ${(d.backends || []).join(", ") || "none installed"}`;
          lastRec.notes.push(vgb ? `The local runtime puts a model of up to about ${(vgb * 0.8).toFixed(0)} GB whole on the card (${vgb.toFixed(0)} GB); a bigger one splits its layers with the CPU and the RAM (${gb.toFixed(0)} GB), slower.` : `The local runtime runs on the CPU, or through Vulkan on whatever card is here, out of the ${gb.toFixed(0)} GB of RAM: models under about ${(gb * 0.6).toFixed(0)} GB.`);
          if (!(d.backends || []).length) lastRec.notes.push("No llama-server on this PC yet: Settings → Local runtime installs llama.cpp's CUDA, Vulkan or CPU build.");
        } else {
          info.textContent += `\n${label}: ${d.device || ""} · ${d.soc || ""} · ${d.ram ? `${gb.toFixed(0)} GB RAM` : ""} · backends ${(d.backends || []).join(", ") || "none packed"}`;
          lastRec.notes.push(gb >= 20 ? "The in-app runtime can hold a 14B model at Q4 (about 9 GB) with room to spare; a 30B-A3B MoE (about 18 GB) fits and runs quickly for its size. Start with Qwen3-8B Q4_K_M." : gb >= 10 ? "The in-app runtime should stay at 7B to 8B models at Q4 (about 5 GB)." : "The in-app runtime should use models under 4 GB here.");
          if (!(d.backends || []).length) lastRec.notes.push("No llama-server binaries are packed into this APK yet; see docs/NATIVE.md.");
        }
      } catch (e) {
        info.textContent += `\n${label}: ${e.message}`;
      }
    }
    $("hw-notes").innerHTML = lastRec.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
    $("btn-apply-rec").hidden = false;
  });
  $("btn-apply-rec").addEventListener("click", async () => {
    if (!lastRec) return;
    const p = lastRec.profile;
    settings.brain = p.brain;
    settings.ttsDevice = p.ttsDevice === "cpu" ? "cpu" : "auto";
    settings.maxTokens = p.maxTokens;
    if (p.labModel) settings.lab.model = p.labModel;
    if (p.thinkingDefault === false) for (const d of DESKS) if (d.thinking) setDeskSetting(settings, d.id, { thinking: false });
    saveSettings(settings);
    renderSettings();
    renderHead();
    await brain.detect();
    renderChip();
    toast("recommended settings applied");
  });
  // storage
  $("btn-purge-models").addEventListener("click", async () => {
    if (!confirm("Delete all downloaded model files from this browser? They download again on next use.")) return;
    for (const name of ["transformers-cache", "kokoro-voices", "companion-voices", "workbench-runtime"]) {
      try {
        await caches.delete(name);
      } catch {
        /* ignore */
      }
    }
    toast("models deleted");
    renderSettings();
  });
  $("btn-delete-all").addEventListener("click", async () => {
    if (!confirm("Delete EVERYTHING this app keeps in this browser: conversations, the memory jar, project files, settings and cached models?")) return;
    stopAll();
    for (const k of Object.keys(localStorage)) if (k.startsWith("workbench.")) localStorage.removeItem(k);
    await store.wipe();
    try {
      for (const k of await caches.keys()) await caches.delete(k);
    } catch {
      /* ignore */
    }
    location.reload();
  });
}

// ------------------------------------------------------------------ native runtime (the Android shell)

/** Under the engine setting: whether the Qwen voice answers right now, and where from. */
async function renderQwenNote() {
  const el = $("set-qwen-note");
  const base = native.isApp() ? "Inside the app the runtime's llama-tts answers with the Qwen3-TTS model pair in Models (download it below, or push the 0.6B files); on the PC tools/qwen_tts_server.py serves her Bella clone." : "tools/qwen_tts_server.py on the PC serves her Bella clone (1.7B, on the GPU); Kokoro stays the fallback when it is not up.";
  if ((settings.ttsEngine || "auto") === "kokoro") {
    el.textContent = `Kokoro only. ${base}`;
    return;
  }
  el.textContent = `${base} Checking…`;
  speech.qwen.checkedAt = 0;
  const ok = await speech._qwenCheck().catch(() => false);
  el.textContent = `${base} Right now: ${ok ? `the Qwen voice answers (${speech.qwen.kind === "native" ? "in-app" : settings.qwenUrl})` : `not reachable${speech.qwen.error ? ` (${speech.qwen.error})` : ""}; Kokoro reads`}.`;
}

/** The runtime panel's words and controls for the runtime that is here: the phone's shell or the PC host. Once per kind. */
function applyRuntimeWording() {
  if (!native.available()) return;
  const pc = native.kind === "host";
  const fs = $("native-fieldset");
  if (fs.dataset.kind === (pc ? "pc" : "phone")) return;
  fs.dataset.kind = pc ? "pc" : "phone";
  $("native-legend").textContent = pc ? "Local runtime · llama.cpp on this PC" : "Native runtime · llama.cpp inside this app";
  $("nat-backend").innerHTML = pc
    ? '<option value="auto">Auto: CUDA (NVIDIA), then Vulkan (any card), then CPU</option><option value="cuda">CUDA (NVIDIA)</option><option value="vulkan">Vulkan</option><option value="cpu">CPU only</option>'
    : '<option value="auto">Auto: OpenCL (Adreno), then Vulkan, then CPU</option><option value="opencl">OpenCL (Adreno)</option><option value="vulkan">Vulkan</option><option value="cpu">CPU only</option>';
  $("nat-keepalive").closest("label").hidden = pc;
  $("nat-pc").hidden = !pc;
  $("nat-tts").hidden = pc;
  $("nat-pick").textContent = pc ? "Use a GGUF already on this PC…" : "Use a GGUF already on the phone";
  $("nat-dl-note").textContent = pc
    ? "One click downloads into the runtime's models folder and starts the server; an interrupted download resumes where it stopped when you click again. A GGUF already on a disk is used where it is: the button below, or paste its path in the box."
    : "One tap downloads into this app's storage and starts the server. Keep the app open while it downloads; an interrupted download resumes where it stopped when you tap again.";
  $("nat-pick-note").textContent = pc
    ? "A file picked on this PC is used where it is, not copied; Delete only forgets it. The server listens at http://127.0.0.1:8080/v1 with no key, so Mira in a browser tab on this PC can use it too."
    : "A file picked from the phone is copied into this app's storage (the server needs a plain path), so keep that much room free; the original can go afterwards.";
  const menuOpt = $("menu-brain").querySelector('option[value="native"]');
  if (menuOpt) menuOpt.textContent = pc ? "local" : "in-app";
  const setOpt = $("set-brain").querySelector('option[value="native"]');
  if (setOpt) setOpt.textContent = pc ? "Local runtime only (llama.cpp on this PC)" : "In-app runtime only (the Android app)";
  const autoOpt = $("set-brain").querySelector('option[value="auto"]');
  if (autoOpt) autoOpt.textContent = pc ? "Auto: the lab, then the local runtime, else on-device" : "Auto: the lab, then the in-app runtime, else on-device";
}

let natModels = [];
async function renderNative() {
  const fs = $("native-fieldset");
  if (!native.available()) {
    fs.hidden = true;
    return;
  }
  const pc = native.kind === "host";
  fs.hidden = false;
  applyRuntimeWording();
  $("nat-ctx").value = settings.native.ctx;
  $("nat-backend").value = settings.native.backend || "auto";
  if (!$("nat-backend").value) $("nat-backend").value = "auto"; // a backend kept from the other device (opencl on the PC, cuda on the phone) shows as auto
  $("nat-keepalive").checked = settings.native.keepAlive !== false;
  $("nat-loadmode").value = settings.native.loadMode || "auto";
  $("nat-cpumoe").value = settings.native.cpuMoe || "auto";
  try {
    const [dev, st, list] = await Promise.all([native.device().catch(() => null), native.status(), native.listModels()]);
    natModels = list.models || [];
    const gb = (b) => `${(b / 1073741824).toFixed(0)} GB`;
    $("nat-device").textContent = !dev
      ? ""
      : pc
        ? `${dev.device || "this PC"} · ${dev.soc || ""} · ${dev.ram ? `${gb(dev.ram)} RAM` : ""} · ${dev.gpu ? `${dev.gpu}${dev.vram ? ` (${gb(dev.vram)})` : ""}` : "no NVIDIA card found (Vulkan or the CPU then)"} · llama.cpp backends ${(dev.backends || []).join(", ") || "none installed yet"} · models in ${list.dir || dev.modelsDir || ""}`
        : `${dev.soc || "SoC ?"} · ${dev.ram ? `${gb(dev.ram)} RAM` : ""} · ${dev.gpu || ""} · backends ${(dev.backends || []).join(", ") || "?"}`;
    const sel = $("nat-model");
    // the brain list: a Qwen3-TTS pair (Mira's voice) is a model too, but not one to talk to
    const brains = natModels.filter((m) => !/tts/i.test(m.name));
    sel.innerHTML = brains.length ? "" : `<option value="">(no models ${pc ? "yet: download one below, or use one already on a disk" : "downloaded"})</option>`;
    for (const m of brains) {
      const o = document.createElement("option");
      o.value = m.name;
      o.textContent = `${m.name} · ${fmtBytes(m.size)}${m.linked ? " · on disk" : ""}`;
      o.title = m.path || "";
      sel.appendChild(o);
    }
    sel.value = settings.native.model && brains.some((m) => m.name === settings.native.model) ? settings.native.model : brains[0]?.name || "";
    renderPlan();
    if (pc) renderServers();
    else
      native
        .ttsStatus(settings.native.ttsModel || "")
        .then((t) => ($("nat-tts").textContent = t.ready ? `Mira's voice in-app: ${t.model}${t.backend ? ` · ${t.backend}` : ""} (Bella, cloned)` : `Mira's voice in-app: not ready (${t.error || "no Qwen3-TTS model pair in Models"}); Kokoro reads`))
        .catch((e) => ($("nat-tts").textContent = `Mira's voice in-app: ${e.message}`));
    $("nat-status").textContent = st.running
      ? `${st.phase === "starting" ? "starting" : "running"} · ${st.model} · ${st.backend || ""} · port ${st.port} · pid ${st.pid}${st.uptime ? ` · ${Math.round(st.uptime / 1000)} s` : ""}${st.foreground ? " · held up in the background" : ""}${st.exe ? ` · ${st.exe}` : ""}`
      : `stopped${st.error ? ` · ${st.error}` : ""}`;
    $("nat-log").textContent = (st.log || "").split("\n").slice(-12).join("\n");
    $("nat-start").hidden = !!st.running;
    $("nat-stop").hidden = !st.running;
    renderCatalog(natModels, dev);
  } catch (e) {
    $("nat-status").textContent = `${pc ? "runtime host" : "plugin"}: ${e.message}`;
  }
}

/** PC only: the llama-server builds found, which one auto takes, and the install buttons' labels. */
async function renderServers() {
  const el = $("nat-servers");
  try {
    const { builds, chosen } = await native.servers();
    const rows = builds.map((b) => `${b.how}${b.tag ? ` ${b.tag}` : b.version ? ` ${b.version}` : ""} (${b.backends.join(", ")}): ${b.dir}`);
    el.textContent = builds.length
      ? `llama-server builds on this PC (auto takes the first that carries the backend, CUDA before Vulkan before CPU): ${rows.join(" · ")}${Object.keys(chosen).length ? ` · chosen by hand: ${Object.entries(chosen).map(([k, v]) => `${k} → ${v}`).join(", ")}` : ""}`
      : "No llama-server on this PC yet. Install llama.cpp's own Windows build below (CUDA for an NVIDIA card, Vulkan for any other card, CPU when there is none), or point the runtime at a llama-server.exe you already have.";
    for (const b of ["cuda", "vulkan", "cpu"]) {
      const have = builds.find((x) => x.how === `installed (${b})`);
      $(`nat-install-${b}`).textContent = have ? `Update the ${b === "cpu" ? "CPU" : b === "cuda" ? "CUDA" : "Vulkan"} build (${have.tag || "installed"})` : `Install the ${b === "cpu" ? "CPU" : b === "cuda" ? "CUDA" : "Vulkan"} build`;
    }
  } catch (e) {
    el.textContent = `builds: ${e.message}`;
  }
}

function renderCatalog(have, dev) {
  const host = $("nat-catalog");
  host.innerHTML = "";
  const names = new Set((have || []).map((m) => m.name));
  const ramGB = dev?.ram ? dev.ram / 1073741824 : 0;
  for (const entry of CATALOG) {
    const parts = partsOf(entry);
    const done = parts.every((p) => names.has(p.file));
    const total = parts.reduce((a, p) => a + p.bytes, 0);
    const tight = ramGB && total / 1073741824 > ramGB * 0.6;
    const row = document.createElement("div");
    row.className = "file";
    row.innerHTML = `<span class="n"><b>${escapeHtml(entry.name)}</b>${entry.tag ? ` <span class="chip">${escapeHtml(entry.tag)}</span>` : ""}<br /><span class="s">${escapeHtml(entry.note)}${tight ? ` Likely too big for ${native.kind === "host" ? "this PC's" : "this phone's"} memory.` : ""}</span></span><span class="s">${fmtBytes(total)}</span><button ${done ? "" : 'class="primary"'}>${done ? "Use" : "Download"}</button>`;
    row.querySelector("button").addEventListener("click", () => (done ? (entry.voice ? useVoice(entry.file) : useModel(entry.file)) : downloadEntry(entry)));
    host.appendChild(row);
  }
}

/** A voice pair from the catalog: Mira's in-app Qwen voice, not the brain; the engine is asked again on the next clip. */
function useVoice(file) {
  settings.native.ttsModel = file;
  saveSettings(settings);
  speech.qwen.checkedAt = 0;
  toast(`Mira's in-app voice: ${file}`);
  renderNative();
  renderQwenNote();
}

async function useModel(file) {
  settings.native.model = file;
  saveSettings(settings);
  $("nat-status").textContent = `starting ${file}…`;
  try {
    await native.stop().catch(() => {});
    const r = await native.startPlanned(file, settings.native);
    settings.brain = "native"; // the one you clicked, lab or no lab; Stop puts auto back
    saveSettings(settings);
    await brain.detect();
    renderChip();
    status("");
    toast(`${native.kind === "host" ? "local" : "in-app"} runtime is up: ${file} · ${r.backend}${r.plan?.cpuMoe ? " · experts on the CPU" : ""}${r.plan?.load === "resident" ? " · in memory" : " · mapped"}`);
  } catch (e) {
    toast(`start: ${e.message}`, { error: true, ms: 9000 });
  }
  renderNative();
}

let downloading = false;
async function downloadEntry(entry) {
  if (downloading) return toast("A download is already running.", { error: true });
  downloading = true;
  try {
    for (const p of partsOf(entry)) {
      $("nat-status").textContent = `downloading ${p.file} (${fmtBytes(p.bytes)})…`;
      await native.download(p.url, p.file, (e) => {
        dl.progress({ model: "gguf", file: p.file, status: e.done ? "done" : "progress", loaded: e.loaded, total: e.total || p.bytes });
        $("nat-status").textContent = `downloading ${p.file} · ${fmtBytes(e.loaded)} of ${fmtBytes(e.total || p.bytes)}`;
      });
    }
    toast(`downloaded ${entry.name}`);
    if (entry.voice) useVoice(entry.file);
    else await useModel(entry.file);
  } catch (e) {
    toast(`download: ${e.message}. Tap again to resume.`, { error: true, ms: 9000 });
    renderNative();
  } finally {
    downloading = false;
  }
}

/** Under the model picker: how the picked model would start on this phone (the header is read once per model). */
async function renderPlan() {
  const el = $("nat-plan");
  const model = $("nat-model").value;
  if (!model) {
    el.textContent = "";
    return;
  }
  el.textContent = "reading the model…";
  try {
    const p = await native.plan(model, settings.native);
    if ($("nat-model").value !== model) return; // picked another one meanwhile
    el.textContent = `${p.summary}.${p.notes.length ? ` ${p.notes.join(" ")}` : ""}`;
  } catch (e) {
    el.textContent = `plan: ${e.message}`;
  }
}

/** A path typed into the download box instead of a URL: an absolute Windows or POSIX path ending in .gguf (the PC host uses it in place). */
const looksLikePath = (t) => /\.gguf$/i.test(t) && (/^[a-zA-Z]:[\\/]/.test(t) || t.startsWith("\\\\") || t.startsWith("/"));

function bindNative() {
  if (!native.available()) return;
  const pc = native.kind === "host";
  $("nat-model").addEventListener("change", (e) => {
    settings.native.model = e.target.value;
    saveSettings(settings);
    renderPlan();
  });
  $("nat-loadmode").addEventListener("change", (e) => {
    settings.native.loadMode = e.target.value;
    saveSettings(settings);
    renderPlan();
  });
  $("nat-cpumoe").addEventListener("change", (e) => {
    settings.native.cpuMoe = e.target.value;
    saveSettings(settings);
    renderPlan();
  });
  $("nat-ctx").addEventListener("change", (e) => {
    settings.native.ctx = Math.max(2048, Number(e.target.value) || 32768);
    saveSettings(settings);
    renderPlan();
  });
  $("nat-backend").addEventListener("change", (e) => {
    settings.native.backend = e.target.value;
    saveSettings(settings);
    renderPlan();
  });
  $("nat-keepalive").addEventListener("change", (e) => {
    settings.native.keepAlive = e.target.checked;
    saveSettings(settings);
    toast(settings.native.keepAlive ? "the next start holds the server up in the background" : "the next start stops the server with the app");
  });
  $("nat-start").addEventListener("click", async () => {
    $("nat-status").textContent = "starting…";
    try {
      await native.startPlanned($("nat-model").value, settings.native);
      settings.brain = "native"; // you asked for this one: the lab, if it answers too, steps aside until Stop
      saveSettings(settings);
      await brain.detect();
      renderChip();
    } catch (e) {
      toast(`start: ${e.message}`, { error: true, ms: 9000 });
    }
    renderNative();
  });
  $("nat-stop").addEventListener("click", async () => {
    await native.stop().catch((e) => toast(e.message, { error: true }));
    if (settings.brain === "native") {
      settings.brain = "auto";
      saveSettings(settings);
    }
    await brain.detect();
    renderChip();
    renderNative();
  });
  $("nat-refresh").addEventListener("click", renderNative);
  // progress right under the buttons (the status line at the top of the fieldset is off screen on a phone), plus the download panel
  const dlStatus = (text, frac = null) => {
    $("nat-dl-status").textContent = text || "";
    const bar = $("nat-dl-bar");
    bar.hidden = frac == null;
    bar.firstElementChild.style.width = `${Math.round(Math.max(0, Math.min(1, frac || 0)) * 100)}%`;
  };
  const report = (name, p, copy = false) => {
    dl.progress({ model: "gguf", file: name, status: p.done ? "done" : "progress", loaded: p.loaded, total: p.total });
    const frac = p.total > 0 ? p.loaded / p.total : null;
    if (p.done) dlStatus(`${name} · ${copy ? "copied in" : "downloaded"} · ${fmtBytes(p.loaded)}`, 1);
    else dlStatus(`${copy ? "copying" : "downloading"} ${name} · ${fmtBytes(p.loaded)}${frac != null ? ` of ${fmtBytes(p.total)} · ${Math.round(frac * 100)}%` : ""}`, frac);
  };
  $("nat-download").addEventListener("click", async () => {
    let url = $("nat-url").value.trim().replace(/^"|"$/g, "");
    if (!url) return toast(pc ? "Paste a GGUF URL, or the path of a .gguf on this PC, first." : "Paste a GGUF URL first.", { error: true });
    if (pc && looksLikePath(url)) {
      // a file already on a disk: used where it is
      try {
        const r = await native.linkModel(url);
        settings.native.model = r.name;
        saveSettings(settings);
        dlStatus(`${r.name} · on disk · ${fmtBytes(r.size)}`);
        toast(`added ${r.name}`);
      } catch (e) {
        dlStatus(`could not add the file: ${e.message}`);
        toast(`file: ${e.message}`, { error: true, ms: 8000 });
      }
      renderNative();
      return;
    }
    url = url.replace(/\/blob\//, "/resolve/"); // a Hugging Face page link, not the file itself
    const name = decodeURIComponent(url.split("/").pop().split("?")[0]);
    if (!/\.gguf$/i.test(name)) return toast("The link should end in .gguf (on Hugging Face, the file's download link).", { error: true });
    dlStatus(`connecting for ${name}…`, 0);
    $("nat-download").disabled = true;
    try {
      await native.download(url, name, (p) => report(name, p));
      settings.native.model = name;
      saveSettings(settings);
      toast(`downloaded ${name}`);
    } catch (e) {
      dlStatus(`download failed: ${e.message}`);
      toast(`download: ${e.message}`, { error: true });
    }
    $("nat-download").disabled = false;
    renderNative();
  });
  $("nat-pick").addEventListener("click", async () => {
    dlStatus(pc ? "pick a .gguf on this PC (the file dialog may open behind this window: look for it on the taskbar)…" : "pick a .gguf on the phone…");
    $("nat-pick").disabled = true;
    try {
      const r = await native.pickModel((p) => report(p.name || "model", p, true));
      if (r?.name) {
        settings.native.model = r.name;
        saveSettings(settings);
        if (pc) dlStatus(`${r.name} · on disk · ${fmtBytes(r.size)}`);
        toast(`added ${r.name}`);
      } else dlStatus("");
    } catch (e) {
      dlStatus(`could not add the file: ${e.message}`);
      toast(`file: ${e.message}`, { error: true });
    }
    $("nat-pick").disabled = false;
    renderNative();
  });
  $("nat-delete").addEventListener("click", async () => {
    const name = $("nat-model").value;
    if (!name) return;
    const m = natModels.find((x) => x.name === name);
    const q = pc ? (m?.linked ? `Forget ${name}? The file stays where it is (${m.path}).` : `Delete ${name} from the runtime's models folder?`) : `Delete ${name} from the phone?`;
    if (!confirm(q)) return;
    await native.deleteModel(name).catch((e) => toast(e.message, { error: true }));
    renderNative();
  });
  if (!pc) return;
  // ---- the PC host: llama.cpp's builds
  const instStatus = (text, frac = null) => {
    $("nat-inst-status").textContent = text || "";
    const bar = $("nat-inst-bar");
    bar.hidden = frac == null;
    bar.firstElementChild.style.width = `${Math.round(Math.max(0, Math.min(1, frac || 0)) * 100)}%`;
  };
  const busy = (on) => {
    for (const id of ["nat-install-cuda", "nat-install-vulkan", "nat-install-cpu", "nat-pick-server"]) $(id).disabled = on;
  };
  const LABEL = { cuda: "CUDA (NVIDIA)", vulkan: "Vulkan (any card)", cpu: "CPU only" };
  const SIZE = { cuda: "about 650 MB, the CUDA runtime included", vulkan: "about 30 MB", cpu: "about 20 MB" };
  for (const b of ["cuda", "vulkan", "cpu"]) {
    $(`nat-install-${b}`).addEventListener("click", async () => {
      if (!confirm(`Download llama.cpp's latest ${LABEL[b]} build for Windows from GitHub (${SIZE[b]}) into the runtime's folder? A build already installed for it is replaced.`)) return;
      busy(true);
      instStatus("asking GitHub for the latest release…", 0);
      try {
        const r = await native.installServer(b, (i) => {
          const frac = i.total ? i.loaded / i.total : null;
          const verb = i.phase === "unzip" ? "unpacking" : i.phase === "release" ? "asking GitHub for the release" : "downloading";
          instStatus(`${verb} ${i.file || ""}${i.tag ? ` (${i.tag})` : ""}${i.phase === "download" && i.total ? ` · ${fmtBytes(i.loaded)} of ${fmtBytes(i.total)} · ${Math.round(frac * 100)}%` : ""}`, i.phase === "download" ? frac : null);
        });
        instStatus(`installed llama.cpp ${r.tag} (${b}) in ${r.dir}`, 1);
        toast(`llama.cpp ${r.tag} (${b}) installed`);
      } catch (e) {
        instStatus(`install failed: ${e.message}`);
        toast(`install: ${e.message}`, { error: true, ms: 9000 });
      }
      busy(false);
      renderNative();
    });
  }
  $("nat-pick-server").addEventListener("click", async () => {
    instStatus("pick llama-server.exe (the file dialog may open behind this window)…");
    busy(true);
    try {
      const r = await native.pickServer("auto");
      if (r?.path) {
        instStatus(`llama-server for ${r.backend} (carries ${r.backends.join(", ")}): ${r.path}`);
        toast(`llama-server for ${r.backend}: ${r.path}`);
      } else instStatus("");
    } catch (e) {
      instStatus(`could not use that file: ${e.message}`);
      toast(e.message, { error: true, ms: 8000 });
    }
    busy(false);
    renderNative();
  });
  $("nat-open-folder").addEventListener("click", () => native.openFolder("models").catch((e) => toast(e.message, { error: true })));
}

// ------------------------------------------------------------------ sprites

let sheet = null;
let measured = null;
let manifest = null;

function openSprite(file = null) {
  const d = $("sprite-dialog");
  d.showModal();
  if (file) loadSprite(file);
}

function bindSprite() {
  const d = $("sprite-dialog");
  $("sprite-close").addEventListener("click", () => d.close());
  const drop = $("sprite-drop");
  drop.addEventListener("click", () => $("sprite-input").click());
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer.files?.[0];
    if (f) loadSprite(f);
  });
  $("sprite-input").addEventListener("change", (e) => {
    if (e.target.files[0]) loadSprite(e.target.files[0]);
    e.target.value = "";
  });
  $("sp-remeasure").addEventListener("click", () => measure({ frameW: Number($("sp-fw").value) || undefined, frameH: Number($("sp-fh").value) || undefined }));
  $("sp-scale").addEventListener("change", () => measured && drawOverlay($("sprite-canvas"), sheet.img, measured, Number($("sp-scale").value)));
  $("sp-draft").addEventListener("click", () => showManifest(buildManifest($("sp-name").value || sheet.name, measured, null)));
  $("sp-ask").addEventListener("click", askVision);
  $("sp-download").addEventListener("click", () => manifest && download(`${(manifest.meta.character || "sprite").replace(/[^a-z0-9_-]+/gi, "_")}.json`, JSON.stringify(manifest, null, 1), "application/json"));
  $("sp-copy").addEventListener("click", () => manifest && copyText(JSON.stringify(manifest, null, 1)).then(() => toast("manifest copied")));
}

async function loadSprite(file) {
  try {
    sheet = await loadSheet(file);
    $("sprite-grid").hidden = false;
    $("sp-name").value = file.name.replace(/\.[^.]+$/, "");
    const big = Math.max(sheet.data.width, sheet.data.height);
    $("sp-scale").value = big > 2400 ? "0.25" : big > 1200 ? "0.5" : big < 400 ? "2" : "1";
    measure({});
  } catch (e) {
    toast(e.message, { error: true });
  }
}

function measure(force) {
  measured = measureSheet(sheet.data, force);
  $("sp-fw").value = measured.frameW;
  $("sp-fh").value = measured.frameH;
  drawOverlay($("sprite-canvas"), sheet.img, measured, Number($("sp-scale").value));
  $("sprite-measure").textContent = `${measured.width}×${measured.height} px · frame ${measured.frameW}×${measured.frameH} (${measured.confidence.x} / ${measured.confidence.y}) · ${measured.columns}×${measured.rows} = ${measured.frames.length} frames, ${measured.emptyFrames} empty · character ${measured.characterWidth}×${measured.characterHeight} px, feet on y=${measured.feetY} · ${measured.hasAlpha ? "alpha" : "keyed on the corner colour"}`;
  $("sp-status").textContent = "Measured. Ask the vision model to name the clips, or draft a manifest from the grid alone.";
  manifest = null;
  $("sp-json").textContent = "";
}

function showManifest(m) {
  manifest = m;
  $("sp-json").textContent = JSON.stringify(m, null, 1);
}

async function askVision() {
  if (!measured) return;
  if (!brain.canSee) return toast("No brain is live to look at it.", { error: true });
  const st = $("sp-status");
  st.textContent = "asking the vision model…";
  const t = thumbnail(sheet.img, 1024);
  let reply = "";
  try {
    const r = await brain.chat({
      messages: [
        { role: "system", content: "You read sprite sheets for a pixel-art game. Answer with JSON only." },
        { role: "user", content: visionPrompt(sheet.name, measured) },
      ],
      images: [t],
      thinking: false,
      maxTokens: 1500,
      onDelta: (d) => {
        reply += d;
        st.textContent = `reading… ${reply.length} chars`;
      },
    });
    reply = r.text || reply;
    const vision = parseVisionJson(reply);
    if (!vision) {
      st.textContent = "The model did not return JSON; drafted from the grid instead. Its reply is in the transcript.";
      appendMessage(conv.push({ role: "tool", title: "sprite inspector", content: reply }));
      showManifest(buildManifest($("sp-name").value || sheet.name, measured, null));
      return;
    }
    showManifest(buildManifest($("sp-name").value || sheet.name, measured, vision));
    st.textContent = `${Object.keys(manifest.clips).length} clips named. ${vision.notes ? `Notes: ${vision.notes}` : ""} Check them against the sheet.`;
    appendMessage(conv.push({ role: "tool", title: `sprite inspector · ${sheet.name}`, content: `**${vision.character || sheet.name}** · ${measured.columns}×${measured.rows} frames of ${measured.frameW}×${measured.frameH}\n\n${vision.notes ? `_${vision.notes}_\n\n` : ""}\`\`\`json\n${JSON.stringify(manifest, null, 1)}\n\`\`\`` }));
  } catch (e) {
    st.textContent = `failed: ${e.message}`;
  }
}

// ------------------------------------------------------------------ go

// For tools/ui_check.mjs and the console.
window.__wb = {
  send,
  selectDesk,
  herPreset,
  deskPromptNow: () => deskPrompt(desk, settings, herPreset()),
  addImage,
  openSprite,
  initiate: () => maybeInitiate(true),
  openMic,
  suno,
  lastSet,
  parseSet,
  modelAlias,
  quickReaction,
  classify,
  topPanel,
  closeTop,
  get micStage() {
    return micStage;
  },
  /** For tools/ui_check.mjs: a voice that needs no model, a short tone per line; `delayMs` makes it slow, like the phone's Qwen, so the buffering shows. */
  fakeVoice(delayMs = 0) {
    const p = micStage?.perf;
    if (!p) return false;
    p.synth = async (line) => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const n = Math.round(24000 * Math.min(1.2, 0.25 + line.spoken.length * 0.012));
      const s = new Float32Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.sin((i / 24000) * 2 * Math.PI * 220) * 0.2 * Math.min(1, (n - i) / 2400) * Math.min(1, i / 600);
      return { samples: s, sampleRate: 24000 };
    };
    return true;
  },
  get stage() {
    return stage;
  },
  brain,
  native,
  settings,
  files,
  memory,
  speech,
  voice,
  get desk() {
    return desk;
  },
  get conv() {
    return conv;
  },
};

main().catch((e) => {
  console.error(e);
  status(`Failed to start: ${e.message}`, true);
});
addEventListener("error", (e) => status(`${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`, true));
addEventListener("unhandledrejection", (e) => status(`unhandled: ${e.reason?.message || e.reason}`, true));
