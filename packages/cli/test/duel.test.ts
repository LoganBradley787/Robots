import { describe, expect, it } from 'vitest';
import { parseWorldFile, World, type Robot } from '@robots/sim-core';
import arenaJson from '../../../worlds/arena.json';
import flatJson from '../../../worlds/flat.json';
import carJson from '../../../blueprints/car.json';
import { DEFAULT_BOUNDS, duel, formatDuel, formatStops, GRACE_SECONDS, SideWatch, SpawnRefused, verdict, type ScriptStop, type SideReport } from '../src/commands/duel';
import { InvalidBlueprint } from '../src/commands/run';
import { readBlueprint, resolveBlueprint } from '../src/blueprintFiles';
import { scriptHost } from '../src/scriptHost';

const arena = parseWorldFile(arenaJson);
const car = { name: 'car', raw: carJson };
const load = (name: string, y?: number) => ({ name, raw: readBlueprint(resolveBlueprint(name)).raw, ...(y !== undefined ? { y } : {}) });
// A core beside an armed warhead: dropped from a height, the landing sets the warhead off and the whole robot is gone.
const popper = (y: number) => ({ name: 'popper', raw: { format: 1, name: 'popper', grid: ['C  X'], legend: { X: { part: 'warhead', armed: true } } }, y });
// A core on a thruster that its script holds wide open: straight up, out of the top of the bounds.
const rocket = { name: 'rocket', raw: { format: 1, name: 'rocket', grid: ['C', 'T^'], scripts: [{ id: 'up', source: "function tick() { set('thruster', 'throttle', 1); }" }] }, y: 100 };
// A parked robot whose scripts light its flare (it burns out after 2 s), throw after half a second, and never end.
const faulty = {
  name: 'faulty',
  raw: {
    format: 1,
    name: 'faulty',
    grid: ['F  C  Q>'],
    scripts: [
      { id: 'light', source: "function tick() { set('flare', 'ignite', 1); }" },
      { id: 'oops', source: "function tick() { if (time > 0.5) throw new Error('lost my way'); }" },
      { id: 'spin', source: 'function tick() { for (;;) {} }' },
    ],
  },
};

