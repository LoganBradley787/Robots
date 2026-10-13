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

async function fly(bp: Blueprint, seconds = 15): Promise<Flight> {
  const w = await World.create({ seed: 1, scripts: host }, flat);
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
