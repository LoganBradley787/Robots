import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World, type WorldEvent } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { resolveScripts } from '../src/blueprint/scripts';
import { orientRaw } from '../src/blueprint/orient';
import { defaultRegistry } from '../src/parts/registry';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
/** A shipped blueprint with its script files loaded; `pilot` overrides the first script's params. */
const blueprint = (name: string, pilot?: Record<string, number>): unknown => {
  const raw = JSON.parse(bpFile(`${name}.json`));
  if (pilot) raw.scripts[0].params = { ...raw.scripts[0].params, ...pilot };
  return resolveScripts(raw, bpFile).raw;
};
const of = (w: World, r: Robot, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind && e.robot === r.id);
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot)).length;
}
/** Parts the robot itself lost (not what it let go). */
const ownLost = (w: World, r: Robot): number => w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === r.id).length;
/** Holds F from `from` seconds on. */
const holdF = (robot: number, from: number) => (t: number) => (t === Math.round(from * 60) ? [{ robot, pressed: ['f'], released: [] }] : []);

describe('enemy fab drone, done when', () => {
  it('flies to its spot beside your parked cars and keeps firing what its bay builds: more than the enemy drone’s four, and they hit parked cars', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('enemy-fab-drone'), { x: -60, y: 20 }, { team: 1 });
    // A row of parked cars: when one is wrecked, it goes after the next.
    const cars = Array.from({ length: 8 }, (_, i) => w.spawnBlueprint(blueprint('car'), { x: -150 - 25 * i, y: 1.45 }));
    for (let t = 0; t < 40 * 60; t++) w.step();
    expect(of(w, d, 'released').length).toBeGreaterThanOrEqual(7);
    expect(cars.filter((c) => partsLost(w, c) > 0).length).toBeGreaterThanOrEqual(3);
    expect(ownLost(w, d)).toBe(0);
    w.dispose();
  });

  it('pops its own flares at a missile the hunter drone sends', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -130, y: 15 });
    const d = w.spawnBlueprint(blueprint('enemy-fab-drone', { minRange: 2000 }), { x: -50, y: 27 }, { team: 1 });
    for (let t = 0; t < 600; t++) w.step(t === 180 ? [{ robot: hunter.id, pressed: ['f'], released: [] }] : []);
    expect(w.events.some((e) => e.kind === 'lit' && e.robot === d.id)).toBe(true);
    w.dispose();
  });
});

describe('bomb fab drone, done when', () => {
  it('hovers level holding a drone bomb built about 8.7 s after deploy (the held bomb’s propellers are not counted as its own)', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('bomb-fab-drone'), { x: -100, y: 15 });
    for (let t = 0; t < 11 * 60; t++) w.step();
    const built = of(w, d, 'built');
    expect(built).toHaveLength(1);
    expect((built[0]?.tick ?? 0) / 60).toBeCloseTo(8.7, 1);
    expect(w.partOutput(d.id, 'fabbay@6,3', 'ready')).toBe(1);
    const s = w.physics.state(d.groups[0]?.bodyId as number);
    expect(Math.abs(s.y - 15)).toBeLessThan(1);
    expect(Math.abs(s.angle)).toBeLessThan(0.05);
    w.dispose();
  });

  it('holding F, it lets each one go as it is built, and they wreck a row of parked cars', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('bomb-fab-drone'), { x: -100, y: 15 });
    const cars = [-160, -190, -220].map((x) => w.spawnBlueprint(blueprint('car'), { x, y: 1.45 }, { team: 1 }));
    const keys = holdF(d.id, 1);
    for (let t = 0; t < 40 * 60; t++) w.step(keys(t));
    expect(of(w, d, 'released').length).toBeGreaterThanOrEqual(4); // 8.7 s each
    expect(cars.filter((c) => partsLost(w, c) > 0).length).toBeGreaterThanOrEqual(2);
    expect(ownLost(w, d)).toBe(0);
    w.dispose();
  });

  it('V still pops a pair of flares', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('bomb-fab-drone'), { x: -100, y: 15 });
    for (let t = 0; t < 60; t++) w.step(t === 30 ? [{ robot: d.id, pressed: ['v'], released: [] }] : []);
    expect(w.events.filter((e) => e.kind === 'lit')).toHaveLength(2);
    w.dispose();
  });
});

