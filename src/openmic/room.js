// The room: a crowd that laughs on the punchlines, one person in the corner
// who laughs a beat early, applause for the bow, and a club murmuring
// behind her. Recorded people this time (public/assets/room/*.ogg: public
// domain, CC0 and CC BY laughter and a café from Wikimedia Commons, the
// credits in CREDITS.md there), picked by the size of the laugh with a
// little pitch and level variation so no two land the same; the murmur
// under a big laugh and the room's swell are still synthesized, and the
// old synthesized laugh is the fallback while the samples load (or when
// they cannot). The bed loops with a crossfade and ducks while she speaks.
// Behind one volume slider and one switch; the recorder's destination hears
// it all too, so a recorded clip has the room in it.

const BASE = import.meta.env.BASE_URL || "/";
const BANKS = {
  one: ["one-1", "one-2", "one-3", "one-4", "one-5", "one-6"],
  medium: ["medium-1", "medium-2", "big-short"],
  big: ["big-1", "big-2", "big-3", "big-4"],
  clapter: ["clapter"],
  applause: ["applause"],
};
const BED = "club-bed";
const BED_LEVEL = 0.85; // of the room's volume, between her lines
const BED_DUCKED = 0.5; // while she speaks

export class Room {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode[]} outs where to play (the speakers, and the recorder's destination)
   */
  constructor(ctx, outs = [ctx.destination]) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.15;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 3200;
    this.tone.connect(this.gain);
    for (const o of outs) this.gain.connect(o);
    this.noise = this._noise(2);
    this.volume = 0.15;
    this.enabled = true;
    this.talking = false;
    this.buffers = new Map();
    this._loading = null;
    this._last = new Map();
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    this.bedGain.connect(this.gain);
    this._bedTimer = 0;
    this._bedSources = [];
    this.load();
  }

  /** The samples, fetched and decoded once; the bed starts when they are in. */
  load() {
    if (this._loading) return this._loading;
    this._loading = (async () => {
      const names = [...new Set([...Object.values(BANKS).flat(), BED])];
      await Promise.all(
        names.map(async (n) => {
          try {
            const r = await fetch(`${BASE}assets/room/${n}.ogg`);
            if (!r.ok) return;
            this.buffers.set(n, await this.ctx.decodeAudioData(await r.arrayBuffer()));
          } catch {
            /* no sample: the synthesized fallback */
          }
        }),
      );
      if (this.enabled) this._startBed();
    })();
    return this._loading;
  }

  /** The switch: off, the bed stops and nothing is scheduled; on, the club comes back. */
  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this._stopBed();
    else this._startBed();
  }

  /** 0..1; the slider is 0..100. */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  /** While she speaks the bed ducks a little, so the club is behind her and not on her. */
  setTalking(on) {
    this.talking = !!on;
    if (this._bedTimer) this.bedGain.gain.setTargetAtTime(this.talking ? BED_DUCKED : BED_LEVEL, this.ctx.currentTime, 0.3);
  }

  /** A laugh: 0.3 a chuckle from one corner, 0.6 a real one, 1 the room gone. */
  laugh(size = 0.6) {
    if (!this.enabled || this.volume <= 0.001) return;
    const t0 = this.ctx.currentTime + 0.1 + Math.random() * 0.15;
    const bank = size >= 0.85 ? (Math.random() < 0.3 ? "clapter" : "big") : size >= 0.5 ? "medium" : "one";
    const name = this._pick(bank);
    if (!name) return this._laughSynth(size);
    this._play(name, { gain: (0.55 + 0.45 * size) * (0.85 + Math.random() * 0.3), rate: 0.95 + Math.random() * 0.1, at: t0 });
    // the one who laughs first, a beat ahead of the room, on a good laugh
    if (size >= 0.5 && Math.random() < 0.6) {
      const one = this._pick("one");
      if (one) this._play(one, { gain: 0.45, rate: 0.95 + Math.random() * 0.1, at: Math.max(this.ctx.currentTime, t0 - 0.08) });
    }
    if (size > 0.5) this.murmur(size * 0.4, t0 + 0.3);
  }

  /** The bow: applause, with the room's laugh under it. */
  applaud(size = 1) {
    if (!this.enabled || this.volume <= 0.001) return;
    const t0 = this.ctx.currentTime + 0.25;
    if (!this._play("applause", { gain: 0.7 * size, at: t0 })) this._laughSynth(1);
  }

  /** A low swell of the room: someone shifting, a breath taken together. */
  murmur(size = 0.4, at = null) {
    if (!this.enabled || this.volume <= 0.001) return;
    const c = this.ctx;
    const t = at ?? c.currentTime + 0.05;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * size, t + 0.35);
    g.gain.linearRampToValueAtTime(0, t + 0.9 + size * 0.6);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.tone);
    src.start(t);
    src.stop(t + 1.8);
  }

  destroy() {
    this._stopBed();
  }

  // ------------------------------------------------------------ inside

  _play(name, { gain = 1, rate = 1, at = null } = {}) {
    const buf = this.buffers.get(name);
    if (!buf) return false;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.tone);
    src.start(at ?? c.currentTime);
    return true;
  }

  /** One of a bank, never the one just played. */
  _pick(bank) {
    const list = BANKS[bank].filter((n) => this.buffers.has(n));
    if (!list.length) return null;
    const last = this._last.get(bank);
    const choices = list.length > 1 ? list.filter((n) => n !== last) : list;
    const n = choices[Math.floor(Math.random() * choices.length)];
    this._last.set(bank, n);
    return n;
  }

  /** The club behind her: the bed looped with a crossfade, scheduled a few seconds ahead. */
  _startBed() {
    const buf = this.buffers.get(BED);
    if (this._bedTimer || !buf || !this.enabled) return;
    const dur = buf.duration;
    const X = 2.5;
    const schedule = (at) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(1, at + X);
      g.gain.setValueAtTime(1, at + dur - X);
      g.gain.linearRampToValueAtTime(0, at + dur);
      src.connect(g);
      g.connect(this.bedGain);
      src.start(at);
      src.stop(at + dur + 0.05);
      this._bedSources.push(src);
      src.onended = () => (this._bedSources = this._bedSources.filter((s) => s !== src));
      return at + dur - X;
    };
    let next = schedule(this.ctx.currentTime + 0.05);
    this.bedGain.gain.setTargetAtTime(this.talking ? BED_DUCKED : BED_LEVEL, this.ctx.currentTime, 0.6);
    this._bedTimer = setInterval(() => {
      if (next - this.ctx.currentTime < 5) next = schedule(next);
    }, 1000);
  }

  _stopBed() {
    clearInterval(this._bedTimer);
    this._bedTimer = 0;
    this.bedGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    const t = this.ctx.currentTime + 1;
    for (const s of this._bedSources) {
      try {
        s.stop(t);
      } catch {
        /* already done */
      }
    }
    this._bedSources = [];
  }

  /** The old laugh, synthesized: a handful of voices, burst trains of band-passed noise, while no sample is in. */
  _laughSynth(size = 0.6) {
    const c = this.ctx;
    const n = 2 + Math.round(size * 5);
    const t0 = c.currentTime + 0.12 + Math.random() * 0.15;
    for (let v = 0; v < n; v++) {
      const start = t0 + Math.random() * 0.25;
      const pitch = 260 + Math.random() * 520;
      const bursts = 3 + Math.round(Math.random() * 4 * size);
      const rate = 0.13 + Math.random() * 0.07;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = pitch;
      bp.Q.value = 2.2;
      const bp2 = c.createBiquadFilter();
      bp2.type = "bandpass";
      bp2.frequency.value = pitch * 2.4;
      bp2.Q.value = 3;
      const g = c.createGain();
      g.gain.setValueAtTime(0, start);
      const peak = (0.05 + 0.09 * size) * (0.6 + Math.random() * 0.6);
      for (let b = 0; b < bursts; b++) {
        const at = start + b * rate;
        const a = peak * Math.pow(0.78, b);
        g.gain.linearRampToValueAtTime(a, at + 0.03);
        g.gain.linearRampToValueAtTime(a * 0.15, at + rate * 0.75);
      }
      const end = start + bursts * rate + 0.25;
      g.gain.linearRampToValueAtTime(0, end);
      src.connect(bp);
      src.connect(bp2);
      bp.connect(g);
      bp2.connect(g);
      g.connect(this.tone);
      src.start(start);
      src.stop(end + 0.05);
    }
    if (size > 0.5) this.murmur(size * 0.5, t0 + 0.4);
  }

  _noise(seconds) {
    const n = Math.round(this.ctx.sampleRate * seconds);
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
}
