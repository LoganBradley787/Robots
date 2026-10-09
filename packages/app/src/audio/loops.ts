import type { World } from '@robots/sim-core';
import type { AudioEngine } from './AudioEngine';
import { hear, type Ear, type Heard } from './listener';
import { LOOP_DRIVES, loopGain, meanLevel, partLevel, pickLoops, type LoopDrive, type LoopGroup } from './loopLevels';

/** A running loop: a small graph that sounds until stopped. `level` is the parts' mean (0 to 1), `grip` how many touch something. */
interface Voice {
  out: AudioNode;
  set(level: number, grip: number, now: number): void;
  stop(at: number): void;
}

type Maker = (engine: AudioEngine, detune: number) => Voice;

/** How fast a voice follows its parts, seconds. */
const FOLLOW = 0.06;

function noiseLoop(engine: AudioEngine, buf: AudioBuffer): AudioBufferSourceNode {
  const src = engine.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start(0, Math.random() * buf.duration);
  return src;
}

function osc(engine: AudioEngine, type: OscillatorType, freq: number): OscillatorNode {
  const o = engine.ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start();
  return o;
}

function gain(engine: AudioEngine, value: number): GainNode {
  const g = engine.ctx.createGain();
  g.gain.value = value;
  return g;
}

function filter(engine: AudioEngine, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = engine.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Blades: two saws a few cents apart at the blade rate, and air chopped at the same rate. */
const propeller: Maker = (engine, detune) => {
  const out = gain(engine, 1);
  const a = osc(engine, 'sawtooth', 40);
  const b = osc(engine, 'sawtooth', 40);
  b.detune.value = 7;
  const tone = filter(engine, 'lowpass', 600);
  a.connect(tone);
  b.connect(tone);
  tone.connect(gain(engine, 0.35)).connect(out);
  const air = noiseLoop(engine, engine.white);
  const chop = gain(engine, 0.5);
  const lfo = osc(engine, 'sine', 40);
  lfo.connect(gain(engine, 0.5)).connect(chop.gain);
  air.connect(filter(engine, 'bandpass', 1400, 0.6)).connect(chop).connect(gain(engine, 0.3)).connect(out);
  return {
    out,
    set(level, _grip, now) {
      const f = (40 + 70 * level) * detune;
      for (const o of [a, b, lfo]) o.frequency.setTargetAtTime(f, now, FOLLOW);
      tone.frequency.setTargetAtTime(600 + 1200 * level, now, FOLLOW);
    },
    stop(at) {
      for (const n of [a, b, lfo, air]) n.stop(at);
    },
  };
};

/** A burn: low noise that opens up with throttle, a roar in the middle, a rumble under it. */
const thruster: Maker = (engine, detune) => {
  const out = gain(engine, 1);
  const low = noiseLoop(engine, engine.brown);
  const open = filter(engine, 'lowpass', 300);
  low.connect(open).connect(gain(engine, 0.9)).connect(out);
  const hiss = noiseLoop(engine, engine.white);
  const roar = filter(engine, 'bandpass', 500, 0.8);
  hiss.connect(roar).connect(gain(engine, 0.3)).connect(out);
  const rumble = osc(engine, 'sine', 45 * detune);
  rumble.connect(gain(engine, 0.25)).connect(out);
  return {
    out,
    set(level, _grip, now) {
      open.frequency.setTargetAtTime(300 + 900 * level, now, FOLLOW);
      roar.frequency.setTargetAtTime((500 + 400 * level) * detune, now, FOLLOW);
    },
    stop(at) {
      for (const n of [low, hiss, rumble]) n.stop(at);
    },
  };
};

/** A motor's whine by its spin, and the tire's rumble while it touches something. */
const wheel: Maker = (engine, detune) => {
  const out = gain(engine, 1);
  const whine = osc(engine, 'triangle', 60);
  whine.connect(gain(engine, 0.3)).connect(out);
  const road = noiseLoop(engine, engine.brown);
  const band = filter(engine, 'bandpass', 200, 1);
  const roll = gain(engine, 0);
  road.connect(band).connect(roll).connect(out);
  return {
    out,
    set(level, grip, now) {
      whine.frequency.setTargetAtTime((60 + 340 * level) * detune, now, FOLLOW);
      band.frequency.setTargetAtTime(200 + 300 * level, now, FOLLOW);
      roll.gain.setTargetAtTime(1.2 * (0.25 + 0.75 * grip), now, FOLLOW);
    },
    stop(at) {
      for (const n of [whine, road]) n.stop(at);
    },
  };
};

/** A laser running: a transformer's hum (two tones that beat) and a harsh buzz riding on it. No pew. */
const laser: Maker = (engine, detune) => {
  const out = gain(engine, 1);
  const top = filter(engine, 'lowpass', 4000);
  top.connect(out);
  const a = osc(engine, 'sawtooth', 100 * detune);
  const b = osc(engine, 'square', 120.7 * detune);
  a.connect(gain(engine, 0.3)).connect(top);
  b.connect(gain(engine, 0.15)).connect(top);
  const air = noiseLoop(engine, engine.white);
  const buzz = gain(engine, 0.5);
  a.connect(gain(engine, 0.5)).connect(buzz.gain);
  air.connect(filter(engine, 'bandpass', 2500, 6)).connect(buzz).connect(gain(engine, 0.6)).connect(top);
  return {
    out,
    set() {},
    stop(at) {
      for (const n of [a, b, air]) n.stop(at);
    },
  };
};

/** Where a beam burns: a crackle that flickers. */
const burn: Maker = (engine) => {
  const out = gain(engine, 1);
  const air = noiseLoop(engine, engine.white);
  const flicker = gain(engine, 0.5);
  air.connect(filter(engine, 'highpass', 3500)).connect(flicker).connect(out);
  const low = noiseLoop(engine, engine.brown);
  low.connect(filter(engine, 'bandpass', 700, 1.5)).connect(gain(engine, 0.5)).connect(flicker);
  return {
    out,
    set(_level, _grip, now) {
      flicker.gain.setTargetAtTime(0.15 + Math.random() * 0.85, now, 0.008);
    },
    stop(at) {
      for (const n of [air, low]) n.stop(at);
    },
  };
};

/** The looping voices by name (a part def's `sound.run`), and how loud each is against the others. */
export const LOOP_VOICES: Readonly<Record<string, { make: Maker; gain: number }>> = {
  propeller: { make: propeller, gain: 0.7 },
  thruster: { make: thruster, gain: 0.9 },
  wheel: { make: wheel, gain: 0.4 },
  laser: { make: laser, gain: 0.7 },
  burn: { make: burn, gain: 0.5 },
};

/** A voice with its place in the mix: the ear's gain, pan and dulling. */
export interface Placed {
  voice: Voice;
  amp: GainNode;
  pan: StereoPannerNode;
  dull: BiquadFilterNode;
  base: number;
}

/** Starts a looping voice, silent until placed. `seed` (a robot id) sets it a little off pitch, so a swarm is not one tone. */
export function startLoop(engine: AudioEngine, name: string, seed: number): Placed | undefined {
  const spec = LOOP_VOICES[name];
  if (!spec) return undefined;
  const voice = spec.make(engine, 0.94 + ((seed * 0.6180339887) % 1) * 0.12);
  const amp = gain(engine, 0);
  const dull = filter(engine, 'lowpass', 20000, 0.5);
  const pan = engine.ctx.createStereoPanner();
  voice.out.connect(dull).connect(amp).connect(pan).connect(engine.bus);
  return { voice, amp, pan, dull, base: spec.gain };
}

/** Puts a loop where the ear hears it, `loud` being its parts' loudness (`loopGain`). */
export function placeLoop(p: Placed, heard: Heard, loud: number, now: number): void {
  p.amp.gain.setTargetAtTime(p.base * loud * heard.gain, now, FOLLOW);
  p.pan.pan.setTargetAtTime(heard.pan, now, FOLLOW);
  p.dull.frequency.setTargetAtTime(heard.cutoff, now, FOLLOW);
}

/** Fades a loop out and lets go of it. */
export function stopLoop(p: Placed, now: number): void {
  p.amp.gain.setTargetAtTime(0, now, FADE / 3);
  p.voice.stop(now + FADE * 2);
  setTimeout(() => p.pan.disconnect(), FADE * 3000);
}

interface SoundingPart {
  id: string;
  group: number;
  voice: string;
  drive: LoopDrive;
  def: { behaviorConfig?: Record<string, number> };
}

/** Seconds between two looks at the parts (20 a second; the voices glide between). */
const LOOK_EVERY = 0.05;
const FADE = 0.1;

/**
 * The looping sounds (M15): one voice per robot per voice name, never per part, so 732 boosters are one burn. Every
 * look it sums each robot's parts by voice, gives voices to the loudest at the ear, and fades the rest.
 */
export class LoopBank {
  private readonly placed = new Map<string, Placed>();
  /** Each robot's parts that make a looping sound, rebuilt when the robot is (its `version`). */
  private readonly parts = new Map<number, { version: number; list: SoundingPart[] }>();
  /** Each group's summed level at the last look, to hear things start and stop. */
  private last = new Map<string, LoopGroup>();
  private lastLook = -1;
  /** False until the first look: what is already running then did not just start. */
  private primed = false;
  private readonly warned = new Set<string>();

  /** `started` and `stopped` are called with groups that went from silent to sounding, and back. */
  update(engine: AudioEngine, world: World, ear: Ear, started: (g: LoopGroup) => void, stopped: (g: LoopGroup) => void): void {
    const now = engine.now;
    if (now - this.lastLook < LOOK_EVERY) return;
    this.lastLook = now;
    const groups = this.groups(world);
    const seen = new Map<string, LoopGroup>();
    for (const g of groups) {
      seen.set(g.key, g);
      if (this.primed && g.sum > 0 && (this.last.get(g.key)?.sum ?? 0) === 0) started(g);
    }
    if (this.primed) for (const [key, g] of this.last) if (g.sum > 0 && (seen.get(key)?.sum ?? 0) === 0) stopped(g);
    this.last = seen;
    this.primed = true;

    const picked = new Set<string>();
    for (const g of pickLoops(groups, (c) => hear(ear, c.x, c.y).gain * (LOOP_VOICES[c.voice]?.gain ?? 0))) {
      picked.add(g.key);
      const p = this.placed.get(g.key) ?? this.start(engine, g);
      if (!p) continue;
      this.place(p, hear(ear, g.x, g.y), loopGain(g.sum), now);
      p.voice.set(meanLevel(g), g.on > 0 ? Math.min(1, (g.grip ?? 0) / g.on) : 0, now);
    }
    for (const [key, p] of this.placed) {
      if (picked.has(key)) continue;
      stopLoop(p, now);
      this.placed.delete(key);
    }
  }

  /** Everything stops now (a new world, the builder). */
  clear(): void {
    for (const p of this.placed.values()) {
      p.amp.gain.value = 0;
      p.voice.stop(0);
      p.pan.disconnect();
    }
    this.placed.clear();
    this.parts.clear();
    this.last = new Map();
    this.primed = false;
    this.lastLook = -1;
  }

  get sounding(): number {
    return this.placed.size;
  }

  private start(engine: AudioEngine, g: LoopGroup): Placed | undefined {
    const p = startLoop(engine, g.voice, g.robot);
    if (p) this.placed.set(g.key, p);
    return p;
  }

  private place(p: Placed, heard: Heard, loud: number, now: number): void {
    placeLoop(p, heard, loud, now);
  }

  /** Every robot's sounding parts summed by voice, and every robot's beams. */
  private groups(world: World): LoopGroup[] {
    const out: LoopGroup[] = [];
    const live = new Set<number>();
    for (const robot of world.robots) {
      live.add(robot.id);
      let cached = this.parts.get(robot.id);
      if (!cached || cached.version !== robot.version || cached.list.length > robot.parts.size) {
        const list: SoundingPart[] = [];
        for (const part of robot.parts.values()) {
          const voice = part.def.sound?.run;
          if (voice === undefined) continue;
          const drive = LOOP_DRIVES[voice];
          if (!LOOP_VOICES[voice]) {
            if (!this.warned.has(voice)) console.warn(`sound: no looping voice named "${voice}" (part ${part.def.id})`);
            this.warned.add(voice);
          }
          if (drive && LOOP_VOICES[voice]) list.push({ id: part.id, group: part.group, voice, drive, def: part.def });
        }
        cached = { version: robot.version, list };
        this.parts.set(robot.id, cached);
      }
      if (cached.list.length === 0) continue;
      // A part that needs energy is silent once its robot has none to give (as it stops looking busy).
      if (!world.unlimitedEnergy && (world.energy(robot.id)?.stored ?? 0) <= 0) continue;
      const channels = world.robotChannels(robot.id);
      const root = robot.groups[0];
      if (!root) continue;
      const at = world.physics.state(root.bodyId);
      const byVoice = new Map<string, LoopGroup>();
      for (const part of cached.list) {
        if (!robot.parts.has(part.id)) continue;
        const level = partLevel(part.drive, part, (c) => channels?.get(part.id)?.get(c), (o) => world.partOutput(robot.id, part.id, o));
        if (level <= 0.01) continue;
        let g = byVoice.get(part.voice);
        if (!g) {
          g = { key: `${robot.id}:${part.voice}`, robot: robot.id, voice: part.voice, sum: 0, on: 0, x: at.x, y: at.y, grip: 0 };
          byVoice.set(part.voice, g);
        }
        g.sum += level;
        g.on++;
        if (part.drive.contact === true) {
          const body = robot.groups[part.group]?.bodyId;
          if (body !== undefined && world.physics.contactPoints(body).length > 0) g.grip = (g.grip ?? 0) + 1;
        }
      }
      out.push(...byVoice.values());
    }
    for (const id of this.parts.keys()) if (!live.has(id)) this.parts.delete(id);
    // Lasers are heard from their beams: the hum where the beam leaves, the crackle where it burns.
    const beams = new Map<string, LoopGroup>();
    for (const b of world.liveBeams()) {
      if (b.power <= 0) continue;
      const hum = beams.get(`${b.robot}:laser`) ?? { key: `${b.robot}:laser`, robot: b.robot, voice: 'laser', sum: 0, on: 0, x: b.x1, y: b.y1 };
      hum.sum += b.power;
      hum.on++;
      beams.set(hum.key, hum);
      if (b.hitPart === undefined) continue;
      const crackle = beams.get(`${b.robot}:burn`) ?? { key: `${b.robot}:burn`, robot: b.robot, voice: 'burn', sum: 0, on: 0, x: b.x2, y: b.y2 };
      crackle.sum += b.power * 0.5 ** b.smoke;
      crackle.on++;
      beams.set(crackle.key, crackle);
    }
    out.push(...beams.values());
    return out;
  }
}
