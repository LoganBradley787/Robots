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
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;
const of = (w: World, r: Robot, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind && e.robot === r.id);
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot)).length;
}
/** Holds F from `from` seconds on. */
const holdF = (robot: number, from: number) => (t: number) => (t === Math.round(from * 60) ? [{ robot, pressed: ['f'], released: [] }] : []);

describe('M12 fab drone, done when', () => {
  it('hovers and has a missile built about 4 s after deploy', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('fab-drone'), { x: -100, y: 15 });
    for (let t = 0; t < 300; t++) w.step();
    const built = of(w, d, 'built');
    expect(built).toHaveLength(1);
    expect((built[0]?.tick ?? 0) / 60).toBeCloseTo(4.08, 1);
    expect(w.partOutput(d.id, 'fabbay@7,3', 'ready')).toBe(1);
    const s = w.physics.state(d.groups[0]?.bodyId as number);
    expect(Math.abs(s.y - 15)).toBeLessThan(1);
    w.dispose();
  });

  it('F sends it at a parked car 100 m away, and it hits', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('fab-drone'), { x: -100, y: 15 });
    const car = w.spawnBlueprint(blueprint('car'), { x: -200, y: 1.45 }, { team: 1 });
    const keys = holdF(d.id, 1);
    for (let t = 0; t < 600; t++) w.step(keys(t));
    expect(of(w, d, 'released').length).toBeGreaterThan(0);
    expect(partsLost(w, car)).toBeGreaterThan(0);
    w.dispose();
  });

  it('holding F, it fires one about every 4 s for as long as there is energy: far more than the hunter drone’s four', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('fab-drone'), { x: -100, y: 15 });
    // A row of parked cars: when one is wrecked, it goes after the next.
    for (let i = 0; i < 12; i++) w.spawnBlueprint(blueprint('car'), { x: -200 - 25 * i, y: 1.45 }, { team: 1 });
    const keys = holdF(d.id, 1);
    for (let t = 0; t < 60 * 60; t++) w.step(keys(t));
    const released = of(w, d, 'released');
    expect(released.length).toBeGreaterThanOrEqual(12);
    // About 4.1 s apart.
    const gaps = released.slice(1).map((e, i) => (e.tick - (released[i]?.tick ?? 0)) / 60);
    expect(Math.min(...gaps)).toBeGreaterThan(4);
    w.dispose();
  });

  it('V still pops a pair of flares', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('fab-drone'), { x: -100, y: 15 });
    for (let t = 0; t < 60; t++) w.step(t === 30 ? [{ robot: d.id, pressed: ['v'], released: [] }] : []);
    expect(w.events.filter((e) => e.kind === 'lit')).toHaveLength(2);
    w.dispose();
  });

  it('with its bay destroyed it builds nothing more, and flies on', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('fab-drone'), { x: -100, y: 15 });
    for (let t = 0; t < 120; t++) w.step();
    const bay = d.parts.get('fabbay@7,3');
    if (bay) bay.health = 0;
    for (let t = 0; t < 600; t++) w.step();
    expect(of(w, d, 'built')).toHaveLength(0);
    expect(w.canControl(d.id)).toBe(true);
    const s = w.physics.state(d.groups[0]?.bodyId as number);
    expect(Math.abs(s.y - 15)).toBeLessThan(2);
    w.dispose();
  });
});

describe('M12 fab drone, review fixes', () => {
  it('its hover keeps its throttles on the tick a missile is finished', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('fab-drone'), { x: -100, y: 15 });
    const throttles: number[] = [];
    for (let t = 0; t < 300; t++) {
      w.step();
      if (w.events.some((e) => e.kind === 'built' && e.tick === w.tick - 1)) throttles.push(w.channelValue(d.id, 'propeller@3,0', 'throttle') ?? 0);
    }
    expect(throttles).toHaveLength(1);
    expect(throttles[0]).toBeGreaterThan(0.2);
    w.dispose();
  });
});
