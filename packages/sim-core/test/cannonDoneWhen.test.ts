import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
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

/** A robot and every piece that broke off it. */
function family(w: World, r: Robot): Set<number> {
  const ids = new Set([r.id]);
  for (const x of w.robots) if (x.brokeFrom !== undefined && ids.has(x.brokeFrom)) ids.add(x.id);
  return ids;
}
/** Parts a robot, or any piece that broke off it, lost; its own flares burning out do not count. */
function partsLost(w: World, r: Robot): number {
  const ids = family(w, r);
  return w.events.filter((e) => e.kind === 'partDestroyed' && ids.has(e.robot) && e.burntOut !== true).length;
}
const body = (w: World, r: Robot) => w.physics.state(r.groups[0]?.bodyId as number);
const of = (w: World, kind: string) => w.events.filter((e) => e.kind === kind);

describe('M15 charged guns, done when', () => {
  it('a cannon tower takes a core behind a heavy plate 200 m off with its first shot, 6 s in, and rocks back from the kick', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const tower = w.spawnBlueprint(blueprint('enemy-cannon-tower'), { x: -300, y: 2.5 }, { team: 1 });
    // A plate, the core behind it, another plate behind that: 250 and 50 of the orb's 500, the rest into the last.
    const brick = w.spawnBlueprint({ format: 1, name: 'brick', grid: ['A C A'] }, { x: -100, y: 0.5 });
    const x0 = w.physics.state(tower.groups[1]?.bodyId as number).x;
    let tilt = 0;
    for (let t = 0; t < 12 * 60; t++) {
      w.step();
      tilt = Math.max(tilt, Math.abs(w.physics.state(tower.groups[1]?.bodyId as number).angle));
    }
    const fires = of(w, 'cannonFire');
    expect(fires).toHaveLength(1);
    expect((fires[0]?.tick ?? 0) / 60).toBeLessThan(6.5);
    const hits = of(w, 'boltHit').map((e) => (e.kind === 'boltHit' ? [e.partType, e.damage] : []));
    expect(hits).toEqual([['armorplate', 250], ['core', 50], ['armorplate', 200]]);
    expect(brick.primaryCoreId).toBeUndefined();
    // The kick: 800 N s on a 290 kg tower standing on the ground. It tips and slides back, and stays up.
    expect(tilt).toBeGreaterThan(0.03);
    expect(w.physics.state(tower.groups[1]?.bodyId as number).x).toBeLessThan(x0 - 0.3);
    expect(Math.abs(w.physics.state(tower.groups[1]?.bodyId as number).angle)).toBeLessThan(0.05);
    // With its target dead it does not charge again: one shot's energy and a rotator's, no backfire.
    expect(of(w, 'cannonBackfire')).toEqual([]);
    expect(w.energy(tower.id)?.used ?? 0).toBeLessThan(6200);
    w.dispose();
  });

  it('a tower with nothing to shoot at never charges and never backfires', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const tower = w.spawnBlueprint(blueprint('enemy-cannon-tower'), { x: -300, y: 2.5 }, { team: 1 });
    // A friend in plain view is not a target.
    w.spawnBlueprint({ format: 1, name: 'friend', grid: ['A C A'] }, { x: -200, y: 0.5 }, { team: 1 });
    for (let t = 0; t < 15 * 60; t++) w.step();
    expect(of(w, 'cannonFire')).toEqual([]);
    expect(of(w, 'cannonBackfire')).toEqual([]);
    expect(of(w, 'scriptCrashed')).toEqual([]);
    expect(w.energy(tower.id)?.used ?? 0).toBeLessThan(200);
    w.dispose();
  });

  it('a target that goes away while it charges: it lets go, the charge drains, and the energy comes back', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const tower = w.spawnBlueprint(blueprint('enemy-cannon-tower'), { x: -300, y: 2.5 }, { team: 1 });
    const brick = w.spawnBlueprint({ format: 1, name: 'brick', grid: ['A C A'] }, { x: -100, y: 0.5 });
    for (let t = 0; t < 4 * 60; t++) w.step();
    const mid = w.energy(tower.id)?.used ?? 0;
    expect(mid).toBeGreaterThan(3500);
    // Its core gone: nobody to shoot at.
    const core = [...brick.parts.values()].find((p) => p.def.id === 'core');
    if (core) core.health = 0;
    for (let t = 0; t < 6 * 60; t++) w.step();
    expect(of(w, 'cannonFire')).toEqual([]);
    expect(of(w, 'cannonBackfire')).toEqual([]);
    expect(w.energy(tower.id)?.used ?? 0).toBeLessThan(300);
    w.dispose();
  });

  it('a tower with one dense battery still fires: it waits for a full battery instead of charging down to its reserve for ever', { timeout: 60_000 }, async () => {
    const raw = JSON.parse(bpFile('enemy-cannon-tower.json'));
    // Seven of its eight dense batteries swapped for frames.
    let kept = false;
    raw.grid = raw.grid.map((row: string) => row.split(' ').map((t) => (t !== 'Z' ? t : kept ? 'F' : ((kept = true), 'Z'))).join(' '));
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const tower = w.spawnBlueprint(resolveScripts(raw, bpFile).raw, { x: -300, y: 2.5 }, { team: 1 });
    w.spawnBlueprint({ format: 1, name: 'brick', grid: ['A C A'] }, { x: -100, y: 0.5 });
    for (let t = 0; t < 12 * 60; t++) w.step();
    expect(w.cannonStats(tower.id).shots).toBe(1);
    expect(of(w, 'boltHit').length).toBeGreaterThan(0);
    w.dispose();
  });

  it('an enemy cannon drone flies through its own kick: it pitches hard on each shot, recovers, and wrecks a hunter drone', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const drone = w.spawnBlueprint(blueprint('enemy-cannon-drone'), { x: -300, y: 60 }, { team: 1 });
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: 50, y: 60 });
    let lowest = Infinity;
    let pitch = 0;
    let shotAt = -1;
    for (let t = 0; t < 40 * 60; t++) {
      w.step();
      const s = body(w, drone);
      lowest = Math.min(lowest, s.y);
      const shots = w.cannonStats(drone.id).shots;
      if (shots > 0 && shotAt < 0) shotAt = t;
      // The second after its first shot.
      if (shotAt >= 0 && t - shotAt < 60) pitch = Math.max(pitch, Math.abs(s.angle));
    }
    // Two since the turret digs for the main core (it took three while it went for the missiles on the rack first).
    expect(w.cannonStats(drone.id).shots).toBeGreaterThanOrEqual(2);
    expect(w.cannonStats(drone.id).backfires).toBe(0);
    expect(pitch).toBeGreaterThan(0.25);
    expect(Math.abs(body(w, drone).angle)).toBeLessThan(0.15);
    expect(lowest).toBeGreaterThan(40);
    expect(partsLost(w, drone)).toBe(0);
    expect(hunter.primaryCoreId).toBeUndefined();
    expect(partsLost(w, hunter)).toBeGreaterThanOrEqual(40);
    w.dispose();
  });

  it('an enemy lance drone picks an enemy laser drone apart from past its 300 m: its core within 40 s, nothing lost', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const drone = w.spawnBlueprint(blueprint('enemy-lance-drone'), { x: -300, y: 60 }, { team: 1 });
    const laser = w.spawnBlueprint(blueprint('enemy-laser-drone'), { x: 300, y: 60 });
    for (let t = 0; t < 40 * 60; t++) w.step();
    expect(laser.primaryCoreId).toBeUndefined();
    expect(partsLost(w, drone)).toBe(0);
    expect(w.cannonStats(drone.id).backfires).toBe(0);
    expect(of(w, 'laserBurn').filter((e) => family(w, drone).has(e.robot))).toEqual([]);
    expect(body(w, drone).y).toBeGreaterThan(30);
    w.dispose();
  });

  it('against an enemy drone with missiles on its rack the tower goes for the main core, not the missiles (Logan: "it cut through all the missiles and did not go for the core")', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    w.spawnBlueprint(blueprint('enemy-cannon-tower'), { x: -150, y: 2.5 }, { team: 1 });
    const drone = w.spawnBlueprint(blueprint('enemy-drone'), { x: 150, y: 40 });
    const main = drone.primaryCoreId;
    for (let t = 0; t < 12 * 60; t++) w.step();
    // Its first orb goes down the drone's long row to the core that runs it, and through no missile.
    const hits = of(w, 'boltHit').flatMap((e) => (e.kind === 'boltHit' ? [e] : []));
    expect(hits.some((e) => e.robot === drone.id && e.part === main)).toBe(true);
    expect(hits.filter((e) => e.partType === 'heavywarhead' || e.partType === 'seeker')).toEqual([]);
    // Measured: the row in front of the core soaks up 460 of the orb's 500, so the core is left with 10 of its 50, and
    // the drone's missiles then disarm the tower before a second shot. Recorded for Logan, not asserted as a win.
    w.dispose();
  });

  it('an enemy lance drone beats an enemy drone that fires back, losing nothing', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const drone = w.spawnBlueprint(blueprint('enemy-lance-drone'), { x: -250, y: 60 }, { team: 1 });
    const foe = w.spawnBlueprint(blueprint('enemy-drone'), { x: 250, y: 60 });
    for (let t = 0; t < 30 * 60; t++) w.step();
    expect(foe.primaryCoreId).toBeUndefined();
    expect(partsLost(w, drone)).toBe(0);
    w.dispose();
  });

  it('no bolt hits a friend in a 2 against 2', { timeout: 180_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const a = w.spawnBlueprint(blueprint('enemy-cannon-drone'), { x: -320, y: 60 }, { team: 1 });
    const b = w.spawnBlueprint(blueprint('enemy-lance-drone'), { x: -380, y: 90 }, { team: 1 });
    w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: 150, y: 50 });
    w.spawnBlueprint(blueprint('hunter-drone'), { x: 200, y: 80 });
    for (let t = 0; t < 40 * 60; t++) w.step();
    const ours = new Set([...family(w, a), ...family(w, b)]);
    const hits = of(w, 'boltHit');
    expect(hits.length).toBeGreaterThan(5);
    expect(hits.filter((e) => ours.has(e.robot))).toEqual([]);
    expect(of(w, 'scriptCrashed')).toEqual([]);
    w.dispose();
  });
});
