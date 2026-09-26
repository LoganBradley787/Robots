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

describe('M10 enemy flying silo, done when', () => {
  it('flies to its spot beside a parked car of yours, launches at it, and hits it', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const car = w.spawnBlueprint(blueprint('car'), { x: -200, y: 1.45 });
    // In open ground, where the app lets it be placed (at x 0 it would sit in the boxes).
    const silo = w.spawnBlueprint(blueprint('enemy-flying-silo'), { x: -100, y: 1.5 }, { team: 1 });
    let highest = 0;
    for (let t = 0; t < 12 * 60; t++) {
      w.step();
      highest = Math.max(highest, w.physics.state(silo.groups[0]?.bodyId as number).y);
    }
    expect(highest).toBeGreaterThan(15); // it took off toward its spot, 20 m over the car
    expect(w.events.some((e) => e.kind === 'decoupled' && e.robot === silo.id)).toBe(true);
    expect(partsLost(w, car)).toBeGreaterThan(0);
    w.dispose();
  });

  it('fights a hunter drone and takes it apart without losing its own core', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -250, y: 15 });
    const silo = w.spawnBlueprint(blueprint('enemy-flying-silo'), { x: -100, y: 1.5 }, { team: 1 });
    for (let t = 0; t < 20 * 60; t++) w.step();
    expect(w.canControl(silo.id)).toBe(true);
    // M11: the hunter's flare racks shield its sides, so its core can outlast 20 s; a third of its parts are gone.
    expect(partsLost(w, hunter)).toBeGreaterThanOrEqual(25);
    w.dispose();
  });
});
