// Getting text out of files, in the browser: pdf.js for PDFs (with the
// Reader's OCR cleaner, textclean.js, which rejoins wrapped lines and drops
// running headers), mammoth for Word, and plain reading for the rest. Both
// libraries are vendored from the Reader so this works offline.

import { cleanPage, stripRunningHeaders, buildSections } from "./textclean.js";

const BASE = import.meta.env.BASE_URL || "/";
const PDFJS_URL = new URL(`${BASE}vendor/pdfjs/pdf.min.mjs`, location.href);
const PDFJS_WORKER_URL = new URL(`${BASE}vendor/pdfjs/pdf.worker.min.mjs`, location.href);
const MAMMOTH_URL = new URL(`${BASE}vendor/mammoth/mammoth.browser.min.js`, location.href);

let pdfjsPromise = null;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL.href).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL.href;
      return lib;
    });
  }
  return pdfjsPromise;
}

/** Rebuild the lines of a page from pdf.js text items (the Reader's method). */
function itemsToText(items) {
  const lines = [];
  let buf = "";
  let y = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    if (y === null && item.transform) y = item.transform[5];
    buf += item.str;
    if (item.hasEOL) {
      lines.push({ text: buf, y: y ?? 0 });
      buf = "";
      y = null;
    }
  }
  if (buf.trim()) lines.push({ text: buf, y: y ?? 0 });
  if (!lines.length) return "";
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i - 1].y - lines[i].y;
    if (d > 0) gaps.push(d);
  }
  gaps.sort((a, b) => a - b);
  const leading = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  let out = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i - 1].y - lines[i].y;
    out += (leading > 0 && d > leading * 1.6 ? "\n\n" : "\n") + lines[i].text;
  }
  return out;
}

/**
 * @param {File|Blob|ArrayBuffer} source
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{text:string,pages:number,words:number}>}
 */
export async function extractPdf(source, onProgress) {
  const pdfjs = await getPdfjs();
  const data = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const task = pdfjs.getDocument({ data, isEvalSupported: false, disableAutoFetch: true });
  const pdf = await task.promise;
  const pages = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = cleanPage(itemsToText(content.items));
      if (text.trim()) pages.push(text);
      page.cleanup();
      if (onProgress && (n % 5 === 0 || n === pdf.numPages)) {
        onProgress(n, pdf.numPages);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    try {
      await task.destroy();
    } catch {
      /* ignore */
    }
  }
  if (!pages.length) throw new Error("This PDF has no text layer; it is images only. Drop it on the chat instead and the vision model can look at a page.");
  const sections = buildSections(stripRunningHeaders(pages));
  const text = sections.map((s) => `## ${s.h}\n\n${s.p.join("\n\n")}`).join("\n\n");
  const words = text.split(/\s+/).filter(Boolean).length;
  return { text, pages: pages.length, words };
}

let mammothLoading = null;
function getMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  if (!mammothLoading) {
    mammothLoading = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = MAMMOTH_URL.href;
      el.onload = () => (window.mammoth ? resolve(window.mammoth) : reject(new Error("Word support failed to load.")));
      el.onerror = () => reject(new Error("Word support could not be loaded."));
      document.head.appendChild(el);
    });
  }
  return mammothLoading;
}

/** .docx to markdown-ish text: headings kept, lists and tables flattened. */
export async function extractDocx(file) {
  const mammoth = await getMammoth();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const dom = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  for (const el of dom.body.children) {
    const text = el.textContent.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const h = /^H([1-6])$/.exec(el.tagName);
    if (h) out.push(`${"#".repeat(Number(h[1]))} ${text}`);
    else if (el.tagName === "UL" || el.tagName === "OL") {
      for (const li of el.querySelectorAll("li")) out.push(`- ${li.textContent.replace(/\s+/g, " ").trim()}`);
    } else if (el.tagName === "TABLE") {
      for (const row of el.querySelectorAll("tr")) {
        const cells = [...row.querySelectorAll("td, th")].map((c) => c.textContent.replace(/\s+/g, " ").trim());
        out.push(`| ${cells.join(" | ")} |`);
      }
    } else out.push(text);
  }
  const text = out.join("\n\n");
  return { text, pages: 1, words: text.split(/\s+/).filter(Boolean).length };
}

function htmlToText(html) {
  const dom = new DOMParser().parseFromString(html, "text/html");
  dom.querySelectorAll("script, style, nav, header, footer, noscript").forEach((e) => e.remove());
  return (dom.body?.innerText || dom.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Any file the desks accept. */
export async function extractAny(file, onProgress) {
  const name = file.name || "file";
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || file.type === "application/pdf") return { name, ...(await extractPdf(file, onProgress)) };
  if (ext === "docx") return { name, ...(await extractDocx(file)) };
  const raw = await file.text();
  let text = raw;
  if (ext === "html" || ext === "htm") text = htmlToText(raw);
  else if (ext === "json") {
    try {
      text = JSON.stringify(JSON.parse(raw), null, 1);
    } catch {
      text = raw;
    }
  }
  return { name, text, pages: 1, words: text.split(/\s+/).filter(Boolean).length };
}

export const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.json,.html,.htm,.csv,.gd,.py,.js,.ts";
