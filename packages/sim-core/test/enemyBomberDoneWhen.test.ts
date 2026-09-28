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

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
/** A shipped blueprint with its script files loaded; `params` overrides the first script's params. */
const blueprint = (name: string, params?: Record<string, number>): unknown => {
  const raw = JSON.parse(bpFile(`${name}.json`));
  if (params) raw.scripts[0].params = { ...raw.scripts[0].params, ...params };
  return resolveScripts(raw, bpFile).raw;
};
const of = (w: World, r: Robot, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind && e.robot === r.id);
/** Parts a robot, or any piece that broke off it, lost (flares burning out do not count). */
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot) && e.burntOut !== true).length;
}
/** Parts the robot itself lost, not what it let go. */
const ownLost = (w: World, r: Robot): number => w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === r.id && e.burntOut !== true).length;
/** Explosions of the robot or any piece that broke off it (a piece that blew up is gone, so its family comes from the split events). */
const blasts = (w: World, r: Robot): Extract<WorldEvent, { kind: 'explosion' }>[] => {
  const family = new Set<number>([r.id]);
  for (const e of w.events) if (e.kind === 'split' && family.has(e.robot)) for (const p of e.pieces) family.add(p);
  return w.events.filter((e): e is Extract<WorldEvent, { kind: 'explosion' }> => e.kind === 'explosion' && family.has(e.robot));
};

describe('enemy bomber, done when', () => {
  it('flies runs over a row of parked cars at 60 to 80 m and wrecks them with bombs armed as they leave', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('enemy-bomber'), { x: -300, y: 30 }, { team: 1 });
    const cars = [-450, -475].map((x) => w.spawnBlueprint(blueprint('car'), { x, y: 1.45 }));
    let low = Infinity;
    let high = 0;
    let bombed = -1;
    for (let t = 0; t < 45 * 60; t++) {
      w.step();
      // Its height while it is on a run over the cars (from 30 s the first bombs are gone and it comes round).
      if (bombed < 0 && of(w, d, 'armed').length > 0) bombed = t;
      const y = w.physics.state(d.groups[0]?.bodyId as number).y;
      if (bombed >= 0 && t < bombed + 2 * 60) {
        low = Math.min(low, y);
        high = Math.max(high, y);
      }
    }
    // Two passes of three bombs each by 45 s, and every car wrecked.
    expect(of(w, d, 'armed').length).toBeGreaterThanOrEqual(6);
    expect(blasts(w, d).length).toBeGreaterThanOrEqual(5);
    expect(cars.filter((c) => c.primaryCoreId === undefined)).toHaveLength(2);
    expect(low).toBeGreaterThan(60);
    expect(high).toBeLessThan(85);
    expect(ownLost(w, d)).toBe(0);
    w.dispose();
  });

  it('a bomb is armed on the very tick its grip opens, never before', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('enemy-bomber'), { x: -300, y: 30 }, { team: 1 });
    w.spawnBlueprint(blueprint('car'), { x: -450, y: 1.45 });
    for (let t = 0; t < 30 * 60; t++) w.step();
    const armed = w.events.filter((e): e is Extract<WorldEvent, { kind: 'armed' }> => e.kind === 'armed' && e.robot === d.id);
    expect(armed.length).toBeGreaterThanOrEqual(3);
    const grips = w.events.filter((e) => e.kind === 'decoupled' && e.robot === d.id && /^decoupler@\d+,2$/.test(e.part));
    for (const a of armed) expect(grips.some((g) => g.tick === a.tick), `bomb ${a.part}`).toBe(true);
    expect(grips.length).toBe(armed.length);
    w.dispose();
  });

  it('a stick of bombs walks along a car, each landing within 8 m of it', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('enemy-bomber'), { x: -300, y: 30 }, { team: 1 });
    w.spawnBlueprint(blueprint('car'), { x: -450, y: 1.45 });
    for (let t = 0; t < 30 * 60; t++) w.step();
    const booms = blasts(w, d);
    expect(booms.length).toBeGreaterThanOrEqual(3);
    for (const b of booms.slice(0, 3)) expect(Math.abs(b.x - -450), `blast at ${b.x}`).toBeLessThan(8);
    w.dispose();
  });

  it('bombs hit a hovering hunter drone, and shot at instead, the bombs it still hangs do not go off (unarmed)', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    w.spawnBlueprint(blueprint('enemy-bomber'), { x: -250, y: 30 }, { team: 1 });
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -450, y: 25 });
    for (let t = 0; t < 40 * 60; t++) w.step();
    expect(partsLost(w, hunter)).toBeGreaterThanOrEqual(20);
    w.dispose();

    const g = await World.create({ seed: 1, scripts: host }, flat);
    const b = g.spawnBlueprint(blueprint('enemy-bomber'), { x: -250, y: 30 }, { team: 1 });
    g.spawnBlueprint(blueprint('enemy-gun-drone'), { x: -450, y: 25 });
    for (let t = 0; t < 40 * 60; t++) g.step();
    // The gun drone shoots the bomber apart: dozens of parts, its bombs among them, and not one blast (no impact fuze while unarmed).
    expect(g.events.filter((e) => e.kind === 'partDestroyed' && e.robot === b.id && e.partType === 'heavywarhead').length).toBeGreaterThanOrEqual(2);
    expect(blasts(g, b)).toHaveLength(0);
    g.dispose();
  });

  it('holds its bombs while something friendly is where they would land', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('enemy-bomber'), { x: -300, y: 30 }, { team: 1 });
    w.spawnBlueprint(blueprint('car'), { x: -450, y: 1.45 });
    const friend = w.spawnBlueprint(blueprint('car'), { x: -455, y: 1.45 }, { team: 1 });
    for (let t = 0; t < 40 * 60; t++) w.step();
    expect(of(w, d, 'armed')).toHaveLength(0);
    expect(partsLost(w, friend)).toBe(0);
    w.dispose();
  });

  it('what the bombs break off fades: a wrecked car’s loose pieces are removed once they lie still', { timeout: 90_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    w.spawnBlueprint(blueprint('enemy-bomber'), { x: -300, y: 30 }, { team: 1 });
    w.spawnBlueprint(blueprint('car'), { x: -450, y: 1.45 });
    w.spawnBlueprint(blueprint('car'), { x: -475, y: 1.45 });
    for (let t = 0; t < 60 * 60; t++) w.step();
    const pieces = w.robots.filter((r) => r.primaryCoreId === undefined && r.brokeFrom !== undefined);
    expect(w.events.filter((e) => e.kind === 'removed').length).toBeGreaterThanOrEqual(1);
    expect(pieces.length).toBeLessThan(200);
    w.dispose();
  });
});
