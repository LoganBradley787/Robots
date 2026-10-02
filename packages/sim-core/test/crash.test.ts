import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { CRASH_REACH, crashDistance, crashFraction, crashWeight } from '../src/world/crash';
import type { PartInstance } from '../src/world/Robot';

const flat = parseWorldFile(flatJson);
const destroyed = (w: World): string[] => w.events.flatMap((e) => (e.kind === 'partDestroyed' ? [e.part] : []));

const CAR = { format: 1, name: 'car', grid: ['F  C  F', 'W  .  W'] };
const DRONE = { format: 1, name: 'drone', grid: ['P  P  P', 'F  C  F'] };

async function drop(bp: object, height: number, seconds = 4): Promise<{ w: World; lost: string[] }> {
  const w = await World.create({ seed: 1 }, flat);
  w.spawnBlueprint(bp as never, { x: -100, y: height });
  for (let i = 0; i < seconds * 60; i++) w.step();
  return { w, lost: destroyed(w) };
}

describe('crash damage (Batch)', () => {
  it('the curve: nothing at or under safe, squared over it, frames tougher', () => {
    expect(crashFraction(12, undefined)).toBe(0);
    expect(crashFraction(3, undefined)).toBe(0);
    expect(crashFraction(12 + 4, undefined)).toBeCloseTo(0.25);
    expect(crashFraction(20, undefined)).toBeCloseTo(1);
    expect(crashFraction(27, { safe: 24 })).toBeCloseTo((3 / 8) ** 2);
  });

  // Titans: the weight was 0.5 (the far side of the robot) to 1.5 (the hit side) whatever the robot's size. Now it is
  // 1.5 at the hit, falling to 0 at 6 m past it.
  it('the weight: 1.5 at the hit (within half a cell), falling in a straight line to nothing 6 m past it', () => {
    expect(CRASH_REACH).toBe(6);
    expect(crashWeight(0)).toBe(1.5);
    expect(crashWeight(0.5)).toBe(1.5);
    expect(crashWeight(3.5)).toBeCloseTo(0.75);
    // The tail of a five cell missile that hit nose first: the 0.5 it had before.
    expect(crashWeight(4.5)).toBeCloseTo(0.5);
    expect(crashWeight(6.5)).toBe(0);
    expect(crashWeight(40)).toBe(0);
  });

  it('the distance: to the nearest touch that pushed the way the body went, else the depth behind the leading face', () => {
    // Hit from the right (the body was pushed left): the touch on the right counts, the ground under it does not.
    const touches = [{ x: 10, y: 0, nx: -1, ny: 0 }, { x: 0, y: -5, nx: 0, ny: 1 }];
    const near = crashDistance(touches, 1, 0, () => { throw new Error('not needed'); });
    expect(near(10, 0)).toBe(0);
    expect(near(7, 4)).toBeCloseTo(5);
    expect(near(0, -5)).toBeCloseTo(Math.hypot(10, 5));
    expect(near(-40, 0)).toBe(Infinity);
    // No touch pushed it that way: the depth behind the leading face (the leading part is half a cell from it).
    const deep = crashDistance([{ x: 0, y: -5, nx: 0, ny: 1 }], 1, 0, () => 9.5);
    expect(deep(9.5, 3)).toBeCloseTo(0.5);
    expect(deep(2.5, -8)).toBeCloseTo(7.5);
  });

  it('a car and a drone set down from the 6 m spawn height take nothing', async () => {
    for (const bp of [CAR, DRONE]) {
      const { w, lost } = await drop(bp, 6);
      expect(lost).toEqual([]);
      for (const r of w.robots) for (const p of r.parts.values()) expect(p.health).toBe(p.def.health);
      w.dispose();
    }
  });

  it('a car falling 20 m loses its wheels first and the frames hold', async () => {
    const { w, lost } = await drop(CAR, 20);
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.every((id) => id.startsWith('wheel'))).toBe(true);
    for (const r of w.robots) for (const p of r.parts.values()) if (p.def.id === 'frame') expect(p.health).toBe(60);
    w.dispose();
  });

  it('a nose ramming a wall at 130 m/s shatters it, the nose worst', async () => {
    const wall = parseWorldFile({ name: 'wall', ground: { width: 400, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [{ x: 60, y: 20, w: 1, h: 30 }] });
    const w = await World.create({ seed: 1, gravityY: 0 }, wall);
    const r = w.spawnBlueprint({ format: 1, name: 'ram', grid: ['F  F  C  B  H'] } as never, { x: 0, y: 20 });
    w.kickRobot(r, 130, 0);
    for (let i = 0; i < 120; i++) w.step();
    expect(destroyed(w)).toContain('heavywarhead@4,0');
    expect(destroyed(w).length).toBeGreaterThanOrEqual(3);
    w.dispose();
  });

  it('a kick is not a crash: 40 m/s given to a body in empty space breaks nothing', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, parseWorldFile({ name: 'void', ground: { width: 50, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] }));
    const r = w.spawnBlueprint({ format: 1, name: 'x', grid: ['F  C  B'] } as never, { x: 0, y: 20 });
    w.kickRobot(r, 40, 0);
    for (let i = 0; i < 60; i++) w.step();
    expect(destroyed(w)).toEqual([]);
    w.dispose();
  });

  it('is deterministic', async () => {
    const a = await drop(CAR, 20);
    const b = await drop(CAR, 20);
    expect(a.w.hash()).toBe(b.w.hash());
    a.w.dispose();
    b.w.dispose();
  });
});

