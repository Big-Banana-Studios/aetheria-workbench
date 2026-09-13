// Conversations - one per desk, text only, in localStorage - and the
// transcript rendering: markdown (marked, sanitised), code blocks with a copy
// button, LaTeX (KaTeX auto-render), think blocks folded into a <details>.

import { marked } from "marked";
import DOMPurify from "dompurify";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";

marked.setOptions({ gfm: true, breaks: false });

const MAX_MESSAGES = 400;

/** @typedef {{id:string, role:"user"|"assistant"|"tool"|"mira", content:string, reasoning?:string, images?:number, t:number, stats?:object, interrupted?:boolean, title?:string, mood?:string}} Msg */

export class Conversation {
  constructor(deskId) {
    this.deskId = deskId;
    this.key = `workbench.chat.${deskId}`;
    /** @type {Msg[]} */
    this.messages = [];
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      this.messages = raw ? JSON.parse(raw).filter((m) => m && m.role && typeof m.content === "string") : [];
    } catch {
      this.messages = [];
    }
  }

  save() {
    try {
      if (this.messages.length > MAX_MESSAGES) this.messages = this.messages.slice(-MAX_MESSAGES);
      // text only: never an image, never a data URL
      localStorage.setItem(this.key, JSON.stringify(this.messages.map(({ id, role, content, reasoning, images, t, stats, interrupted, title, mood, kind, lint, draft, notes, jarred, target, voice, rows }) => ({ id, role, content, reasoning, images, t, stats, interrupted, title, mood, kind, lint, draft, notes, jarred, target, voice, rows }))));
    } catch (e) {
      console.warn("conversation not saved", e);
    }
  }

  push(msg) {
    const m = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), ...msg };
    this.messages.push(m);
    this.save();
    return m;
  }

  clear() {
    this.messages = [];
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }

  lastAssistant() {
    for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i].role === "assistant") return this.messages[i];
    return null;
  }

  /**
   * The turns that go to the model: the last N, tool cards folded in as
   * assistant text so the model knows what the user has already seen.
   */
  context(limit = 24) {
    return this.messages
      .slice(-limit)
      .filter((m) => m.content && m.content.trim())
      .map((m) => ({
        role: m.role === "tool" || m.role === "mira" ? "assistant" : m.role,
        content: m.role === "tool" ? `[tool result shown to the user]\n${m.content}` : m.role === "mira" ? `(Mira, aside, unprompted: "${m.content}")` : m.content,
      }));
  }

  asMarkdown(deskName) {
    const lines = [`# ${deskName} · ${new Date().toLocaleString()}`, ""];
    for (const m of this.messages) {
      const who = m.role === "user" ? "**You**" : m.role === "tool" ? `**Tool**${m.title ? ` · ${m.title}` : ""}` : m.role === "mira" ? "**Mira**" : "**Desk**";
      lines.push(`${who} _(${new Date(m.t).toLocaleTimeString()})_`, "");
      if (m.reasoning) lines.push("<details><summary>thinking</summary>", "", m.reasoning, "", "</details>", "");
      lines.push(m.content + (m.interrupted ? " —" : ""), "");
    }
    return lines.join("\n");
  }
}

export function renderMarkdown(text) {
  const html = marked.parse(String(text || ""));
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
}

/** The Open Mic desk's inline pose tags, shown as small badges instead of literal braces. */
export function poseHtml(text) {
  const badge = (t) => `<span class="pose ${t.toLowerCase()}" title="stage direction: ${t.toLowerCase()}">${t.toLowerCase()}</span>`;
  return String(text || "")
    .replace(/\{(pace|lean|shriek|deadpan|aside)\s*:\s*([^{}]+?)\s*\}/gi, (m, t, remark) => `${badge(t)}${remark}`) // the inline form: the remark rides inside the braces
    .replace(/\{(pace|lean|shriek|deadpan|aside)\+?\}/gi, (m, t) => badge(t));
}

const POSE_KINDS = new Set(["set", "heckle", "punchup"]);

/** Copy buttons on code blocks, links in new tabs, LaTeX rendered. */
export function decorate(el) {
  el.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector("button.copy")) return;
    const b = document.createElement("button");
    b.className = "copy";
    b.type = "button";
    b.textContent = "copy";
    b.addEventListener("click", () => {
      const code = pre.querySelector("code")?.textContent ?? pre.textContent;
      navigator.clipboard?.writeText(code).then(
        () => {
          b.textContent = "copied";
          setTimeout(() => (b.textContent = "copy"), 1200);
        },
        () => (b.textContent = "no clipboard"),
      );
    });
    pre.appendChild(b);
  });
  el.querySelectorAll("a[href]").forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener";
  });
  try {
    renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    });
  } catch {
    /* KaTeX is decoration */
  }
}

/**
 * Build or update one transcript entry.
 * @param {HTMLElement} el the .msg element (created if null)
 * @param {Msg} m
 */
export function renderMessage(el, m, { streaming = false } = {}) {
  if (!el) {
    el = document.createElement("article");
    el.className = `msg ${m.role}`;
    el.dataset.id = m.id;
    el.innerHTML = `<div class="who"></div><details class="think" hidden><summary>thinking</summary><div class="think-body"></div></details><div class="body"></div><div class="meta"></div>`;
  }
  el.classList.toggle("streaming", streaming);
  el.querySelector(".who").textContent = m.role === "user" ? "you" : m.role === "tool" ? `tool${m.title ? ` · ${m.title}` : ""}` : m.role === "mira" ? `mira${m.title ? ` · ${m.title}` : ""}` : "desk";
  const think = el.querySelector(".think");
  if (m.reasoning) {
    think.hidden = false;
    const tb = think.querySelector(".think-body");
    tb.textContent = m.reasoning;
    if (streaming && !m.content) think.open = true;
    else if (!streaming) think.open = false;
  } else think.hidden = true;
  const body = el.querySelector(".body");
  if (m.role === "user") {
    body.textContent = m.content;
    if (m.images) body.textContent = `${"📷 ".repeat(Math.min(m.images, 3))}${m.content}`;
  } else {
    const src = m.content || (streaming ? "" : "…");
    body.innerHTML = renderMarkdown(POSE_KINDS.has(m.kind) ? poseHtml(src) : src);
    if (!streaming) decorate(body);
  }
  if (m.interrupted) body.insertAdjacentHTML("beforeend", '<span class="cut"> — stopped</span>');
  const meta = el.querySelector(".meta");
  const bits = [];
  if (m.stats?.tokPerSec) bits.push(`${m.stats.tokPerSec} tok/s`);
  if (m.stats?.firstTokenMs != null) bits.push(`first token ${m.stats.firstTokenMs} ms`);
  if (m.stats?.brain) bits.push(m.stats.brain);
  meta.textContent = bits.join(" · ");
  if (m.jarred?.length) {
    // she put something in the memory jar on this turn: the chip, never an announcement in the text
    const chip = document.createElement("span");
    chip.className = "jarred";
    chip.title = `In the memory jar, by Mira:\n${m.jarred.join("\n")}`;
    chip.textContent = "jarred";
    if (bits.length) meta.append(" · ");
    meta.append(chip);
  }
  return el;
}
