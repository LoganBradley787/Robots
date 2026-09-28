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

// Batch: the enemy factory, a ground base with three fabricator bays (two making missile-up, one making heavy drone
// bombs), armor plates all round, solar panels on the roof, a radar; it lets each copy go at a tracked enemy as soon
// as it is built. The base sits at x -300 with its core at cell (17, 1), so a bay's hollow is 5 cells from the core
// column for the left missile bay (world x -312), 1 left for the bomb bay (-301 to -297) and 11 right for the other
// missile bay (-288).

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
/** A shipped blueprint with its script files loaded. */
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;
/** The factory with every solar panel swapped for a frame (same cells, no power). */
const noSolar = (): unknown => {
  const raw = JSON.parse(bpFile('enemy-factory.json')) as { grid: string[] };
  raw.grid = raw.grid.map((row) => row.split(' ').map((t) => (t === 'So' ? 'F' : t)).join(' '));
  return resolveScripts(raw, bpFile).raw;
};
const of = (w: World, r: Robot, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind && e.robot === r.id);
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot)).length;
}
const lostOfType = (w: World, r: Robot, type: string): number => w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === r.id && e.partType === type).length;
const coreLost = (w: World, r: Robot): boolean => w.events.some((e) => e.kind === 'coreLost' && e.robot === r.id);
const FACTORY_AT = { x: -300, y: 1.55 };
const deploy = (w: World, bp: unknown = blueprint('enemy-factory')): Robot => w.spawnBlueprint(bp, FACTORY_AT, { team: 1 });
const angle = (w: World, r: Robot): number => w.physics.state(r.groups[0]?.bodyId as number).angle;
const car = (): unknown => blueprint('car');
const row = (w: World, xs: number[]): Robot[] => xs.map((x) => w.spawnBlueprint(car(), { x, y: 1.45 }));

