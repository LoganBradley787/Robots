import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { PartInstance, Robot } from '../src/world/Robot';

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
const space = parseWorldFile({ name: 'space', ground: { width: 400, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });

const slab = (cols: number, rows: number, fill = 'F', special: Record<string, string> = {}): string[] => {
  const grid: string[] = [];
  for (let y = rows - 1; y >= 0; y--) grid.push(Array.from({ length: cols }, (_, x) => (special[`${x},${y}`] ?? fill).padEnd(3)).join(''));
  return grid;
};
const BOX = { format: 1, name: 'box', grid: slab(30, 4, 'F', { '3,1': 'C' }) };
const CAR = { format: 1, name: 'car', grid: ['F  F  F  F  F  F  F  F  F  F  F  F', 'F  F  F  F  F  C  F  F  F  F  F  F', 'F  F  F  F  F  F  F  F  F  F  F  F', 'W  .  W  .  W  .  W  .  W  .  .  W'] };
const ARM = { format: 1, name: 'arm', grid: ['.  F  F  F  .', '.  .  F  .  .', '.  .  R  .  .', 'F  F  C  F  F', 'F  F  F  F  F', 'F  F  F  F  F'] };

const topPart = (r: Robot): PartInstance | undefined => {
  let best: PartInstance | undefined;
  for (const p of r.parts.values()) if (p.def.role !== 'core' && p.def.id !== 'wheel' && (!best || p.y > best.y)) best = p;
  return best;
};
// Every part still on a robot that is not at full health.
const hurtParts = (w: World): PartInstance[] => w.robots.flatMap((r) => [...r.parts.values()].filter((p) => p.health < p.def.health));
const lostParts = (w: World): number => w.events.filter((e) => e.kind === 'partDestroyed').length;
const healthOf = (r: Robot): number => [...r.parts.values()].reduce((sum, p) => sum + Math.max(0, p.health), 0);
const fullHealth = (r: Robot): number => [...r.parts.values()].reduce((sum, p) => sum + p.def.health, 0);

describe('crash: a rebuild is not a hit', () => {
  /** Loses its top part every 2 ticks, `ticks` long: every part it did not lose by hand must come through untouched. */
  async function rebuilt(w: World, r: Robot, ticks: number): Promise<number> {
    const before = lostParts(w);
    let hand = 0;
    for (let t = 0; t < ticks; t++) {
      if (t % 2 === 0) {
        const p = topPart(r);
        if (p) {
          p.health = 0;
          hand++;
        }
      }
      w.step();
    }
    expect(hand).toBeGreaterThan(0);
    expect(hurtParts(w).map((p) => p.id)).toEqual([]);
    return lostParts(w) - before - hand;
  }

  it('resting on the ground', async () => {
    const w = await World.create({ seed: 1 }, open);
    const r = w.spawnBlueprint(BOX, { x: 0, y: 3 });
    for (let t = 0; t < 90; t++) w.step();
    expect(await rebuilt(w, r, 40)).toBe(0);
    w.dispose();
  });

  it('sliding along the ground at about 60 m/s', async () => {
    const w = await World.create({ seed: 1 }, open);
    const r = w.spawnBlueprint(BOX, { x: 0, y: 3 });
    for (let t = 0; t < 90; t++) w.step();
    w.kickRobot(r, 90, 0, 0);
    for (let t = 0; t < 60; t++) w.step();
    const s = w.physics.state(r.groups[0]?.bodyId as number);
    expect(s.vx).toBeGreaterThan(40);
    expect(await rebuilt(w, r, 40)).toBe(0);
    w.dispose();
  });

  it('spinning in empty space', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const r = w.spawnBlueprint(ARM, { x: 0, y: 100 });
    w.kickRobot(r, 0, 0, 6);
    for (let t = 0; t < 10; t++) w.step();
    expect(await rebuilt(w, r, 8)).toBe(0);
    w.dispose();
  });

  it('a jointed robot on its wheels, resting and rolling at about 70 m/s (rebuilt by kicks in their own first substep)', async () => {
    for (const speed of [0, 90]) {
      const w = await World.create({ seed: 1 }, open);
      const r = w.spawnBlueprint(CAR, { x: 0, y: 3 });
      for (let t = 0; t < 90; t++) w.step();
      if (speed > 0) {
        w.kickRobot(r, speed, 0, 0);
        for (let t = 0; t < 120; t++) w.step();
        expect(w.physics.state(r.groups[0]?.bodyId as number).vx).toBeGreaterThan(50);
      }
      expect(w.physics.isLinked(r.groups[0]?.bodyId as number)).toBe(true);
      expect(await rebuilt(w, r, 30)).toBe(0);
      w.dispose();
    }
  });

  it('a robot with a rotator standing on the ground', async () => {
    const w = await World.create({ seed: 1 }, open);
    const r = w.spawnBlueprint(ARM, { x: 0, y: 3 });
    for (let t = 0; t < 90; t++) w.step();
    expect(await rebuilt(w, r, 6)).toBe(0);
    w.dispose();
  });

  it('a heavy robot resting on a light one, the light one rebuilt under it: a still load stays no hit', async () => {
    const w = await World.create({ seed: 1 }, open);
    const lift = w.spawnBlueprint({ format: 1, name: 'lift', grid: slab(9, 4, 'F', { '4,1': 'C' }) }, { x: 0, y: 1.5 });
    w.spawnBlueprint({ format: 1, name: 'lid', grid: slab(14, 4, 'A', { '7,2': 'C' }) }, { x: 0, y: 5.5 });
    for (let t = 0; t < 120; t++) w.step();
    const before = lostParts(w);
    let hand = 0;
    for (let t = 0; t < 20; t++) {
      if (t % 2 === 0) {
        // From the outer columns, which carry nothing the lid stands on being lost.
        const p = [...lift.parts.values()].find((q) => q.def.role !== 'core' && (q.x === 0 || q.x === 8) && q.y > 0);
        if (p) {
          p.health = 0;
          hand++;
        }
      }
      w.step();
    }
    expect(hand).toBeGreaterThan(0);
    expect(lostParts(w) - before).toBe(hand);
    expect(hurtParts(w).map((p) => p.id)).toEqual([]);
    w.dispose();
  });
});

