/**
 * The one-shot sounds (M15), each a recipe that builds a small Web Audio graph. Every recipe is rendered once into
 * buffers at startup (`renderOneShots`), a few variants each, so playing one in a fight is a buffer and three nodes.
 * All of it is noise, sines and filters: mechanical and a bit crunchy, no samples. Tune by ear on `?soundboard`.
 */

/** What a recipe draws with. `rnd` is seeded per variant, so a variant sounds the same on every load. */
export interface Kit {
  ctx: BaseAudioContext;
  out: AudioNode;
  white: AudioBuffer;
  brown: AudioBuffer;
  rnd: () => number;
}

export interface OneShot {
  seconds: number;
  variants: number;
  make(k: Kit, variant: number): void;
}

type Point = [time: number, value: number];

/** Where a dying sound's envelope ends (about -54 dB): lower and all of it sits in its first few milliseconds. */
const QUIET = 0.002;

/** Ramps a param through points; exponential (never to 0, so values are floored) unless `linear`. */
function ramp(p: AudioParam, pts: readonly Point[], linear = false): void {
  pts.forEach(([t, v], i) => {
    const value = linear ? v : Math.max(v, 1e-4);
    if (i === 0) p.setValueAtTime(value, t);
    else if (linear) p.linearRampToValueAtTime(value, t);
    else p.exponentialRampToValueAtTime(value, t);
  });
}

interface BurstOpts {
  type: BiquadFilterType;
  f: number;
  /** Where the filter ends up by the end of the burst. */
  f1?: number;
  q?: number;
  gain: number;
}

/** Filtered noise starting sharply at `t` and dying away over `dur`. */
function burst(k: Kit, buf: AudioBuffer, t: number, dur: number, o: BurstOpts): void {
  const src = k.ctx.createBufferSource();
  src.buffer = buf;
  const filter = k.ctx.createBiquadFilter();
  filter.type = o.type;
  filter.Q.value = o.q ?? 0.7;
  ramp(filter.frequency, o.f1 === undefined ? [[t, o.f]] : [[t, o.f], [t + dur, o.f1]]);
  const g = k.ctx.createGain();
  ramp(g.gain, [[t, o.gain], [t + dur, o.gain * QUIET]]);
  src.connect(filter).connect(g).connect(k.out);
  src.start(t, k.rnd() * (buf.duration - dur - 0.01), dur + 0.01);
}

/** An oscillator sliding from `f0` to `f1`, dying away over `dur`. */
function tone(k: Kit, type: OscillatorType, t: number, dur: number, f0: number, f1: number, gain: number): void {
  const osc = k.ctx.createOscillator();
  osc.type = type;
  ramp(osc.frequency, [[t, f0], [t + dur, f1]]);
  const g = k.ctx.createGain();
  ramp(g.gain, [[t, gain], [t + dur, gain * QUIET]]);
  osc.connect(g).connect(k.out);
  osc.start(t);
  osc.stop(t + dur + 0.01);
}

/** Struck metal: sines that do not line up, each a little off its pitch, the higher ones dying sooner. */
function ring(k: Kit, t: number, dur: number, freqs: readonly number[], gain: number): void {
  freqs.forEach((f, i) => {
    const off = f * (0.94 + k.rnd() * 0.12);
    tone(k, 'sine', t, dur / (1 + i * 0.35), off, off * 0.995, gain / freqs.length);
  });
}

/** A kit whose output is soft clipped on the way out (a blast pushed into the red). */
function driven(k: Kit, amount: number): Kit {
  const shaper = k.ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * amount);
  shaper.curve = curve;
  shaper.connect(k.out);
  return { ...k, out: shaper };
}

function gun(k: Kit): void {
  const pitch = 0.9 + k.rnd() * 0.2;
  burst(k, k.white, 0, 0.004, { type: 'highpass', f: 3000, gain: 1 });
  burst(k, k.white, 0, 0.07, { type: 'bandpass', f: 1800 * pitch, q: 0.8, gain: 0.9 });
  burst(k, k.brown, 0, 0.12, { type: 'lowpass', f: 500, gain: 0.8 });
  tone(k, 'sine', 0, 0.06, 140 * pitch, 55, 0.9);
  // The bolt going home.
  const bolt = 0.028 + k.rnd() * 0.006;
  burst(k, k.white, bolt, 0.012, { type: 'bandpass', f: 3200, q: 4, gain: 0.35 });
  ring(k, bolt, 0.03, [2400], 0.15);
}

const HIT_RING: Readonly<Record<string, readonly number[]>> = { metal: [2100, 3400, 5200], armor: [700, 1100, 1900] };

