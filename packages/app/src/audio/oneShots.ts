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

/**
 * Gate 14 (Logan): these are giant robots, not little tinky guys. Every recipe below is built from the bottom up: a
 * low thump that carries it, a wide body of noise, and only a little top for the edge. Most are driven into soft
 * clipping, which is what makes a low sound read as heavy on small speakers.
 */

/** A heavy gun: a cannon's thump and a wide crack, then the breech slamming. */
function gun(dry: Kit): void {
  const k = driven(dry, 2.2);
  const pitch = 0.9 + k.rnd() * 0.2;
  burst(k, k.white, 0, 0.006, { type: 'bandpass', f: 1400, q: 0.7, gain: 0.7 });
  burst(k, k.white, 0, 0.1, { type: 'bandpass', f: 800 * pitch, q: 0.6, gain: 0.9 });
  burst(k, k.brown, 0, 0.3, { type: 'lowpass', f: 450, f1: 140, gain: 1.2 });
  tone(k, 'sine', 0, 0.2, 115 * pitch, 42, 1.3);
  tone(k, 'triangle', 0, 0.12, 230 * pitch, 80, 0.4);
  // The breech going home: a low clack, not a click.
  const breech = 0.05 + k.rnd() * 0.01;
  burst(dry, dry.white, breech, 0.03, { type: 'bandpass', f: 900, q: 2, gain: 0.25 });
  ring(dry, breech, 0.06, [430, 690], 0.18);
}

const HIT_RING: Readonly<Record<string, readonly number[]>> = { metal: [310, 520, 840], armor: [170, 290, 460] };

/** A shell landing: a thunk that goes into the part, with the plate's low ring under it. */
function hit(material: string): (k: Kit) => void {
  return (dry) => {
    const k = driven(dry, 1.8);
    if (material === 'soft') {
      tone(k, 'sine', 0, 0.11, 120, 50, 1);
      burst(k, k.brown, 0, 0.12, { type: 'lowpass', f: 320, gain: 1 });
      burst(k, k.white, 0, 0.02, { type: 'bandpass', f: 600, q: 1, gain: 0.25 });
    } else if (material === 'armor') {
      tone(k, 'sine', 0, 0.16, 130, 48, 1.2);
      burst(k, k.brown, 0, 0.14, { type: 'lowpass', f: 380, gain: 0.9 });
      burst(k, k.white, 0, 0.012, { type: 'bandpass', f: 900, q: 0.8, gain: 0.5 });
      ring(dry, 0, 0.32, HIT_RING.armor ?? [], 0.45);
    } else {
      tone(k, 'sine', 0, 0.11, 170, 65, 1.1);
      burst(k, k.brown, 0, 0.1, { type: 'lowpass', f: 520, gain: 0.8 });
      burst(k, k.white, 0, 0.01, { type: 'bandpass', f: 1300, q: 0.8, gain: 0.45 });
      ring(dry, 0, 0.16, HIT_RING.metal ?? [], 0.35);
    }
  };
}

/** `size` 0 (a small charge) to 2 (a big one): bigger is longer and lower. */
function explosion(size: number): (k: Kit) => void {
  const sc = [0.8, 1.15, 1.7][size] ?? 1;
  return (dry) => {
    const k = driven(dry, 3);
    burst(k, k.white, 0, 0.02, { type: 'bandpass', f: 900, q: 0.5, gain: 1 });
    burst(k, k.white, 0, 0.5 * sc, { type: 'lowpass', f: 2600, f1: 140, gain: 1 });
    burst(k, k.brown, 0, 1.1 * sc, { type: 'lowpass', f: 320, f1: 60, gain: 1.5 });
    tone(k, 'sine', 0, 0.7 * sc, 95 / Math.sqrt(sc), 28, 1.5);
    tone(k, 'triangle', 0, 0.35 * sc, 150 / Math.sqrt(sc), 45, 0.5);
    // Heavy pieces coming down: thumps, not a patter.
    const bits = 5 + size * 3;
    for (let i = 0; i < bits; i++) {
      const t = 0.2 + k.rnd() * sc * 0.9;
      const fade = 1 - (t - 0.2) / (sc * 0.95);
      burst(dry, dry.brown, t, 0.05 + k.rnd() * 0.06, { type: 'lowpass', f: 300 + k.rnd() * 500, gain: 0.35 * fade });
      burst(dry, dry.white, t, 0.02, { type: 'bandpass', f: 500 + k.rnd() * 900, q: 1.5, gain: 0.1 * fade });
    }
  };
}

const BREAK_SNAP: Readonly<Record<string, readonly number[]>> = { metal: [360, 610], armor: [190, 330] };

/** A part torn off a giant: a low crunch of buckling metal, and the thump of it letting go. */
function breakUp(material: string): (k: Kit) => void {
  return (dry) => {
    const k = driven(dry, 2);
    tone(k, 'sine', 0, 0.16, 125, 45, 1);
    burst(k, k.brown, 0, 0.22, { type: 'lowpass', f: 420, f1: 150, gain: 1 });
    const grains = 3 + Math.floor(k.rnd() * 3);
    for (let i = 0; i < grains; i++) {
      burst(k, k.white, k.rnd() * 0.16, 0.03 + k.rnd() * 0.04, { type: 'bandpass', f: 300 + k.rnd() * 800, q: 1.2, gain: 0.5 });
    }
    const snap = BREAK_SNAP[material];
    if (snap) ring(dry, 0.01, material === 'armor' ? 0.3 : 0.2, snap, 0.3);
  };
}

