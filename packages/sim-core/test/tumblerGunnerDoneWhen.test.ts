import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import type { RobotInput } from '../src/control/types';
import { resolveScripts } from '../src/blueprint/scripts';

// Measured on the tumbler gunner (50 kg, 16 thrusters, 4 guns, 2 radars, standoff 60 m, shells 300 m/s):
// - hovering alone: y and x within 0.01 m, drifts at 0.40 rad/s, 84 J/s, so about 146 s on its 12600 J.
// - enemy gun drone, 6 fights (3 starts, seeds 1 and 2): core gone in 9.3 to 21.1 s, 79 to 206 shots, 92% or more hit,
//   10 to 21 parts destroyed; it lost 0 or 1 parts.
// - hunter drone flown up and right, then down and left, at up to 50 m/s: 77 to 155 shots, 92% or more hit, 8 to 38 parts.
// - a gun lost: the next one is firing 1.08 to 1.13 s later for a quarter turn (2.1 rad/s at most), 1.63 s for a half turn.
// - W S A D held 3 s: goes 14 m up (flat, it has only 3 m/s^2 of climb), 32 m down, 27 and 30 m sideways, 0.0088 rad off at
//   worst (0.49 m at the target), 30 shots of 30 possible.
// - a whole face gone: with an enemy y stays within 1.4 m (10 m for the bottom face) and it keeps firing; alone it sags 10 m
//   at worst, then holds within 0.1 m. Last gun pinning a dead face under it: it tumbles at 3.2 rad/s, 15 shots in 30 s.
// The tolerances below leave room around those.
const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

const HZ = 60;
const SHELL = 300;
const G = 9.81;
const GUNS = ['gun@3,6', 'gun@0,3', 'gun@3,0', 'gun@6,3'];
const FACES = {
  bottom: [[1, 0], [2, 0], [4, 0], [5, 0]],
  top: [[1, 6], [2, 6], [4, 6], [5, 6]],
  left: [[0, 1], [0, 2], [0, 4], [0, 5]],
  right: [[6, 1], [6, 2], [6, 4], [6, 5]],
} as const;

interface Pose {
  x: number;
  y: number;
  a: number;
  w: number;
  vx: number;
  vy: number;
}
interface Tick {
  /** The guns that put a shell out this tick. */
  fired: string[];
  /** How far the last gun fired points from where a shell would hit `foe`, in radians and in meters at the target. */
  off?: number;
  meters?: number;
}

function poseOf(w: World, r: Robot): Pose {
  const core = r.parts.get(r.primaryCoreId ?? '');
  const s = w.physics.state(r.groups[core?.group ?? 0]?.bodyId as number);
  return { x: s.x, y: s.y, a: s.angle, w: s.w, vx: s.vx, vy: s.vy };
}

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Steps a world, noting which of `r`'s guns fired each tick and how far off the one in use is from `foe`. */
class Fight {
  private seen = new Set<object>();
  last = '';
  readonly w: World;
  readonly r: Robot;
  readonly foe: Robot | undefined;
  constructor(w: World, r: Robot, foe?: Robot) {
    this.w = w;
    this.r = r;
    this.foe = foe;
  }

  guns(): string[] {
    return GUNS.filter((id) => this.r.parts.has(id));
  }

  step(inputs?: RobotInput[]): Tick {
    this.w.step(inputs);
    const fired: string[] = [];
    for (const s of this.w.liveShells()) {
      if (s.robot !== this.r.id || this.seen.has(s)) continue;
      this.seen.add(s);
      fired.push(s.gun);
      this.last = s.gun;
    }
    const out: Tick = { fired };
    if (this.foe && this.r.parts.has(this.last)) {
      const me = poseOf(this.w, this.r);
      const it = poseOf(this.w, this.foe);
      const aim = this.w.partOutput(this.r.id, this.last, 'aim') as number;
      const rx = it.x - (me.x + 3.5 * Math.cos(aim));
      const ry = it.y - (me.y + 3.5 * Math.sin(aim));
      let t = Math.hypot(rx, ry) / SHELL;
      let px = rx;
      let py = ry;
      for (let i = 0; i < 3; i++) {
        px = rx + (it.vx - me.vx) * t;
        py = ry + (it.vy - me.vy) * t;
        t = Math.hypot(px, py) / SHELL;
      }
      out.off = Math.abs(wrap(Math.atan2(py + 0.5 * G * t * t, px) - aim));
      out.meters = out.off * Math.hypot(px, py);
    }
    return out;
  }