// Titans: crash damage is local. A hit hurt every part of the body before, however deep.
describe('crash damage is local (Titans)', () => {
  const space = parseWorldFile({ name: 'space', ground: { width: 400, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [{ x: 60, y: 40, w: 1, h: 1 }] });
  const slab = (cols: number, rows: number, special: Record<string, string> = {}): string[] => {
    const grid: string[] = [];
    // The grid's first line is the top row; cells are named by column and row from the bottom left.
    for (let y = rows - 1; y >= 0; y--) grid.push(Array.from({ length: cols }, (_, x) => (special[`${x},${y}`] ?? 'F').padEnd(3)).join(''));
    return grid;
  };
  const lostShare = (p: PartInstance): number => 1 - p.health / p.def.health;

  it('a 20 by 20 slab hit hard at one spot: the parts near it are hurt, nearest most, and the core and the far side take nothing', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const r = w.spawnBlueprint({ format: 1, name: 'slab', grid: slab(20, 20, { '10,10': 'C' }) } as never, { x: 40, y: 39 });
    // 30 m/s into a 1 m box: frames are safe to 24, so the nearest lose 1.5 * (6 / 8)^2 of their health and none breaks.
    w.kickRobot(r, 30, 0);
    for (let i = 0; i < 90; i++) w.step();
    expect(destroyed(w)).toEqual([]);
    const parts = [...r.parts.values()];
    const worst = parts.reduce((a, b) => (lostShare(b) > lostShare(a) ? b : a));
    expect(worst.x).toBe(19);
    expect(lostShare(worst)).toBeGreaterThan(0.5);
    const far = (p: PartInstance): number => Math.hypot(p.x - worst.x, p.y - worst.y);
    const hurt = parts.filter((p) => lostShare(p) > 0);
    expect(hurt.length).toBeGreaterThan(40);
    expect(hurt.length).toBeLessThan(120);
    for (const p of parts) {
      if (far(p) <= 4) expect(lostShare(p)).toBeGreaterThan(0);
      if (far(p) >= 8) expect(p.health).toBe(p.def.health);
      // Falloff order: a part clearly farther from the hit never lost more.
      for (const q of hurt) if (far(q) > far(p) + 1.5) expect(lostShare(q)).toBeLessThanOrEqual(lostShare(p));
    }
    expect(r.parts.get(r.primaryCoreId ?? '')?.health).toBe(50);
    for (const p of parts) if (p.x <= 11) expect(p.health).toBe(p.def.health);
    w.dispose();
  });

  it('the same hit on a five cell robot still hurts every part, nose first, as before', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const r = w.spawnBlueprint({ format: 1, name: 'dart', grid: ['B  B  C  B  B'] } as never, { x: 40, y: 40 });
    w.kickRobot(r, 16, 0);
    for (let i = 0; i < 90; i++) w.step();
    const parts = [...r.parts.values()].sort((a, b) => b.x - a.x);
    expect(parts).toHaveLength(5);
    const lost = parts.map(lostShare);
    for (const share of lost) expect(share).toBeGreaterThan(0);
    for (let i = 1; i < lost.length; i++) expect(lost[i]).toBeLessThan(lost[i - 1] ?? 0);
    // Before: the weights ran from 1.5 (the nose) to 0.5 (the tail). They still do on a robot this long.
    expect((lost[0] ?? 0) / (lost[4] ?? 1)).toBeGreaterThan(2.5);
    expect((lost[0] ?? 0) / (lost[4] ?? 1)).toBeLessThan(3.5);
    w.dispose();
  });

  it('a heavy block rammed into armor at 45 m/s ends a core 2 cells deep, and no longer one 10 cells deep', async () => {
    const ram = async (depth: number): Promise<{ alive: boolean; health: number | undefined }> => {
      const w = await World.create({ seed: 1, gravityY: 0 }, space);
      // The target's left face takes the hit: `depth` cells of frame between it and the core.
      const target = w.spawnBlueprint({ format: 1, name: 'armor', grid: slab(13, 5, { [`${depth},2`]: 'C' }) } as never, { x: 0, y: 30 }, { team: 1 });
      const block = w.spawnBlueprint({ format: 1, name: 'block', grid: slab(8, 5, { '0,2': 'C' }).map((row) => row.replaceAll('F', 'B')) } as never, { x: -30, y: 30 });
      const core = target.primaryCoreId ?? '';
      w.kickRobot(block, 45, 0);
      for (let i = 0; i < 120; i++) w.step();
      const out = { alive: !destroyed(w).includes(core), health: w.robots.flatMap((x) => [...x.parts.values()]).find((p) => p.id === core && p.def.id === 'core' && p.x === depth)?.health };
      w.dispose();
      return out;
    };
    expect((await ram(2)).alive).toBe(false);
    expect(await ram(10)).toEqual({ alive: true, health: 50 });
  });

  it('an armed warhead and an armed distance charge deep in a body still go off on the jolt', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const legend = { X: { part: 'warhead', armed: true }, Xd: { part: 'charge', armed: true }, Xu: { part: 'warhead' } };
    // Each 15 cells behind the face that hits, apart so one blast does not reach the other, the unarmed warhead and
    // the core out of reach of both blasts.
    const grid = slab(20, 9, { '4,1': 'X', '4,7': 'Xd', '0,4': 'Xu', '10,4': 'C' });
    const r = w.spawnBlueprint({ format: 1, name: 'slab', grid, legend } as never, { x: 40, y: 40 });
    w.kickRobot(r, 20, 0);
    const safe = [...r.parts.values()].find((p) => p.def.id === 'warhead' && p.armed !== true);
    for (let i = 0; i < 90; i++) w.step();
    const went = w.events.flatMap((e) => (e.kind === 'partDestroyed' && e.exploded ? [e.partType] : [])).sort();
    expect(went).toEqual(['charge', 'warhead']);
    // The jolt hurt nothing that deep: the unarmed warhead (no fuze until armed) and the core lost nothing.
    const left = w.robots.flatMap((x) => [...x.parts.values()]);
    expect(left).toContain(safe);
    expect(safe?.health).toBe(20);
    expect(left.find((p) => p.def.id === 'core')?.health).toBe(50);
    w.dispose();
  });

  it('a tall car landing hard on its wheels: the wheels and the parts near them take it, the roof does not', async () => {
    const grid = [...Array.from({ length: 10 }, () => 'B  B  B'), 'B  C  B', 'W  .  W'];
    const { w, lost } = await drop({ format: 1, name: 'tall', grid }, 20);
    expect(lost.filter((id) => id.startsWith('wheel'))).toHaveLength(2);
    const parts = w.robots.flatMap((x) => [...x.parts.values()]);
    const top = Math.max(...parts.map((p) => p.y));
    // The hull never touched the ground: its hit landed where its wheels are, and falls off from there.
    const low = parts.filter((p) => p.y <= 2);
    const roof = parts.filter((p) => p.y >= top - 2);
    expect(roof).toHaveLength(9);
    for (const p of roof) expect(p.health).toBe(p.def.health);
    expect(lost.some((id) => id.startsWith('battery'))).toBe(true);
    for (const p of low) expect(p.health).toBeLessThan(p.def.health);
    w.dispose();
  });
});
