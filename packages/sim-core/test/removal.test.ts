import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { orientRaw } from '../src/blueprint/orient';
import { resolveScripts } from '../src/blueprint/scripts';
import { buildReplay, parseReplay, ReplayError, runReplay } from '../src/replay/replayFile';

const flat = parseWorldFile(flatJson);
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

let quickjs: ScriptHost;
beforeAll(async () => {
  quickjs = await createQuickJsHost(variant);
});

/** The QuickJS host, counting the script instances it made that are not disposed yet. */
function counted(): { host: ScriptHost; live: () => number; made: () => number } {
  let live = 0;
  let made = 0;
  const host: ScriptHost = {
    compile(source, opts) {
      const r = quickjs.compile(source, opts);
      if (!r.ok) return r;
      made++;
      live++;
      const inner = r.instance;
      let gone = false;
      const instance = Object.create(inner) as typeof inner;
      instance.setup = inner.setup.bind(inner);
      instance.tick = inner.tick.bind(inner);
      instance.dispose = () => {
        if (!gone) live--;
        gone = true;
        inner.dispose();
      };
      return { ok: true, instance };
    },
  };
  return { host, live: () => live, made: () => made };
}

/** A small scripted robot: a core with a script that writes every tick and logs now and then. */
const LIFTER = {
  format: 1,
  name: 'lifter',
  grid: ['F  T^ C  T^ F'],
  scripts: [{ id: 'lift', enabled: true, source: `function tick() { set('thruster', 'throttle', 0.1); if (frame % 30 === 0) log('up'); }` }],
};

/** Everything the world keeps per robot, by name: each must be empty once every robot is gone. */
const PER_ROBOT = ['byId', 'controllers', 'runners', 'channels', 'used', 'logBudget', 'emptied', 'debrisRest', 'dirty', 'grown', 'seen', 'seenDecoys', 'scriptMarks', 'lastSentEvent', 'pendingKicks', 'unprimed', 'pendingRemove'] as const;

function held(w: World): Record<string, number> {
  const inside = w as unknown as Record<string, { size: number }>;
  return Object.fromEntries(PER_ROBOT.map((k) => [k, inside[k]?.size ?? -1]));
}

const empty = Object.fromEntries(PER_ROBOT.map((k) => [k, 0]));

describe('robots that die and go are cleaned up (M16 audit)', () => {
  it('a lost core stops its scripts, and Clear debris leaves nothing of the robots behind', async () => {
    const scripts = counted();
    const w = await World.create({ seed: 1, scripts: scripts.host }, flat);
    const terrain = w.physics.bodyIds.length;
    const robots = [0, 1, 2, 3].map((i) => w.spawnBlueprint(LIFTER, { x: -30 + i * 15, y: 1 }));
    for (let t = 0; t < 60; t++) w.step();
    expect(scripts.live()).toBe(4);
    for (const r of robots) {
      const core = r.parts.get(r.primaryCoreId ?? '');
      if (core) core.health = 0;
      w.step();
    }
    // Each lost its core: its scripts are disposed at once, it latches, and nothing controls it.
    expect(scripts.live()).toBe(0);
    expect(robots.every((r) => !w.canControl(r.id))).toBe(true);
    expect(w.scripts(robots[0]?.id ?? 0)).toEqual([]);
    // The core sat in the middle: each robot fell in two.
    expect(w.robots.length).toBe(8);
    w.clearDebris();
    w.step();
    expect(w.robots).toEqual([]);
    expect(w.physics.bodyIds.length).toBe(terrain);
    expect(held(w)).toEqual(empty);
    w.dispose();
  });

  it('missiles that woke in pieces and robots blown apart leave nothing once removed by hand', { timeout: 30_000 }, async () => {
    const scripts = counted();
    const w = await World.create({ seed: 1, scripts: scripts.host }, flat);
    const terrain = w.physics.bodyIds.length;
    const silo = w.spawnBlueprint(blueprint('silo'), { x: -100, y: 0.5 });
    w.spawnBlueprint(orientRaw(blueprint('enemy-drone'), { flip: true }, w.registry), { x: -30, y: 25 }, { team: 1 });
    let woke = 0;
    for (let t = 0; t < 8 * 60; t++) {
      const fire = t >= 120 && t <= 210 && t % 18 === 0;
      const release = t >= 120 && t <= 211 && t % 18 === 1;
      w.step(fire ? [{ robot: silo.id, pressed: ['f'], released: [] }] : release ? [{ robot: silo.id, pressed: [], released: ['f'] }] : []);
      woke = Math.max(woke, w.robots.filter((r) => r.woke).length);
    }
    // Missiles woke with their own scripts, and more scripts ran than the two robots started with.
    expect(woke).toBeGreaterThan(0);
    expect(scripts.made()).toBeGreaterThan(2);
    w.removeRobots(w.robots.map((r) => r.id));
    w.step();
    expect(w.robots).toEqual([]);
    expect(scripts.live()).toBe(0);
    expect(w.physics.bodyIds.length).toBe(terrain);
    expect(held(w)).toEqual(empty);
    w.dispose();
  });
});

