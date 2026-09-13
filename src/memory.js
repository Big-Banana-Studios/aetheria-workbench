// The memory jar: a small list of notes kept between sessions and injected
// into every desk's system prompt. The user saves with /remember or the
// Memory tab; on her own desk Mira saves too, with a `[jar: …]` line at the
// end of a reply that takeJar() strips before the reply is shown or spoken
// (a "jarred" chip marks the message instead; prompts/mira-core.md has her
// rules for what goes in). Every line can be edited or deleted in the
// drawer. Text only, localStorage. The tag parser and the protocol text are
// pure, so tools/smoke.mjs can import them without a DOM.

const KEY = "workbench.memory";
const MAX_HER_NOTE = 240; // two short lines, as her rules say

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export class MemoryJar extends EventTarget {
  constructor() {
    super();
    this.items = [];
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      this.items = raw ? JSON.parse(raw).filter((x) => x && typeof x.text === "string") : [];
    } catch {
      this.items = [];
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.items));
    } catch (e) {
      console.warn("memory not saved", e);
    }
    this.dispatchEvent(new Event("change"));
  }

  /** True when a note saying the same thing is already in the jar. */
  has(text) {
    const n = norm(text);
    return !!n && this.items.some((x) => norm(x.text) === n);
  }

  /** Add a note; `by` is "user" (the default) or "mira" (her own save, capped at two short lines). Returns the item, or null for an empty or repeated note. */
  add(text, desk = null, { by = "user" } = {}) {
    let t = String(text || "").trim();
    if (by === "mira") t = t.replace(/\s+/g, " ").slice(0, MAX_HER_NOTE).trim();
    if (!t || this.has(t)) return null;
    const item = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: t, desk, t: Date.now(), by };
    this.items.push(item);
    this.save();
    return item;
  }

  update(id, text) {
    const it = this.items.find((x) => x.id === id);
    if (!it) return;
    it.text = String(text).trim();
    this.save();
  }

  remove(id) {
    this.items = this.items.filter((x) => x.id !== id);
    this.save();
  }

  clear() {
    this.items = [];
    this.save();
  }

  /** The block that goes into every system prompt. */
  asPrompt() {
    if (!this.items.length) return "";
    return "## Memory jar (kept between sessions: notes the user saved, and ones Mira jarred herself)\nContext, not a script: use it, never recite it, never announce it.\n" + this.items.map((x) => `- ${x.text}`).join("\n");
  }

  asMarkdown() {
    return `# Memory jar\n\n${this.items.map((x) => `- ${x.text}  \n  _${new Date(x.t).toLocaleString()}${x.desk ? ` · ${x.desk}` : ""}${x.by === "mira" ? " · by Mira" : ""}_`).join("\n")}\n`;
  }
}

/** Her save, as the model writes it: a line `[jar: the note]` at the end of a reply. */
export const JAR_TAG = /\[jar:\s*([^\]\n]{1,240})\]/gi;

/**
 * Split her `[jar: …]` lines out of a reply: {text, notes, pending}.
 * `pending` is true while an unfinished tag is still streaming at the end,
 * so the transcript never shows half of one.
 */
export function takeJar(raw) {
  const notes = [];
  let text = String(raw || "").replace(JAR_TAG, (_, n) => {
    const t = n.replace(/\s+/g, " ").trim();
    if (t) notes.push(t);
    return "";
  });
  const open = /\[jar:[^\]]*$/i.exec(text);
  if (open) text = text.slice(0, open.index);
  text = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { text, notes, pending: !!open };
}

/** What her desk is told about the jar, after the persona (which carries her own rules for it). */
export const JAR_PROTOCOL = `Memory jar. To save something to the jar, put it on its own line at the very end of the reply as [jar: the note], one note at most per reply and two short lines at most, and never mention that you saved it: the line is removed before the reply is shown or spoken and a small "jarred" chip appears on the message. Save what keeps the flow alive: what we're working on, decisions made, names, running jokes, what they told you they want next. Never health details, money details, or anything they'd wince to see in a settings page. Most replies save nothing. Read the jar above before you speak and pick up where we were, like a friend who remembers, not a receptionist reading a file.`;
