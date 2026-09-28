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
import { orientRaw } from '../src/blueprint/orient';
import { defaultRegistry } from '../src/parts/registry';

// Batch: the gun drone bomb (a drone bomb airframe with a gun where the warhead was) and the fab drones that make it.
const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;
const of = (w: World, r: Robot, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind && e.robot === r.id);
/** Parts a robot, or any piece that broke off it, lost. */
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot)).length;
}
/** Parts a robot itself lost (not what it let go). */
const ownLost = (w: World, r: Robot): number => w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === r.id).length;
/** Shells that hit `target` (or a piece that broke off it), fired by `shooter` or by anything that broke off it. */
function shellHits(w: World, shooter: Robot, target: Robot): number {
  const from = (id: number | undefined): boolean => id === shooter.id || w.robots.find((x) => x.id === id)?.brokeFrom === shooter.id;
  const to = (id: number): boolean => id === target.id || w.robots.find((x) => x.id === id)?.brokeFrom === target.id;
  return w.events.filter((e) => e.kind === 'shellHit' && from(e.by) && to(e.robot)).length;
}
const holdF = (robot: number, from: number) => (t: number) => (t === Math.round(from * 60) ? [{ robot, pressed: ['f'], released: [] }] : []);
const x = (w: World, r: Robot): number => w.physics.state(r.groups[0]?.bodyId as number).x;

describe('gun drone bomb, done when', () => {
  it('hangs about 40 m off a parked car, on the side its gun faces, and shoots it without losing a part', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const car = w.spawnBlueprint(blueprint('car'), { x: -20, y: 1.45 }, { team: 1 });
    const g = w.spawnBlueprint(blueprint('gun-drone-bomb'), { x: -110, y: 25 });
    for (let t = 0; t < 25 * 60; t++) w.step();
    const off = x(w, car) - x(w, g);
    expect(off).toBeGreaterThan(30);
    expect(off).toBeLessThan(55);
    expect(shellHits(w, g, car)).toBeGreaterThanOrEqual(30);
    expect(ownLost(w, g)).toBe(0);
    w.dispose();
  });

  it('facing away from its target it crosses over it, then hangs off the far side and shoots', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    // The gun faces right; the car is to the left.
    const car = w.spawnBlueprint(blueprint('car'), { x: -220, y: 1.45 }, { team: 1 });
    const g = w.spawnBlueprint(blueprint('gun-drone-bomb'), { x: -110, y: 25 });
    for (let t = 0; t < 40 * 60; t++) w.step();
    expect(x(w, g)).toBeLessThan(x(w, car));
    expect(shellHits(w, g, car)).toBeGreaterThanOrEqual(10);
    expect(ownLost(w, g)).toBe(0);
    w.dispose();
  });

  it('two of them share a target: the one behind takes another row of it, and both hit', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -20, y: 25 }, { team: 1 });
    const a = w.spawnBlueprint(blueprint('gun-drone-bomb'), { x: -120, y: 25 });
    const b = w.spawnBlueprint(blueprint('gun-drone-bomb'), { x: -130, y: 25 });
    for (let t = 0; t < 30 * 60; t++) w.step();
    expect(shellHits(w, a, hunter)).toBeGreaterThanOrEqual(15);
    expect(shellHits(w, b, hunter)).toBeGreaterThanOrEqual(15);
    expect(ownLost(w, a) + ownLost(w, b)).toBe(0);
    w.dispose();
  });
});

describe('swarm fab drone, done when', () => {
  it('builds a gun drone bomb in 4.9 s (per-part build times; the heavy drone bomb takes 8.7) and holds it level', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('swarm-fab-drone'), { x: -100, y: 15 });
    for (let t = 0; t < 7 * 60; t++) w.step();
    const built = of(w, d, 'built');
    expect(built).toHaveLength(1);
    expect((built[0]?.tick ?? 0) / 60).toBeCloseTo(4.9, 1);
    const s = w.physics.state(d.groups[0]?.bodyId as number);
    expect(Math.abs(s.y - 15)).toBeLessThan(1);
    expect(Math.abs(s.angle)).toBeLessThan(0.05);
    w.dispose();
  });

  it('holding F, it lets each go as it is built and they wear a hovering hunter down', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('swarm-fab-drone'), { x: -360, y: 20 });
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -110, y: 20 }, { team: 1 });
    const keys = holdF(d.id, 1);
    for (let t = 0; t < 45 * 60; t++) w.step(keys(t));
    expect(of(w, d, 'released').length).toBeGreaterThanOrEqual(8); // one per 4.9 s
    expect(partsLost(w, hunter)).toBeGreaterThanOrEqual(8);
    expect(shellHits(w, d, hunter)).toBeGreaterThanOrEqual(90);
    expect(ownLost(w, d)).toBe(0);
    w.dispose();
  });

  it('loose junk in its hollow blocks the bay for a second, is pushed out, and the drone bomb is built after (bay clearing)', { timeout: 30_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(blueprint('swarm-fab-drone'), { x: -100, y: 15 });
    // A frame lying in the hollow (the bay is at grid cell (5, 3): the hollow starts one cell above it).
    const junk = w.spawnBlueprint({ format: 1, name: 'lump', parts: [{ part: 'frame', x: 0, y: 0 }] }, { x: -101, y: 19 });
    for (let t = 0; t < 9 * 60; t++) w.step();
    const blocked = of(w, d, 'buildBlocked');
    const built = of(w, d, 'built');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(built).toHaveLength(1);
    // Ready at 4.9 s but for the junk: a second's wait, then the push out.
    expect((built[0]?.tick ?? 0) - (blocked[0]?.tick ?? 0)).toBeGreaterThan(55);
    expect(w.physics.state(junk.groups[0]?.bodyId as number).y).toBeGreaterThan(25);
    w.dispose();
  });
});

describe('enemy swarm fab drone, done when', () => {
  it('deployed flipped, it sends gun drone bombs at a hovering hunter, keeps building, and loses nothing itself', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const d = w.spawnBlueprint(orientRaw(blueprint('enemy-swarm-fab-drone'), { flip: true, rot: 0 }, defaultRegistry()), { x: -60, y: 27 }, { team: 1 });
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -260, y: 27 });
    for (let t = 0; t < 45 * 60; t++) w.step();
    expect(of(w, d, 'released').length).toBeGreaterThanOrEqual(8);
    expect(shellHits(w, d, hunter)).toBeGreaterThanOrEqual(70);
    expect(partsLost(w, hunter)).toBeGreaterThanOrEqual(6);
    expect(ownLost(w, d)).toBe(0);
    w.dispose();
  });
});
