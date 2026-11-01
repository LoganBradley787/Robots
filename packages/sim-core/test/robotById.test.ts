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

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

/** Every robot in the list is found by its id, and no id outside the list is. */
function checkIds(w: World, maxId: number): void {
  const inList = new Set(w.robots.map((r) => r.id));
  for (const r of w.robots) expect(w.robotById(r.id)).toBe(r);
  for (let id = 0; id <= maxId; id++) if (!inList.has(id)) expect(w.robotById(id)).toBeUndefined();
}

describe('robotById (M9)', () => {
  it('follows spawns, missiles breaking off and waking, pieces blown apart, and debris cleared', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const silo = w.spawnBlueprint(blueprint('silo'), { x: -100, y: 0.5 });
    w.spawnBlueprint(orientRaw(blueprint('enemy-drone'), { flip: true }, w.registry), { x: -30, y: 25 }, { team: 1 });
    let maxId = 0;
    for (let t = 0; t < 14 * 60; t++) {
      const fire = t >= 120 && t <= 210 && t % 18 === 0;
      const release = t >= 120 && t <= 211 && t % 18 === 1;
      w.step(fire ? [{ robot: silo.id, pressed: ['f'], released: [] }] : release ? [{ robot: silo.id, pressed: [], released: ['f'] }] : []);
      for (const r of w.robots) maxId = Math.max(maxId, r.id);
      if (t % 10 === 0) checkIds(w, maxId + 5);
    }
    // Missiles left and blew things apart: many more robots were made than the two spawned.
    expect(maxId).toBeGreaterThan(8);
    w.clearDebris();
    w.step();
    checkIds(w, maxId + 5);
  });
});