describe('crash: a robot under fire takes its crashes', () => {
  /** Frame blocks with their cores at the far ends, flying into each other. What each one lost of its health. */
  async function ram(opts: { under?: 'target' | 'ram' | 'both'; jointed?: boolean; quiet?: boolean } = {}): Promise<{ target: number; ram: number }> {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    // Jointed: a mast on a rotator over the middle, so its bodies are multibody links.
    const grid = (core: string): string[] => [...(opts.jointed ? [`${'.  '.repeat(7)}F  ${'.  '.repeat(8)}`, `${'.  '.repeat(7)}R  ${'.  '.repeat(8)}`] : []), ...slab(16, 5, 'F', { [core]: 'C' })];
    const ramBot = w.spawnBlueprint({ format: 1, name: 'ram', grid: grid('0,2') }, { x: -13, y: 40 });
    const target = w.spawnBlueprint({ format: 1, name: 'target', grid: grid('15,2') }, { x: 20, y: 40 });
    const full = { ram: fullHealth(ramBot), target: fullHealth(target) };
    w.step();
    w.kickRobot(ramBot, 60, 0);
    // A corner of each, far from the hit, goes on every tick from the start, so the hit lands on rebuilt bodies.
    const shave = (r: Robot, x: number): void => {
      const p = [...r.parts.values()].find((q) => Math.abs(q.x - x) < 3 && q.y === 4);
      if (p) p.health = 0;
    };
    for (let t = 0; t < 15; t++) {
      if (opts.under === 'target' || opts.under === 'both') shave(target, 15);
      if (opts.under === 'ram' || opts.under === 'both') shave(ramBot, 0);
      w.step();
    }
    const left = { ram: healthOf(ramBot), target: healthOf(target) };
    w.dispose();
    return { target: 1 - left.target / full.target, ram: 1 - left.ram / full.ram };
  }

  it('rammed while it loses a part every tick, it is hurt like a robot that loses none, and so is what rammed it', async () => {
    const calm = await ram();
    const fire = await ram({ under: 'target' });
    expect(calm.target).toBeGreaterThan(0.01);
    expect(fire.target).toBeGreaterThan(calm.target * 0.8);
    expect(fire.ram).toBeGreaterThan(calm.ram * 0.8);
    expect(fire.ram).toBeLessThan(calm.ram * 1.2 + 0.01);
  });

  it('the same when it is the ram that loses parts, when both do, and on a jointed robot (kicked in its own first substep)', async () => {
    const calm = await ram();
    for (const opts of [{ under: 'ram' }, { under: 'both' }] as const) {
      const fire = await ram(opts);
      expect(fire.target).toBeGreaterThan(calm.target * 0.8);
      expect(fire.ram).toBeGreaterThan(calm.ram * 0.8);
    }
    const jointed = await ram({ jointed: true });
    const jointedFire = await ram({ jointed: true, under: 'target' });
    expect(jointed.target).toBeGreaterThan(0.005);
    expect(jointedFire.target).toBeGreaterThan(jointed.target * 0.7);
  });

  it('landing hard while it loses parts, it crashes as one that loses none', async () => {
    // What the two rows it lands on lost of their health (the top rows go by hand in one of the runs).
    const drop = async (fire: boolean): Promise<number> => {
      const w = await World.create({ seed: 1 }, open);
      const r = w.spawnBlueprint({ format: 1, name: 'brick', grid: slab(20, 6, 'F', { '10,3': 'C' }) }, { x: 0, y: 40 });
      const low = [...r.parts.values()].filter((p) => p.y <= 1);
      const full = low.reduce((sum, p) => sum + p.health, 0);
      w.kickRobot(r, 0, -40);
      for (let t = 0; t < 120; t++) {
        if (fire && t % 2 === 0) {
          const p = topPart(r);
          if (p) p.health = 0;
        }
        w.step();
      }
      const left = low.reduce((sum, p) => sum + Math.max(0, p.health), 0);
      w.dispose();
      return 1 - left / full;
    };
    const calm = await drop(false);
    const fire = await drop(true);
    expect(calm).toBeGreaterThan(0.1);
    expect(fire).toBeGreaterThan(calm * 0.7);
  });

  it('a push that hardly moves its robot leaves it crash-worthy; one that throws it does not', async () => {
    type Pushes = { pendingPushes: { part: PartInstance; jx: number; jy: number }[] };
    const hit = async (push: number): Promise<number> => {
      const w = await World.create({ seed: 1, gravityY: 0 }, space);
      const ramBot = w.spawnBlueprint({ format: 1, name: 'ram', grid: slab(16, 5, 'F', { '0,2': 'C' }) }, { x: -13, y: 40 });
      const target = w.spawnBlueprint({ format: 1, name: 'target', grid: slab(16, 5, 'F', { '15,2': 'C' }) }, { x: 20, y: 40 });
      const full = fullHealth(target);
      w.step();
      w.kickRobot(ramBot, 60, 0);
      const part = target.parts.get('frame@14,0') as PartInstance;
      for (let t = 0; t < 15; t++) {
        if (push !== 0) (w as unknown as Pushes).pendingPushes.push({ part, jx: 0, jy: push });
        w.step();
      }
      const left = healthOf(target) / full;
      w.dispose();
      return 1 - left;
    };
    const calm = await hit(0);
    expect(calm).toBeGreaterThan(0.01);
    // 10 N s a tick on 780 kg: a blast or a bolt that barely stirs a robot.
    expect(await hit(10)).toBeGreaterThan(calm * 0.8);
    // 3000 N s a tick on 780 kg: thrown (3.8 m/s a tick), it takes no crash damage while that goes on.
    expect(await hit(3000)).toBe(0);
  });

  it('a robot thrown and then rebuilt is still thrown: the kick of a release outlasts a part lost the tick after', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const a = w.spawnBlueprint({ format: 1, name: 'a', grid: slab(6, 4, 'F', { '2,1': 'C' }) }, { x: 0, y: 40 });
    w.spawnBlueprint({ format: 1, name: 'b', grid: slab(6, 4, 'A', { '3,1': 'C' }) }, { x: 8.2, y: 40 });
    w.step();
    w.kickRobot(a, 90, 0);
    const lost = a.parts.get('frame@0,3') as PartInstance;
    lost.health = 0;
    w.step();
    w.step();
    expect(a.parts.has('frame@0,3')).toBe(false);
    // The hit lands inside the kick's ticks: the block it was thrown at takes its share, the thrown one nothing.
    expect(w.physics.state(a.groups[0]?.bodyId as number).vx).toBeLessThan(80);
    expect(hurtParts(w).filter((p) => a.parts.get(p.id) === p).map((p) => p.id)).toEqual([]);
    w.dispose();
  });
});