describe('enemy factory, done when', () => {
  it('validates, sits on the ground where it is put, and never moves', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const f = deploy(w);
    let tilt = 0;
    for (let t = 0; t < 10 * 60; t++) {
      w.step();
      tilt = Math.max(tilt, Math.abs(angle(w, f)));
    }
    const s = w.physics.state(f.groups[0]?.bodyId as number);
    expect(Math.abs(s.x - FACTORY_AT.x)).toBeLessThan(0.05);
    expect(s.y).toBeGreaterThan(1.4);
    expect(s.y).toBeLessThan(1.6);
    expect(tilt).toBeLessThan(0.001);
    expect(f.groups).toHaveLength(1); // one body, no wheels
    w.dispose();
  });

  it('builds a missile in each missile bay (4.1 s) and a drone bomb (8.7 s), and lets each go at the nearest car as soon as it is done', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const f = deploy(w);
    row(w, [-450, -480, -520]);
    for (let t = 0; t < 12 * 60; t++) w.step();
    const built = of(w, f, 'built') as Extract<WorldEvent, { kind: 'built' }>[];
    const at = (scope: string): number => (built.find((e) => e.scope === scope)?.tick ?? 0) / 60;
    expect(at('msl-a1')).toBeCloseTo(4.1, 1);
    expect(at('msl-b1')).toBeCloseTo(4.1, 1);
    expect(at('bmb-a1')).toBeCloseTo(8.7, 1);
    const released = of(w, f, 'released') as Extract<WorldEvent, { kind: 'released' }>[];
    // Each one goes within a second of being built (the two missile bays are half a second apart).
    for (const scope of ['msl-a1', 'msl-b1', 'bmb-a1']) {
      const r = released.find((e) => e.scope === scope);
      expect(r, scope).toBeDefined();
      expect((r?.tick ?? 0) / 60 - at(scope)).toBeLessThan(1);
    }
    w.dispose();
  });

  it('wrecks a row of parked cars with missiles and drone bombs, and the base takes nothing', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const f = deploy(w);
    const near = row(w, [-420, -445, -470]); // inside a drone bomb's range (450 m)
    const far = row(w, [-700, -730, -760]); // 400 to 460 m: the edge of a drone bomb's range, missiles beyond
    for (let t = 0; t < 45 * 60; t++) w.step();
    expect(of(w, f, 'released').length).toBeGreaterThanOrEqual(8);
    expect(near.filter((c) => partsLost(w, c) > 0).length).toBe(3);
    expect(far.filter((c) => partsLost(w, c) > 0).length).toBeGreaterThanOrEqual(2);
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === f.id)).toHaveLength(0);
    w.dispose();
  });

  it('holds fire on a car beyond its missiles’ range and lets every bay sit ready', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const f = deploy(w);
    row(w, [-300 - 900]); // 900 m: the radar sees to 1000, the missile bays to 800
    for (let t = 0; t < 15 * 60; t++) w.step();
    expect(of(w, f, 'released')).toHaveLength(0);
    expect(w.partOutput(f.id, 'fabbay@5,3', 'ready')).toBe(1);
    expect(w.partOutput(f.id, 'fabbay@15,3', 'ready')).toBe(1);
    w.dispose();
  });

  it('beats an enemy gun drone: its armor plates hold, it never tips, and the drone loses its core', { timeout: 90_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const f = deploy(w);
    const d = w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: -200, y: 20 });
    let tilt = 0;
    for (let t = 0; t < 60 * 60; t++) {
      w.step();
      tilt = Math.max(tilt, Math.abs(angle(w, f)));
    }
    expect(coreLost(w, d)).toBe(true);
    expect(coreLost(w, f)).toBe(false);
    expect(tilt).toBeLessThan(0.01); // radians
    // The guns shot what they could reach (roof panels are 8 health), and 500 shells make an armor plate no dent.
    expect(lostOfType(w, f, 'armorplate')).toBe(0);
    expect(lostOfType(w, f, 'solar')).toBeGreaterThan(0);
    // The fight's wreckage fades.
    expect(w.events.filter((e) => e.kind === 'removed').length).toBeGreaterThanOrEqual(5);
    w.dispose();
  });

  it('beats an enemy fab drone and a hovering hunter drone', { timeout: 90_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const f = deploy(w);
    const fab = w.spawnBlueprint(blueprint('enemy-fab-drone'), { x: -60, y: 25 });
    for (let t = 0; t < 60 * 60; t++) w.step();
    expect(coreLost(w, fab)).toBe(true);
    expect(coreLost(w, f)).toBe(false);
    expect(Math.abs(angle(w, f))).toBeLessThan(0.01);
    w.dispose();

    const w2 = await World.create({ seed: 1, scripts: host }, flat);
    const f2 = deploy(w2);
    const hunter = w2.spawnBlueprint(blueprint('hunter-drone'), { x: -180, y: 15 });
    // Its four missiles, one every 4 s.
    for (let t = 0; t < 60 * 60; t++) w2.step(t % 240 === 60 ? [{ robot: hunter.id, pressed: ['f'], released: [] }] : []);
    expect(coreLost(w2, hunter)).toBe(true);
    expect(coreLost(w2, f2)).toBe(false);
    w2.dispose();
  });

  it('solar panels on the roof refill what the bays spend: a full pool with them, spent without', { timeout: 60_000 }, async () => {
    const run = async (bp: unknown): Promise<{ stored: number; capacity: number }> => {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const f = deploy(w, bp);
      for (let t = 0; t < 40 * 60; t++) w.step(); // nothing to shoot at: three copies built (3174 J), then it idles
      const e = w.energy(f.id) as { stored: number; capacity: number };
      w.dispose();
      return e;
    };
    const sun = await run(blueprint('enemy-factory'));
    const dark = await run(noSolar());
    expect(sun.capacity).toBeGreaterThan(dark.capacity - 1); // same batteries
    expect(sun.stored).toBeGreaterThan(sun.capacity - 200);
    expect(dark.stored).toBeLessThan(dark.capacity - 3000);
  });

  it('a piece that lands in a bay’s hollow is pushed out after a second and the bay carries on', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const f = deploy(w);
    row(w, [-450]);
    const junk = { format: 1, name: 'junk', grid: ['F'] };
    // Into the left missile bay's hollow just before its first copy is done (4.1 s).
    for (let t = 0; t < 9 * 60; t++) {
      if (t === Math.round(3.5 * 60)) w.spawnBlueprint(junk, { x: -312, y: 7.5 });
      w.step();
    }
    expect(of(w, f, 'buildBlocked').some((e) => e.kind === 'buildBlocked' && e.part === 'fabbay@5,3')).toBe(true);
    const built = (of(w, f, 'built') as Extract<WorldEvent, { kind: 'built' }>[]).find((e) => e.scope === 'msl-a1');
    expect(built).toBeDefined();
    expect((built?.tick ?? 0) / 60).toBeGreaterThan(4.6); // it waited about a second
    expect((of(w, f, 'released') as Extract<WorldEvent, { kind: 'released' }>[]).some((e) => e.scope === 'msl-a1')).toBe(true);
    w.dispose();
  });
});
