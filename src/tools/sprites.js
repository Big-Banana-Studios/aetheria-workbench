// The sprite-sheet inspector. Drop a PNG: the grid is measured here (frame
// size, columns, rows, per-frame bounding boxes, feet line) and the vision
// model is asked what the frames are - which rows are which clips, which way
// they face, how fast they should play. The result is a draft manifest in the
// same format Mira reads (public/assets/sprites/courier/courier.json):
// meta {frame, character_height, feet_y, atlas, columns, rows}, and
// clips {name: {fps, loop, facing, frames:[{x,y}]}}.

const COMMON = [8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 144, 160, 192, 256, 320, 384, 512, 640, 768, 1024];

/** Load an image file into an ImageData (and keep the bitmap for previews). */
export async function loadSheet(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("not an image"));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { img, canvas, data: ctx.getImageData(0, 0, canvas.width, canvas.height), name: file.name };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** True where a pixel is not background (alpha, or the corner colour). */
function occupancy(data) {
  const { width: w, height: h, data: px } = data;
  const hasAlpha = (() => {
    for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 250) return true;
    return false;
  })();
  const bg = [px[0], px[1], px[2]];
  const cols = new Uint8Array(w);
  const rows = new Uint8Array(h);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let on;
      if (hasAlpha) on = px[i + 3] > 13;
      else on = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 24;
      if (on) {
        mask[y * w + x] = 1;
        cols[x] = 1;
        rows[y] = 1;
      }
    }
  }
  return { cols, rows, mask, hasAlpha };
}

/** Runs of occupied cells, small gaps bridged. */
function runs(occ, bridge = 2) {
  const out = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i <= occ.length; i++) {
    const on = i < occ.length && occ[i];
    if (on) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > bridge || i === occ.length) {
        out.push([start, i - gap]);
        start = -1;
        gap = 0;
      }
    }
  }
  return out;
}

function divisors(n, min = 8) {
  const d = [];
  for (let i = min; i <= n / 2; i++) if (n % i === 0) d.push(i);
  d.push(n);
  return d;
}

/**
 * Guess the frame pitch along one axis from the occupied runs: the median
 * distance between run starts, snapped to a divisor of the length when one
 * is close, else to a common frame size.
 */
function guessPitch(occ, length) {
  const rs = runs(occ);
  if (rs.length >= 2) {
    const pitches = [];
    for (let i = 1; i < rs.length; i++) pitches.push(rs[i][0] - rs[i - 1][0]);
    pitches.sort((a, b) => a - b);
    const med = pitches[Math.floor(pitches.length / 2)];
    const div = divisors(length).sort((a, b) => Math.abs(a - med) - Math.abs(b - med))[0];
    if (div && Math.abs(div - med) <= Math.max(2, med * 0.15)) return { pitch: div, confidence: "measured (gutters)" };
    const common = COMMON.sort((a, b) => Math.abs(a - med) - Math.abs(b - med))[0];
    if (Math.abs(common - med) <= med * 0.1 && length % common === 0) return { pitch: common, confidence: "measured (common size)" };
    return { pitch: med, confidence: "measured (irregular)" };
  }
  // no gutters: prefer a common divisor
  const div = divisors(length).filter((d) => COMMON.includes(d));
  if (div.length) return { pitch: div[div.length - 1] === length && div.length > 1 ? div[div.length - 2] : div[div.length - 1], confidence: "guessed (no gutters)" };
  return { pitch: length, confidence: "single frame" };
}

/**
 * Measure a sheet: frame size, grid, and each frame's bounding box.
 * @param {ImageData} data
 * @param {{frameW?:number, frameH?:number}} [force] use these instead of guessing
 */
