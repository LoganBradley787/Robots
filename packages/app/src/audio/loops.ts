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

/** Soft clipping for a loop: it thickens a low tone into something that reads as heavy. */
function drive(engine: AudioEngine, amount: number): WaveShaperNode {
  const shaper = engine.ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * amount);
  shaper.curve = curve;
  return shaper;
}

/**
 * Gate 14 (Logan: giant robots, not little tinky guys; the first take was leafy and light). Every loop is built on a
 * low tone and a wide low body of noise; the top is only an edge.
 */

/** Big rotors: a slow heavy blade beat with a sub under it, and the air they throw down, thumped at the same rate. */
const propeller: Maker = (engine, detune) => {
  const out = gain(engine, 1);
  const a = osc(engine, 'sawtooth', 24);
  const b = osc(engine, 'sawtooth', 24);
  b.detune.value = 9;
  const sub = osc(engine, 'sine', 24);
  const tone = filter(engine, 'lowpass', 320);
  a.connect(tone);
  b.connect(tone);
  tone.connect(drive(engine, 1.6)).connect(gain(engine, 0.45)).connect(out);
  sub.connect(gain(engine, 0.5)).connect(out);
  const air = noiseLoop(engine, engine.brown);
  const chop = gain(engine, 0.45);
  const lfo = osc(engine, 'sine', 24);
  lfo.connect(gain(engine, 0.45)).connect(chop.gain);
  const wash = filter(engine, 'lowpass', 500, 0.6);
  air.connect(wash).connect(chop).connect(gain(engine, 0.9)).connect(out);
  return {
    out,
    set(level, _grip, now) {
      const f = (24 + 34 * level) * detune;
      for (const o of [a, b, lfo]) o.frequency.setTargetAtTime(f, now, FOLLOW);
      // The sub sits an octave up so small speakers still carry the beat.
      sub.frequency.setTargetAtTime(f * 2, now, FOLLOW);
      tone.frequency.setTargetAtTime(320 + 520 * level, now, FOLLOW);
      wash.frequency.setTargetAtTime(500 + 700 * level, now, FOLLOW);
    },
    stop(at) {
      for (const n of [a, b, sub, lfo, air]) n.stop(at);
    },
  };
};

/** Noise played so slowly it is a random wander, a few tens of changes a second: what makes fire flutter instead of hiss. */
function flutter(engine: AudioEngine, rate: number): AudioBufferSourceNode {
  const src = noiseLoop(engine, engine.white);
  src.playbackRate.value = rate;
  return src;
}

/**
 * A rocket engine (Logan, round 2: the first sounded like a fan, with no racing fire behind it). A fan is steady and
 * has a tone; fire has neither. So no tone at all here: a roar driven into clipping, a tearing band of flame up in
 * the mids, both fluttering at random, and a rumble under them that never repeats.
 */
const thruster: Maker = (engine, detune) => {
  const out = gain(engine, 1);
  const hot = drive(engine, 5);
  hot.connect(gain(engine, 0.55)).connect(out);
  // The body of the burn.
  const low = noiseLoop(engine, engine.brown);
  const open = filter(engine, 'lowpass', 350);
  const surge = gain(engine, 0.9);
  low.connect(open).connect(surge).connect(hot);
  // The flame tearing: a wide band in the mids, breaking up at random.
  const fire = noiseLoop(engine, engine.white);
  const tear = filter(engine, 'bandpass', 1400, 0.5);
  const crackle = gain(engine, 0.3);
  fire.connect(tear).connect(crackle).connect(hot);
  const breakUp = flutter(engine, 0.004 * detune);
  breakUp.connect(gain(engine, 0.9)).connect(crackle.gain);
  const heave = flutter(engine, 0.0011);
  heave.connect(gain(engine, 0.5)).connect(surge.gain);
  // The ground shaking: the bottom of the noise, loud, with no pitch.
  const shake = noiseLoop(engine, engine.brown);
  const deep = filter(engine, 'lowpass', 110, 1.2);
  shake.connect(deep).connect(gain(engine, 1.6)).connect(out);
  const sources = [low, fire, shake, breakUp, heave];
  return {
    out,
    set(level, _grip, now) {
      open.frequency.setTargetAtTime(350 + 1500 * level, now, FOLLOW);
      tear.frequency.setTargetAtTime((1400 + 1400 * level) * detune, now, FOLLOW);
      crackle.gain.setTargetAtTime(0.2 + 0.5 * level, now, FOLLOW);
      deep.frequency.setTargetAtTime(110 + 70 * level, now, FOLLOW);
    },
    stop(at) {
      for (const n of sources) n.stop(at);
    },
  };
};

