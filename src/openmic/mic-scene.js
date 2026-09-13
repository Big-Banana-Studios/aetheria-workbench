// The open-mic room: a dive-bar back room with a brick wall, one hot
// light on a cord, a mic stand, and a couple of silhouetted heads in the
// dark in front of the stage. Drawn at the renderer's virtual pixel
// resolution, so it is the same pixel art she is, and it stands in for
// Mira's street: SpriteRenderer talks to it through the same methods
// Scene has (setState, setVoice, resize, update, drawBack, drawFront and
// the rest), so renderer.js stays the unchanged copy of Mira's.
//
// What moves: the light swings a little on its cord and breathes with her
// voice; an aside dims the room; the shriek flares it; the heads bob when
// the room laughs. The GUT palette from Mira's scene (green and ember
// signs, cold blue shadows) keeps it dark; the tiles are ours, the setting
// is any bar, not the game.

const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const BRICK = [38, 30, 36];
const BRICK_LIT = [96, 70, 62];
const MORTAR = [18, 15, 22];
const FLOOR = [14, 14, 22];
const FLOOR_LIT = [70, 58, 44];
const LAMP = [255, 214, 150];
const SIGN = [150, 255, 120];
const SIGN2 = [255, 165, 90];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MicScene {
  constructor() {
    this.vw = 0;
    this.vh = 0;
    this.groundY = 0;
    this.standY = 0;
    this.charH = 144;
    this.enabled = true;
    this.storm = false;
    this.rainOn = false;
    this.gustsOn = false;
    this.lightningOn = false;
    this.regime = "GUT";
    this.rain = 0;
    this.shake = 0;
    this.onStrike = null;
    this.mood = "calm";
    this.state = "idle";
    this.voice = 0;
    this.listen = 0;
    this.t = 0;
    this.light = 1;
    this.lightTarget = 1;
    this.laughUntil = 0;
    this.laughSize = 0;
    this.flashUntil = 0;
    this.wall = null;
    this.heads = [];
  }

  // ------------------------------------------------------------ Scene's surface

  setRegime(name) {
    this.regime = name || "GUT";
  }
  setMoodTable() {}
  setMood(m) {
    this.mood = m;
  }
  setState(s) {
    this.state = s;
  }
  setVoice(level) {
    this.voice = clamp(level * 3, 0, 1);
  }
  setListen(level) {
    this.listen = level;
  }
  strike() {
    this.flashUntil = this.t + 0.12;
    this.onStrike?.(1);
  }
  /** No signs to punch here: the renderer's sign gestures fall back to a plain punch. */
  signStand() {
    return null;
  }
  hitSign() {
    this.shake = 0.1;
  }

  resize(vw, vh, groundY, charH = 144, standY = groundY) {
    this.vw = vw;
    this.vh = vh;
    this.groundY = groundY;
    this.standY = standY;
    this.charH = charH;
    this._generate();
  }

  // ------------------------------------------------------------ stage controls

  /** The hot light: 1 is the show, 0.45 an aside, 1.35 the shriek. */
  setLight(level) {
    this.lightTarget = clamp(level, 0, 1.6);
  }

  /** The room reacts: the heads bob for a moment. */
  react(size = 0.6) {
    this.laughSize = clamp(size, 0, 1);
    this.laughUntil = this.t + 0.9 + size * 0.8;
  }

  // ------------------------------------------------------------ build

  _generate() {
    const { vw, vh, groundY } = this;
    if (!vw || !vh) return;
    const rand = rng(7);
    // the wall, once: bricks 12x5 with a pixel of mortar, a little colour noise, darker up top
    const wall = document.createElement("canvas");
    wall.width = vw;
    wall.height = groundY;
    const w = wall.getContext("2d");
    w.fillStyle = rgb(MORTAR);
    w.fillRect(0, 0, vw, groundY);
    const bw = 12;
    const bh = 5;
    for (let y = 0; y < groundY; y += bh + 1) {
      const row = Math.floor(y / (bh + 1));
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < vw + bw; x += bw + 1) {
        const k = 0.75 + rand() * 0.35;
        const dark = 0.55 + 0.45 * (y / groundY); // darker towards the ceiling
        w.fillStyle = rgb(BRICK.map((c) => Math.round(c * k * dark)));
        w.fillRect(Math.round(x + off), y, bw, bh);
        if (rand() < 0.06) {
          w.fillStyle = rgb(MORTAR, 0.6);
          w.fillRect(Math.round(x + off + rand() * bw), y + Math.floor(rand() * bh), 2, 1);
        }
      }
    }
    // a pipe along the top, and a small neon sign off to one side
    w.fillStyle = "rgba(60,64,80,0.9)";
    w.fillRect(0, 3, vw, 3);
    w.fillStyle = "rgba(20,22,30,0.9)";
    w.fillRect(0, 6, vw, 1);
    this.wall = wall;
    this.sign = { x: Math.round(vw * 0.16), y: Math.round(groundY * 0.28), w: 22, h: 9, flicker: rand() * 10 };
    // the heads: two or three silhouettes along the bottom, never under her
    const n = vw < 200 ? 2 : 3;
    this.heads = [];
    for (let i = 0; i < n; i++) {
      const x = Math.round(vw * (0.18 + (0.64 * i) / Math.max(1, n - 1)) + (rand() - 0.5) * 12);
      this.heads.push({ x, r: 9 + Math.round(rand() * 3), phase: rand() * 6.28, bob: 0 });
    }
    this.lampX = Math.round(vw / 2);
    this.lampY = 10;
  }

  // ------------------------------------------------------------ per frame

  update(dt) {
    this.t += dt;
    this.light += (this.lightTarget - this.light) * Math.min(1, dt * 4);
    if (this.shake > 0) this.shake -= dt;
    for (const h of this.heads) {
      const want = this.t < this.laughUntil ? Math.sin(this.t * 14 + h.phase) * 1.5 * this.laughSize : 0;
      h.bob += (want - h.bob) * Math.min(1, dt * 10);
    }
  }

  drawBack(ctx) {
    const { vw, vh, groundY, standY } = this;
    if (!vw || !this.wall) return;
    const lit = this.light * (1 + this.voice * 0.08) * (this.t < this.flashUntil ? 1.6 : 1);
    // the wall, then the light on it
    ctx.drawImage(this.wall, 0, 0);
    const swing = Math.sin(this.t * 0.7) * 2;
    const lx = this.lampX + swing;
    // the cone: additive, from the bulb down to a pool on the floor around her feet
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const cone = ctx.createRadialGradient(lx, this.lampY + 8, 2, lx, standY - 20, Math.max(40, vw * 0.55));
    cone.addColorStop(0, rgb(LAMP, 0.55 * lit));
    cone.addColorStop(0.45, rgb(LAMP, 0.16 * lit));
    cone.addColorStop(1, rgb(LAMP, 0));
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(lx, this.lampY + 6);
    ctx.lineTo(lx - vw * 0.42, vh);
    ctx.lineTo(lx + vw * 0.42, vh);
    ctx.closePath();
    ctx.fill();
    // the brick catches it warm near the middle
    const warm = ctx.createRadialGradient(lx, groundY * 0.55, 4, lx, groundY * 0.55, vw * 0.4);
    warm.addColorStop(0, rgb(BRICK_LIT, 0.35 * lit));
    warm.addColorStop(1, rgb(BRICK_LIT, 0));
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, vw, groundY);
    ctx.restore();
    // the floor: boards, and the pool of light
    ctx.fillStyle = rgb(FLOOR);
    ctx.fillRect(0, groundY, vw, vh - groundY);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let y = groundY + 3; y < vh; y += 4) ctx.fillRect(0, y, vw, 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const pool = ctx.createRadialGradient(lx, standY + 2, 2, lx, standY + 2, vw * 0.36);
    pool.addColorStop(0, rgb(FLOOR_LIT, 0.55 * lit));
    pool.addColorStop(1, rgb(FLOOR_LIT, 0));
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(lx, standY + 2, vw * 0.36, (vh - groundY) * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // the cord and the bulb
    ctx.strokeStyle = "rgba(30,30,40,1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.lampX, 0);
    ctx.lineTo(lx, this.lampY);
    ctx.stroke();
    ctx.fillStyle = "rgba(40,40,52,1)";
    ctx.fillRect(Math.round(lx) - 3, this.lampY, 6, 3);
    ctx.fillStyle = rgb(LAMP, Math.min(1, 0.7 + 0.3 * lit));
    ctx.fillRect(Math.round(lx) - 2, this.lampY + 3, 4, 4);
    ctx.fillStyle = rgb([255, 255, 240], Math.min(1, 0.5 * lit));
    ctx.fillRect(Math.round(lx) - 1, this.lampY + 4, 2, 2);
    // the sign: OPEN in green, MIC in ember, a flicker now and then
    const s = this.sign;
    const fl = Math.sin(this.t * 9 + s.flicker) > 0.92 ? 0.35 : 1;
    ctx.fillStyle = "rgba(8,8,14,0.85)";
    ctx.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
    ctx.fillStyle = rgb(SIGN, 0.9 * fl);
    ctx.fillRect(s.x, s.y, s.w, 3);
    ctx.fillStyle = rgb(SIGN2, 0.9 * fl);
    ctx.fillRect(s.x + 4, s.y + 5, s.w - 8, 3);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(s.x + s.w / 2, s.y + s.h / 2, 1, s.x + s.w / 2, s.y + s.h / 2, 22);
    glow.addColorStop(0, rgb(SIGN, 0.25 * fl));
    glow.addColorStop(1, rgb(SIGN, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(s.x - 22, s.y - 22, s.w + 44, s.h + 44);
    ctx.restore();
  }

  drawFront(ctx) {
    const { vw, vh, standY } = this;
    if (!vw) return;
    // the mic stand, just off her centre so it never covers her face: steel, lit down one side
    const mx = Math.round(vw / 2) + 16;
    const top = standY - Math.round(this.charH * 0.62);
    ctx.fillStyle = "rgba(14,15,22,1)";
    ctx.fillRect(mx - 5, standY + 1, 11, 2);
    ctx.fillStyle = "rgba(78,84,104,1)";
    ctx.fillRect(mx - 4, standY, 9, 1);
    ctx.fillRect(mx, top + 4, 1, standY - top - 4);
    ctx.fillStyle = rgb(LAMP, 0.5 * this.light);
    ctx.fillRect(mx + 1, top + 6, 1, standY - top - 8);
    ctx.fillStyle = "rgba(96,102,124,1)";
    ctx.fillRect(mx - 1, top + 2, 3, 3);
    ctx.fillRect(mx - 2, top, 5, 2);
    ctx.fillStyle = rgb(LAMP, Math.min(1, 0.6 * this.light));
    ctx.fillRect(mx - 1, top, 2, 1);
    // the dark in front of the stage, and the heads in it, the light catching the top of each
    const dark = ctx.createLinearGradient(0, vh - 26, 0, vh);
    dark.addColorStop(0, "rgba(4,4,10,0)");
    dark.addColorStop(1, "rgba(4,4,10,0.95)");
    ctx.fillStyle = dark;
    ctx.fillRect(0, vh - 26, vw, 26);
    for (const h of this.heads) {
      const y = vh - 6 + h.bob;
      ctx.fillStyle = "rgba(30,26,34,1)";
      ctx.beginPath();
      ctx.ellipse(h.x, y, h.r, h.r * 1.15, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = rgb(BRICK_LIT, 0.45 * this.light);
      ctx.beginPath();
      ctx.ellipse(h.x, y, h.r, h.r * 1.15, 0, Math.PI * 1.15, Math.PI * 1.85);
      ctx.lineTo(h.x, y - h.r * 0.9);
      ctx.fill();
      ctx.fillStyle = "rgba(6,6,12,1)";
      ctx.beginPath();
      ctx.ellipse(h.x, y + 1, h.r - 1, h.r * 1.15 - 1, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(h.x - h.r * 1.8, y + h.r * 0.5, h.r * 3.6, vh - y);
    }
    // vignette
    const v = ctx.createRadialGradient(vw / 2, vh * 0.45, vh * 0.25, vw / 2, vh * 0.45, vh * 0.95);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, `rgba(0,0,0,${(0.55 + (1 - this.light) * 0.3).toFixed(2)})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, vw, vh);
  }
}