export function measureSheet(data, force = {}) {
  const { width: w, height: h } = data;
  const { cols, rows, mask, hasAlpha } = occupancy(data);
  const px = force.frameW ? { pitch: force.frameW, confidence: "set by hand" } : guessPitch(cols, w);
  const py = force.frameH ? { pitch: force.frameH, confidence: "set by hand" } : guessPitch(rows, h);
  let frameW = px.pitch;
  let frameH = py.pitch;
  // sprite sheets are very often square-framed; if one axis is confident and the
  // other is a guess, and the confident one divides the other axis, use it for both
  if (!force.frameW && !force.frameH) {
    if (/measured/.test(px.confidence) && !/measured/.test(py.confidence) && h % frameW === 0) frameH = frameW;
    else if (/measured/.test(py.confidence) && !/measured/.test(px.confidence) && w % frameH === 0) frameW = frameH;
  }
  const columns = Math.max(1, Math.floor(w / frameW));
  const rowsN = Math.max(1, Math.floor(h / frameH));
  const frames = [];
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < columns; c++) {
      const x0 = c * frameW;
      const y0 = r * frameH;
      let minX = frameW;
      let minY = frameH;
      let maxX = -1;
      let maxY = -1;
      let count = 0;
      for (let y = 0; y < frameH; y++) {
        const yy = y0 + y;
        if (yy >= h) break;
        for (let x = 0; x < frameW; x++) {
          const xx = x0 + x;
          if (xx >= w) break;
          if (!mask[yy * w + xx]) continue;
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      frames.push({ index: frames.length, row: r, col: c, x: x0, y: y0, empty: count < 4, bbox: count >= 4 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null, pixels: count });
    }
  }
  const full = frames.filter((f) => !f.empty);
  const med = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return {
    width: w,
    height: h,
    frameW,
    frameH,
    columns,
    rows: rowsN,
    confidence: { x: px.confidence, y: py.confidence },
    hasAlpha,
    frames,
    characterHeight: med(full.map((f) => f.bbox.h)),
    characterWidth: med(full.map((f) => f.bbox.w)),
    feetY: med(full.map((f) => f.bbox.y + f.bbox.h - 1)),
    emptyFrames: frames.length - full.length,
  };
}

