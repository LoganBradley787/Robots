import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { resolveScripts } from '../src/blueprint/scripts';
import { orientRaw } from '../src/blueprint/orient';
import { defaultRegistry } from '../src/parts/registry';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

describe('tech fab drone, done when', () => {
  it('its tech missiles fly to a hovering hunter drone, blast it with their nose guns on the way in, and set off their distance charges beside it', { timeout: 90_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -100, y: 40 });
    const d = w.spawnBlueprint(orientRaw(blueprint('enemy-tech-fab-drone'), { flip: true, rot: 0 }, defaultRegistry()), { x: 300, y: 40 }, { team: 1 });
    // Its missiles are gone by the end (blown up): note what broke off it while they fly (its flares too, harmless here).
    const missiles = new Set<number>();
    for (let t = 0; t < 25 * 60; t++) {
      w.step();
      for (const r of w.robots) if (r.brokeFrom === d.id) missiles.add(r.id);
    }
    expect(w.events.filter((e) => e.kind === 'released' && e.robot === d.id).length).toBeGreaterThanOrEqual(3);
    // Nose guns hit the hunter.
    const gunHits = w.events.filter((e) => e.kind === 'shellHit' && missiles.has(e.by) && e.robot === hunter.id).length;
    expect(gunHits).toBeGreaterThanOrEqual(5);
    // Charges armed and went off near it.
    expect(w.events.filter((e) => e.kind === 'armed' && missiles.has(e.robot)).length).toBeGreaterThanOrEqual(3);
    const hs = w.physics.state(hunter.groups[0]?.bodyId as number);
    const near = w.events.filter((e) => e.kind === 'explosion' && Math.hypot(e.x - hs.x, e.y - hs.y) < 30).length;
    expect(near).toBeGreaterThanOrEqual(2);
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === hunter.id).length).toBeGreaterThanOrEqual(8);
    // Nothing of its own lost to its own missiles.
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === d.id).length).toBe(0);
    w.dispose();
  });
});