describe('duel', () => {
  it('puts a on the left on team 0 and b on the right on team 1, both resting on the ground; time running out is a draw', { timeout: 30_000 }, async () => {
    const r = await duel(car, car, { seed: 1, seconds: 2 });
    expect(r.world).toBe('arena');
    expect(r.a).toMatchObject({ name: 'car', team: 0, at: { x: -400, y: 1.45 }, startParts: 8, startCores: 1, parts: 8, cores: 1, share: 1, robots: 1, copies: 0 });
    expect(r.b).toMatchObject({ team: 1, at: { x: 400, y: 1.45 }, share: 1 });
    expect(r.ticks).toBe(120);
    expect(r).toMatchObject({ winner: 'draw', length: 2, why: 'time ran out with both main cores alive (a has 100.0% of its parts left, b 100.0%)', bounds: DEFAULT_BOUNDS, scriptCrashes: [] });
    expect(r.samples.map((s) => s.tick)).toEqual([120]);
    expect(r.finalHash).toMatch(/^[0-9a-f]{8}$/);
    const text = formatDuel(r);
    expect(text).toContain('winner: draw');
    expect(text).toContain('a car: 8 of 8 starting parts alive (100.0% left), 1 of 1 starting cores');
    expect(text).toContain('scripts stopped: none');
    expect(text).toContain('bounds x 1000, y 250');
    expect(text).toContain('time per tick on this machine:');
  });

  it('runs on another world when given one', { timeout: 30_000 }, async () => {
    const r = await duel(car, car, { seed: 1, seconds: 0.5, file: parseWorldFile(flatJson) });
    expect(r.world).toBe('flat');
  });

  it('a robot destroyed whole has lost (no coreLost is logged for it), and the match stops 2 s later', { timeout: 30_000 }, async () => {
    const r = await duel(popper(10), car, { seed: 1, seconds: 30 });
    expect(r.winner).toBe('b');
    expect(r.a).toMatchObject({ cores: 0, parts: 0, share: 0, robots: 0, lostBy: 'core', spent: 1 });
    expect(r.a.lostAt).toBeGreaterThan(1);
    expect(r.a.lostAt).toBeLessThan(3);
    expect(r.b.lostAt).toBeUndefined();
    expect(r.length).toBeCloseTo((r.a.lostAt ?? 0) + GRACE_SECONDS, 6);
    expect(r.samples.at(-1)?.tick).toBe(r.ticks);
    expect(r.why).toMatch(/^a's main core was destroyed at t=\d\.\d\d s$/);
    expect(formatDuel(r)).toContain('winner: b (car)');
  });

  it('both sides losing within 2 s is a draw', { timeout: 30_000 }, async () => {
    const r = await duel(popper(10), popper(20), { seed: 1, seconds: 30 });
    expect(r.a.lostAt).toBeDefined();
    expect(r.b.lostAt).toBeGreaterThan(r.a.lostAt ?? Infinity);
    expect(r.winner).toBe('draw');
    expect(r.why).toContain('both lost within 2 s');
  });

  it('a main core that goes out of bounds has lost; the bounds can be moved or turned off', { timeout: 30_000 }, async () => {
    const r = await duel(rocket, car, { seed: 1, seconds: 30 });
    expect(r.winner).toBe('b');
    expect(r.a).toMatchObject({ lostBy: 'bounds', cores: 1, share: 1 });
    expect(r.a.lostWhere?.y).toBeGreaterThan(DEFAULT_BOUNDS.y);
    expect(r.a.lostWhere?.y).toBeLessThan(DEFAULT_BOUNDS.y + 5);
    expect(r.why).toMatch(/^a's main core went out of bounds at t=\d+\.\d\d s, at \(-400, 25\d\)$/);
    expect(r.length).toBeCloseTo((r.a.lostAt ?? 0) + GRACE_SECONDS, 6);

    const low = await duel(rocket, car, { seed: 1, seconds: 30, bounds: { x: 1000, y: 120 } });
    expect(low.a.lostAt).toBeLessThan(r.a.lostAt ?? 0);
    expect(low.bounds).toEqual({ x: 1000, y: 120 });
    const off = await duel(rocket, car, { seed: 1, seconds: 4, bounds: false });
    expect(off).toMatchObject({ winner: 'draw', ticks: 240, bounds: false });
    expect(formatDuel(off)).toContain('bounds off');
  });

  it('reports every script that stopped: which, on which robot, when, and why', { timeout: 30_000 }, async () => {
    const r = await duel(car, faulty, { seed: 1, seconds: 3 });
    expect(r.scriptCrashes.map((c) => [c.side, c.robot, c.main, c.script, c.kind])).toEqual([
      ['b', 2, true, 'spin', 'budget'],
      ['b', 2, true, 'oops', 'throw'],
    ]);
    expect(r.scriptCrashes[0]?.t).toBe(0);
    expect(r.scriptCrashes[1]?.t).toBeCloseTo(0.5, 1);
    expect(r.scriptCrashes[1]?.message).toContain('lost my way');
    const text = formatDuel(r);
    expect(text).toContain('scripts stopped: 2 (a stopped script stays stopped)');
    expect(text).toMatch(/ {2}b faulty: script spin on the robot with its main core \(robot 2\) at t=0\.00 s \(budget\): ran too long for one tick/);
    expect(text).toMatch(/ {2}b faulty: script oops on the robot with its main core \(robot 2\) at t=0\.5\d s \(throw\): .*lost my way/);
  });

  it('leaves starting parts that ended themselves out of the share', { timeout: 30_000 }, async () => {
    // The flare burnt out: 2 of 3 starting parts are alive, and that is all of the 2 that did not end themselves.
    const r = await duel(car, faulty, { seed: 1, seconds: 3 });
    expect(r.b).toMatchObject({ startParts: 3, parts: 2, spent: 1, share: 1 });
    expect(formatDuel(r)).toContain('b faulty: 2 of 3 starting parts alive, 1 more ended themselves (100.0% left)');
  });

  it('a fab drone beats a parked car from 800 m; the copies it lets go are counted, but not as its parts or cores', { timeout: 60_000 }, async () => {
    const r = await duel(load('enemy-fab-drone', 40), car, { seed: 1, seconds: 40 });
    expect(r.winner).toBe('a');
    expect(r.b.lostBy).toBe('core');
    expect(r.ticks).toBeLessThan(40 * 60);
    expect(r.a.copies).toBeGreaterThan(0);
    expect(r.a.robots).toBeGreaterThan(1);
    expect(r.a).toMatchObject({ startCores: 1, cores: 1, share: 1 });
    expect(r.a.parts).toBe(r.a.startParts);
    expect(r.timing.scriptMs).toBeGreaterThan(0);
    expect(r.timing.avgMs).toBeGreaterThanOrEqual(r.timing.scriptMs);
    expect(r.timing.p95Ms).toBeLessThanOrEqual(r.timing.worstMs);
  });

  it('gives the same hash for the same blueprints and seed', { timeout: 60_000 }, async () => {
    const run = () => duel(load('enemy-gun-drone', 40), load('enemy-drone', 30), { seed: 3, seconds: 4 });
    const [p, q] = [await run(), await run()];
    expect(p.finalHash).toBe(q.finalHash);
    expect(p.samples).toEqual(q.samples);
  });

  it('says why a spawn spot is refused', async () => {
    await expect(duel({ ...car, y: 0.2 }, car, { seed: 1, seconds: 1 })).rejects.toThrow(/car cannot spawn with its core at \(-400, 0\.2\): below the ground/);
    await expect(duel({ ...car, y: 0.2 }, car, { seed: 1, seconds: 1 })).rejects.toBeInstanceOf(SpawnRefused);
    await expect(duel(car, { ...car, y: 151 }, { seed: 1, seconds: 1 })).rejects.toThrow(/car cannot spawn with its core at height 151: the highest allowed is 150 m/);
    // Main cores 2 m apart: b's wheels land in a's.
    await expect(duel(car, car, { seed: 1, seconds: 1, x: 1 })).rejects.toThrow(/overlaps something already in the world/);
    await expect(duel(car, { name: 'wall', raw: { format: 1, name: 'wall', grid: ['F', 'F'] } }, { seed: 1, seconds: 1 })).rejects.toThrow(/wall has no core/);
    await expect(duel(car, { name: 'x', raw: { format: 1, name: 'x', grid: ['C . F'] } }, { seed: 1, seconds: 1 })).rejects.toBeInstanceOf(InvalidBlueprint);
  });
});

describe('SideWatch: the starting robot followed through splits', () => {
  // Two cores joined by a decoupler: F lets the right half go, and its core wakes as a robot of its own. The left core
  // is the main one.
  const twin = { format: 1, name: 'twin', grid: ['F  C  D>  C  F'], bindings: [{ key: 'f', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }] };
  const kill = (robot: Robot | undefined, ids?: string[]): void => {
    for (const p of robot?.parts.values() ?? []) if (!ids || ids.includes(p.id)) p.health = 0;
  };

  it('counts the parts of a piece that broke off, and only the main core decides', async () => {
    const world = await World.create({ seed: 1, scripts: await scriptHost() }, arena);
    try {
      const ours = world.spawnBlueprint(twin, { x: -100, y: 30 }, { team: 0 });
      const theirs = world.spawnBlueprint(twin, { x: 100, y: 30 }, { team: 1 });
      const a = new SideWatch(ours);
      const b = new SideWatch(theirs);
      const check = (): void => [a, b].forEach((w) => w.check(world, DEFAULT_BOUNDS));
      expect(a.count(world)).toEqual({ cores: 2, parts: 5, share: 1, robots: 1 });

      world.step([ours, theirs].map((r) => ({ robot: r.id, pressed: ['f'], released: [] })));
      world.step([ours, theirs].map((r) => ({ robot: r.id, pressed: [], released: ['f'] })));
      const piece = (of: Robot): Robot | undefined => world.robots.find((r) => r.brokeFrom === of.id);
      expect(piece(ours)?.woke).toBe(true);
      expect(ours.parts.size).toBe(3);
      expect(piece(ours)?.parts.size).toBe(2);
      // Both halves still count, though one is another robot now.
      expect(a.count(world)).toEqual({ cores: 2, parts: 5, share: 1, robots: 2 });
      check();
      expect(a.lost || b.lost).toBe(false);

      // Ours: the main core's whole half goes. The robot is removed (a `removed` event, never `coreLost`), and though
      // the piece and its core fight on, the side has lost.
      kill(ours);
      // Theirs: the piece's core goes. That is not the main core, so the side is still in.
      kill(piece(theirs), [piece(theirs)?.primaryCoreId ?? '']);
      world.step();
      check();
      expect(world.robots).not.toContain(ours);
      expect(world.events.some((e) => e.kind === 'coreLost' && e.robot === ours.id)).toBe(false);
      expect(a.count(world)).toEqual({ cores: 1, parts: 2, share: 0.4, robots: 1 });
      expect(a.lostTick).toBe(world.tick);
      expect(a.lostBy).toBe('core');
      expect(b.count(world)).toEqual({ cores: 1, parts: 4, share: 0.8, robots: 1 });
      expect(b.lost).toBe(false);

      // Theirs: the main core alone goes (`coreLost` this time); its frame lives on as a wreck.
      kill(theirs, [theirs.primaryCoreId ?? '']);
      world.step();
      check();
      expect(b.count(world)).toEqual({ cores: 0, parts: 3, share: 0.6, robots: 0 });
      expect(b.lostTick).toBe(world.tick);
    } finally {
      world.dispose();
    }
  });

  it('follows the main core when the part of the robot around it is what breaks away', async () => {
    // The decoupler sits between the main core and the bulk of the robot: fired, the main core flies off as the small half.
    const pod = { format: 1, name: 'pod', grid: ['C  D>  F  F  F  C'], bindings: [{ key: 'f', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }] };
    const world = await World.create({ seed: 1, scripts: await scriptHost() }, arena);
    try {
      const robot = world.spawnBlueprint(pod, { x: 0, y: 30 }, { team: 0 });
      const main = robot.primaryCoreId ?? '';
      const w = new SideWatch(robot);
      world.step([{ robot: robot.id, pressed: ['f'], released: [] }]);
      world.step();
      const big = world.robots.find((r) => r.parts.size === 4);
      const small = world.robots.find((r) => r.parts.has(main));
      expect(small?.parts.size).toBe(2);
      w.check(world, DEFAULT_BOUNDS);
      expect(w.lost).toBe(false);
      expect(w.holds(small?.id ?? -1)).toBe(true);
      // The big half gone changes nothing; the main core gone ends it.
      kill(big);
      world.step();
      w.check(world, DEFAULT_BOUNDS);
      expect(w.lost).toBe(false);
      kill(small, [main]);
      world.step();
      w.check(world, DEFAULT_BOUNDS);
      expect(w.lostBy).toBe('core');
    } finally {
      world.dispose();
    }
  });

  it('checks the bounds on the main core', async () => {
    const world = await World.create({ seed: 1, scripts: await scriptHost() }, arena);
    try {
      const inside = new SideWatch(world.spawnBlueprint(carJson, { x: 999, y: 249 }, { team: 0 }));
      const outside = new SideWatch(world.spawnBlueprint(carJson, { x: -1001, y: 5 }, { team: 1 }));
      const high = new SideWatch(world.spawnBlueprint(carJson, { x: 0, y: 251 }, { team: 2 }));
      const free = new SideWatch(world.spawnBlueprint(carJson, { x: 0, y: 300 }, { team: 3 }));
      for (const w of [inside, outside, high]) w.check(world, DEFAULT_BOUNDS);
      free.check(world, false);
      expect(inside.lost).toBe(false);
      expect(free.lost).toBe(false);
      expect(outside).toMatchObject({ lostTick: 0, lostBy: 'bounds', lostWhere: { x: -1001, y: 5 } });
      expect(high).toMatchObject({ lostBy: 'bounds', lostWhere: { x: 0, y: 251 } });
    } finally {
      world.dispose();
    }
  });
});

describe('formatStops', () => {
  const stop = (over: Partial<ScriptStop>): ScriptStop => ({ side: 'a', robot: 1, main: true, script: 'pilot', t: 1.5, kind: 'throw', message: 'x is not defined', ...over });

  it('puts the same stop on many pieces on one line', () => {
    const stops = [stop({}), ...[7, 8, 9].map((robot, i) => stop({ robot, main: false, core: 'core@3,5 (dart1)', script: 'guide', t: 12 + i, kind: 'budget', message: 'ran too long' })), stop({ side: 'b', robot: 2, t: 0 })];
    expect(formatStops(stops, { a: 'ant', b: 'bee' })).toEqual([
      'scripts stopped: 5 (a stopped script stays stopped)',
      '  a ant: script pilot on the robot with its main core (robot 1) at t=1.50 s (throw): x is not defined',
      '  a ant: script guide on 3 pieces or copies (first robot 7, core@3,5 (dart1)) at t=12.00 s and after (budget): ran too long',
      '  b bee: script pilot on the robot with its main core (robot 2) at t=0.00 s (throw): x is not defined',
    ]);
    expect(formatStops([], { a: 'ant', b: 'bee' })).toEqual(['scripts stopped: none']);
  });
});

describe('verdict', () => {
  const side = (share: number, lostAt?: number, lostBy: 'core' | 'bounds' = 'core'): SideReport => ({ name: 'x', team: 0, at: { x: 0, y: 0 }, startCores: 1, startParts: 100, cores: 1, parts: share * 100, share, robots: 1, spent: 0, copies: 0, ...(lostAt !== undefined ? { lostAt, lostBy, ...(lostBy === 'bounds' ? { lostWhere: { x: 1000.4, y: 12 } } : {}) } : {}) });

  it('the side that lost loses, whatever the shares', () => {
    expect(verdict(side(0.9, 12), side(0.1))).toEqual({ winner: 'b', why: "a's main core was destroyed at t=12.00 s" });
    expect(verdict(side(0.1), side(0.9, 30, 'bounds'))).toEqual({ winner: 'a', why: "b's main core went out of bounds at t=30.00 s, at (1000, 12)" });
  });

  it('both lost within 2 s is a draw', () => {
    expect(verdict(side(0, 12), side(0, 14)).winner).toBe('draw');
    expect(verdict(side(0, 12), side(0, 14.5)).winner).toBe('b');
    expect(verdict(side(0, 14.5), side(0, 12)).winner).toBe('a');
  });

  it('time running out is a draw, whatever is left of either', () => {
    expect(verdict(side(0.9), side(0.1))).toEqual({ winner: 'draw', why: 'time ran out with both main cores alive (a has 90.0% of its parts left, b 10.0%)' });
  });
});
