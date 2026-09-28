import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { DEBRIS_CAP, DEBRIS_REST_SECONDS } from '../src/world/debris';

const flat = parseWorldFile(flatJson);
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });

/** A car-like robot with a long frame arm: cutting the arm leaves a coreless piece that broke off. */
const ARM = { format: 1, name: 'arm', grid: ['C  F  F  F  F  F', 'W  .  .  .  .  W'] };
const WALL = { format: 1, name: 'wall', grid: ['F  F  F'] };
const BLOCK = { format: 1, name: 'block', grid: ['F'] };

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

  it('a broken-off piece holding an armed part (a dropped mine) is live, not debris (integration: mine and debris)', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const mine = w.spawnBlueprint({ format: 1, name: 'landmine', grid: ['Xm'], legend: { Xm: { part: 'mine', armed: true } } }, { x: 0, y: 20 });
    mine.brokeFrom = 999;
    const dud = w.spawnBlueprint({ format: 1, name: 'dud', grid: ['Xm'] }, { x: 40, y: 20 });
    dud.brokeFrom = 999;
    for (let i = 0; i < HOLD_TICKS + 60; i++) w.step();
    expect(has(w, mine.id)).toBe(true);
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
