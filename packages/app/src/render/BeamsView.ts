import { Container, Graphics } from 'pixi.js';
import { SIGHT, type Beam, type Robot, type World } from '@robots/sim-core';
import { PIXELS_PER_METER, toScreen, type Vec2 } from './units';
import { interpolateState } from './interpolate';

const CORE = 0xfff6f6;
const HOT = 0xff5a5a;
const RED = 0xff1630;
const DEEP = 0xa8001c;
const SPARK = 0xffd890;
const EMBER = 0xff6a2a;
const SMOKE = 0x4f4846;
const SCORCH = 0x17110f;
/** Particles alive at once, at most (oldest go first), and scorch marks. */
const MAX_PARTICLES = 900;
const MAX_SCORCHES = 80;
/** Seconds a beam takes to grow from thin to full when it starts. */
const RAMP = 0.15;

interface Particle {
  kind: 'spark' | 'ember' | 'smoke';
  /** Meters and m/s, physics frame (y up). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  t: number;
  life: number;
}

interface Scorch {
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
}

/**
 * Laser beams (M14, Logan: "make it VERY visual and powerful-looking, a little overkill"), drawn fresh every frame
 * from the world's beams of the last tick: a white-hot core in layers of red glow that flicker and grow in when a beam
 * starts, bright beads racing down it, a flare at the barrel, a blinding spot where it burns with sparks, embers, and
 * smoke flying off, the part it burns glowing red to yellow and cooling after, and scorch marks where it touches the
 * ground. Widths never go below a few screen pixels, so a beam reads across a whole battle. Cosmetic only: wall-clock
 * time and Math.random are fine here.
 */
export class BeamsView {
  readonly root = new Container();
  private readonly scorchLayer = new Graphics();
  private readonly smokeLayer = new Graphics();
  private readonly glow = new Graphics();
  private readonly sparks = new Graphics();
  private particles: Particle[] = [];
  private scorches: Scorch[] = [];
  /** How hot each burned part is (0 to 1), by `robot:part`. */
  private heat = new Map<string, { robot: number; part: string; heat: number }>();
  /** The tick each beam came on, by `robot:laser` (ticks, so a beam stepped while paused grows in too). */
  private starts = new Map<string, number>();
  private clock = 0;

  constructor() {
    this.glow.blendMode = 'add';
    this.sparks.blendMode = 'add';
    this.root.addChild(this.scorchLayer, this.smokeLayer, this.glow, this.sparks);
  }

  /** `dt` is sim seconds since the last frame (0 while paused: nothing moves or spawns), `zoom` the camera's. */
  draw(world: World, alpha: number, dt: number, zoom: number): void {
    this.clock += dt;
    const px = 1 / Math.max(zoom, 1e-3) / PIXELS_PER_METER; // one screen pixel, in meters
    const beams = world.liveBeams();
    const starts = new Map<string, number>();
    for (const g of [this.scorchLayer, this.smokeLayer, this.glow, this.sparks]) g.clear();

    for (const b of beams) {
      const key = `${b.robot}:${b.laser}`;
      // A beam that stopped grows in again when it restarts.
      const start = this.starts.get(key) ?? world.tick;
      starts.set(key, start);
      this.beam(world, b, alpha, (world.tick - start + 1) * world.dt, dt, px);
    }
    this.starts = starts;

    // Oldest go first past the cap (trimmed once a frame, not per particle).
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    this.cool(world, alpha, dt, px);
    this.move(dt, px);
    this.drawScorches(dt, px);
  }

  clear(): void {
    this.particles = [];
    this.scorches = [];
    this.heat.clear();
    this.starts.clear();
    for (const g of [this.scorchLayer, this.smokeLayer, this.glow, this.sparks]) g.clear();
  }

