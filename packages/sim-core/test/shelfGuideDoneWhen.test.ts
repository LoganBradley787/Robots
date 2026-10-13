import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { coreState, give, raw, shipped } from './shelfHelp';

/**
 * The shelf behavior Guide (`behaviors/guide.js`) on missiles it was never tuned for, given the way the builder gives
 * it (`attachBehavior`, the slots filled with their guess), each with its own guide script taken off first.
 */
const flat = parseWorldFile(flatJson);
const BLOCK = { format: 1, name: 'target', grid: ['F F F', 'F F F', 'F C F', 'F F F'] };
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** Flies `name` from 60 m up toward a block of frames 120 m off; the nearest its core came to the block's middle. */
async function fly(name: string, stock = false): Promise<{ nearest: number; crashes: string[]; fit: unknown }> {
  const g = stock ? { blueprint: shipped(name), fit: { slots: [] } } : give(shipped(name, ['guide']), 'guide');
  const w = await World.create({ seed: 1, scripts: host }, flat);
  const r = w.spawnBlueprint(raw(g.blueprint), { x: -200, y: 60 });
  w.spawnBlueprint(BLOCK, { x: -80, y: 1.5 }, { team: 1 });
  let nearest = Infinity;
  for (let t = 0; t < 15 * 60; t++) {
    w.step([]);
    const live = w.robots.find((x) => x.id === r.id);
    if (!live || live.parts.size === 0) break;
    const s = coreState(w, live);
    nearest = Math.min(nearest, Math.hypot(s.x - -79, s.y - 2.5));
  }
  const crashes = w.events.filter((e) => e.kind === 'scriptCrashed').map((e) => JSON.stringify(e));
  w.dispose();
  return { nearest, crashes, fit: g.fit.slots.map((s) => [s.slot.group, s.guess]) };
}

describe('shelf Guide: closes on a target on missiles it was never tuned for', () => {
  // Measured when this was written (flat world, seed 1): the seeker missile comes within 4.3 m of the block's middle
  // (it goes off at its side) with either script; the two small missiles fall short of a target this far off with
  // their own guide (55.4 m and 57.6 m) and get a little nearer with the shelf one (51.7 m).
  for (const name of ['missile', 'missile-v2', 'missile-seeker']) {
    it(`${name} gets as near as with its own guide, and the script never stops`, { timeout: 120_000 }, async () => {
      const own = await fly(name, true);
      const f = await fly(name);
      expect(f.crashes).toEqual([]);
      expect(f.nearest).toBeLessThan(own.nearest + 1);
    });
  }

  it('the seeker missile reaches the block', { timeout: 120_000 }, async () => {
    const f = await fly('missile-seeker');
    expect(f.nearest).toBeLessThan(5);
    expect(f.fit).toEqual([
      ['push', ['booster@0,0']],
      ['steer', ['heavygyro@1,0']],
      ['blast', ['heavywarhead@4,0']],
    ]);
  });
});