function thud(dry: Kit): void {
  const k = driven(dry, 2);
  tone(k, 'sine', 0, 0.26, 85, 30, 1.3);
  tone(k, 'triangle', 0, 0.1, 150, 60, 0.35);
  burst(k, k.brown, 0, 0.3, { type: 'lowpass', f: 240, f1: 90, gain: 1.1 });
  burst(k, k.white, 0, 0.025, { type: 'lowpass', f: 600, gain: 0.25 });
}

/** Heavy plates shaken by a hard hit, on top of the thud. */
function rattle(k: Kit): void {
  const clanks = 4 + Math.floor(k.rnd() * 3);
  for (let i = 0; i < clanks; i++) {
    const t = k.rnd() * 0.25;
    ring(k, t, 0.12, [220 + k.rnd() * 400, 500 + k.rnd() * 700], 0.3);
    burst(k, k.brown, t, 0.05, { type: 'lowpass', f: 500, gain: 0.35 });
    burst(k, k.white, t, 0.012, { type: 'bandpass', f: 900, gain: 0.2 });
  }
}

/** Clamps the size of a truck letting go. */
function decouple(dry: Kit): void {
  const k = driven(dry, 1.8);
  for (const t of [0, 0.045]) {
    tone(k, 'sine', t, 0.09, 140, 55, 0.9);
    burst(k, k.white, t, 0.02, { type: 'bandpass', f: 850, q: 1.5, gain: 0.6 });
    ring(dry, t, 0.1, [330, 560], 0.3);
  }
  burst(k, k.brown, 0, 0.16, { type: 'lowpass', f: 350, gain: 0.7 });
  burst(dry, dry.white, 0.05, 0.14, { type: 'bandpass', f: 2200, q: 0.5, gain: 0.08 });
}

/** A thruster lighting from cold: a boom, then the burn takes over. */
function ignite(dry: Kit): void {
  const k = driven(dry, 2.2);
  tone(k, 'sine', 0, 0.22, 100, 36, 1.1);
  burst(k, k.brown, 0, 0.36, { type: 'lowpass', f: 900, f1: 180, gain: 1.2 });
  burst(k, k.white, 0, 0.08, { type: 'bandpass', f: 700, q: 0.6, gain: 0.5 });
}

/**
 * A laser firing (Logan: a giant beam that obliterates what it meets, not a little whoop): the bank dumping all at
 * once. A slam, a tearing roar that opens up, and a deep tone dropping under it into the hum.
 */
function laserOn(dry: Kit): void {
  const k = driven(dry, 3.5);
  burst(k, k.white, 0, 0.03, { type: 'bandpass', f: 1000, q: 0.5, gain: 1 });
  tone(k, 'sine', 0, 0.55, 130, 34, 1.5);
  tone(k, 'sawtooth', 0, 0.45, 110, 50, 0.5);
  burst(k, k.brown, 0, 0.7, { type: 'lowpass', f: 1400, f1: 220, gain: 1.4 });
  burst(k, k.white, 0, 0.4, { type: 'bandpass', f: 500, f1: 1600, q: 0.8, gain: 0.6 });
  // The contactor closing, the size of a door.
  ring(dry, 0, 0.18, [240, 410], 0.3);
}

/** The beam cutting out: the contactor dropping and the bank winding down. */
function laserOff(dry: Kit): void {
  const k = driven(dry, 2.5);
  tone(k, 'sine', 0, 0.5, 105, 30, 1.2);
  tone(k, 'sawtooth', 0, 0.3, 100, 40, 0.3);
  burst(k, k.brown, 0, 0.45, { type: 'lowpass', f: 700, f1: 120, gain: 1 });
  burst(k, k.white, 0, 0.025, { type: 'bandpass', f: 800, q: 1, gain: 0.6 });
  ring(dry, 0, 0.16, [210, 360], 0.3);
}

export const ONE_SHOTS: Readonly<Record<string, OneShot>> = {
  gun: { seconds: 0.42, variants: 4, make: gun },
  'hit.metal': { seconds: 0.24, variants: 3, make: hit('metal') },
  'hit.armor': { seconds: 0.4, variants: 3, make: hit('armor') },
  'hit.soft': { seconds: 0.18, variants: 2, make: hit('soft') },
  'explosion.small': { seconds: 1.3, variants: 2, make: explosion(0) },
  'explosion.medium': { seconds: 1.7, variants: 2, make: explosion(1) },
  'explosion.large': { seconds: 1.97, variants: 2, make: explosion(2) },
  'break.metal': { seconds: 0.34, variants: 3, make: breakUp('metal') },
  'break.armor': { seconds: 0.4, variants: 2, make: breakUp('armor') },
  'break.soft': { seconds: 0.3, variants: 2, make: breakUp('soft') },
  thud: { seconds: 0.36, variants: 2, make: thud },
  rattle: { seconds: 0.42, variants: 3, make: rattle },
  decouple: { seconds: 0.24, variants: 2, make: decouple },
  ignite: { seconds: 0.42, variants: 2, make: ignite },
  'laser.on': { seconds: 0.75, variants: 2, make: laserOn },
  'laser.off': { seconds: 0.55, variants: 2, make: laserOff },
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