describe('enemy bomb fab drone, done when', () => {
  it('sends drone bomb after drone bomb at a row of your cars and a hovering hunter drone, and none of them comes down on it', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('enemy-bomb-fab-drone'), { x: -60, y: 20 }, { team: 1 });
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -200, y: 15 });
    const cars = Array.from({ length: 6 }, (_, i) => w.spawnBlueprint(blueprint('car'), { x: -150 - 25 * i, y: 1.45 }));
    for (let t = 0; t < 60 * 60; t++) w.step();
    expect(of(w, d, 'released').length).toBeGreaterThanOrEqual(5);
    expect(cars.filter((c) => partsLost(w, c) > 0).length).toBeGreaterThanOrEqual(2);
    expect(partsLost(w, hunter)).toBeGreaterThanOrEqual(15);
    expect(ownLost(w, d)).toBe(0);
    w.dispose();
  });

  it('deployed flipped, none of its drone bombs comes down on it either (one did, as it climbed to a new spot)', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(orientRaw(blueprint('enemy-bomb-fab-drone'), { flip: true, rot: 0 }, defaultRegistry()), { x: -60, y: 20 }, { team: 1 });
    for (const x of [-150, -175]) w.spawnBlueprint(blueprint('car'), { x, y: 1.45 });
    w.spawnBlueprint(blueprint('hunter-drone'), { x: -200, y: 15 });
    for (let t = 0; t < 40 * 60; t++) w.step();
    expect(of(w, d, 'released').length).toBeGreaterThanOrEqual(4);
    expect(ownLost(w, d)).toBe(0);
    w.dispose();
  });
});

describe('heavy drone bomb and off the line (Logan, after playing the fab drones)', () => {
  it('its four corner warheads go off together and wreck a whole parked car', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const car = w.spawnBlueprint(blueprint('car'), { x: -60, y: 1.45 });
    const bomb = w.spawnBlueprint(blueprint('heavy-drone-bomb'), { x: -20, y: 3 }, { team: 1 });
    for (let t = 0; t < 12 * 60; t++) w.step();
    expect(w.events.filter((e) => e.kind === 'explosion' && (e.robot === bomb.id || w.robots.find((r) => r.id === e.robot)?.brokeFrom === bomb.id))).toHaveLength(4);
    expect(w.robots.find((r) => r.id === car.id)?.primaryCoreId).toBeUndefined();
    expect(partsLost(w, car)).toBeGreaterThanOrEqual(5);
    w.dispose();
  });

  it('let go from a bay, it is 15 m up and steering in under 1.5 s', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('bomb-fab-drone'), { x: -100, y: 15 });
    w.spawnBlueprint(blueprint('car'), { x: -200, y: 1.45 }, { team: 1 });
    const keys = holdF(d.id, 1);
    let released = -1;
    let clear = -1;
    for (let t = 0; t < 12 * 60; t++) {
      w.step(keys(t));
      if (released < 0 && of(w, d, 'released').length > 0) released = t;
      const b = w.robots.find((r) => r.brokeFrom === d.id && r.primaryCoreId !== undefined);
      if (released >= 0 && clear < 0 && b && w.marks(b.id).some((m) => m.label === 'aim')) clear = t;
    }
    expect(released).toBeGreaterThan(0);
    expect((clear - released) / 60).toBeLessThan(1.5);
    w.dispose();
  });

  it('two enemy fab drones deployed one over the other slide apart, off each other’s line', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const a = w.spawnBlueprint(blueprint('enemy-fab-drone'), { x: -60, y: 20 }, { team: 1 });
    const b = w.spawnBlueprint(blueprint('enemy-fab-drone'), { x: -60, y: 35 }, { team: 1 });
    for (let t = 0; t < 4 * 60; t++) w.step();
    const s = w.physics.state(a.groups[0]?.bodyId as number);
    const o = w.physics.state(b.groups[0]?.bodyId as number);
    expect(Math.abs(s.x - o.x)).toBeGreaterThan(12);
    expect(ownLost(w, a) + ownLost(w, b)).toBe(0);
    w.dispose();
  });

  it('the enemy bomb fab drone lets a finished drone bomb go the moment it tracks a target, even crippled and askew (Logan)', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('enemy-bomb-fab-drone'), { x: -60, y: 20 }, { team: 1 });
    for (let t = 0; t < 12 * 60; t++) {
      // Its outer left propellers shot away at 10 s: it sags and tilts, a drone bomb held and nothing to send it at yet.
      if (t === 600) for (const [id, p] of d.parts) if (p.def.id === 'propeller' && p.tags.includes('lprop') && Number(id.split('@')[1]?.split(',')[0]) < 5) p.health = 0;
      w.step();
    }
    expect(of(w, d, 'built')).toHaveLength(1);
    expect(of(w, d, 'released')).toHaveLength(0);
    w.spawnBlueprint(blueprint('car'), { x: -160, y: 1.45 });
    for (let t = 0; t < 6; t++) w.step();
    expect(of(w, d, 'released')).toHaveLength(1);
    w.dispose();
  });
});
