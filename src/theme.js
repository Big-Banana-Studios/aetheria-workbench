// The district and aura palette from Mira - GUT ember, HEART rose, HEAD
// white light - as the accent of whichever desk is open, plus a plain paper
// theme for long reading. The Aetheria desk follows the selected frequency,
// the way the Reader does.

import { REGIMES } from "./settings.js";

export function applyTheme(settings, { regime = "HEART", colour = null } = {}) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme === "paper" ? "paper" : "district";
  const r = REGIMES[regime] || REGIMES.HEART;
  const c = colour || r.colour;
  root.style.setProperty("--accent", c);
  root.style.setProperty("--accent-soft", hexToRgba(c, 0.14));
  root.style.setProperty("--accent-line", hexToRgba(c, 0.35));
  root.dataset.regime = r.name;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = settings.theme === "paper" ? "#f4f1ea" : "#0c0d1d";
}

export function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return `rgba(255,79,139,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

/** Which regime a frequency falls in (the Reader's bands). */
export function regimeOfHz(hz) {
  const f = Number(hz);
  if (!Number.isFinite(f)) return null;
  if (f >= 173 && f <= 964) return "GUT";
  if (f >= 1205 && f <= 3151) return "HEART";
  if (f >= 3503 && f <= 6337) return "HEAD";
  return null;
}
