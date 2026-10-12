import type { Heard } from './listener';
import { noiseBuffer, renderOneShots } from './oneShots';

/**
 * The audio context and what every sound goes through (M15): sources into `bus`, then the pause gate, the volume, a
 * compressor and a limiter, out. Made on the first click or key press (browsers refuse earlier). Nothing here touches
 * the sim.
 */
export class AudioEngine {
  /** Every voice connects here. */
  readonly bus: GainNode;
  readonly white: AudioBuffer;
  readonly brown: AudioBuffer;
  /** The output's level, for the load check and the soundboard's meter. */
  readonly meter: AnalyserNode;
  private readonly gate: GainNode;
  private readonly volume: GainNode;
  private shots = new Map<string, AudioBuffer[]>();
  /** One-shots started or waiting to start, so a new world can cut them off. */
  private readonly playing = new Set<AudioBufferSourceNode>();
  private paused = false;
  readonly ctx: AudioContext;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    // A context made outside a click starts suspended in some browsers.
    void ctx.resume();
    this.bus = ctx.createGain();
    this.gate = ctx.createGain();
    this.volume = ctx.createGain();
    const squeeze = ctx.createDynamicsCompressor();
    squeeze.threshold.value = -16;
    squeeze.ratio.value = 5;
    squeeze.attack.value = 0.004;
    squeeze.release.value = 0.18;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.08;
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 2048;
    // Gate 14 (Logan: giant robots): everything gets more bottom and a little less top.
    const weight = ctx.createBiquadFilter();
    weight.type = 'lowshelf';
    weight.frequency.value = 160;
    weight.gain.value = 5;
    const soften = ctx.createBiquadFilter();
    soften.type = 'highshelf';
    soften.frequency.value = 3500;
    soften.gain.value = -4;
    this.bus.connect(this.gate).connect(this.volume).connect(weight).connect(soften).connect(squeeze).connect(limit).connect(this.meter).connect(ctx.destination);
    this.white = noiseBuffer(ctx.sampleRate, false, 1);
    this.brown = noiseBuffer(ctx.sampleRate, true, 2);
    renderOneShots(ctx.sampleRate, this.white, this.brown).then(
      (shots) => {
        this.shots = shots;
      },
      (err: unknown) => console.warn('sound: the one-shots could not be rendered, so there are none', err),
    );
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** True once the one-shots are rendered (a fraction of a second after the first click). */
  get ready(): boolean {
    return this.shots.size > 0;
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume.gain.setTargetAtTime(muted ? 0 : volume, this.now, 0.02);
  }

  /** Paused is silent: everything fades out in about 50 ms and back in on resume. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.gate.gain.setTargetAtTime(paused ? 0 : 1, this.now, 0.015);
  }

  /** How many variants a one-shot has (0 until rendered). */
  variants(name: string): number {
    return this.shots.get(name)?.length ?? 0;
  }

  /**
   * Plays a one-shot as the ear hears it. `gain` is the sound's own loudness (the ear's is applied here), `after` the
   * seconds until it starts, `rate` its playback rate, `variant` which take (random when absent).
   */
  play(name: string, heard: Pick<Heard, 'gain' | 'pan' | 'cutoff'>, gain: number, after = 0, rate = 1, variant?: number): void {
    const takes = this.shots.get(name);
    if (!takes || takes.length === 0) return;
    const buffer = takes[variant ?? Math.floor(Math.random() * takes.length)] ?? takes[0];
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain * heard.gain;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = heard.pan;
    let tail: AudioNode = src;
    // Near sounds keep their whole top: no filter to pay for.
    if (heard.cutoff < 16000) {
      const dull = this.ctx.createBiquadFilter();
      dull.type = 'lowpass';
      dull.frequency.value = heard.cutoff;
      dull.Q.value = 0.5;
      tail = tail.connect(dull);
    }
    tail.connect(g).connect(pan).connect(this.bus);
    src.start(this.now + Math.max(0, after));
    this.playing.add(src);
    src.onended = () => {
      this.playing.delete(src);
      pan.disconnect();
    };
  }

  /** Cuts off every one-shot, the ones still on their way included (a new world: its old blasts are gone). */
  stopOneShots(): void {
    for (const src of this.playing) {
      src.onended = null;
      src.stop();
      src.disconnect();
    }
    this.playing.clear();
  }

  /** The loudest sample at the output right now, 0 to 1 and beyond when it clips. */
  peak(): number {
    const data = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  dispose(): void {
    void this.ctx.close();
  }
}