describe('crash: a kick elsewhere in the world changes nothing about a hit', () => {
  const turret = { format: 1, name: 'turret', grid: ['.  F  .', '.  R  .', 'F  C  F'] };
  /** A hit between two blocks, with a jointed robot far off kicked on tick `kick` (which steps that tick in two). */
  async function hit(gap: number, kick: number | undefined, speed: number): Promise<{ tick: number; dv: number; j: number; hurtRam: number; hurtTarget: number }> {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const a = w.spawnBlueprint({ format: 1, name: 'a', grid: slab(16, 5, 'F', { '0,2': 'C' }) }, { x: -13, y: 40 });
    const b = w.spawnBlueprint({ format: 1, name: 'b', grid: slab(16, 5, 'F', { '15,2': 'C' }) }, { x: 19 + gap, y: 40 });
    const far = w.spawnBlueprint(turret, { x: 150, y: 150 });
    const full = { a: fullHealth(a), b: fullHealth(b) };
    w.step();
    w.kickRobot(a, speed, 0);
    const out = { tick: -1, dv: 0, j: 0, hurtRam: 0, hurtTarget: 0 };
    for (let i = 0; i < 12 && out.tick < 0; i++) {
      if (i === kick) w.kickRobot(far, 0, 1);
      const bodies = [a.groups, b.groups];
      w.step();
      const ba = a.groups[0]?.bodyId as number;
      const s = w.physics.state(ba);
      const p = w.physics.prevState(ba);
      // A hit that broke something shows as new bodies.
      if (a.groups !== bodies[0] || b.groups !== bodies[1]) {
        out.tick = i;
        continue;
      }
      if (Math.abs(s.vx - p.vx) < 5) continue;
      const m = w.physics.massProperties(ba).mass;
      out.tick = i;
      out.dv = m * (s.vx - p.vx);
      for (const c of w.physics.contactImpulses([ba])) out.j += c.body1 === ba ? -c.jx : c.jx;
    }
    out.hurtRam = full.a - healthOf(a);
    out.hurtTarget = full.b - healthOf(b);
    w.dispose();
    return out;
  }

  it('on the tick before it and on its own tick, with the hit in the first or the second part of the step: the impulses read match the momentum change and the damage is the same', { timeout: 30_000 }, async () => {
    let hard = 0;
    // At 40 m/s nothing breaks, so the bodies are still the ones that hit and their impulses can be read after the step.
    for (const speed of [40, 60, 80]) {
      // Far enough that the ram's own kick is over when it lands; each a different share of a tick away.
      for (const part of [0.05, 0.3, 0.5, 0.95, 1.3]) {
        const gap = (speed / 60) * 4 + part;
        const none = await hit(gap, undefined, speed);
        expect(none.tick).toBeGreaterThanOrEqual(0);
        for (const kick of [none.tick, none.tick - 1]) {
          const with_ = await hit(gap, kick, speed);
          // A step cut in two can see the contact a tick early; the hit is the same hit.
          expect(with_.tick === none.tick || with_.tick === none.tick - 1).toBe(true);
          if (speed === 40) {
            expect(Math.abs(with_.j - with_.dv)).toBeLessThan(0.02 * Math.abs(with_.dv));
            expect(Math.abs(with_.dv - none.dv)).toBeLessThan(0.05 * Math.abs(none.dv));
          }
          expect(Math.abs(with_.hurtRam - none.hurtRam)).toBeLessThan(0.2 * none.hurtRam + 5);
          expect(Math.abs(with_.hurtTarget - none.hurtTarget)).toBeLessThan(0.2 * none.hurtTarget + 5);
          if (with_.hurtRam > 0) hard++;
        }
      }
    }
    expect(hard).toBeGreaterThan(5);
  });
});

