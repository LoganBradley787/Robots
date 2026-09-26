import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { partWorldPose } from '../src/metrics/robotMetrics';

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** No gravity, a small ground far below, and a wall at x 50 from y 90 to 110 (as in the sensor tests). */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 }, boxes: [{ x: 50, y: 100, w: 2, h: 20 }] });
const RADAR = { format: 1, name: 'radar-bot', grid: ['C  O  B'] };
const SEEKER_UP = { format: 1, name: 'seeker-bot', grid: ['S^', 'C', 'B'] };
const LIGHT = [
  { key: 'v', mode: 'pulse', target: 'flare', channel: 'ignite', value: 1 },
  { key: 'v', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 },
];
/** Lets a burning flare go to the right on V. */
const RIGHT = { format: 1, name: 'right', grid: ['C  D>  Q'], bindings: LIGHT };
/** Lets a burning flare go each way on V. */
const BOTH = { format: 1, name: 'both', grid: ['Q  D<  C  D>  Q'], bindings: LIGHT };
/** Lets a burning flare go straight down on V. */
const DOWN = { format: 1, name: 'down', grid: ['C', 'Dv', 'Q'], bindings: LIGHT };
const BURN_TICKS = 120;

async function world(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0, scripts: host }, space);
}
function light(w: World, r: Robot): void {
  w.step([{ robot: r.id, pressed: ['v'], released: [] }]);
  w.step([{ robot: r.id, pressed: [], released: ['v'] }]);
}
/** The robot holding a part now, and where the part is. */
function where(w: World, partId: string, of: number): { robot: Robot; x: number; y: number } {
  const robot = w.robots.find((r) => r.parts.get(partId)?.decoyOf === of);
  if (!robot) throw new Error(`no burning ${partId}`);
  const p = partWorldPose(w, robot, partId);
  return { robot, x: p.x, y: p.y };
}
function corePos(w: World, r: Robot): { x: number; y: number } {
  const p = partWorldPose(w, r, r.primaryCoreId ?? r.rootId);
  return { x: p.x, y: p.y };
}

