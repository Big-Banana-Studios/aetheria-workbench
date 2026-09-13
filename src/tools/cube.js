// The Aetheria cube: the canonical data (public/data/aetheria-cube.json) and
// the three tools the Aetheria desk offers - walk calculator, frequency
// lookup, and the "which stone / regime" explainer - all local, no model.

const BASE = import.meta.env.BASE_URL || "/";
let cube = null;
let loading = null;

export function loadCube() {
  if (cube) return Promise.resolve(cube);
  if (!loading) {
    loading = fetch(`${BASE}data/aetheria-cube.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`cube data ${r.status}`);
        return r.json();
      })
      .then((j) => (cube = j));
  }
  return loading;
}

export function getCube() {
  return cube;
}

/** Find a frequency by Hz, by name, by keyword, by holder or by letter title. */
export function findFrequency(q) {
  if (!cube) return null;
  const s = String(q || "").trim().toLowerCase();
  if (!s) return null;
  const n = Number(s.replace(/hz$/i, "").trim());
  if (Number.isFinite(n)) {
    let best = null;
    for (const f of cube.frequencies) {
      const d = Math.abs(f.hz - n);
      if (!best || d < best.d) best = { f, d };
    }
    return best && best.d <= 60 ? best.f : null;
  }
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const fields = (f) => [f.name, f.keyword, f.scene, f.stone?.holder, f.stone?.held_by?.replace(/_/g, " "), f.stone?.letter_title, f.stone?.id?.replace(/_/g, " ")];
  const ns = norm(s);
  return cube.frequencies.find((f) => fields(f).some((x) => norm(x) === ns)) || cube.frequencies.find((f) => fields(f).some((x) => norm(x).includes(ns))) || null;
}

export function findWalk(key) {
  if (!cube) return null;
  const k = String(key || "").trim().toLowerCase();
  return cube.walks.find((w) => w.key.toLowerCase() === k || w.id === k || w.name.toLowerCase() === k) || null;
}

const REG_COL = { GUT: "ember", HEART: "rose", HEAD: "white light" };

export function frequencyCard(f) {
  const st = f.stone;
  const rows = [
    `## ${f.hz} Hz · ${f.regime} position ${f.position} · ${f.name}`,
    "",
    `| | |`,
    `|---|---|`,
    `| Regime | **${f.regime}** (${cube.regimes.find((r) => r.id === f.regime)?.district}, ${REG_COL[f.regime]}) |`,
    `| Lo Shu | position ${f.position}, cell ${f.cell} (value ${f.loshu_value}), ${f.direction} · ${f.element} |`,
    `| Keyword | ${f.keyword || "—"} · scene *${f.scene || "—"}* |`,
    `| Hexagram | ${f.hexagram ? `${f.hexagram} · ${f.hexagram_name} (${f.hexagram_pinyin}) · ${f.trigram_note}` : "—"} |`,
    `| Geometry | ${f.geometry || "—"} |`,
    `| Digital root | ${f.digital_root} |`,
    `| Colour | ${f.colour || "—"} (aura ${st?.aura_colour || "—"}) |`,
  ];
  if (st) rows.push(`| Stone | \`${st.id}\` · ${st.tier}${st.unlocks ? ` · unlocks ${st.unlocks}` : ""} · held by **${st.holder || st.held_by}** |`, `| Letter | ${st.letter_index}: *${st.letter_title}* |`);
  const triad = cube.triads.find((t) => t.position === f.position);
  if (triad) rows.push(`| Pillar (same position) | ${triad.gut} · ${triad.heart} · ${triad.head} |`);
  return rows.join("\n");
}

export function stoneCard(f) {
  const st = f.stone;
  const reg = cube.regimes.find((r) => r.id === f.regime);
  const lines = [`## Which stone: ${f.hz} Hz is **${f.regime}** ${st ? `stone \`${st.id}\`` : ""}`, ""];
  lines.push(`**Regime.** ${f.regime}: ${reg?.district}, theme *${reg?.theme}*, aura ${REG_COL[f.regime]}. ${reg?.formula}.`);
  lines.push("");
  if (st) {
    lines.push(`**Stone.** \`${st.id}\` is the ${ordinal(st.tier_index)} stone of ${f.regime}, tier **${st.tier}**${st.unlocks ? ` (unlocks ${st.unlocks})` : ""}, aura colour ${st.aura_colour}. It is held by **${st.holder || st.held_by}**, who is waiting for letter ${st.letter_index}, *${st.letter_title}*.`);
    lines.push("");
  }
  lines.push(`**Position.** Lo Shu ${f.position} (${f.direction}, ${f.element}), cell ${f.cell} of the square with value ${f.loshu_value}. ${f.position === 5 ? "This is the centre: every pillar and diagonal passes through it, and the Ouroboros crosses the HEART centre three times." : ""}`);
  lines.push("");
  lines.push(`**Tiers of the regime.** ${reg?.tiers.join(" · ")}. Nine stones per regime, six in the open and three in the dungeon, the last held by the guardian.`);
  lines.push("", "_The cosmology of the game and the family's creative frame. Not a physiological or medical claim._");
  return lines.join("\n");
}

