import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { resolveScripts } from '../src/blueprint/scripts';
import { parseWorldFile } from '../src/world/WorldFile';
import { World, type WorldEvent } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { partWorldPose } from '../src/metrics/robotMetrics';

/**
 * The repair drone's ladder, each rung set up by hand with no enemy in sight: parts are taken off it (health 0, so they
 * go as if shot) and the pilot, which makes every decision, is left to get on with it.
 */
const flat = parseWorldFile(flatJson);
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const raw = resolveScripts(JSON.parse(bpFile('repair-drone.json')), bpFile).raw as Record<string, unknown>;
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

async function flying(): Promise<{ w: World; r: Robot }> {
  const w = await World.create({ seed: 1, scripts: host }, flat);
  const r = w.spawnBlueprint(raw, { x: -150, y: 40 });
  for (let i = 0; i < 180; i++) w.step();
  return { w, r };
}
const shoot = (r: Robot, match: (id: string, type: string) => boolean): void => {
  for (const p of r.parts.values()) if (match(p.id, p.def.id)) p.health = 0;
};
const steps = (w: World, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) w.step();
};
const kinds = (w: World, kind: WorldEvent['kind'], type?: string): WorldEvent[] => w.events.filter((e) => e.kind === kind && (type === undefined || (e as { part?: string }).part?.startsWith(type) === true));
const count = (r: Robot, type: string): number => [...r.parts.values()].filter((p) => p.def.id === type).length;
const hover = (w: World, r: Robot): { y: number; tilt: number } => {
  const core = partWorldPose(w, r, r.primaryCoreId ?? '');
  return { y: core.y, tilt: Math.abs(core.angle) };
};

describe('repair drone: the ladder', () => {
  it('rung 1: gives up armor to rebuild propellers and the laser', async () => {
    const { w, r } = await flying();
    shoot(r, (id, type) => type === 'laser' || id.startsWith('propeller@1,') || id.startsWith('propeller@2,') || id.startsWith('propeller@10,') || id.startsWith('propeller@11,'));
    steps(w, 2);
    expect(count(r, 'laser')).toBe(0);
    steps(w, 30);
    expect(kinds(w, 'partScrapped', 'armorplate').length).toBeGreaterThan(0);
    expect(count(r, 'laser')).toBe(1);
    expect(count(r, 'propeller')).toBe(18);
    expect(hover(w, r).y).toBeGreaterThan(20);
    w.dispose();
  });

  it('what it sells it spends on what it sold it for: it does not sell itself out of the air to heal the laser', async () => {
    const { w, r } = await flying();
    shoot(r, (id, type) => type === 'armorplate' || id === 'propeller@1,2' || id === 'propeller@2,2' || id === 'propeller@3,2');
    (r.parts.get('laser@6,5') as { health: number }).health = 8;
    steps(w, 40);
    expect(count(r, 'propeller')).toBeGreaterThanOrEqual(15);
    expect(hover(w, r).y).toBeGreaterThan(20);
    w.dispose();
  });

  it('gives plates up from both ends in turn, so what it sells does not flip it over', async () => {
    const { w, r } = await flying();
    shoot(r, (_, type) => type === 'laser' || type === 'rotator');
    steps(w, 30);
    const ends = kinds(w, 'partScrapped', 'armorplate').map((e) => (e as unknown as { part: string }).part.startsWith('armorplate@0,'));
    expect(ends.length).toBeGreaterThanOrEqual(2);
    expect(ends[0]).not.toBe(ends[1]);
    expect(Math.abs(hover(w, r).tilt)).toBeLessThan(25);
    expect(hover(w, r).y).toBeGreaterThan(20);
    w.dispose();
  });

  it('rung 2: when it cannot afford the laser it spends on propellers to stay in the air', async () => {
    const { w, r } = await flying();
    r.repair = { tank: 3, jobs: [] };
    shoot(r, (id, type) => type === 'laser' || type === 'armorplate' || id.startsWith('propeller@1,') || id.startsWith('propeller@2,') || id.startsWith('propeller@3,') || id.startsWith('propeller@9,') || id.startsWith('propeller@10,') || id.startsWith('propeller@11,'));
    steps(w, 1);
    const had = count(r, 'propeller');
    steps(w, 8);
    // 3 in the tank buys six propellers at half price, and the laser (10) stays gone.
    expect(count(r, 'propeller')).toBeGreaterThan(had);
    expect(count(r, 'laser')).toBe(0);
    expect(kinds(w, 'partRebuilt', 'laser')).toEqual([]);
    expect(kinds(w, 'partRebuilt', 'rotator')).toEqual([]);
    expect(hover(w, r).y).toBeGreaterThan(20);
    w.dispose();
  });

  it('rung 3: lost propellers on the left are rebuilt with propellers from the right, and it stays level', async () => {
    const { w, r } = await flying();
    shoot(r, (id, type) => type === 'armorplate' || (type === 'propeller' && r.parts.get(id)?.tags.includes('lprop') === true));
    steps(w, 21);
    const left = [...r.parts.values()].filter((p) => p.tags.includes('lprop')).length;
    const right = [...r.parts.values()].filter((p) => p.tags.includes('rprop')).length;
    expect(kinds(w, 'partScrapped', 'propeller').length).toBeGreaterThan(1);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    expect(hover(w, r).tilt).toBeLessThan(0.2);
    expect(hover(w, r).y).toBeGreaterThan(20);
    w.dispose();
  });

  it('rung 4: nothing left to trade, it lands and spends on armor', async () => {
    const { w, r } = await flying();
    const keep = ['propeller@4,2', 'propeller@8,2', 'propeller@4,0', 'propeller@8,0'];
    shoot(r, (id, type) => type === 'armorplate' || (type === 'propeller' && !keep.includes(id)) || id === 'frame@10,1');
    steps(w, 30);
    expect(w.logsOf(r.id).some((l) => l.text.startsWith('on the ground'))).toBe(true);
    expect(hover(w, r).y).toBeLessThan(5);
    expect(r.primaryCoreId).toBeDefined();
    expect(count(r, 'propeller')).toBeLessThan(4);
    expect(kinds(w, 'partRebuilt', 'frame').length).toBeGreaterThan(0);
    w.dispose();
  });
});