describe('decoys fool sensors (M11)', () => {
  it('a radar sees the robot at its burning flare, with the robot’s id, side, and part count; the flare is not listed as itself', async () => {
    const w = await world();
    const me = w.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const target = w.spawnBlueprint(RIGHT, { x: 0, y: 130 }, { team: 1 });
    light(w, target);
    for (let i = 0; i < 30; i++) w.step();
    const flare = where(w, 'flare@2,0', target.id);
    expect(flare.x - corePos(w, target).x).toBeGreaterThan(4);
    const seen = w.sensorView(me.id).contacts;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: target.id, side: 'enemy', decoy: true });
    expect(seen[0]?.x).toBeCloseTo(flare.x, 6);
    expect(seen[0]?.y).toBeCloseTo(flare.y, 6);
    w.dispose();
  });

  it('scripts get the robot at the flare (its position and speed, the robot’s mass and parts), and scan() of it returns the flare', async () => {
    const w = await world();
    const src = `
      function tick() {
        if (frame !== 40) return;
        var c = contacts[0];
        log(contacts.length, c.id, c.side, c.core, c.parts, Math.round(c.mass * 10) / 10, c.pos.x.toFixed(3), c.pos.y.toFixed(3), c.vel.x > 3, c.center.x === c.pos.x);
        log(JSON.stringify(scan(c.id).map(function (p) { return [p.id, p.type]; })));
      }`;
    const me = w.spawnBlueprint({ ...RADAR, scripts: [{ id: 'look', source: src }] }, { x: 0, y: 100 });
    const target = w.spawnBlueprint(RIGHT, { x: 0, y: 130 }, { team: 1 });
    for (let i = 0; i < 10; i++) w.step();
    light(w, target);
    // The script reads the world as it was after the step before it runs.
    for (let i = 0; i < 28; i++) w.step();
    const flare = where(w, 'flare@2,0', target.id);
    w.step();
    const logs = w.scriptLogs.filter((l) => l.robot === me.id).map((l) => l.text);
    expect(logs).toEqual([`1 ${target.id} enemy true 2 3 ${flare.x.toFixed(3)} ${flare.y.toFixed(3)} true true`, '[["flare@2,0","flare"]]']);
    w.dispose();
  });

  it('a seeker is fooled only while the flare is inside its cone', async () => {
    const w = await world();
    // Looking up, 10 m under the target: the flare drifts right, out of the 90 degree cone after about a second.
    const eye = w.spawnBlueprint(SEEKER_UP, { x: 0, y: 120 });
    const target = w.spawnBlueprint(RIGHT, { x: 0, y: 131 }, { team: 1 });
    light(w, target);
    w.step();
    expect(w.sensorView(eye.id).contacts).toMatchObject([{ id: target.id, decoy: true }]);
    for (let i = 0; i < 90; i++) w.step();
    const flare = where(w, 'flare@2,0', target.id);
    expect(Math.abs(flare.x - 0) > Math.abs(flare.y - 120)).toBe(true);
    const seen = w.sensorView(eye.id).contacts;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.decoy).toBeUndefined();
    expect(seen[0]?.x).toBeCloseTo(corePos(w, target).x, 6);
    w.dispose();
  });

  it('of two flares in view, the nearest to the viewer stands in', async () => {
    const w = await world();
    const me = w.spawnBlueprint(RADAR, { x: 40, y: 130 });
    const target = w.spawnBlueprint(BOTH, { x: 0, y: 130 }, { team: 1 });
    light(w, target);
    for (let i = 0; i < 20; i++) w.step();
    const east = where(w, 'flare@4,0', target.id);
    const west = where(w, 'flare@0,0', target.id);
    expect(east.x).toBeGreaterThan(west.x);
    const seen = w.sensorView(me.id).contacts;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.x).toBeCloseTo(east.x, 6);
    w.dispose();
  });

  it('once burnt out, the robot is seen where it really is again', async () => {
    const w = await world();
    const me = w.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const target = w.spawnBlueprint(RIGHT, { x: 0, y: 130 }, { team: 1 });
    light(w, target);
    for (let i = 0; i < BURN_TICKS; i++) w.step();
    const seen = w.sensorView(me.id).contacts;
    expect(w.robots.some((r) => r.parts.has('flare@2,0'))).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.decoy).toBeUndefined();
    expect(seen[0]?.x).toBeCloseTo(corePos(w, target).x, 6);
    w.dispose();
  });

  it('a flare behind terrain fools nothing', async () => {
    const w = await world();
    // The wall (x 49 to 51, y 90 to 110) is between the radar and the flare once it falls below about y 120, not the robot.
    const me = w.spawnBlueprint(RADAR, { x: 70, y: 100 });
    const target = w.spawnBlueprint(DOWN, { x: 30, y: 126 }, { team: 1 });
    light(w, target);
    expect(w.sensorView(me.id).contacts).toMatchObject([{ id: target.id, decoy: true }]);
    for (let i = 0; i < 40; i++) w.step();
    expect(where(w, 'flare@0,0', target.id).y).toBeLessThan(118);
    const seen = w.sensorView(me.id).contacts;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.decoy).toBeUndefined();
    expect(seen[0]?.y).toBeCloseTo(corePos(w, target).y, 6);
    w.dispose();
  });

  it('every sensor is fooled, a friend’s too; a robot never sees itself, nor its own flare', async () => {
    const w = await world();
    const me = w.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const mine = w.spawnBlueprint({ ...RIGHT, grid: ['C  O  D>  Q'] }, { x: 0, y: 130 });
    light(w, mine);
    for (let i = 0; i < 30; i++) w.step();
    const flare = where(w, 'flare@3,0', mine.id);
    expect(w.sensorView(me.id).contacts).toMatchObject([{ id: mine.id, side: 'friend', decoy: true }]);
    expect(w.sensorView(me.id).contacts[0]?.x).toBeCloseTo(flare.x, 6);
    expect(w.sensorView(mine.id).contacts.map((c) => c.id)).toEqual([me.id]);
    w.dispose();
  });

  it('a robot with no flares, and a world with none, see as before', async () => {
    const w = await world();
    const me = w.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const plain = w.spawnBlueprint({ format: 1, name: 'plain', grid: ['C  B'] }, { x: 0, y: 130 }, { team: 1 });
    const target = w.spawnBlueprint(RIGHT, { x: 0, y: 70 }, { team: 1 });
    light(w, target);
    for (let i = 0; i < 20; i++) w.step();
    const seen = w.sensorView(me.id).contacts;
    const p = seen.find((c) => c.id === plain.id);
    expect(p?.decoy).toBeUndefined();
    expect(p?.x).toBeCloseTo(corePos(w, plain).x, 6);
    expect(seen.find((c) => c.id === target.id)?.decoy).toBe(true);
    w.dispose();
  });
});