describe('crash: a release is not a crash', () => {
  const noCrash = (w: World, robots: readonly Robot[]): void => {
    expect(w.events.filter((e) => e.kind === 'partDestroyed')).toEqual([]);
    expect(hurtParts(w).map((p) => p.id)).toEqual([]);
    for (const r of robots) expect(r.parts.size).toBeGreaterThan(0);
  };
  /** A hull with a thing held on by decouplers, kicked to speed and turning, let go on G. */
  const SHIP = {
    format: 1,
    name: 'ship',
    grid: [
      'F  F  F  C  F  F  F',
      'F  F  F  F  F  F  F',
      '.  Dv .  .  .  Dv .',
      'A  A  A  A  A  A  A',
      '.  A  A  A  A  A  .',
    ],
    bindings: [{ key: 'g', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }],
  };
  const LEGEND = { Dv: { part: 'decoupler', rot: 180, tags: ['decoupler'] } };

  async function dropped(w: World, r: Robot, kick: [number, number, number]): Promise<void> {
    for (let t = 0; t < 3; t++) w.step();
    w.kickRobot(r, ...kick);
    for (let t = 0; t < 8; t++) w.step();
    const before = w.robots.length;
    w.step([{ robot: r.id, pressed: ['g'], released: [] }]);
    expect(w.events.filter((e) => e.kind === 'decoupled').length).toBeGreaterThanOrEqual(2);
    expect(w.robots.length).toBeGreaterThan(before);
    w.step([{ robot: r.id, pressed: [], released: ['g'] }]);
    for (let t = 0; t < 30; t++) w.step();
    noCrash(w, w.robots);
  }

  it('decouplers dropping a plated lid (the Anvil\'s, smaller): flying sideways at 60 m/s, neither side is hurt', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const r = w.spawnBlueprint({ ...SHIP, legend: LEGEND }, { x: 0, y: 100 });
    await dropped(w, r, [60, 0, 0]);
    w.dispose();
  });

  it('and turning fast, so the lid swings against the hull as it goes', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const r = w.spawnBlueprint({ ...SHIP, legend: LEGEND }, { x: 0, y: 100 });
    await dropped(w, r, [20, -10, 4]);
    w.dispose();
  });

  it('a decoupler firing right over the ground, under gravity: the lid lands from a few centimeters, nothing breaks', async () => {
    const w = await World.create({ seed: 1 }, open);
    const r = w.spawnBlueprint({ ...SHIP, legend: LEGEND }, { x: 0, y: 3 });
    for (let t = 0; t < 120; t++) w.step();
    w.step([{ robot: r.id, pressed: ['g'], released: [] }]);
    w.step([{ robot: r.id, pressed: [], released: ['g'] }]);
    for (let t = 0; t < 120; t++) w.step();
    noCrash(w, w.robots);
    w.dispose();
  });

  it('a missile leaving a rail under its own thrust: neither it nor the launcher is hurt', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const r = w.spawnBlueprint({
      format: 1,
      name: 'launcher',
      grid: ['t  F  F  k', '.  D  .  .', 'F  C  F  F'],
      legend: { k: { part: 'core' }, D: { part: 'decoupler', tags: ['decoupler'] }, t: { part: 'thruster', rot: 270, tags: ['motor'] } },
      primaryCore: 'core@1,0',
      bindings: [
        { key: 'g', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 },
        { key: 'h', mode: 'hold', target: 'motor', channel: 'throttle', value: 1 },
      ],
    }, { x: 0, y: 100 });
    w.setUnlimitedEnergy(true);
    for (let t = 0; t < 3; t++) w.step();
    w.kickRobot(r, 30, 0, 0);
    for (let t = 0; t < 8; t++) w.step();
    w.step([{ robot: r.id, pressed: ['h'], released: [] }]);
    w.step([{ robot: r.id, pressed: ['g'], released: [] }]);
    w.step([{ robot: r.id, pressed: [], released: ['g'] }]);
    for (let t = 0; t < 30; t++) w.step();
    expect(w.events.filter((e) => e.kind === 'decoupled').length).toBeGreaterThan(0);
    expect(w.robots.length).toBeGreaterThan(1);
    noCrash(w, w.robots);
    w.dispose();
  });

  /** A hull with a rotator (so it is kicked in a first substep) and a bay as tight as titan-hive's, its dart built. */
  const BAYSHIP = {
    format: 1,
    name: 'bayship',
    parts: [
      { part: 'core', x: 0, y: 0 },
      { part: 'densebattery', x: -1, y: 0 },
      { part: 'densebattery', x: 1, y: 0 },
      { part: 'frame', x: 2, y: 0 },
      { part: 'rotator', x: 2, y: 1 },
      { part: 'frame', x: 2, y: 2 },
      { part: 'fabbay', x: -2, y: 1, tags: ['bay'], makes: 'dart' },
    ],
    recipes: { dart: { format: 1, name: 'dart', grid: ['F', 'F', 'C'] } },
    bindings: [{ key: 'r', mode: 'pulse', target: 'bay', channel: 'release', value: 1 }],
  };
  async function loaded(kick: [number, number, number]): Promise<{ w: World; ship: Robot }> {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const ship = w.spawnBlueprint(BAYSHIP, { x: 0, y: 100 });
    w.setUnlimitedEnergy(true);
    for (let t = 0; t < 400 && !w.events.some((e) => e.kind === 'built'); t++) w.step();
    expect(w.events.some((e) => e.kind === 'built')).toBe(true);
    w.kickRobot(ship, ...kick);
    for (let t = 0; t < 10; t++) w.step();
    return { w, ship };
  }

  it('a dart let go from a bay flying sideways at 40 m/s: it slides out with neither side hurt', async () => {
    const { w, ship } = await loaded([40, 0, 0]);
    w.step([{ robot: ship.id, pressed: ['r'], released: [] }]);
    expect(w.robots.length).toBe(2);
    w.step([{ robot: ship.id, pressed: [], released: ['r'] }]);
    for (let t = 0; t < 60; t++) w.step();
    noCrash(w, w.robots);
    w.dispose();
  });

  it('a dart let go from a bay turning at 3 rad/s: the walls meet it, and neither side is hurt', async () => {
    const { w, ship } = await loaded([10, 0, 3]);
    w.step([{ robot: ship.id, pressed: ['r'], released: [] }]);
    expect(w.robots.length).toBe(2);
    w.step([{ robot: ship.id, pressed: [], released: ['r'] }]);
    for (let t = 0; t < 60; t++) w.step();
    noCrash(w, w.robots);
    w.dispose();
  });

  it('a dart let go while its ship loses parts: the ship\'s rebuild on the next ticks does not end the release\'s protection', async () => {
    const { w, ship } = await loaded([40, 0, 0]);
    w.step([{ robot: ship.id, pressed: ['r'], released: [] }]);
    const frame = ship.parts.get('frame@2,0') as PartInstance;
    w.step([{ robot: ship.id, pressed: [], released: ['r'] }]);
    frame.health = 0;
    for (let t = 0; t < 30; t++) w.step();
    expect(w.events.filter((e) => e.kind === 'partDestroyed').map((e) => (e as { part: string }).part)).toEqual(['frame@2,0']);
    expect(hurtParts(w).map((p) => p.id)).toEqual([]);
    w.dispose();
  });
});
