import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { DEBRIS_CAP, DEBRIS_REST_SECONDS } from '../src/world/debris';
import { partWorldPose } from '../src/metrics/robotMetrics';

const flat = parseWorldFile(flatJson);
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });

/** A car-like robot with a long frame arm: cutting the arm leaves a coreless piece that broke off. */
const ARM = { format: 1, name: 'arm', grid: ['C  F  F  F  F  F', 'W  .  .  .  .  W'] };
const WALL = { format: 1, name: 'wall', grid: ['F  F  F'] };
const BLOCK = { format: 1, name: 'block', grid: ['F'] };
const CAR_FLAT = { format: 1, name: 'flat', grid: ['F  C  F'] };
const SLAB = { format: 1, name: 'slab', grid: ['Aa  Aa  Aa  Aa  Aa', 'Aa  Aa  Aa  Aa  Aa'], legend: { Aa: { part: 'armorplate' } } };

const HOLD_TICKS = Math.round(DEBRIS_REST_SECONDS * 60);

function has(w: World, id: number): boolean {
  return w.robots.some((r) => r.id === id);
}

async function armAtRest(): Promise<{ w: World; wreckId: number }> {
  const w = await World.create({ seed: 1 }, flat);
  const arm = w.spawnBlueprint(ARM, { x: -60, y: 3 });
  for (let i = 0; i < 180; i++) w.step();
  const part = arm.parts.get('frame@2,1');
  if (!part) throw new Error('no frame@2,1');
  part.health = 0;
  w.step();
  const wreck = w.robots.find((r) => r.brokeFrom === arm.id && r.primaryCoreId === undefined);
  if (!wreck) throw new Error('no broken-off coreless piece');
  return { w, wreckId: wreck.id };
}

describe('debris fades (Batch)', () => {
  it('a broken-off coreless frame is gone after 10 s at rest, and not before', async () => {
    const { w, wreckId } = await armAtRest();
    // Let it fall and settle; the clock only runs while every body is nearly still.
    for (let i = 0; i < 60 * 8; i++) w.step();
    expect(has(w, wreckId)).toBe(true);
    let gone = -1;
    for (let i = 0; i < 60 * 30 && gone < 0; i++) {
      w.step();
      if (!has(w, wreckId)) gone = i;
    }
    expect(gone).toBeGreaterThan(0);
    expect(w.events.filter((e) => e.kind === 'removed' && e.robot === wreckId)).toHaveLength(1);
    w.dispose();
  });

  it('counts rest in ticks: exactly 10 s of stillness removes a piece', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const piece = w.spawnBlueprint(BLOCK, { x: 0, y: 20 });
    piece.brokeFrom = 999;
    for (let i = 0; i < HOLD_TICKS - 1; i++) w.step();
    expect(has(w, piece.id)).toBe(true);
    w.step();
    expect(has(w, piece.id)).toBe(false);
    w.dispose();
  });

  it('a moving piece is kept and its clock restarts', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const piece = w.spawnBlueprint(BLOCK, { x: 0, y: 20 });
    piece.brokeFrom = 999;
    for (let i = 0; i < HOLD_TICKS - 5; i++) w.step();
    w.physics.kick(piece.groups[0]?.bodyId as number, 1, 0, 0);
    w.step();
    for (let i = 0; i < 60 * 5; i++) w.step();
    expect(has(w, piece.id)).toBe(true);
    w.dispose();
  });

  it('a broken-off piece holding an armed part (a dropped charge) is live, not debris (integration: charge and debris)', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const charge = w.spawnBlueprint({ format: 1, name: 'ground charge', grid: ['Xd'], legend: { Xd: { part: 'charge', armed: true } } }, { x: 0, y: 20 });
    charge.brokeFrom = 999;
    const dud = w.spawnBlueprint({ format: 1, name: 'dud', grid: ['Xd'] }, { x: 40, y: 20 });
    dud.brokeFrom = 999;
    for (let i = 0; i < HOLD_TICKS + 60; i++) w.step();
    expect(has(w, charge.id)).toBe(true);
    // An unarmed one is just debris.
    expect(has(w, dud.id)).toBe(false);
    w.dispose();
  });

  it('a wall spawned coreless is never removed', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const wall = w.spawnBlueprint(WALL, { x: -60, y: 3 });
    expect(wall.brokeFrom).toBeUndefined();
    for (let i = 0; i < 60 * 25; i++) w.step();
    expect(has(w, wall.id)).toBe(true);
    w.dispose();
  });

  it('a broken-off piece that woke with a core is not debris', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const arm = w.spawnBlueprint({ format: 1, name: 'two', grid: ['C  F  F  C'] }, { x: -60, y: 3 });
    for (let i = 0; i < 60; i++) w.step();
    const part = arm.parts.get('frame@1,0');
    if (!part) throw new Error('no frame@1,0');
    part.health = 0;
    w.step();
    const pieces = w.robots.filter((r) => r.brokeFrom === arm.id);
    expect(pieces.length).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 25; i++) w.step();
    for (const p of pieces) expect(has(w, p.id)).toBe(true);
    w.dispose();
  });

  it('past 200 pieces the oldest go first', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const made = [];
    for (let i = 0; i < DEBRIS_CAP + 5; i++) {
      const p = w.spawnBlueprint(BLOCK, { x: (i % 20) * 4, y: 20 + Math.floor(i / 20) * 4 });
      p.brokeFrom = 999;
      made.push(p.id);
    }
    const wall = w.spawnBlueprint(WALL, { x: 0, y: 200 });
    w.step();
    expect(w.robots.filter((r) => r.brokeFrom !== undefined)).toHaveLength(DEBRIS_CAP);
    for (const id of made.slice(0, 5)) expect(has(w, id)).toBe(false);
    for (const id of made.slice(5)) expect(has(w, id)).toBe(true);
    expect(has(w, wall.id)).toBe(true);
    w.dispose();
  });

  it('is deterministic: two runs match tick for tick', async () => {
    const hashes: string[][] = [];
    for (let run = 0; run < 2; run++) {
      const { w } = await armAtRest();
      const hs: string[] = [];
      for (let i = 0; i < 60 * 25; i++) {
        w.step();
        if (i % 30 === 0) hs.push(w.hash());
      }
      hashes.push(hs);
      w.dispose();
    }
    expect(hashes[0]).toEqual(hashes[1]);
  });
});

