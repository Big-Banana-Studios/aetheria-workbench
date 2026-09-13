// Export: the desk's conversation as a .md file, with the memory jar and the
// project-file list appended so the document stands on its own.

import { download, slug } from "./ui.js";

export function exportConversation({ desk, conversation, memory, files = [] }) {
  const parts = [conversation.asMarkdown(desk.name)];
  if (memory.items.length) parts.push("---", "", memory.asPrompt().replace(/^## /, "## "));
  if (files.length) parts.push("---", "", "## Project files on this desk", "", ...files.map((f) => `- ${f.name} (${f.words} words${f.embedded ? ", embedded" : ""})`));
  parts.push("", `_Exported from the Aetheria Workbench · ${desk.name} desk · ${new Date().toISOString()}_`, "");
  const name = `${slug(desk.name)}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
  download(name, parts.join("\n"));
  return name;
}

/**
 * Flashcards out of a reply. Accepts `Q: … / A: …` pairs, `**Q:**` markdown,
 * or a two-column markdown table. Anki reads tab-separated text.
 */
export function parseFlashcards(text) {
  const cards = [];
  const t = String(text || "");
  const re = /(?:^|\n)\s*\**\s*Q(?:uestion)?\s*[:.]\**\s*([\s\S]*?)\n\s*\**\s*A(?:nswer)?\s*[:.]\**\s*([\s\S]*?)(?=\n\s*\**\s*Q(?:uestion)?\s*[:.]|\n\s*---|\n\s*#|$)/gi;
  let m;
  while ((m = re.exec(t))) {
    const q = m[1].trim();
    const a = m[2].trim();
    if (q && a) cards.push({ q, a });
  }
  if (!cards.length) {
    for (const line of t.split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length >= 4 && cells[1] && cells[2] && !/^[-:\s]+$/.test(cells[1]) && !/^(q|question|front)$/i.test(cells[1])) cards.push({ q: cells[1], a: cells[2] });
    }
  }
  return cards;
}

export function exportFlashcards(cards, deskName = "study") {
  const tsv = cards.map((c) => `${c.q.replace(/\t|\n/g, " ")}\t${c.a.replace(/\t|\n/g, " ")}`).join("\n") + "\n";
  const name = `flashcards-${slug(deskName)}-${Date.now().toString(36)}.txt`;
  download(name, tsv, "text/plain;charset=utf-8");
  return name;
}
