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
import { BAY_CLEAR_AFTER_S, bayClearAfterTicks, copyLeaveTicks } from '../src/world/bayclear';
import { defaultRegistry, PartRegistry } from '../src/parts/registry';

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

// A copy the bay let go that never got out (wedged, out of energy, its script gave up) blocked the bay for good: two
// silos each jammed a copy and never built again. The bay's def gives it `clearAfter` seconds to leave.
const registry = defaultRegistry();
/** The parts as they were before `clearAfter`: the bay's def without the field. */
const oldRegistry = new PartRegistry(
  registry.list().map((d) => {
    if (!d.fabricate) return d;
    const { clearAfter: _, ...fabricate } = d.fabricate;
    return { ...d, fabricate };
  }),
);
/** `bayBot` making `recipe`; R lets go of what the bay holds. */
const firing = (recipe: unknown): Record<string, unknown> => ({ ...bayBot, recipes: { item: recipe }, bindings: [{ key: 'r', mode: 'pulse', target: 'bay', channel: 'release', value: 1 }] });
/** A core and two armor plates, no motor: 4.5 s to build, and let go it sits in the hollow with its core awake. */
const sitter = { format: 1, name: 'sitter', parts: [{ part: 'core', x: 0, y: 0 }, { part: 'armorplate', x: 0, y: 1 }, { part: 'armorplate', x: 0, y: 2 }] };
const CLEAR_TICKS = copyLeaveTicks(registry.get('fabbay').fabricate?.clearAfter ?? 0, 1 / 60);
/** Steps until the bay has built its first copy, lets it go, and returns the copy (its own robot now). */
function letGo(w: World, host: Robot): Robot {
  for (let t = 0; t < 600 && events(w, 'built').length === 0; t++) w.step();
  expect(events(w, 'built')).toHaveLength(1);
  w.step([{ robot: host.id, pressed: ['r'], released: [] }]);
  w.step([{ robot: host.id, pressed: [], released: ['r'] }]);
  const woke = events(w, 'coreWoke');
  expect(woke).toHaveLength(1);
  const copy = w.robots.find((r) => r.id === woke[0]?.robot);
  if (!copy) throw new Error('the copy did not wake');
  return copy;
}

describe('a copy that never leaves its bay is cleared (def `clearAfter`)', () => {
  it('the shipped bay gives a copy 10 s', () => {
    expect(registry.get('fabbay').fabricate?.clearAfter).toBe(10);
    expect(CLEAR_TICKS).toBe(600);
    expect(oldRegistry.get('fabbay').fabricate).toEqual({ joulesPerKg: 40, secondsPerKg: 0.6, separation: 4 });
  });

  it('a copy that cannot leave is given up on after 10 s and pushed out whole, and the bay builds again', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(firing(sitter), AT);
    const copy = letGo(w, r);
    const released = events(w, 'released')[0]?.tick ?? -1;
    expect(w.canControl(copy.id)).toBe(true);
    let top = 0;
    for (let t = 0; t < 1200 && events(w, 'built').length < 2; t++) {
      w.step();
      // Before the bay gives up on it, it is left alone: it sits where it was built.
      if (events(w, 'copyStuck').length === 0) expect(y(w, copy)).toBeLessThan(3);
      top = Math.max(top, y(w, copy));
    }
    expect(events(w, 'copyStuck')).toMatchObject([{ robot: r.id, part: 'fabbay@0,1', scope: 'bay1', tick: released + CLEAR_TICKS }]);
    // Pushed as a piece with no core is: a second in the way, then up and out of the U, and the next copy is built.
    const built = events(w, 'built');
    expect(built).toHaveLength(2);
    expect(built[1]).toMatchObject({ scope: 'bay2' });
    expect(built[1]?.tick ?? 0).toBeGreaterThan(released + CLEAR_TICKS + 55);
    expect(built[1]?.tick ?? 0).toBeLessThan(released + CLEAR_TICKS + 180);
    expect(top).toBeGreaterThan(7.2);
    // Pushed, not broken: no part is lost and its core is still in charge.
    expect(events(w, 'partDestroyed')).toHaveLength(0);
    expect(copy.parts.size).toBe(3);
    expect(w.canControl(copy.id)).toBe(true);
    // Falling back into the hollow after the next copy is let go, it is pushed out again: the bay keeps building.
    w.step([{ robot: r.id, pressed: ['r'], released: [] }]);
    w.step([{ robot: r.id, pressed: [], released: ['r'] }]);
    for (let t = 0; t < 2400 && events(w, 'built').length < 3; t++) w.step();
    expect(events(w, 'built')).toHaveLength(3);
    w.dispose();
  });

  it('a copy that leaves in time is untouched: the world is the same as with the old def', async () => {
    const a = await World.create({ seed: 1, scripts: host }, flat, registry);
    const b = await World.create({ seed: 1, scripts: host }, flat, oldRegistry);
    const copies = [a, b].map((w) => letGo(w, w.spawnBlueprint(firing(missileUp), AT)));
    // While the copy is on its way out the bay watches it, which is state; once it is out, nothing is left of that.
    expect(a.hash()).not.toBe(b.hash());
    for (let t = 0; t < 900; t++) {
      a.step();
      b.step();
    }
    expect(events(a, 'copyStuck')).toHaveLength(0);
    expect(events(a, 'built').length).toBeGreaterThan(1);
    expect(copies.map((c, i) => [a, b][i]?.canControl(c.id))).toEqual([true, true]);
    expect(a.hash()).toBe(b.hash());
    a.dispose();
    b.dispose();
  });

  it('a copy that left and falls back into the hollow is left alone', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(firing(sitter), AT);
    const copy = letGo(w, r);
    // It has no motor: throw it up out of the hollow (11.5 m/s lifts it 6.7 m and lands under the 12 m/s parts shrug off).
    w.physics.kick(copy.groups[0]?.bodyId ?? 0, 0, 11.5, 0);
    let top = 0;
    for (let t = 0; t < 200; t++) {
      w.step();
      top = Math.max(top, y(w, copy));
    }
    // Its lowest cell cleared the hollow's top (y 7), and it is back inside before the next build is done (4.5 s).
    expect(top).toBeGreaterThan(7.6);
    expect(y(w, copy)).toBeLessThan(3);
    expect(events(w, 'built')).toHaveLength(1);
    for (let t = 0; t < CLEAR_TICKS + 600; t++) w.step();
    expect(events(w, 'copyStuck')).toHaveLength(0);
    expect(events(w, 'buildBlocked')).toHaveLength(1);
    expect(events(w, 'built')).toHaveLength(1);
    expect(y(w, copy)).toBeLessThan(3);
    expect(w.canControl(copy.id)).toBe(true);
    w.dispose();
  });

  it('with an old def (no clearAfter) a copy that never leaves blocks the bay, as before', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat, oldRegistry);
    const r = w.spawnBlueprint(firing(sitter), AT);
    const copy = letGo(w, r);
    for (let t = 0; t < CLEAR_TICKS + 900; t++) w.step();
    expect(events(w, 'copyStuck')).toHaveLength(0);
    expect(events(w, 'buildBlocked')).toHaveLength(1);
    expect(events(w, 'built')).toHaveLength(1);
    expect(y(w, copy)).toBeLessThan(3);
    w.dispose();
  });
});