/** A grid overlay for the preview canvas. */
export function drawOverlay(canvas, img, m, scale) {
  canvas.width = Math.round(m.width * scale);
  canvas.height = Math.round(m.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#101226";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(55,230,240,0.6)";
  for (let c = 0; c <= m.columns; c++) {
    const x = Math.round(c * m.frameW * scale) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let r = 0; r <= m.rows; r++) {
    const y = Math.round(r * m.frameH * scale) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,79,139,0.7)";
  ctx.font = `${Math.max(9, Math.round(10 * scale))}px ui-monospace, monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  for (const f of m.frames) {
    if (f.empty) continue;
    ctx.strokeRect((f.x + f.bbox.x) * scale + 0.5, (f.y + f.bbox.y) * scale + 0.5, f.bbox.w * scale, f.bbox.h * scale);
    ctx.fillText(String(f.index), f.x * scale + 2, f.y * scale + 10 * scale);
  }
  if (m.feetY != null) {
    ctx.strokeStyle = "rgba(255,179,71,0.8)";
    for (let r = 0; r < m.rows; r++) {
      const y = Math.round((r * m.frameH + m.feetY) * scale) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }
}

/** The sheet, shrunk to fit the vision model's eye, as a data URL. */
export function thumbnail(img, maxSide = 1024) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3a3a3a"; // a mid grey ground so alpha edges read
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = s < 0.5;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL("image/png"), imageData: ctx.getImageData(0, 0, c.width, c.height), scale: s };
}

/** The question for the vision model, with the measurements attached. */
export function visionPrompt(name, m) {
  const rows = [];
  for (let r = 0; r < m.rows; r++) {
    const fr = m.frames.filter((f) => f.row === r);
    const full = fr.filter((f) => !f.empty);
    rows.push(`row ${r}: frames ${fr[0].index}-${fr[fr.length - 1].index}, ${full.length} drawn${full.length < fr.length ? `, ${fr.length - full.length} empty` : ""}`);
  }
  return [
    `This image is a sprite sheet named "${name}". I measured it: ${m.width}x${m.height} px, frames ${m.frameW}x${m.frameH} (${m.confidence.x} / ${m.confidence.y}), ${m.columns} columns x ${m.rows} rows = ${m.frames.length} frames, indexed row-major from 0. The drawn character is about ${m.characterHeight} px tall with feet on y=${m.feetY} inside a frame.`,
    rows.join("\n"),
    "",
    "Look at the frames and tell me what they are. For each row (or each run of frames that belongs together) give a clip: a snake_case name from this vocabulary where it fits (idle, walk, run, jump, dash, punch, hurt, resonate, smoke, sleep, talk) with the facing suffix (_down, _up, _left, _right, _southeast, _southwest, _northeast, _northwest), the facing, the frame indices in play order, a sensible fps (idle 6, walk 12-21, run 21, one-shots 10-16), and whether it loops. If the sheet is a single pose per direction (RPG Maker walk format: 3 columns x 4 rows, rows down/left/right/up, walk sequence 0-1-2-1), say so and name the rows accordingly. If a frame is a mirror of another, still list it.",
    "",
    "Reply with JSON only, no prose, in exactly this shape:",
    '{"character": "one line describing who this is", "notes": "anything odd: baked-in glow, flash frames, a frame that turns to face the camera", "clips": [{"name": "idle_down", "facing": "down", "frames": [0,1,2,3], "fps": 6, "loop": true}]}',
  ].join("\n");
}

/** Pull the JSON out of a model reply that may have prose or a fence around it. */
export function parseVisionJson(text) {
  const t = String(text || "");
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const candidates = [fence?.[1], t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1), t].filter(Boolean);
  for (const c of candidates) {
    try {
      const j = JSON.parse(c);
      if (j && Array.isArray(j.clips)) return j;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Merge the measurement and the model's reading into Mira's manifest shape. */
export function buildManifest(name, m, vision) {
  const atlas = name.replace(/\.[^.]+$/, "") + ".png";
  const clips = {};
  const frameAt = (i) => m.frames[i];
  const list = vision?.clips?.length ? vision.clips : defaultClips(m);
  for (const c of list) {
    const frames = (c.frames || []).map((i) => frameAt(Number(i))).filter(Boolean);
    if (!frames.length) continue;
    const key = String(c.name || `clip_${Object.keys(clips).length}`)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_");
    clips[key] = {
      fps: Number(c.fps) || 8,
      loop: c.loop !== false,
      facing: c.facing || (key.match(/_(down|up|left|right|southeast|southwest|northeast|northwest)$/)?.[1] ?? "down"),
      frames: frames.map((f) => ({ x: f.x, y: f.y })),
    };
  }
  const states = {};
  const pick = (re) => Object.keys(clips).find((k) => re.test(k));
  const idle = pick(/^idle_down/) || pick(/^idle/);
  const listen = pick(/^walk_down/) || pick(/^walk/);
  const think = pick(/^idle_(right|left|side)/) || idle;
  const hurt = pick(/^hurt/) || pick(/^flinch/);
  if (idle) states.idle = { clip: idle, bob: true, blink: true };
  if (listen) states.listening = { clip: listen, fps: 6, aura: "low" };
  if (think) states.thinking = { clip: think, turn_every: 1.2, particles: true };
  if (idle) states.speaking = { clip: idle, mouth: true, nod_on_sentence: true };
  if (hurt) states.interrupted = { clip: hurt, then: "listening" };
  return {
    meta: {
      character: vision?.character || name.replace(/\.[^.]+$/, ""),
      frame: m.frameW === m.frameH ? m.frameW : undefined,
      frame_w: m.frameW,
      frame_h: m.frameH,
      character_height: m.characterHeight,
      feet_y: m.feetY,
      atlas,
      columns: m.columns,
      rows: m.rows,
      scaling: "integer nearest-neighbour only",
      generated_by: "aetheria-workbench sprite inspector - a DRAFT; check every clip against the sheet",
      packs: [name],
      measured: { confidence: m.confidence, empty_frames: m.emptyFrames, has_alpha: m.hasAlpha },
      notes: vision?.notes || undefined,
    },
    mouth: { source: "procedural", box: { w: Math.max(8, Math.round(m.frameW / 10)), h: Math.max(5, Math.round(m.frameW / 16)) }, note: "Mira draws a mouth at each down-facing frame's `mouth` anchor; add anchors after checking the frames." },
    states,
    clips,
  };
}

/** With no model: one clip per row, named by the RPG Maker convention if it fits. */
function defaultClips(m) {
  const mz = m.columns === 3 && m.rows === 4;
  const facing = ["down", "left", "right", "up"];
  const out = [];
  for (let r = 0; r < m.rows; r++) {
    const frames = m.frames.filter((f) => f.row === r && !f.empty).map((f) => f.index);
    if (!frames.length) continue;
    if (mz) out.push({ name: `walk_${facing[r]}`, facing: facing[r], frames: [frames[0], frames[1], frames[2], frames[1]].filter((x) => x != null), fps: 8, loop: true });
    else out.push({ name: `row_${r}`, facing: "down", frames, fps: 8, loop: true });
  }
  return out;
}