describe('falling off the world', () => {
  // The ground ends at x = +-5 here, and it is 2 m thick with nothing under it.
  const tall = { format: 1, name: 'tall', grid: ['F', 'F', 'F', 'F', 'C'] };

  async function fallen(w: World, id: number, ticks: number): Promise<number | undefined> {
    for (let i = 0; i < ticks; i++) {
      w.step();
      if (!has(w, id)) return w.tick;
    }
    return undefined;
  }

  it('a robot with a core that drops past the edge goes once every part is under the surface, and says so', async () => {
    const w = await World.create({ seed: 1 }, space);
    const r = w.spawnBlueprint(tall, { x: 8, y: 3 });
    expect(await fallen(w, r.id, 300)).toBeDefined();
    const kinds = w.events.filter((e) => e.robot === r.id).map((e) => e.kind);
    expect(kinds.slice(-2)).toEqual(['fell', 'removed']);
    const fell = w.events.find((e) => e.kind === 'fell');
    expect(fell).toMatchObject({ name: 'tall', team: 0, core: true });
  });

  it('it stays until its top part is under the surface', async () => {
    const w = await World.create({ seed: 1 }, space);
    const r = w.spawnBlueprint(tall, { x: 8, y: 3 });
    let last = Infinity;
    while (has(w, r.id) && w.tick < 300) {
      last = Math.max(...[...r.parts.values()].map((p) => partWorldPose(w, r, p.id).y));
      w.step();
    }
    expect(has(w, r.id)).toBe(false);
    // Its top part's center, the tick before it went: under the surface, and only a tick's fall above the line.
    expect(last).toBeLessThan(0);
    expect(last).toBeGreaterThan(-1.5);
  });

  it('a robot put under the middle of the ground goes on the first tick: nothing may fly about in there', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(BLOCK, { x: -60, y: -10 });
    w.step();
    expect(has(w, r.id)).toBe(false);
  });

  it('a robot hanging over the edge with a part still above the surface stays', async () => {
    const w = await World.create({ seed: 1 }, space);
    const low = w.spawnBlueprint(BLOCK, { x: 8, y: 30 });
    const r = w.spawnBlueprint(tall, { x: 8, y: -1 });
    w.step();
    expect(has(w, r.id)).toBe(true);
    expect(has(w, low.id)).toBe(true);
  });

  it('a robot at rest on the ground, or pressed flat under a heavy one, stays', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(CAR_FLAT, { x: -60, y: 1 });
    const heavy = w.spawnBlueprint(SLAB, { x: -60, y: 3 });
    for (let i = 0; i < 300; i++) w.step();
    expect(has(w, r.id)).toBe(true);
    expect(has(w, heavy.id)).toBe(true);
    expect(w.events.some((e) => e.kind === 'fell')).toBe(false);
  });

  it('gives the same world, run twice', async () => {
    const run = async (): Promise<string> => {
      const w = await World.create({ seed: 1 }, space);
      w.spawnBlueprint(tall, { x: 8, y: 3 });
      w.spawnBlueprint(ARM, { x: 0, y: 3 });
      for (let i = 0; i < 300; i++) w.step();
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });
});