function hit(material: string): (k: Kit) => void {
  return (k) => {
    if (material === 'soft') {
      burst(k, k.brown, 0, 0.07, { type: 'lowpass', f: 350, gain: 1 });
      burst(k, k.white, 0, 0.01, { type: 'bandpass', f: 900, q: 1, gain: 0.3 });
    } else if (material === 'armor') {
      burst(k, k.white, 0, 0.006, { type: 'bandpass', f: 1500, gain: 0.7 });
      ring(k, 0, 0.18, HIT_RING.armor ?? [], 0.6);
      tone(k, 'sine', 0, 0.05, 180, 90, 0.4);
    } else {
      burst(k, k.white, 0, 0.003, { type: 'highpass', f: 4000, gain: 0.6 });
      ring(k, 0, 0.09, HIT_RING.metal ?? [], 0.5);
    }
  };
}

/** `size` 0 (a small charge) to 2 (a big one): bigger is longer and lower. */
function explosion(size: number): (k: Kit) => void {
  const sc = [0.7, 1, 1.5][size] ?? 1;
  return (dry) => {
    const k = driven(dry, 2.5);
    burst(k, k.white, 0, 0.012, { type: 'highpass', f: 1500, gain: 1 });
    burst(k, k.white, 0, 0.45 * sc, { type: 'lowpass', f: 4000, f1: 200, gain: 1 });
    burst(k, k.brown, 0, 0.9 * sc, { type: 'lowpass', f: 300, f1: 80, gain: 1.2 });
    tone(k, 'sine', 0, 0.5 * sc, 90 / Math.sqrt(sc), 32, 1.2);
    // Debris coming down.
    const bits = 10 + size * 6;
    for (let i = 0; i < bits; i++) {
      const t = 0.15 + k.rnd() * sc;
      burst(dry, dry.white, t, 0.01 + k.rnd() * 0.03, { type: 'bandpass', f: 800 + k.rnd() * 3000, q: 2, gain: 0.12 * (1 - (t - 0.15) / (sc * 1.05)) });
    }
  };
}

const BREAK_SNAP: Readonly<Record<string, readonly number[]>> = { metal: [1600, 2900], armor: [500, 900] };

function breakUp(material: string): (k: Kit) => void {
  return (k) => {
    const grains = 3 + Math.floor(k.rnd() * 3);
    for (let i = 0; i < grains; i++) {
      burst(k, k.white, k.rnd() * 0.1, 0.015 + k.rnd() * 0.02, { type: 'bandpass', f: 800 + k.rnd() * 1700, q: 1.5, gain: 0.6 });
    }
    const snap = BREAK_SNAP[material];
    if (snap) ring(k, 0, material === 'armor' ? 0.16 : 0.08, snap, 0.5);
    else burst(k, k.brown, 0, 0.09, { type: 'lowpass', f: 400, gain: 0.8 });
  };
}

function thud(k: Kit): void {
  tone(k, 'sine', 0, 0.14, 72, 38, 1);
  burst(k, k.brown, 0, 0.16, { type: 'lowpass', f: 220, gain: 0.9 });
  burst(k, k.white, 0, 0.02, { type: 'lowpass', f: 900, gain: 0.25 });
}

/** Loose metal shaken by a hard hit, on top of the thud. */
function rattle(k: Kit): void {
  const clanks = 5 + Math.floor(k.rnd() * 3);
  for (let i = 0; i < clanks; i++) {
    const t = k.rnd() * 0.2;
    ring(k, t, 0.05, [900 + k.rnd() * 1800, 2000 + k.rnd() * 2500], 0.25);
    burst(k, k.white, t, 0.008, { type: 'bandpass', f: 2500, gain: 0.3 });
  }
}

function decouple(k: Kit): void {
  for (const t of [0, 0.03]) {
    burst(k, k.white, t, 0.01, { type: 'bandpass', f: 2200, q: 3, gain: 0.8 });
    ring(k, t, 0.035, [1300, 2700], 0.3);
  }
  tone(k, 'sine', 0, 0.04, 160, 80, 0.5);
  burst(k, k.white, 0.03, 0.12, { type: 'highpass', f: 5000, gain: 0.2 });
}

/** A thruster lighting from cold. */
function ignite(k: Kit): void {
  burst(k, k.brown, 0, 0.22, { type: 'lowpass', f: 1500, f1: 300, gain: 1 });
  burst(k, k.white, 0, 0.05, { type: 'bandpass', f: 1200, gain: 0.5 });
  tone(k, 'sine', 0, 0.12, 110, 50, 0.6);
}

/** A laser switching on: a relay, then its capacitors charging. A machine, not a pew. */
function laserOn(k: Kit): void {
  burst(k, k.white, 0, 0.008, { type: 'bandpass', f: 2600, q: 3, gain: 0.9 });
  ring(k, 0, 0.04, [1500], 0.3);
  const osc = k.ctx.createOscillator();
  osc.type = 'sawtooth';
  ramp(osc.frequency, [[0.01, 250], [0.3, 2200]]);
  const band = k.ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 2;
  ramp(band.frequency, [[0.01, 500], [0.3, 2400]]);
  const g = k.ctx.createGain();
  ramp(g.gain, [[0.01, 0.02], [0.28, 0.18], [0.33, 1e-4]]);
  osc.connect(band).connect(g).connect(k.out);
  osc.start(0.01);
  osc.stop(0.34);
}