  private beam(world: World, b: Beam, alpha: number, age: number, dt: number, px: number): void {
    // The barrel moves between ticks like the sprites do: shift the start by how far its body is drawn from where it is.
    const shift = this.drawnShift(world, world.robotById(b.robot), b.laser, alpha);
    const a = { x: b.x1 + shift.x, y: b.y1 + shift.y };
    const e = { x: b.x2, y: b.y2 };
    const len = Math.hypot(e.x - a.x, e.y - a.y);
    if (len < 1e-3) return;
    const ux = (e.x - a.x) / len;
    const uy = (e.y - a.y) / len;
    const ramp = Math.min(1, 0.2 + age / RAMP);
    const flick = 0.82 + 0.36 * Math.random();
    // Smoke on the way dims it (each cloud halves what it burns).
    const power = b.power * 0.65 ** b.smoke;
    const k = ramp * flick * (0.35 + 0.65 * power);
    const s = toScreen(a);
    const t = toScreen(e);
    const g = this.glow;
    const line = (width: number, color: number, alphaV: number): void => {
      g.moveTo(s.x, s.y).lineTo(t.x, t.y).stroke({ color, width: width * PIXELS_PER_METER, alpha: alphaV, cap: 'round' });
    };
    line(Math.max(3.4, 26 * px) * k, DEEP, 0.16 * power);
    line(Math.max(1.6, 13 * px) * k, RED, 0.42 * power);
    line(Math.max(0.75, 6 * px) * k, HOT, 0.75);
    line(Math.max(0.3, 2.6 * px) * k, CORE, 0.95);
    // Bright beads racing down the beam: power flowing.
    const gap = Math.max(5, 40 * px);
    const speed = 160;
    for (let d = (this.clock * speed) % gap; d < len; d += gap) {
      const p = toScreen({ x: a.x + ux * d, y: a.y + uy * d });
      g.circle(p.x, p.y, Math.max(0.35, 3.2 * px) * k * PIXELS_PER_METER).fill({ color: CORE, alpha: 0.55 * power });
    }
    // The barrel: a hot glow, and a flare across the beam.
    const r = (m: number, minPx: number): number => Math.max(m, minPx * px) * PIXELS_PER_METER * k;
    g.circle(s.x, s.y, r(2.2, 18)).fill({ color: RED, alpha: 0.22 * power });
    g.circle(s.x, s.y, r(1.0, 9)).fill({ color: HOT, alpha: 0.5 });
    g.circle(s.x, s.y, r(0.4, 4)).fill({ color: CORE, alpha: 0.95 });
    const flare = r(2.6, 22);
    // Screen y points down: the perpendicular of (ux, -uy) on screen is (uy, ux).
    g.moveTo(s.x - uy * flare, s.y - ux * flare)
      .lineTo(s.x + uy * flare, s.y + ux * flare)
      .stroke({ color: CORE, width: Math.max(0.12, 1.6 * px) * PIXELS_PER_METER, alpha: 0.6 * ramp });
    // A flash as it starts.
    if (age < RAMP * 1.5) g.circle(s.x, s.y, r(4, 34) * (1 - age / (RAMP * 1.5))).fill({ color: CORE, alpha: 0.35 });

    if (b.side === SIGHT.nothing) return;
    // Where it burns: a blinding spot in a red bloom.
    g.circle(t.x, t.y, r(3.2, 26) * flick).fill({ color: RED, alpha: 0.2 * power });
    g.circle(t.x, t.y, r(1.5, 13) * flick).fill({ color: HOT, alpha: 0.5 * power });
    g.circle(t.x, t.y, r(0.55, 5)).fill({ color: CORE, alpha: 0.95 });
    if (dt > 0) this.spray(e, -ux, -uy, dt, power, b.side !== SIGHT.terrain);
    if (b.side === SIGHT.terrain) this.scorch(e);
    if (b.hitRobot !== undefined && b.hitPart !== undefined) {
      const hk = `${b.hitRobot}:${b.hitPart}`;
      const h = this.heat.get(hk) ?? { robot: b.hitRobot, part: b.hitPart, heat: 0 };
      h.heat = Math.min(1, h.heat + dt * 5 * power);
      this.heat.set(hk, h);
    }
  }

  /** Sparks, embers, and (off a part) smoke thrown back toward the laser from where it burns. */
  private spray(at: Vec2, bx: number, by: number, dt: number, power: number, part: boolean): void {
    const back = Math.atan2(by, bx);
    const n = (rate: number): number => {
      const want = rate * dt * power;
      return Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
    };
    for (let i = n(110); i > 0; i--) {
      const a = back + (Math.random() - 0.5) * 2.8;
      const v = 6 + Math.random() * 20;
      this.add({ kind: 'spark', x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 0.1, t: 0, life: 0.2 + Math.random() * 0.45 });
    }
    for (let i = n(30); i > 0; i--) {
      const a = back + (Math.random() - 0.5) * 3.4;
      const v = 1.5 + Math.random() * 7;
      this.add({ kind: 'ember', x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 2, size: 0.1 + Math.random() * 0.14, t: 0, life: 0.7 + Math.random() * 1.1 });
    }
    if (!part) return;
    for (let i = n(14); i > 0; i--) {
      this.add({ kind: 'smoke', x: at.x, y: at.y, vx: (Math.random() - 0.5) * 2 + bx * 1.5, vy: 1.5 + Math.random() * 2, size: 0.35 + Math.random() * 0.5, t: 0, life: 1.1 + Math.random() * 1.1 });
    }
  }

  private add(p: Particle): void {
    this.particles.push(p);
  }

  /** A scorch where the beam touches the ground, unless one is already right there (any recent one: two beams). */
  private scorch(at: Vec2): void {
    const near = this.scorches.find((s) => Math.hypot(s.x - at.x, s.y - at.y) < 0.7);
    if (near) {
      near.t = Math.min(near.t, 0.3);
      return;
    }
    this.scorches.push({ x: at.x, y: at.y, r: 0.6 + Math.random() * 0.4, t: 0, life: 8 });
    if (this.scorches.length > MAX_SCORCHES) this.scorches.shift();
  }

