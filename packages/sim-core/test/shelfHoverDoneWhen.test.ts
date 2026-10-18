import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import flatJson from '../../../worlds/flat.json';
import { copyParts, removeParts } from '../src/blueprint/edit';
import type { Blueprint } from '../src/blueprint/types';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { built, coreState, give, raw, registry, shipped } from './shelfHelp';

/**
 * The shelf behavior Hover (`behaviors/hover.js`) on robots it was never tuned for. Every robot gets it the way the
 * builder gives it (`attachBehavior`, the slots filled with their guess), with every param at its default.
 *
 * Tolerance, the same for every robot here: deployed at 3 m it climbs its `height` (5 m) and from 5 s to 15 s stays
 * within 0.15 m of 8 m and within 2 degrees of level, with no script crash and nothing said in the log.
 * Measured when this was written (flat world, seed 1), height at 2 s, 3 s, then from 4 s on, and the most tilt:
 * - the stock drone, 4 propellers and a gyro:        8.02, 8.00, 8.00, 0.0 degrees
 * - a heavy one, 6 propellers and 2 armor plates:    7.31, 8.06, 8.00, 0.0 degrees
 * - 2 thrusters and a gyro:                          8.04, 8.00, 8.00, 0.0 degrees
 * - 2 swiveling thrusters, no gyro:                  8.02, 8.00, 8.00, 0.0 degrees
 * - 3 propellers off center, no gyro:                8.08, 7.99, 8.00, 0.0 degrees
 * - the drone with one propeller gone (3 left):      8.12, 7.99, 8.00, 0.1 degrees
 * - the drone with one propeller more (5):           8.03, 8.00, 8.00, 0.0 degrees
 *
 * Lifters that push sideways (2 thrusters up, one pointing each way, a gyro), D held from 5 s to 8 s, against the
 * same robot with the sideways ones left out of the group: 59.6 m/s at 8 s against 25.0, and under 0.1 m/s 3.9 s
 * after the key is let go against 12 s. Height within 0.26 m against 0.14 m, most tilt 54 degrees against 47.
 *
 * Slow turners with weight in big parts (review 2026-10-18), deployed at 12 m, a key held from 5 s to 8 s:
 * - the many-gun drone (its pilot taken off), D: most tilt 45.1 degrees (its lean), height 16.99 to 17.07 m from 5 s
 *   on, 0.5 degrees at 16 s. Before Hover v4 it learned its trim all through the turn, which then cancelled its
 *   braking: it swung to 128 degrees and fell to 7 m.
 * - the hunter carrier (its pilot taken off), A: most tilt 53.8 degrees, sinks to 5.8 m (its thrust is 1.48 times its
 *   weight) and is back at 17.3 m and 2.1 degrees at 16 s. With its parts weighed at their first cells (before
 *   `part.center`) it rolled over and lay upside down at 6.5 m, with or without v4.
 */
const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const START = 3;
const HEIGHT = 5;
const WITHIN = 0.15;
const LEVEL = 2;

interface Flight {
  /** The furthest it was from its height between 5 s and 15 s, in meters. */
  off: number;
  /** The most it tilted in the whole flight, in degrees. */
  tilt: number;
  logs: string[];
  crashes: number;
}

async function fly(bp: Blueprint, seconds = 15, before = 0): Promise<Flight> {
  const w = await World.create({ seed: 1, scripts: host }, flat);
  // The world may have been running for a while before the robot is put in it (in the app it always has).
  for (let t = 0; t < before * 60; t++) w.step();
  const r = w.spawnBlueprint(raw(bp), { x: 0, y: START });
  let off = 0;
  let tilt = 0;
  for (let t = 0; t < seconds * 60; t++) {
    w.step();
    const s = coreState(w, r);
    tilt = Math.max(tilt, Math.abs((s.angle * 180) / Math.PI));
    if (t >= 5 * 60) off = Math.max(off, Math.abs(s.y - (START + HEIGHT)));
  }
  const out = { off, tilt, logs: w.scriptLogs.filter((l) => l.robot === r.id).map((l) => l.text), crashes: w.events.filter((e) => e.kind === 'scriptCrashed').length };
  w.dispose();
  return out;
}

function expectHolds(f: Flight, name: string): void {
  expect(f.crashes, name).toBe(0);
  expect(f.logs, name).toEqual([]);
  expect(f.off, name).toBeLessThan(WITHIN);
  expect(f.tilt, name).toBeLessThan(LEVEL);
}