describe('removing robots by hand (M16)', () => {
  it("keeps a robot's weapon tallies once it is gone: the run report counts what a robot did before it went", async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint({ format: 1, name: 'gun-car', grid: ['C M>'], bindings: [{ key: 'f', mode: 'hold', target: 'gun', channel: 'fire', value: 1 }] }, { x: -100, y: 0.5 });
    for (let i = 0; i < 5; i++) w.step();
    w.step([{ robot: car.id, pressed: ['f'], released: [] }]);
    for (let i = 0; i < 59; i++) w.step();
    expect(w.shotsBy(car.id)).toBe(10);
    w.removeRobots([car.id]);
    w.step();
    expect(w.robots).toEqual([]);
    // Reporting only (shotsBy, laserStats, cannonStats): never simulation state, read by pnpm sim run's report.
    expect(w.shotsBy(car.id)).toBe(10);
    w.dispose();
  });

  it('goes on the next tick, is logged with the ids that went, and a replay does the same', async () => {
    const w = await World.create({ seed: 3, scripts: quickjs }, flat);
    const a = w.spawnBlueprint(LIFTER, { x: -20, y: 1 });
    const b = w.spawnBlueprint(LIFTER, { x: 0, y: 1 }, { team: 1 });
    const c = w.spawnBlueprint(LIFTER, { x: 20, y: 1 });
    for (let t = 0; t < 30; t++) w.step();
    // A key held on the robot that goes: dropped, unlogged, like a robot that lost its core.
    w.removeRobots([c.id, b.id, 99]);
    expect(w.removing(b.id)).toBe(true);
    expect(w.robots.length).toBe(3);
    const tick = w.tick;
    w.step([{ robot: c.id, pressed: ['w'], released: [] }]);
    expect(w.robots.map((r) => r.id)).toEqual([a.id]);
    expect(w.removing(b.id)).toBe(false);
    expect(w.canControl(c.id)).toBe(false);
    // In the robots' order, without the id that was never there.
    expect(w.inputLog.worldAt(tick)).toEqual({ remove: [b.id, c.id] });
    expect(w.inputLog.inputsAt(tick)).toEqual([]);
    expect(w.events.filter((e) => e.kind === 'removed').map((e) => e.robot)).toEqual([b.id, c.id]);
    // Again for a robot already gone: nothing happens and nothing is logged.
    w.removeRobots([b.id]);
    w.step();
    expect(w.inputLog.worldAt(tick + 1)).toBeUndefined();
    for (let t = 0; t < 30; t++) w.step();
    const replay = parseReplay(JSON.parse(JSON.stringify(buildReplay(w))));
    const rerun = await runReplay(replay, undefined, quickjs);
    expect(rerun.matches).toBe(true);
    expect(rerun.world.robots.map((r) => r.id)).toEqual([a.id]);
    rerun.world.dispose();
    w.dispose();
  });

  it('refuses ids that are not robot ids, and a replay with a bad removal', async () => {
    const w = await World.create({ seed: 1 }, flat);
    expect(() => w.removeRobots([0])).toThrow('whole number');
    expect(() => w.removeRobots([1.5])).toThrow('whole number');
    const file = JSON.parse(JSON.stringify(buildReplay(w))) as { inputs: unknown[] };
    file.inputs = [{ tick: 0, inputs: [], world: { remove: ['x'] } }];
    expect(() => parseReplay(file)).toThrow(ReplayError);
    w.dispose();
  });
});