  run(seconds: number, inputs?: (tick: number) => RobotInput[] | undefined): Tick[] {
    const out: Tick[] = [];
    for (let i = 0; i < seconds * HZ; i++) out.push(this.step(inputs?.(i)));
    return out;
  }

  /** Holds `key` on the gunner for `seconds`. */
  hold(key: string, seconds: number): Tick[] {
    const r = this.r.id;
    return this.run(seconds, (i) => (i === 0 ? [{ robot: r, pressed: [key], released: [] }] : i === seconds * HZ - 1 ? [{ robot: r, pressed: [], released: [key] }] : undefined));
  }

  /** Runs until a gun has fired and it has had `seconds` of firing. */
  untilFiring(seconds: number): void {
    for (let i = 0; this.last === ''; i++) {
      if (i > 30 * HZ) throw new Error('it never fired');
      this.step();
    }
    this.run(seconds);
  }

  crashes(): unknown[] {
    return this.w.events.filter((e) => e.kind === 'scriptCrashed');
  }
}

const hits = (w: World, by: Robot): number => w.events.filter((e) => e.kind === 'shellHit' && e.by === by.id).length;
const lost = (w: World, r: Robot): number => w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === r.id && e.burntOut !== true).length;
const coreGone = (w: World, r: Robot): boolean => w.events.some((e) => e.kind === 'coreLost' && e.robot === r.id);

/** The gunner and an enemy. A `tough` enemy cannot be broken, for tests that must not end with its death. */
async function fightAt(foe: string, seed: number, me: { x: number; y: number }, at: { x: number; y: number }, tough = false): Promise<Fight> {
  const w = await World.create({ seed, scripts: host }, flat);
  const r = w.spawnBlueprint(blueprint('tumbler-gunner'), me);
  const e = w.spawnBlueprint(blueprint(foe), at, { team: 1 });
  if (tough) for (const p of e.parts.values()) p.health = 1e6;
  return new Fight(w, r, e);
}

async function alone(y = 20): Promise<Fight> {
  const w = await World.create({ seed: 1, scripts: host }, flat);
  return new Fight(w, w.spawnBlueprint(blueprint('tumbler-gunner'), { x: -100, y }));
}

function shoot(r: Robot, id: string): void {
  const p = r.parts.get(id);
  if (!p) throw new Error(`no ${id}`);
  p.health = 0;
}

function shootFace(r: Robot, cells: readonly (readonly [number, number])[]): void {
  for (const [x, y] of cells) shoot(r, `thruster@${x},${y}`);
}

/** Lowest and highest the core goes while running `seconds`. */
function band(f: Fight, seconds: number): { low: number; high: number } {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < seconds * HZ; i++) {
    f.step();
    const { y } = poseOf(f.w, f.r);
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  return { low, high };
}

/** No tick of a fight has two guns firing. */
function oneAtATime(ticks: Tick[]): void {
  for (const t of ticks) expect(t.fired.length).toBeLessThanOrEqual(1);
}
const peak = (ticks: Tick[], key: 'off' | 'meters'): number => Math.max(0, ...ticks.map((t) => t[key] ?? 0));