describe('shelf Hover: holds a height and stays level on robots it was never tuned for', () => {
  it('climbs to its height when deployed into a world that has been running for a while (it goes by self.age, not the world clock)', async () => {
    const f = await fly(give(shipped('drone', ['hover']), 'hover').blueprint, 15, 20);
    expect(f.off).toBeLessThan(WITHIN);
    expect(f.tilt).toBeLessThan(LEVEL);
    expect(f.crashes).toBe(0);
  });

  it('a small drone: the stock drone with its own hover script taken off', { timeout: 60_000 }, async () => {
    const g = give(shipped('drone', ['hover']), 'hover');
    expect(g.fit.slots.map((s) => [s.slot.group, s.guess.length])).toEqual([
      ['lift', 4],
      ['level', 1],
    ]);
    expectHolds(await fly(g.blueprint), 'drone');
  });

  it('a heavy one with armor', { timeout: 60_000 }, async () => {
    const g = give(built({ format: 1, name: 'heavy', grid: ['P  P  P  G  P  P  P', 'F  F  B  C  B  F  F', '.  .  A  F  A  .  .'] }), 'hover');
    expectHolds(await fly(g.blueprint), 'heavy');
  });

  it('other lifters: thrusters with a gyro, and swiveling thrusters with nothing that levels', { timeout: 60_000 }, async () => {
    const thrusters = give(built({ format: 1, name: 'th', grid: ['.  .  G  .  .', 'F  F  C  F  F', 'T^ .  B  .  T^'] }), 'hover');
    expectHolds(await fly(thrusters.blueprint), 'thrusters');
    const swivels = give(built({ format: 1, name: 'sw', grid: ['F  F  C  F  F', 'V^ .  B  .  V^'] }), 'hover');
    expect(swivels.fit.slots.find((s) => s.slot.group === 'level')?.could).toEqual([]);
    expectHolds(await fly(swivels.blueprint), 'swiveling thrusters');
  });

  it('lifters off center with no gyro: it balances by running one side harder', { timeout: 60_000 }, async () => {
    const g = give(built({ format: 1, name: 'lop', grid: ['P  P  .  P  .  .', 'B  F  C  F  F  F'] }), 'hover');
    expectHolds(await fly(g.blueprint), 'off center');
  });

  it('the same drone with one lifter removed, and with one added by copying: no retuning', { timeout: 60_000 }, async () => {
    const g = give(shipped('drone', ['hover']), 'hover');
    const fewer = removeParts(g.blueprint, ['propeller@0,2'], registry);
    expect(fewer.parts.filter((p) => p.tags.includes('lift'))).toHaveLength(3);
    expectHolds(await fly(fewer), 'one propeller gone');
    // A copy keeps the original's group and settings, so the script drives it with nothing more done.
    const copy = copyParts(g.blueprint, registry, ['propeller@0,2'], -1, 0);
    if (!copy.ok) throw new Error(copy.error);
    expect(copy.blueprint.parts.filter((p) => p.tags.includes('lift'))).toHaveLength(5);
    expectHolds(await fly(copy.blueprint), 'one propeller more');
  });

  it('lifters that push sideways: it holds as before, flies faster with D, and stops sooner when the key is let go', { timeout: 60_000 }, async () => {
    const grid = ['.  .  G  .  .', 'T> F  C  F  T<', '.  T^ B  T^ .'];
    const all = give(built({ format: 1, name: 'side', grid }), 'hover');
    expect(all.fit.slots[0]?.guess).toEqual(['thruster@0,1', 'thruster@4,1', 'thruster@1,0', 'thruster@3,0']);
    expectHolds(await fly(all.blueprint), 'sideways lifters');
    // The same robot with the sideways ones left alone: neither in the group nor on their own keys.
    const upOnly = give(built({ format: 1, name: 'side', grid, legend: { 'T>': { part: 'thruster', rot: 270, auto: false }, 'T<': { part: 'thruster', rot: 90, auto: false } } }), 'hover', { fill: { lift: ['thruster@1,0', 'thruster@3,0'] } });
    const dash = async (bp: Blueprint): Promise<{ speed: number; stopped: number; sink: number; crashes: number }> => {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const r = w.spawnBlueprint(raw(bp), { x: -200, y: 20 });
      let speed = 0;
      let stopped = Infinity;
      let sink = 0;
      for (let t = 0; t < 20 * 60; t++) {
        w.step(t === 300 ? [{ robot: r.id, pressed: ['d'], released: [] }] : t === 480 ? [{ robot: r.id, pressed: [], released: ['d'] }] : []);
        const s = coreState(w, r);
        if (t === 480) speed = s.vx;
        if (t > 480 && stopped === Infinity && Math.abs(s.vx) < 0.1) stopped = (t - 480) / 60;
        if (t >= 300) sink = Math.max(sink, Math.abs(s.y - 25));
      }
      const crashes = w.events.filter((e) => e.kind === 'scriptCrashed').length;
      w.dispose();
      return { speed, stopped, sink, crashes };
    };
    const fast = await dash(all.blueprint);
    const slow = await dash(upOnly.blueprint);
    expect(fast.crashes).toBe(0);
    expect(fast.speed).toBeGreaterThan(1.5 * slow.speed);
    expect(fast.stopped).toBeLessThan(0.5 * slow.stopped);
    expect(fast.sink).toBeLessThan(1);
  });

  it('sideways lifters set above its weight, and with no gyro: they are held back to what it can still level', { timeout: 60_000 }, async () => {
    for (const grid of [
      ['T> F  G  F  T<', '.  F  C  F  .', '.  T^ B  T^ .'],
      ['T> F  C  F  T<', '.  P  B  P  .'],
    ]) {
      const g = give(built({ format: 1, name: 'side', grid }), 'hover');
      expectHolds(await fly(g.blueprint), grid[0] as string);
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const r = w.spawnBlueprint(raw(g.blueprint), { x: -200, y: 20 });
      let tilt = 0;
      let sink = 0;
      for (let t = 0; t < 15 * 60; t++) {
        w.step(t === 300 ? [{ robot: r.id, pressed: ['d'], released: [] }] : t === 480 ? [{ robot: r.id, pressed: [], released: ['d'] }] : []);
        const s = coreState(w, r);
        tilt = Math.max(tilt, Math.abs((s.angle * 180) / Math.PI));
        if (t >= 300) sink = Math.max(sink, Math.abs(s.y - 25));
      }
      expect(tilt, grid[0]).toBeLessThan(65);
      expect(sink, grid[0]).toBeLessThan(1);
      expect(Math.abs(coreState(w, r).vx), grid[0]).toBeLessThan(0.1);
      w.dispose();
    }
  });

  /** Deployed at 12 m, `key` held from 5 s to 8 s, 16 s in all: the most tilt from 5 s, the height from 5 s, and the end. */
  async function turn(bp: Blueprint, key: string): Promise<{ tilt: number; low: number; high: number; end: { y: number; tilt: number }; logs: string[]; crashes: number }> {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(raw(bp), { x: 0, y: 12 });
    let tilt = 0;
    let low = Infinity;
    let high = -Infinity;
    for (let t = 0; t < 16 * 60; t++) {
      w.step(t === 300 ? [{ robot: r.id, pressed: [key], released: [] }] : t === 480 ? [{ robot: r.id, pressed: [], released: [key] }] : []);
      if (t < 300) continue;
      const s = coreState(w, r);
      tilt = Math.max(tilt, Math.abs((s.angle * 180) / Math.PI));
      low = Math.min(low, s.y);
      high = Math.max(high, s.y);
    }
    const s = coreState(w, r);
    const out = { tilt, low, high, end: { y: s.y, tilt: Math.abs((s.angle * 180) / Math.PI) }, logs: w.scriptLogs.filter((l) => l.robot === r.id).map((l) => l.text), crashes: w.events.filter((e) => e.kind === 'scriptCrashed').length };
    w.dispose();
    return out;
  }

  it('a slow turner: the many-gun drone leans with D held and comes back level, without its trim cancelling its braking', { timeout: 60_000 }, async () => {
    const f = await turn(give(shipped('enemy-many-gun-drone', ['pilot']), 'hover').blueprint, 'd');
    expect([f.crashes, f.logs]).toEqual([0, []]);
    expect(f.tilt).toBeLessThan(47);
    expect(f.low).toBeGreaterThan(17 - WITHIN);
    expect(f.high).toBeLessThan(17 + WITHIN);
    expect(f.end.tilt).toBeLessThan(LEVEL);
  });

  it('weight in a big part: the hunter carrier (a 10 by 4 bay) leans with A held and does not roll over', { timeout: 60_000 }, async () => {
    const f = await turn(give(shipped('enemy-hunter-carrier', ['pilot']), 'hover').blueprint, 'a');
    expect([f.crashes, f.logs]).toEqual([0, []]);
    expect(f.tilt).toBeLessThan(60);
    // It has little thrust to spare and sinks while it rights itself, then climbs back.
    expect(f.low).toBeGreaterThan(4);
    expect(Math.abs(f.end.y - 17)).toBeLessThan(1);
    expect(f.end.tilt).toBeLessThan(5);
  });

  it('too heavy to lift: it says so in plain words and stays down', { timeout: 60_000 }, async () => {
    const g = give(built({ format: 1, name: 'brick', grid: ['P  P  P  G  P  P  P', 'A  F  B  C  B  F  A', '.  .  A  A  A  .  .'] }), 'hover');
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(raw(g.blueprint), { x: 0, y: START });
    for (let t = 0; t < 300; t++) w.step();
    expect(w.scriptLogs.filter((l) => l.robot === r.id).map((l) => l.text)).toEqual(['Hover: the lifters hold 73 kg and this robot weighs 117 kg. It needs more lift.']);
    expect(coreState(w, r).y).toBeLessThan(START);
    w.dispose();
  });
});
