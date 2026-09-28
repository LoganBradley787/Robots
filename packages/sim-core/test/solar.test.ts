import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { fillContainers, type Container } from '../src/resources/pools';
import { defaultRegistry } from '../src/parts/registry';
import { parsePartDef, PartDefError } from '../src/parts/parsePartDef';

// No gravity and a ground far below, so a robot stays where it is put and only the energy moves.
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 }, boxes: [] });
const LEGEND = { Sd: { part: 'solar', rot: 180 }, 'S~': { part: 'solar', rot: 90 }, 'S-': { part: 'solar', rot: 270 } };
/** A panel on top of a core (600 J). */
const ONE = { format: 1, name: 'one', grid: ['So', 'C'] };
const DOWN = { format: 1, name: 'down', grid: ['C', 'Sd'], legend: LEGEND };
const LEFT = { format: 1, name: 'left', grid: ['S~  C'], legend: LEGEND };
const RIGHT = { format: 1, name: 'right', grid: ['C  S-'], legend: LEGEND };
/** Two panels over a core (600 J) and a battery (1500 J) in one chunk. */
const TWO = { format: 1, name: 'two', grid: ['So  So', 'C   B'] };
/** A panel with nothing that holds energy to fill. */
const EMPTY = { format: 1, name: 'empty', grid: ['So', 'F'] };

async function world(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0 }, space);
}
function drain(r: Robot, to = 0): void {
  for (const p of r.parts.values()) if (p.stored !== undefined) p.stored = to;
}
function stored(r: Robot): number {
  let s = 0;
  for (const p of r.parts.values()) s += p.stored ?? 0;
  return s;
}
function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.step();
}

describe('solar panel (Batch)', () => {
  it('a core with a panel refills after draining, 6 J a second', async () => {
    const w = await world();
    const r = w.spawnBlueprint(ONE, { x: 0, y: 100 });
    drain(r);
    run(w, 60);
    expect(stored(r)).toBeCloseTo(6, 6);
    expect(w.energy(r.id)?.stored).toBeCloseTo(6, 6);
    run(w, 60 * 9);
    expect(stored(r)).toBeCloseTo(60, 6);
    w.dispose();
  });

  it('refills all the way and stops at capacity', async () => {
    const w = await world();
    const r = w.spawnBlueprint(ONE, { x: 0, y: 100 });
    drain(r, 599.9);
    run(w, 60);
    expect(stored(r)).toBe(600);
    run(w, 600);
    expect(stored(r)).toBe(600);
    expect(w.energy(r.id)).toMatchObject({ stored: 600, capacity: 600 });
    w.dispose();
  });

  it('a panel upside down, or on its side, makes nothing', async () => {
    const w = await world();
    const robots = [DOWN, LEFT, RIGHT].map((bp, i) => w.spawnBlueprint(bp, { x: 30 * (i + 1), y: 100 }));
    for (const r of robots) drain(r);
    run(w, 120);
    for (const r of robots) expect(stored(r)).toBe(0);
    w.dispose();
  });

  it('several panels add up, and the containers fill together', async () => {
    const w = await world();
    const r = w.spawnBlueprint(TWO, { x: 0, y: 100 });
    drain(r);
    run(w, 60);
    expect(stored(r)).toBeCloseTo(12, 6);
    const core = [...r.parts.values()].find((p) => p.def.id === 'core');
    const battery = [...r.parts.values()].find((p) => p.def.id === 'battery');
    // Filled in proportion to the room each has: 600 to 1500.
    expect((core?.stored ?? 0) / (battery?.stored ?? 1)).toBeCloseTo(600 / 1500, 6);
    w.dispose();
  });

  it('a panel with nothing to fill makes nothing and breaks nothing', async () => {
    const w = await world();
    const r = w.spawnBlueprint(EMPTY, { x: 0, y: 100 });
    run(w, 30);
    expect(stored(r)).toBe(0);
    expect(w.energy(r.id)?.capacity).toBe(0);
    w.dispose();
  });

  it('the sun does not spend anything: a full core with a panel keeps its 600 J and the run report counts no use', async () => {
    const w = await world();
    const r = w.spawnBlueprint(ONE, { x: 0, y: 100 });
    run(w, 120);
    expect(w.energy(r.id)).toEqual({ stored: 600, capacity: 600, used: 0 });
    w.dispose();
  });

  it('a thruster on a panel-fed pool runs longer than one without', async () => {
    const lifter = async (grid: string[]): Promise<number> => {
      const w = await world();
      const r = w.spawnBlueprint({ format: 1, name: 'lift', grid }, { x: 0, y: 100 });
      w.step([{ robot: r.id, pressed: ['w'], released: [] }]);
      run(w, 60 * 20);
      const left = stored(r);
      w.dispose();
      return left;
    };
    const plain = await lifter(['C', 'T^']);
    const sunny = await lifter(['So', 'C', 'T^']);
    expect(Math.abs(plain - (600 - 20 * 20))).toBeLessThan(1);
    expect(Math.abs(sunny - (600 - 14 * 20))).toBeLessThan(1);
  });

  it('is deterministic', async () => {
    const hashes: string[] = [];
    for (let k = 0; k < 2; k++) {
      const w = await world();
      const r = w.spawnBlueprint(TWO, { x: 0, y: 100 });
      drain(r, 100);
      run(w, 200);
      hashes.push(w.hash());
      w.dispose();
    }
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('the def: 0.5 kg, health 8, attaches by its bottom face only, and needs "acts"', () => {
    const d = defaultRegistry().get('solar');
    expect(d).toMatchObject({ mass: 0.5, health: 8, acts: 'N', solar: { power: 6 } });
    expect(d.footprint).toEqual([{ x: 0, y: 0, faces: ['S'] }]);
    const { solar: _s, acts: _a, ...rest } = d as unknown as Record<string, unknown>;
    expect(() => parsePartDef({ ...rest, solar: { power: 6 } }, 'thing.json')).toThrow(PartDefError);
    expect(() => parsePartDef({ ...rest, acts: 'N', solar: { power: 0 } }, 'thing.json')).toThrow(PartDefError);
  });
});

describe('fillContainers', () => {
  const pool = (): Container[] => [
    { id: 'battery@2,0', stored: 0, capacity: 1500 },
    { id: 'core@1,0', stored: 300, capacity: 600 },
    { id: 'battery@3,0', stored: 1500, capacity: 1500 },
  ];

  it('fills in proportion to the room each has left and never passes capacity', () => {
    const p = pool();
    expect(fillContainers(p, 180)).toBeCloseTo(180, 9);
    expect(p[0]?.stored).toBeCloseTo(150, 9);
    expect(p[1]?.stored).toBeCloseTo(330, 9);
    expect(p[2]?.stored).toBe(1500);
  });

  it('a fill larger than the room tops everything up and reports only what fit', () => {
    const p = pool();
    expect(fillContainers(p, 5000)).toBe(1800);
    expect(p.every((c) => c.stored === c.capacity)).toBe(true);
    expect(fillContainers(p, 10)).toBe(0);
  });

  it('nothing to add, or a negative amount, changes nothing', () => {
    const p = pool();
    expect(fillContainers(p, 0)).toBe(0);
    expect(fillContainers(p, -5)).toBe(0);
    expect(p.map((c) => c.stored)).toEqual([0, 300, 1500]);
  });
});