/** A heavy drive motor's growl by its spin, and the weight of the wheel on the ground. */
const wheel: Maker = (engine, detune) => {
  const out = gain(engine, 1);
  const growl = osc(engine, 'sawtooth', 35);
  const body = filter(engine, 'lowpass', 300);
  growl.connect(body).connect(gain(engine, 0.35)).connect(out);
  const road = noiseLoop(engine, engine.brown);
  const band = filter(engine, 'lowpass', 180, 0.8);
  const roll = gain(engine, 0);
  road.connect(band).connect(roll).connect(out);
  return {
    out,
    set(level, grip, now) {
      growl.frequency.setTargetAtTime((35 + 130 * level) * detune, now, FOLLOW);
      body.frequency.setTargetAtTime(300 + 500 * level, now, FOLLOW);
      band.frequency.setTargetAtTime(180 + 320 * level, now, FOLLOW);
      roll.gain.setTargetAtTime(1.6 * (0.2 + 0.8 * grip), now, FOLLOW);
    },
    stop(at) {
      for (const n of [growl, road]) n.stop(at);
    },
  };
};

/**
 * A laser burning (Logan: a giant beam that obliterates what it meets). A power station pushed past its limit: two
 * deep saws beating against each other, a sub under them, all of it driven hard, and a roar of air torn at the
 * mains rate riding on top. No pew, no whine.
 */
const laser: Maker = (engine, detune) => {
  const out = gain(engine, 1);
  const hot = drive(engine, 4);
  const top = filter(engine, 'lowpass', 1800, 0.6);
  hot.connect(top).connect(gain(engine, 0.6)).connect(out);
  const a = osc(engine, 'sawtooth', 55 * detune);
  const b = osc(engine, 'sawtooth', 55.9 * detune);
  const c = osc(engine, 'square', 110.6 * detune);
  a.connect(gain(engine, 0.5)).connect(hot);
  b.connect(gain(engine, 0.5)).connect(hot);
  c.connect(gain(engine, 0.2)).connect(hot);
  const sub = osc(engine, 'sine', 82.5 * detune);
  sub.connect(gain(engine, 0.45)).connect(out);
  // The air along the beam, torn at the mains rate.
  const air = noiseLoop(engine, engine.brown);
  const tear = gain(engine, 0.6);
  a.connect(gain(engine, 0.4)).connect(tear.gain);
  air.connect(filter(engine, 'lowpass', 900, 0.7)).connect(tear).connect(gain(engine, 1.2)).connect(out);
  const edge = noiseLoop(engine, engine.white);
  edge.connect(filter(engine, 'bandpass', 1100, 0.9)).connect(gain(engine, 0.12)).connect(out);
  // A slow swell, so it heaves instead of sitting still.
  const swell = osc(engine, 'sine', 0.7);
  swell.connect(gain(engine, 0.12)).connect(out.gain);
  return {
    out,
    set() {},
    stop(at) {
      for (const n of [a, b, c, sub, air, edge, swell]) n.stop(at);
    },
  };
};

/** A curve that passes only what is over `over` (0 to 1) of what goes in: slow noise through it comes out as sparse pops. */
function pops(engine: AudioEngine, over: number): WaveShaperNode {
  const shaper = engine.ctx.createWaveShaper();
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.sign(x) * Math.max(0, (Math.abs(x) - over) / (1 - over));
  }
  shaper.curve = curve;
  return shaper;
}

/**
 * Where a beam burns (Logan, round 2: the first was wind noise; "I have to feel something melting under the immense
 * power of this giant laser"). Steady noise is wind, so almost none of this is steady:
 * - a hard sizzle, like a ton of steel dropped in a fryer, flickering;
 * - spits and pops as bits boil off;
 * - the melt itself: a thick low tone that keeps lurching in pitch, bubbling;
 * - the metal that is left groaning as it gives.
 */
