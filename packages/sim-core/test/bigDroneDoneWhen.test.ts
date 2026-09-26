import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import type { RobotInput } from '../src/control/types';
import { resolveScripts } from '../src/blueprint/scripts';
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
const core = (w: World, r: Robot): { x: number; y: number } => partWorldPose(w, r, r.primaryCoreId ?? r.rootId);

describe('big drone (four big missiles on boosters), done when', () => {
  it('W climbs, it holds its height, and four F presses send a big missile each at a car and a drone', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const drone = w.spawnBlueprint(blueprint('big-drone'), { x: -100, y: 1.55 });
    const car = w.spawnBlueprint(blueprint('car'), { x: -300, y: 1.45 }, { team: 1 });
    const target = w.spawnBlueprint(blueprint('missile-drone-10prop'), { x: -250, y: 30 }, { team: 1 });
    const press = (key: string): RobotInput[] => [{ robot: drone.id, pressed: [key], released: [] }];
    const release = (key: string): RobotInput[] => [{ robot: drone.id, pressed: [], released: [key] }];
    const fireAt = new Set([300, 390, 480, 570]);
    let heightAt5 = 0;
    for (let t = 0; t < 20 * 60; t++) {
      w.step(t === 30 ? press('w') : t === 150 ? release('w') : fireAt.has(t) ? press('f') : fireAt.has(t - 1) ? release('f') : []);
      if (t === 5 * 60) heightAt5 = core(w, drone).y;
    }
    expect(heightAt5).toBeGreaterThan(20);
    expect(Math.abs(core(w, drone).y - heightAt5)).toBeLessThan(1.5);
    expect(w.events.filter((e) => e.kind === 'decoupled' && e.robot === drone.id)).toHaveLength(8);
    expect(partsLost(w, car)).toBeGreaterThan(0);
    expect(partsLost(w, target)).toBeGreaterThan(0);
    w.dispose();
  });

  it('the enemy big drone flies itself and takes a hunter drone apart, keeping its own core', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -250, y: 15 });
    const enemy = w.spawnBlueprint(blueprint('enemy-big-drone'), { x: -100, y: 1.55 }, { team: 1 });
    for (let t = 0; t < 20 * 60; t++) w.step();
    expect(partsLost(w, hunter)).toBeGreaterThan(10);
    expect(w.canControl(enemy.id)).toBe(true);
    w.dispose();
  });
});