function laserOff(k: Kit): void {
  burst(k, k.white, 0, 0.008, { type: 'bandpass', f: 2000, q: 3, gain: 0.9 });
  ring(k, 0, 0.04, [1100], 0.3);
  tone(k, 'sine', 0, 0.1, 400, 120, 0.2);
}

export const ONE_SHOTS: Readonly<Record<string, OneShot>> = {
  gun: { seconds: 0.2, variants: 4, make: gun },
  'hit.metal': { seconds: 0.12, variants: 3, make: hit('metal') },
  'hit.armor': { seconds: 0.22, variants: 3, make: hit('armor') },
  'hit.soft': { seconds: 0.1, variants: 2, make: hit('soft') },
  'explosion.small': { seconds: 1.1, variants: 2, make: explosion(0) },
  'explosion.medium': { seconds: 1.5, variants: 2, make: explosion(1) },
  'explosion.large': { seconds: 2.2, variants: 2, make: explosion(2) },
  'break.metal': { seconds: 0.2, variants: 3, make: breakUp('metal') },
  'break.armor': { seconds: 0.24, variants: 2, make: breakUp('armor') },
  'break.soft': { seconds: 0.2, variants: 2, make: breakUp('soft') },
  thud: { seconds: 0.25, variants: 2, make: thud },
  rattle: { seconds: 0.3, variants: 3, make: rattle },
  decouple: { seconds: 0.18, variants: 2, make: decouple },
  ignite: { seconds: 0.28, variants: 2, make: ignite },
  'laser.on': { seconds: 0.36, variants: 1, make: laserOn },
  'laser.off': { seconds: 0.14, variants: 1, make: laserOff },
};

/** What a part sounds like struck or broken: its def's `sound.hit` when the table has it, else metal. */
export function material(hit: string | undefined): string {
  return hit !== undefined && `hit.${hit}` in ONE_SHOTS ? hit : 'metal';
}

/** The blast sound for a radius in meters. */
export function explosionFor(radius: number): string {
  return radius < 2.75 ? 'explosion.small' : radius < 5 ? 'explosion.medium' : 'explosion.large';
}

/** The loudest sample of every rendered buffer. */
export const PEAK = 0.9;

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nameSeed(name: string, variant: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h + variant * 7919) >>> 0;
}

/** Two seconds of noise: white, or brown (white summed and leaked, so it rumbles). */
export function noiseBuffer(sampleRate: number, brown: boolean, seed: number): AudioBuffer {
  const buf = new AudioBuffer({ length: sampleRate * 2, sampleRate, numberOfChannels: 1 });
  const data = buf.getChannelData(0);
  const rnd = seeded(seed);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const w = rnd() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    } else data[i] = w;
  }
  return buf;
}

/** Scales a buffer so its loudest sample is `PEAK`, and fades its last 3 ms so it never ends on a click. */
export function finish(buf: AudioBuffer): AudioBuffer {
  const data = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] ?? 0));
  const scale = peak > 0 ? PEAK / peak : 1;
  const fade = Math.min(data.length, Math.floor(buf.sampleRate * 0.003));
  for (let i = 0; i < data.length; i++) {
    const left = data.length - 1 - i;
    data[i] = (data[i] ?? 0) * scale * (left < fade ? left / fade : 1);
  }
  return buf;
}

/** Renders one variant of one sound. */
export async function renderOneShot(name: string, variant: number, sampleRate: number, white: AudioBuffer, brown: AudioBuffer): Promise<AudioBuffer> {
  const shot = ONE_SHOTS[name];
  if (!shot) throw new Error(`no one-shot named ${name}`);
  const ctx = new OfflineAudioContext(1, Math.ceil((shot.seconds + 0.02) * sampleRate), sampleRate);
  shot.make({ ctx, out: ctx.destination, white, brown, rnd: seeded(nameSeed(name, variant)) }, variant);
  return finish(await ctx.startRendering());
}

/** Every variant of every one-shot, by name. */
export async function renderOneShots(sampleRate: number, white: AudioBuffer, brown: AudioBuffer): Promise<Map<string, AudioBuffer[]>> {
  const out = new Map<string, AudioBuffer[]>();
  await Promise.all(
    Object.entries(ONE_SHOTS).map(async ([name, shot]) => {
      out.set(name, await Promise.all(Array.from({ length: shot.variants }, (_, v) => renderOneShot(name, v, sampleRate, white, brown))));
    }),
  );
  return out;
}
