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
import { partWorldPose } from '../src/metrics/robotMetrics';
import { BAY_CLEAR_AFTER_S, bayClearAfterTicks } from '../src/world/bayclear';

// Batch: a fab bay clears its hollow. Debris (a piece with no core) is pushed out after a second; a piece with a live
// core is left alone.
const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const missileUp = resolveScripts(JSON.parse(bpFile('missile-up.json')), bpFile).raw;
const bayBot = {
  format: 1,
  name: 'bay-bot',
  parts: [
    { part: 'core', x: 0, y: 0 },
    { part: 'densebattery', x: -1, y: 0 },
    { part: 'densebattery', x: 1, y: 0 },
    { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' },
  ],
  recipes: { item: missileUp },
};
const events = (w: World, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind);
/** A robot parked at (-100, 0.5): its core cell is at that spot, the bay above it, the hollow 2 to 6 cells above. */
const AT = { x: -100, y: 0.5 };
const inHollow = { x: -100, y: 4.5 };
const frame = { format: 1, name: 'lump', parts: [{ part: 'frame', x: 0, y: 0 }] };
const liveCore = { format: 1, name: 'seed', parts: [{ part: 'core', x: 0, y: 0 }] };
const y = (w: World, r: Robot): number => partWorldPose(w, r, r.rootId).y;

describe('fab bays clear their hollow (Batch)', () => {
  it('waits one second before pushing', () => {
    expect(BAY_CLEAR_AFTER_S).toBe(1);
    expect(bayClearAfterTicks(1 / 60)).toBe(60);
  });

  it('a frame dropped into the hollow is pushed out, and the bay then builds', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    w.spawnBlueprint(bayBot, AT);
    const junk = w.spawnBlueprint(frame, inHollow);
    expect(w.canControl(junk.id)).toBe(false);
    let blockedAt = -1;
    let builtAt = -1;
    for (let t = 0; t < 900 && builtAt < 0; t++) {
      w.step();
      if (blockedAt < 0 && events(w, 'buildBlocked').length > 0) blockedAt = t;
      if (builtAt < 0 && events(w, 'built').length > 0) builtAt = t;
    }
    expect(blockedAt).toBeGreaterThan(0);
    expect(builtAt).toBeGreaterThan(blockedAt + 55);
    // The lump left the hollow, upward.
    expect(y(w, junk)).toBeGreaterThan(7.2);
    w.dispose();
  });

  it('a piece with a live core is left alone, and the bay stays blocked', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    w.spawnBlueprint(bayBot, AT);
    const seed = w.spawnBlueprint(liveCore, inHollow);
    expect(w.canControl(seed.id)).toBe(true);
    for (let t = 0; t < 900; t++) w.step();
    expect(events(w, 'buildBlocked')).toHaveLength(1);
    expect(events(w, 'built')).toHaveLength(0);
    expect(y(w, seed)).toBeLessThan(7);
    w.dispose();
  });

  it('the wait shapes the hash only while a bay is waiting on loose pieces', async () => {
    const a = await World.create({ seed: 1, scripts: host }, flat);
    const b = await World.create({ seed: 1, scripts: host }, flat);
    a.spawnBlueprint(bayBot, AT);
    b.spawnBlueprint(bayBot, AT);
    b.spawnBlueprint(frame, inHollow);
    for (let t = 0; t < 30; t++) a.step();
    for (let t = 0; t < 30; t++) b.step();
    expect(a.hash()).not.toBe(b.hash());
    a.dispose();
    b.dispose();
  });
});