  /** Burned parts glow red to yellow while the beam is on them and cool over about a second after. */
  private cool(world: World, alpha: number, dt: number, px: number): void {
    const g = this.glow;
    for (const [key, h] of this.heat) {
      h.heat -= dt * 0.9;
      const robot = world.robotById(h.robot);
      const pose = robot ? this.drawnPose(world, robot, h.part, alpha) : undefined;
      if (h.heat <= 0 || !pose) {
        this.heat.delete(key);
        continue;
      }
      const p = toScreen(pose);
      const k = h.heat;
      g.circle(p.x, p.y, Math.max(1.3, 10 * px) * PIXELS_PER_METER).fill({ color: EMBER, alpha: 0.3 * k });
      // The part's own square, turned with it, glowing hotter toward yellow.
      const c = Math.cos(pose.angle) * 0.55 * PIXELS_PER_METER;
      const n = Math.sin(pose.angle) * 0.55 * PIXELS_PER_METER;
      // Screen y is down, so a counterclockwise turn in meters is clockwise on screen.
      const corners = [
        [c - n, -(n + c)],
        [-c - n, -(-n + c)],
        [-c + n, -(-n - c)],
        [c + n, -(n - c)],
      ].flatMap(([x, y]) => [p.x + (x as number), p.y + (y as number)]);
      g.poly(corners).fill({ color: k > 0.6 ? SPARK : HOT, alpha: 0.65 * k });
    }
  }

  private move(dt: number, px: number): void {
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.t += dt;
      if (p.t >= p.life) continue;
      if (p.kind === 'smoke') {
        p.vx *= 1 - 0.8 * dt;
        p.size += dt * 0.6;
      } else {
        p.vy -= 9.81 * dt * (p.kind === 'ember' ? 0.35 : 1);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      alive.push(p);
      const fade = 1 - p.t / p.life;
      const at = toScreen(p);
      if (p.kind === 'spark') {
        const tail = toScreen({ x: p.x - p.vx * 0.035, y: p.y - p.vy * 0.035 });
        this.sparks.moveTo(tail.x, tail.y).lineTo(at.x, at.y).stroke({ color: SPARK, width: Math.max(0.09, 1.6 * px) * PIXELS_PER_METER, alpha: fade });
      } else if (p.kind === 'ember') {
        this.sparks.circle(at.x, at.y, Math.max(p.size, 1.5 * px) * PIXELS_PER_METER).fill({ color: EMBER, alpha: fade * 0.9 });
      } else {
        this.smokeLayer.circle(at.x, at.y, p.size * PIXELS_PER_METER).fill({ color: SMOKE, alpha: 0.32 * fade });
      }
    }
    this.particles = alive;
  }

  private drawScorches(dt: number, px: number): void {
    const kept: Scorch[] = [];
    for (const s of this.scorches) {
      s.t += dt;
      if (s.t >= s.life) continue;
      kept.push(s);
      const p = toScreen(s);
      const fade = 1 - s.t / s.life;
      this.scorchLayer.ellipse(p.x, p.y, s.r * 1.4 * PIXELS_PER_METER, s.r * 0.6 * PIXELS_PER_METER).fill({ color: SCORCH, alpha: 0.6 * fade });
      // Molten for the first second.
      if (s.t < 1.2) this.glow.circle(p.x, p.y, Math.max(s.r * 0.7, 3 * px) * PIXELS_PER_METER).fill({ color: EMBER, alpha: 0.7 * (1 - s.t / 1.2) });
    }
    this.scorches = kept;
  }

  /** A part's pose as drawn this frame (its body interpolated like the sprites), or undefined when it is gone. */
  private drawnPose(world: World, robot: Robot, partId: string, alpha: number): { x: number; y: number; angle: number } | undefined {
    const part = robot.parts.get(partId);
    const group = part ? robot.groups[part.group] : undefined;
    if (!part || !group) return undefined;
    const s = interpolateState(world.physics.prevState(group.bodyId), world.physics.state(group.bodyId), alpha);
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    return { x: s.x + c * part.localX - n * part.localY, y: s.y + n * part.localX + c * part.localY, angle: s.angle };
  }

  /** How far a part is drawn from where it is this tick. */
  private drawnShift(world: World, robot: Robot | undefined, partId: string, alpha: number): Vec2 {
    const part = robot?.parts.get(partId);
    const group = part && robot ? robot.groups[part.group] : undefined;
    if (!group) return { x: 0, y: 0 };
    const now = world.physics.state(group.bodyId);
    const s = interpolateState(world.physics.prevState(group.bodyId), now, alpha);
    return { x: s.x - now.x, y: s.y - now.y };
  }
}
