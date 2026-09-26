import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { resolveScripts } from '../src/blueprint/scripts';
import { orientRaw } from '../src/blueprint/orient';
import { partWorldPose } from '../src/metrics/robotMetrics';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot)).length;
}
const coreX = (w: World, r: Robot): number => partWorldPose(w, r, r.primaryCoreId ?? r.rootId).x;

describe('M10 enemy launcher truck, done when', () => {
  it('drives toward a parked car of yours, stops about 150 m from it, and hits it; the same deployed flipped', { timeout: 60_000 }, async () => {
    for (const [flip, truckX, carX] of [[false, -100, -350], [true, -400, -150]] as const) {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const car = w.spawnBlueprint(blueprint('car'), { x: carX, y: 1.45 });
      const truck = w.spawnBlueprint(orientRaw(blueprint('enemy-truck'), { flip }, w.registry), { x: truckX, y: 1.45 }, { team: 1 });
      let firstShot: number | undefined;
      for (let t = 0; t < 30 * 60; t++) {
        w.step();
        if (firstShot === undefined && w.events.some((e) => e.kind === 'decoupled' && e.robot === truck.id)) firstShot = coreX(w, truck);
      }
      expect(Math.abs(Math.abs((firstShot ?? 0) - carX) - 150)).toBeLessThan(10);
      expect(partsLost(w, car)).toBeGreaterThan(0);
      w.dispose();
    }
  });

  it('backs off from a robot closer than 40 m', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    w.spawnBlueprint(blueprint('car'), { x: -120, y: 1.45 });
    const truck = w.spawnBlueprint(blueprint('enemy-truck'), { x: -100, y: 1.45 }, { team: 1 });
    for (let t = 0; t < 5 * 60; t++) w.step();
    expect(coreX(w, truck)).toBeGreaterThan(-100 + 10);
    w.dispose();
  });
});