function ordinal(n) {
  return ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"][n] || `${n}th`;
}

export function walkCard(w, fromHz = null) {
  const F = cube.frequencies;
  let steps = w.steps.map((i) => F[i]);
  if (fromHz) {
    const at = steps.findIndex((f) => f.hz === Number(fromHz));
    if (at > 0) steps = steps.slice(at);
  }
  const head = [`## Walk ${w.key} · ${w.name} · ${steps.length} steps`, "", w.blurb, ""];
  if (w.paperless) head.push(`In Paperless this is the **${w.paperless}** walk of the satchel.`, "");
  head.push(`| # | Hz | Regime | Pos | Dir | Name | Stone · holder |`, `|---|---|---|---|---|---|---|`);
  steps.forEach((f, i) => head.push(`| ${i + 1} | **${f.hz}** | ${f.regime} | ${f.position} | ${f.direction} | ${f.name} | ${f.stone ? `\`${f.stone.id}\` · ${f.stone.holder || ""}` : ""} |`));
  head.push("", `Sequence: ${steps.map((f) => f.hz).join(" → ")}`);
  return head.join("\n");
}

export function cubeCard() {
  const sq = cube.loshu.square;
  const lines = ["## The cube: three Lo Shu layers", "", "The square, row-major (every line sums to 15):", "", "```", `  ${sq[0]}  ${sq[1]}  ${sq[2]}`, `  ${sq[3]}  ${sq[4]}  ${sq[5]}`, `  ${sq[6]}  ${sq[7]}  ${sq[8]}`, "```", ""];
  for (const r of cube.regimes) {
    const fs = cube.frequencies.filter((f) => f.regime === r.id);
    const cell = (c) => fs.find((f) => f.cell === c);
    lines.push(`**${r.id}** · ${r.district} · ${r.formula}`, "", "```");
    for (let row = 0; row < 3; row++) lines.push([0, 1, 2].map((c) => String(cell(row * 3 + c).hz).padStart(5)).join("  "));
    lines.push("```", "");
  }
  lines.push("Pillars (same position through the three layers):", "", cube.triads.map((t) => `- ${t.position} ${t.direction}: ${t.gut} · ${t.heart} · ${t.head}`).join("\n"), "");
  lines.push("Walks: " + cube.walks.map((w) => `**${w.key}** ${w.name} (${w.steps.length})`).join(", ") + ". `/walk C` for one of them.");
  return lines.join("\n");
}

/** A compact rendering of the whole cube for the desk's system prompt. */
export function cubeSummary() {
  if (!cube) return "";
  const lines = ["## The Aetheria cube (canonical data, loaded from aetheria-cube.json)", "", "Lo Shu square row-major 4 9 2 / 3 5 7 / 8 1 6; cell 4 (value 5) is the SOURCE. Position → direction: " + Object.entries(cube.loshu.position_to_direction).map(([p, d]) => `${p}=${d}`).join(" "), ""];
  for (const r of cube.regimes) lines.push(`${r.id} (${r.district}, ${r.theme}, ${r.colour}): ${r.formula}.`);
  lines.push("", "hz | regime pos dir | name | keyword | hexagram | stone tier holder | letter");
  for (const f of cube.frequencies) lines.push(`${f.hz} | ${f.regime} ${f.position} ${f.direction} | ${f.name} | ${f.keyword || ""} | ${f.hexagram ? `${f.hexagram} ${f.hexagram_name}` : ""} | ${f.stone ? `${f.stone.id} ${f.stone.tier} ${f.stone.holder || ""}` : ""} | ${f.stone ? `${f.stone.letter_index} ${f.stone.letter_title}` : ""}`);
  lines.push("");
  for (const w of cube.walks) lines.push(`Walk ${w.key} ${w.name} (${w.steps.length}): ${w.steps.map((i) => cube.frequencies[i].hz).join(" ")}`);
  lines.push("", "Tiers: ember 1-2, ring 3 (ability I), ring+ 4-5, halo 6 (ability II), halo+ 7-8, lattice 9 (capstone). The bed is tuned to A4 = 432 Hz.");
  return lines.join("\n");
}