const burn: Maker = (engine) => {
  const out = gain(engine, 1);
  // Sizzle.
  const fry = noiseLoop(engine, engine.white);
  const sizzle = gain(engine, 0.3);
  fry.connect(filter(engine, 'highpass', 2600, 0.7)).connect(sizzle).connect(gain(engine, 0.5)).connect(out);
  const fryFlicker = flutter(engine, 0.006);
  fryFlicker.connect(gain(engine, 0.6)).connect(sizzle.gain);
  // Spits: a few tens of sharp pops a second, and a slower, heavier set under them (about ten a second).
  const spit = flutter(engine, 0.02);
  spit.connect(pops(engine, 0.95)).connect(filter(engine, 'bandpass', 2200, 0.6)).connect(gain(engine, 2)).connect(out);
  const glob = flutter(engine, 0.004);
  glob.connect(pops(engine, 0.9)).connect(filter(engine, 'lowpass', 500, 1)).connect(gain(engine, 2)).connect(out);
  // The melt: a low tone, driven thick, whose pitch lurches about.
  const hot = drive(engine, 5);
  hot.connect(filter(engine, 'lowpass', 900, 0.7)).connect(gain(engine, 0.5)).connect(out);
  const boil = osc(engine, 'sawtooth', 70);
  const boilGain = gain(engine, 0.6);
  boil.connect(boilGain).connect(hot);
  const boil2 = osc(engine, 'triangle', 110);
  boil2.connect(gain(engine, 0.4)).connect(hot);
  const body = noiseLoop(engine, engine.brown);
  body.connect(filter(engine, 'lowpass', 300, 0.8)).connect(gain(engine, 0.5)).connect(hot);
  // The groan: a narrow band dragged up and down.
  const strain = osc(engine, 'sawtooth', 93);
  const groan = filter(engine, 'bandpass', 500, 9);
  const groanGain = gain(engine, 0.25);
  strain.connect(groan).connect(groanGain).connect(out);
  let next = 0;
  return {
    out,
    set(_level, _grip, now) {
      // Bubbles: the pitch jumps and sags a few times a second, never the same twice.
      boil.frequency.setTargetAtTime(55 + Math.random() ** 2 * 120, now, 0.02);
      boil2.frequency.setTargetAtTime(80 + Math.random() * 110, now, 0.03);
      boilGain.gain.setTargetAtTime(0.35 + Math.random() * 0.5, now, 0.02);
      if (now < next) return;
      next = now + 0.25 + Math.random() * 0.5;
      groan.frequency.setTargetAtTime(280 + Math.random() * 700, now, 0.15);
      groanGain.gain.setTargetAtTime(0.1 + Math.random() * 0.35, now, 0.1);
    },
    stop(at) {
      for (const n of [fry, fryFlicker, spit, glob, boil, boil2, body, strain]) n.stop(at);
    },
  };
};

/**
 * The looping voices by name (a part def's `sound.run`), and how loud each is against the others. One beam is a level
 * of 1 where a drone's propellers sum to 4 or more, and a laser should be the loudest thing a robot does: hence its gain.
 */
export const LOOP_VOICES: Readonly<Record<string, { make: Maker; gain: number }>> = {
  propeller: { make: propeller, gain: 0.8 },
  thruster: { make: thruster, gain: 1 },
  wheel: { make: wheel, gain: 0.5 },
  laser: { make: laser, gain: 2.6 },
  'laser.burn': { make: burn, gain: 1.7 },
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
  /** Driven by an input and needing energy: silent once its robot has none (as it stops looking busy). A wheel is heard by its spin, so it still rolls. */
  needsPower: boolean;
}

/** Seconds between two looks at the parts (20 a second; the voices glide between). */
const LOOK_EVERY = 0.05;
const FADE = 0.1;
/** A voice that fell silent or out of the loudest is kept this long at no gain, so one that flickers is not rebuilt. */
const LINGER = 0.5;
/** A group must stay silent this long before its stop is told; back sooner, it never stopped (and does not start again). */
const SETTLE = 0.3;
/** How much a group that already has a voice is favored, so near ties do not swap voices every look. */
const KEEP = 1.25;

/**
 * The looping sounds (M15): one voice per robot per voice name, never per part, so 732 boosters are one burn. Every
 * look it sums each robot's parts by voice, gives voices to the loudest at the ear, and fades the rest.
 */
export class LoopBank {
  private readonly placed = new Map<string, Placed>();
  /** Each robot's parts that make a looping sound, rebuilt when the robot is (its `version`). */
  private readonly parts = new Map<number, { version: number; list: SoundingPart[] }>();
  /** Whether each group sounds, since when (`at`), whether its stop is still to be told, and what it last was. */
  private readonly edges = new Map<string, { on: boolean; at: number; stopping: boolean; last: LoopGroup }>();
  /** When each voice that is no longer picked went quiet. */
  private readonly idle = new Map<string, number>();
  private lastLook = -1;
  /** False until the first look: what is already running then did not just start. */
  private primed = false;
  private readonly warned = new Set<string>();