describe('tumbler gunner', () => {
  it('hovers and drifts round with no enemy and no keys, and has energy left', async () => {
    const f = await alone();
    f.run(4);
    const a = poseOf(f.w, f.r);
    const e0 = f.w.energy(f.r.id)?.stored ?? 0;
    const { low, high } = band(f, 60);
    const b = poseOf(f.w, f.r);
    const rate = (e0 - (f.w.energy(f.r.id)?.stored ?? 0)) / 60;
    expect(high - low).toBeLessThan(0.1);
    expect(Math.abs(b.x - a.x)).toBeLessThan(0.1);
    expect(b.w).toBeCloseTo(0.4, 2);
    expect(rate).toBeLessThan(90);
    expect(e0 / rate).toBeGreaterThan(130);
    expect(f.w.shotsBy(f.r.id)).toBe(0);
    f.w.dispose();
  });

  it('closes on an enemy by itself, holds the standoff, and shoots from there', { timeout: 60_000 }, async () => {
    const f = await fightAt('hunter-drone', 1, { x: -200, y: 40 }, { x: 100, y: 40 }, true);
    const ticks = f.run(40);
    const me = poseOf(f.w, f.r);
    const it = poseOf(f.w, f.foe as Robot);
    const held = f.run(5);
    const spread = peak(held, 'meters');
    expect(Math.hypot(me.x - it.x, me.y - it.y)).toBeGreaterThan(55);
    expect(Math.hypot(me.x - it.x, me.y - it.y)).toBeLessThan(65);
    expect(hits(f.w, f.r) / f.w.shotsBy(f.r.id)).toBeGreaterThan(0.9);
    expect(spread).toBeLessThan(0.5);
    oneAtATime(ticks);
    f.w.dispose();
  });

  for (const seed of [1, 2]) {
    for (const [me, at] of [
      [{ x: -100, y: 30 }, { x: 60, y: 30 }],
      [{ x: -100, y: 30 }, { x: 100, y: 60 }],
      [{ x: 100, y: 40 }, { x: -80, y: 20 }],
    ] as const) {
      it(`beats an enemy gun drone, seed ${seed}, from ${me.x} to ${at.x}`, { timeout: 60_000 }, async () => {
        const f = await fightAt('enemy-gun-drone', seed, me, at);
        const e = f.foe as Robot;
        const ticks: Tick[] = [];
        while (!coreGone(f.w, e) && ticks.length < 30 * HZ) ticks.push(f.step());
        expect(coreGone(f.w, e)).toBe(true);
        expect(coreGone(f.w, f.r)).toBe(false);
        expect(hits(f.w, f.r) / f.w.shotsBy(f.r.id)).toBeGreaterThan(0.9);
        expect(lost(f.w, e)).toBeGreaterThanOrEqual(8);
        expect(f.crashes()).toEqual([]);
        oneAtATime(ticks);
        f.w.dispose();
      });
    }
  }

  for (const seed of [1, 2]) {
    for (const [me, at] of [
      [{ x: -100, y: 30 }, { x: 40, y: 30 }],
      [{ x: 150, y: 40 }, { x: 20, y: 50 }],
    ] as const) {
      it(`hits a hunter drone that keeps moving, seed ${seed}, from ${me.x} to ${at.x}`, { timeout: 60_000 }, async () => {
        const f = await fightAt('hunter-drone', seed, me, at);
        const e = f.foe as Robot;
        // Held keys send the hunter up and right, then down and left: 50 m/s at its fastest, until it is too broken to.
        const shuttle = (i: number): RobotInput[] | undefined => {
          const k = i % (6 * HZ);
          if (k === 0) return [{ robot: e.id, pressed: ['d', 'w'], released: ['a', 's'] }];
          if (k === 3 * HZ) return [{ robot: e.id, pressed: ['a', 's'], released: ['d', 'w'] }];
          return undefined;
        };
        const ticks = f.run(30, shuttle);
        expect(hits(f.w, f.r)).toBeGreaterThan(50);
        expect(hits(f.w, f.r) / f.w.shotsBy(f.r.id)).toBeGreaterThan(0.85);
        expect(lost(f.w, e)).toBeGreaterThanOrEqual(6);
        expect(f.crashes()).toEqual([]);
        oneAtATime(ticks);
        f.w.dispose();
      });
    }
  }

  it('swings to the next nearest gun each time the gun in use goes, one gun firing at a time, and flies on with none', { timeout: 60_000 }, async () => {
    const f = await fightAt('hunter-drone', 1, { x: -100, y: 30 }, { x: 0, y: 30 }, true);
    f.untilFiring(1);
    const order = [f.last];
    while (f.guns().length > 1) {
      const gone = f.last;
      const dir = f.w.partOutput(f.r.id, gone, 'aim') as number;
      const left = f.guns().filter((g) => g !== gone);
      const nearest = Math.min(...left.map((g) => Math.abs(wrap((f.w.partOutput(f.r.id, g, 'aim') as number) - dir))));
      const a0 = poseOf(f.w, f.r).a;
      const before = hits(f.w, f.r);
      shoot(f.r, gone);
      f.step();
      f.last = '';
      const swing: Tick[] = [];
      let fastest = 0;
      while (f.last === '' && swing.length < 5 * HZ) {
        swing.push(f.step());
        fastest = Math.max(fastest, Math.abs(poseOf(f.w, f.r).w));
      }
      const after = f.run(1.5);
      const turned = (wrap(poseOf(f.w, f.r).a - a0) * 180) / Math.PI;
      expect(left).toContain(f.last);
      // The gun that took over is the nearest one: a quarter turn, not the one opposite.
      expect(nearest).toBeCloseTo(Math.PI / 2, 1);
      expect(Math.abs(turned)).toBeGreaterThan(80);
      expect(Math.abs(turned)).toBeLessThan(100);
      expect(swing.length / HZ).toBeLessThan(2);
      expect(fastest).toBeGreaterThan(1);
      expect(hits(f.w, f.r) - before).toBeGreaterThanOrEqual(8);
      // Only the new gun fires, and the old one's shells are the only other ones that could be in flight.
      expect(new Set(after.flatMap((t) => t.fired))).toEqual(new Set([f.last]));
      oneAtATime(after);
      order.push(f.last);
    }
    expect(new Set(order).size).toBe(4);
    // None left: it stops closing in, hovers, and drifts.
    shoot(f.r, f.last);
    f.step();
    const shots = f.w.shotsBy(f.r.id);
    f.run(2);
    const a = poseOf(f.w, f.r);
    const { low, high } = band(f, 20);
    const b = poseOf(f.w, f.r);
    expect(f.guns()).toEqual([]);
    expect(high - low).toBeLessThan(0.5);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.5);
    expect(b.w).toBeCloseTo(0.4, 1);
    expect(f.w.shotsBy(f.r.id)).toBe(shots);
    expect(f.crashes()).toEqual([]);
    f.w.dispose();
  });

  it('turns right round when the only gun left is on the far face', { timeout: 60_000 }, async () => {
    const f = await fightAt('hunter-drone', 1, { x: -100, y: 30 }, { x: 0, y: 30 }, true);
    f.untilFiring(1);
    const across = f.last === 'gun@6,3' ? 'gun@0,3' : 'gun@6,3';
    for (const g of f.guns()) if (g !== across && g !== f.last) shoot(f.r, g);
    f.step();
    const gone = f.last;
    shoot(f.r, gone);
    f.step();
    f.last = '';
    const swing: Tick[] = [];
    while (f.last === '' && swing.length < 5 * HZ) swing.push(f.step());
    expect(f.last).toBe(across);
    expect(swing.length / HZ).toBeLessThan(3);
    f.w.dispose();
  });

  it('keeps its aim and goes on firing while W S A D fly it, and goes back to work when let go', { timeout: 60_000 }, async () => {
    const f = await fightAt('hunter-drone', 1, { x: -100, y: 60 }, { x: 0, y: 60 }, true);
    f.untilFiring(3);
    for (const [key, x, y] of [['w', 0, 1], ['s', 0, -1], ['a', -1, 0], ['d', 1, 0]] as const) {
      const a = poseOf(f.w, f.r);
      const shots = f.w.shotsBy(f.r.id);
      const hit = hits(f.w, f.r);
      const ticks = f.hold(key, 3);
      const b = poseOf(f.w, f.r);
      const going = (b.x - a.x) * x + (b.y - a.y) * y;
      expect(going).toBeGreaterThan(key === 'w' ? 10 : 25);
      expect(peak(ticks, 'meters')).toBeLessThan(1.5);
      expect(f.w.shotsBy(f.r.id) - shots).toBeGreaterThanOrEqual(25);
      expect(hits(f.w, f.r) - hit).toBeGreaterThanOrEqual(25);
      oneAtATime(ticks);
      f.run(6);
      // Let go, it goes back to the standoff by itself.
      const me = poseOf(f.w, f.r);
      const it = poseOf(f.w, f.foe as Robot);
      expect(Math.hypot(me.x - it.x, me.y - it.y)).toBeGreaterThan(50);
      expect(Math.hypot(me.x - it.x, me.y - it.y)).toBeLessThan(70);
    }
    f.w.dispose();
  });

  for (const face of ['bottom', 'top', 'left', 'right'] as const) {
    it(`keeps flying and shooting with its whole ${face} face gone`, { timeout: 60_000 }, async () => {
      const f = await fightAt('hunter-drone', 1, { x: -100, y: 40 }, { x: 0, y: 40 }, true);
      f.run(5);
      shootFace(f.r, FACES[face]);
      const shots = f.w.shotsBy(f.r.id);
      const { low } = band(f, 15);
      const me = poseOf(f.w, f.r);
      const it = poseOf(f.w, f.foe as Robot);
      const distance = Math.hypot(me.x - it.x, me.y - it.y);
      expect(low).toBeGreaterThan(25);
      expect(f.w.shotsBy(f.r.id) - shots).toBeGreaterThan(100);
      expect(distance).toBeLessThan(75);
      expect(f.crashes()).toEqual([]);
      f.w.dispose();
    });

    it(`hovers with no enemy with its whole ${face} face gone`, { timeout: 60_000 }, async () => {
      const f = await alone(30);
      f.run(5);
      shootFace(f.r, FACES[face]);
      const sag = band(f, 12);
      const { low, high } = band(f, 30);
      expect(sag.low).toBeGreaterThan(15);
      expect(high - low).toBeLessThan(1);
      expect(low).toBeGreaterThan(25);
      f.w.dispose();
    });
  }

  it('tumbles rather than sinks when its last gun would pin a dead face under it, and still fires as the gun passes', { timeout: 60_000 }, async () => {
    const f = await fightAt('hunter-drone', 1, { x: -100, y: 40 }, { x: 0, y: 40 }, true);
    f.untilFiring(1);
    expect(f.last).toBe('gun@6,3');
    for (const g of f.guns()) if (g !== 'gun@6,3') shoot(f.r, g);
    shootFace(f.r, FACES.bottom);
    const shots = f.w.shotsBy(f.r.id);
    f.step();
    const parts = f.r.parts.size;
    const { low } = band(f, 30);
    const me = poseOf(f.w, f.r);
    // Its tips reach 4.3 m from its center: it never touches the ground.
    expect(low).toBeGreaterThan(4.5);
    expect(f.r.parts.size).toBe(parts);
    expect(Math.abs(me.w)).toBeGreaterThan(1);
    expect(f.w.shotsBy(f.r.id) - shots).toBeGreaterThan(3);
    f.w.dispose();
  });

  it('flies on blind with both radars gone', { timeout: 60_000 }, async () => {
    const f = await fightAt('hunter-drone', 1, { x: -100, y: 30 }, { x: 0, y: 30 }, true);
    f.untilFiring(1);
    shoot(f.r, 'radar@2,4');
    shoot(f.r, 'radar@4,2');
    f.run(3);
    const shots = f.w.shotsBy(f.r.id);
    const { low, high } = band(f, 10);
    expect(f.w.shotsBy(f.r.id)).toBe(shots);
    expect(high - low).toBeLessThan(0.5);
    expect(poseOf(f.w, f.r).w).toBeCloseTo(0.4, 1);
    expect(f.crashes()).toEqual([]);
    f.w.dispose();
  });

  it('deployed on the ground it climbs before it turns, and S stops it above the ground', { timeout: 60_000 }, async () => {
    const f = await alone(3.6);
    const parts = f.r.parts.size;
    f.run(0.25);
    expect(Math.abs(poseOf(f.w, f.r).w)).toBeLessThan(0.1);
    f.run(4.75);
    expect(poseOf(f.w, f.r).w).toBeCloseTo(0.4, 1);
    f.hold('w', 2);
    f.run(3);
    let lowest = Infinity;
    const r = f.r.id;
    f.run(9, (i) => {
      lowest = Math.min(lowest, poseOf(f.w, f.r).y);
      return i === 0 ? [{ robot: r, pressed: ['s'], released: [] }] : i === 6 * HZ ? [{ robot: r, pressed: [], released: ['s'] }] : undefined;
    });
    // Its tips reach 4.3 m from its center.
    expect(lowest).toBeGreaterThan(4.6);
    expect(f.r.parts.size).toBe(parts);
    f.w.dispose();
  });
});
