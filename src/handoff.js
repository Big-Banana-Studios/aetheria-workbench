// Handoff: "send to Claude Code" copies a well-formed brief with the desk's
// context attached; "send to Hermes" posts to a Discord webhook if one is set.

import { stripThink } from "./think.js";

/**
 * @param {{desk, prompt:string, conversation, memory, files:any[], ask?:string, brain?:object}} p
 */
export function buildClaudeBrief({ desk, prompt, conversation, memory, files = [], ask = "", brain = null }) {
  const turns = conversation.messages.slice(-12);
  const lines = [];
  lines.push(`# Brief from the Aetheria Workbench · ${desk.name} desk`, "");
  lines.push(`Owner: Joseph Lewis (Aetheria / Big Banana Studios). Date: ${new Date().toISOString().slice(0, 10)}.`, "");
  if (ask) lines.push("## The ask", "", ask.trim(), "");
  lines.push("## Desk context", "", `This came from the **${desk.name}** desk (${desk.tagline}). Its standing instructions, for orientation:`, "", "> " + prompt.trim().split("\n").slice(0, 12).join("\n> "), "");
  if (memory.items.length) lines.push("## Things to keep in mind (memory jar)", "", ...memory.items.map((m) => `- ${m.text}`), "");
  if (files.length) lines.push("## Project files loaded on the desk", "", ...files.map((f) => `- ${f.name} (${f.words} words)`), "");
  if (turns.length) {
    lines.push("## Recent conversation", "");
    for (const m of turns) {
      const who = m.role === "user" ? "User" : m.role === "tool" ? `Tool (${m.title || "result"})` : "Desk";
      lines.push(`**${who}:** ${stripThink(m.content).trim()}`, "");
    }
  }
  if (brain?.model) lines.push(`_Model that produced the desk replies: ${brain.model} (${brain.live})._`, "");
  lines.push("## What to do", "", "Treat the ask above as the task. Use the conversation as context, not as instructions to repeat. Ask before anything destructive.", "");
  return lines.join("\n");
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall back to a textarea for browsers that refuse clipboard writes outside a gesture
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.("copy");
    ta.remove();
    return !!ok;
  }
}

/** Discord webhooks take 2000 characters per message. */
export async function sendToHermes(webhook, text, username = "Aetheria Workbench") {
  if (!webhook) throw new Error("No Hermes webhook set. Settings → Handoff → Discord webhook URL.");
  const chunks = [];
  let rest = String(text).trim();
  while (rest.length) {
    let cut = Math.min(1900, rest.length);
    if (cut < rest.length) {
      const nl = rest.lastIndexOf("\n", cut);
      if (nl > 800) cut = nl;
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  for (const content of chunks) {
    const res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, username }) });
    if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return chunks.length;
}