  /**
   * `started` and `stopped` are called with groups that went from silent to sounding, and back, once they have
   * settled: a thruster pulsed ten times a second lights once.
   */
  update(engine: AudioEngine, world: World, ear: Ear, started: (g: LoopGroup) => void, stopped: (g: LoopGroup) => void): void {
    const now = engine.now;
    if (now - this.lastLook < LOOK_EVERY) return;
    this.lastLook = now;
    const groups = this.groupsOf(world);
    const sounding = new Set<string>();
    for (const g of groups) {
      if (g.sum <= 0) continue;
      sounding.add(g.key);
      const e = this.edges.get(g.key);
      if (e?.on === true) {
        e.last = g;
        continue;
      }
      // New to us, or back after a real silence: it starts. Back at once: it never stopped.
      if (this.primed && (e === undefined || !e.stopping)) started(g);
      this.edges.set(g.key, { on: true, at: now, stopping: false, last: g });
    }
    for (const [key, e] of this.edges) {
      if (sounding.has(key)) continue;
      if (e.on) this.edges.set(key, { ...e, on: false, at: now, stopping: true });
      else if (e.stopping && now - e.at >= SETTLE) {
        stopped(e.last);
        e.stopping = false;
      } else if (now - e.at > 5) this.edges.delete(key);
    }
    this.primed = true;

    const picked = new Set<string>();
    for (const g of pickLoops(groups, (c) => hear(ear, c.x, c.y).gain * (LOOP_VOICES[c.voice]?.gain ?? 0) * (this.placed.has(c.key) ? KEEP : 1))) {
      picked.add(g.key);
      const p = this.placed.get(g.key) ?? this.start(engine, g);
      if (!p) continue;
      this.idle.delete(g.key);
      placeLoop(p, hear(ear, g.x, g.y), loopGain(g.sum), now);
      p.voice.set(meanLevel(g), g.on > 0 ? Math.min(1, (g.grip ?? 0) / g.on) : 0, now);
    }
    for (const [key, p] of this.placed) {
      if (picked.has(key)) continue;
      const since = this.idle.get(key);
      if (since === undefined) {
        this.idle.set(key, now);
        p.amp.gain.setTargetAtTime(0, now, FADE / 3);
      } else if (now - since > LINGER) {
        stopLoop(p, now);
        this.placed.delete(key);
        this.idle.delete(key);
      }
    }
  }

  /** Every loop fades out (sound switched off). */
  fade(engine: AudioEngine): void {
    for (const p of this.placed.values()) stopLoop(p, engine.now);
    this.placed.clear();
    this.idle.clear();
    this.edges.clear();
    this.primed = false;
  }

  /** Everything stops now (a new world, the builder). */
  clear(): void {
    for (const p of this.placed.values()) {
      p.amp.gain.value = 0;
      p.voice.stop(0);
      p.pan.disconnect();
    }
    this.placed.clear();
    this.idle.clear();
    this.parts.clear();
    this.edges.clear();
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

  /** Every robot's sounding parts summed by voice, and every robot's beams. */
  groupsOf(world: World): LoopGroup[] {
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
          if (drive && LOOP_VOICES[voice]) list.push({ id: part.id, group: part.group, voice, drive, def: part.def, needsPower: part.def.powerDraw > 0 && drive.input !== undefined });
        }
        cached = { version: robot.version, list };
        this.parts.set(robot.id, cached);
      }
      if (cached.list.length === 0) continue;
      const powered = world.unlimitedEnergy || (world.energy(robot.id)?.stored ?? 0) > 0;
      const channels = world.robotChannels(robot.id);
      const root = robot.groups[0];
      if (!root) continue;
      const at = world.physics.state(root.bodyId);
      const byVoice = new Map<string, LoopGroup>();
      for (const part of cached.list) {
        if (!robot.parts.has(part.id) || (part.needsPower && !powered)) continue;
        const level = partLevel(part.drive, part, (c) => channels?.get(part.id)?.get(c), (o) => world.partOutput(robot.id, part.id, o), () => {
          const body = robot.groups[part.group]?.bodyId;
          return body === undefined ? 0 : world.physics.state(body).w - at.w;
        });
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
    // A beam is heard as its part's voice where it leaves, and as that voice's `.burn` where it burns.
    const beams = new Map<string, LoopGroup>();
    for (const b of world.liveBeams()) {
      const voice = world.robotById(b.robot)?.parts.get(b.laser)?.def.sound?.run;
      if (b.power <= 0 || voice === undefined || !LOOP_VOICES[voice]) continue;
      const hum = beams.get(`${b.robot}:${voice}`) ?? { key: `${b.robot}:${voice}`, robot: b.robot, voice, sum: 0, on: 0, x: b.x1, y: b.y1 };
      hum.sum += b.power;
      hum.on++;
      beams.set(hum.key, hum);
      if (b.hitPart === undefined || !LOOP_VOICES[`${voice}.burn`]) continue;
      const crackle = beams.get(`${b.robot}:${voice}.burn`) ?? { key: `${b.robot}:${voice}.burn`, robot: b.robot, voice: `${voice}.burn`, sum: 0, on: 0, x: b.x2, y: b.y2 };
      crackle.sum += b.power * 0.5 ** b.smoke;
      crackle.on++;
      beams.set(crackle.key, crackle);
    }
    out.push(...beams.values());
    return out;
  }
}
