// Ambience: Mira's generative bed (432 Hz, the district's progression) and
// her rain, behind one toggle. Off by default here - this is a work tool.

import { Music } from "./audio/music.js";

export class Ambience {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.music = null;
    this.regime = "HEART";
  }

  /** Needs a user gesture the first time. */
  start() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.music = new Music(this.ctx);
      this.music.setMood("calm");
      this.music.setRegime(this.regime);
    }
    if (this.ctx.state !== "running") this.ctx.resume().catch(() => {});
    this.apply();
    this.music.start();
  }

  stop() {
    this.music?.stop();
  }

  apply() {
    if (!this.music) return;
    this.music.setVolume((this.settings.ambienceVolume ?? 35) / 100);
    this.music.setRainSound(this.settings.rain !== false);
    this.music.setRainVolume(0.4);
    this.music.setRain(this.settings.rain !== false ? 0.6 : 0);
    this.music.setThunder(this.settings.rain !== false && this.settings.stageStorm !== false);
  }

  /** The street's rain, from the stage, 0..1.6. */
  setRain(r) {
    if (this.settings.rain !== false) this.music?.setRain(r);
  }

  /** A lightning strike on the stage. */
  thunder(near) {
    this.music?.thunder(near);
  }

  setMood(m) {
    this.music?.setMood(m);
  }

  setRegime(name) {
    this.regime = name;
    this.music?.setRegime(name);
  }

  /** Duck under the voice. */
  setState(state) {
    this.music?.setState(state);
  }
}
