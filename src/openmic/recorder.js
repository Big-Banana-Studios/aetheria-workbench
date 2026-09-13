// The stage's own recorder: the canvas frames and the audio graph encoded
// with WebCodecs (the platform's H.264 and AAC encoders, hardware on the
// phone) and muxed into a standard MP4 here (mp4-muxer, the index at the
// front), so the clip no longer depends on the browser's MediaRecorder,
// whose MP4 the phone's WebView did not deliver playable. Where WebCodecs
// cannot encode H.264 (headless Chrome, an old build) `probe()` says so and
// the player falls back to MediaRecorder's WebM. Frames are taken from the
// canvas at up to 30 a second while the set plays, scaled to at most 1080
// on the short side; the audio comes off the graph's stream track.

import { Muxer, ArrayBufferTarget } from "mp4-muxer";

const VIDEO_CODECS = ["avc1.640033", "avc1.640028", "avc1.4D4028", "avc1.42E028", "avc1.42E01E"];
const FPS = 30;
const MAX_SHORT = 1080;

/** The even frame size the canvas records at: at most 1080 on the short side. */
export function frameSize(width, height) {
  const short = Math.min(width, height);
  const k = short > MAX_SHORT ? MAX_SHORT / short : 1;
  return { width: Math.max(2, Math.round((width * k) / 2) * 2), height: Math.max(2, Math.round((height * k) / 2) * 2) };
}

export class StageRecorder {
  /** Whether this browser can encode the video and the audio with WebCodecs: {ok, video, audio, width, height} or {ok: false, why}. */
  static async probe(width, height, sampleRate = 48000, channels = 2) {
    if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined" || typeof MediaStreamTrackProcessor === "undefined" || typeof VideoFrame === "undefined") return { ok: false, why: "no WebCodecs in this browser" };
    const size = frameSize(width, height);
    let video = null;
    for (const codec of VIDEO_CODECS) {
      try {
        const r = await VideoEncoder.isConfigSupported({ codec, width: size.width, height: size.height, bitrate: 4e6, framerate: FPS, avc: { format: "avc" } });
        if (r.supported) {
          video = codec;
          break;
        }
      } catch {
        /* the next profile */
      }
    }
    if (!video) return { ok: false, why: "no H.264 encoder for this size" };
    let audio = null;
    for (const codec of ["mp4a.40.2", "opus"]) {
      try {
        const r = await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: channels, bitrate: codec === "opus" ? 96000 : 128000 });
        if (r.supported) {
          audio = codec;
          break;
        }
      } catch {
        /* the next codec */
      }
    }
    if (!audio) return { ok: false, why: "no AAC or Opus encoder" };
    return { ok: true, video, audio, ...size };
  }

  /**
   * @param {HTMLCanvasElement} canvas the stage
   * @param {MediaStreamTrack} audioTrack the graph's output (the voice, the room, the rain)
   * @param {{video:string, audio:string, width:number, height:number}} probe from probe()
   */
  constructor(canvas, audioTrack, probe) {
    this.canvas = canvas;
    this.track = audioTrack;
    this.probe = probe;
    this.muxer = null;
    this.target = null;
    this.videoEncoder = null;
    this.audioEncoder = null;
    this.reader = null;
    this.recording = false;
    this.error = null;
    this._raf = 0;
    this._t0 = 0;
    this._last = -1;
    this._n = 0;
    this._pendingVideo = [];
    this._frames = 0;
    this._audioFrames = 0;
    this.off = document.createElement("canvas");
    this.off.width = probe.width;
    this.off.height = probe.height;
    this.octx = this.off.getContext("2d", { alpha: false });
  }

  get type() {
    return "video/mp4";
  }

  async start() {
    const { probe } = this;
    this.videoEncoder = new VideoEncoder({
      output: (chunk, meta) => (this.muxer ? this.muxer.addVideoChunk(chunk, meta) : this._pendingVideo.push([chunk, meta])),
      error: (e) => (this.error = this.error || e),
    });
    this.videoEncoder.configure({ codec: probe.video, width: probe.width, height: probe.height, bitrate: 4e6, framerate: FPS, avc: { format: "avc" }, latencyMode: "realtime" });
    // the audio: the first AudioData tells the real sample rate and channel count; the muxer is made then, and the queued video chunks go in
    const processor = new MediaStreamTrackProcessor({ track: this.track });
    this.reader = processor.readable.getReader();
    this.recording = true;
    this._t0 = performance.now();
    this._pump();
    this._tick();
  }

  async _pump() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done || !this.recording) {
          value?.close();
          break;
        }
        if (!this.muxer) this._openMuxer(value.sampleRate, value.numberOfChannels);
        if (this.audioEncoder && this.audioEncoder.state === "configured") {
          this.audioEncoder.encode(value);
          this._audioFrames++;
        }
        value.close();
      }
    } catch (e) {
      this.error = this.error || e;
    }
  }

  _openMuxer(sampleRate, channels) {
    const { probe } = this;
    this.target = new ArrayBufferTarget();
    this.muxer = new Muxer({
      target: this.target,
      video: { codec: "avc", width: probe.width, height: probe.height, frameRate: FPS },
      audio: { codec: probe.audio === "opus" ? "opus" : "aac", sampleRate, numberOfChannels: channels },
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });
    for (const [chunk, meta] of this._pendingVideo.splice(0)) this.muxer.addVideoChunk(chunk, meta);
    this.audioEncoder = new AudioEncoder({
      output: (chunk, meta) => this.muxer.addAudioChunk(chunk, meta),
      error: (e) => (this.error = this.error || e),
    });
    this.audioEncoder.configure({ codec: probe.audio, sampleRate, numberOfChannels: channels, bitrate: probe.audio === "opus" ? 96000 : 128000 });
  }

  _tick() {
    if (!this.recording) return;
    this._raf = requestAnimationFrame(() => this._tick());
    const now = performance.now();
    if (now - this._last < 1000 / FPS - 2) return;
    if (this.videoEncoder.state !== "configured" || this.videoEncoder.encodeQueueSize > 4) return; // the encoder is behind: drop this frame
    this._last = now;
    this.octx.drawImage(this.canvas, 0, 0, this.off.width, this.off.height);
    const frame = new VideoFrame(this.off, { timestamp: Math.round((now - this._t0) * 1000) });
    try {
      this.videoEncoder.encode(frame, { keyFrame: this._n % (FPS * 2) === 0 });
      this._n++;
      this._frames++;
    } finally {
      frame.close();
    }
  }

  /** Finish: the encoders flushed, the file closed; {blob, ext, type, frames}. */
  async stop() {
    if (!this.recording) return null;
    this.recording = false;
    cancelAnimationFrame(this._raf);
    try {
      await this.reader?.cancel();
    } catch {
      /* already closed */
    }
    try {
      if (this.videoEncoder?.state === "configured") await this.videoEncoder.flush();
      if (this.audioEncoder?.state === "configured") await this.audioEncoder.flush();
    } catch (e) {
      this.error = this.error || e;
    }
    try {
      this.videoEncoder?.close();
      this.audioEncoder?.close();
    } catch {
      /* closed */
    }
    if (this.error) throw this.error instanceof Error ? this.error : new Error(String(this.error));
    if (!this.muxer) throw new Error("no audio reached the recorder");
    this.muxer.finalize();
    const blob = new Blob([this.target.buffer], { type: "video/mp4" });
    return { blob, ext: "mp4", type: "video/mp4", frames: this._frames, audioFrames: this._audioFrames };
  }
}
