import { describe, expect, it } from 'vitest';
import { expandBlueprint } from '../src/blueprint/expand';
import { copyParts, placePart, placePartStamp, stampOfParts, stampPlacement, type CopyResult } from '../src/blueprint/edit';
import { partCells } from '../src/assembly/assemble';
import { matchesTarget, scopedView } from '../src/control/target';
import type { Blueprint } from '../src/blueprint/types';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();

function bp(raw: Record<string, unknown>): Blueprint {
  const r = expandBlueprint({ format: 1, name: 'x', ...raw });
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
}

function done(r: CopyResult): Extract<CopyResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error);
  return r;
}

const part = (b: Blueprint, id: string) => b.parts.find((p) => p.id === id);

/** A gun drone: a core, a tagged turret (a rotator with a gun on it) on its left, and a propeller with auto keys off. */
const drone = (): Blueprint =>
  bp({
    grid: ['g  .  .  .', 'r  C  F  p'],
    legend: {
      g: { part: 'gun', rot: 90, tags: ['guns', 'turret1.gun'] },
      r: { part: 'rotator', tags: ['turret1.rot'] },
      p: { part: 'propeller', tags: ['rprop'], auto: false },
    },
    bindings: [{ key: 'f', mode: 'hold', target: 'gun@0,1', channel: 'fire', value: 1 }],
  });

describe('copyParts (M16: copies carry everything)', () => {
  it('copies a part at an offset with its explicit tags, rotation and settings, under the id of its new cell', () => {
    const d = drone();
    const r = done(copyParts(d, reg, ['propeller@3,0'], 0, 1));
    expect([...r.ids]).toEqual([['propeller@3,0', 'propeller@3,1']]);
    expect(part(r.blueprint, 'propeller@3,1')).toEqual({ id: 'propeller@3,1', part: 'propeller', x: 3, y: 1, rot: 0, tags: ['rprop', 'propeller@3,1'], auto: false });
    // The original is as it was, the copy is appended, and nothing else changed.
    expect(r.blueprint.parts.slice(0, d.parts.length)).toEqual(d.parts);
    expect(r.blueprint.parts).toHaveLength(d.parts.length + 1);
    expect(r.blueprint.bindings).toEqual(d.bindings);
  });

  it('a copy joins the group its original is in, where a plain placed part does not', () => {
    const d = drone();
    const copy = part(done(copyParts(d, reg, ['gun@0,1'], 1, 0)).blueprint, 'gun@1,1');
    expect(copy).toEqual({ id: 'gun@1,1', part: 'gun', x: 1, y: 1, rot: 90, tags: ['guns', 'turret1.gun', 'gun@1,1'] });
    expect(matchesTarget(copy as { part: string; tags: string[] }, 'guns')).toBe(true);
    const plain = part(placePart(d, reg, 'gun', 1, 1, 90), 'gun@1,1');
    expect(plain?.tags).toEqual(['gun@1,1']);
    // A binding that named the original by id still means the original alone.
    expect(matchesTarget(copy as { part: string; tags: string[] }, 'gun@0,1')).toBe(false);
  });

  it('copies several parts as they stand to each other, in blueprint order', () => {
    const d = drone();
    const r = done(copyParts(d, reg, ['rotator@0,0', 'gun@0,1'], 2, 1));
    expect([...r.ids]).toEqual([['gun@0,1', 'gun@2,2'], ['rotator@0,0', 'rotator@2,1']]);
    expect(r.blueprint.parts.slice(-2)).toEqual([
      { id: 'gun@2,2', part: 'gun', x: 2, y: 2, rot: 90, tags: ['guns', 'turret1.gun', 'gun@2,2'] },
      { id: 'rotator@2,1', part: 'rotator', x: 2, y: 1, rot: 0, tags: ['turret1.rot', 'rotator@2,1'] },
    ]);
  });

  it('refuses a copy that would cover a part, changing nothing', () => {
    const d = drone();
    expect(copyParts(d, reg, ['propeller@3,0'], -1, 0)).toEqual({ ok: false, error: 'a copy of propeller@3,0 would land on frame@2,0 at (2, 0)' });
    // Onto itself too: a copy is a second part.
    expect(copyParts(d, reg, ['propeller@3,0'], 0, 0)).toMatchObject({ ok: false });
    // One blocked copy of two refuses both.
    expect(copyParts(d, reg, ['rotator@0,0', 'gun@0,1'], 1, 0)).toEqual({ ok: false, error: 'a copy of rotator@0,0 would land on core@1,0 at (1, 0)' });
    expect(copyParts(d, reg, ['propeller@3,0'], 1, 0, { area: { minX: 0, minY: 0, maxX: 3, maxY: 3 } })).toEqual({ ok: false, error: 'a copy of propeller@3,0 would leave the build area at (4, 0)' });
  });

  it('copies a multi-cell part by all its cells, and a sized bay with its size and what it makes', () => {
    const b = bp({
      grid: ['.  =  .  =  .  .  .  .', '.  =  .  =  .  .  .  .', '.  =  b  =  .  .  .  .', 'C  F  F  F  F  F  F  F'],
      legend: { b: { part: 'fabbay', tags: ['bay'], makes: 'pod', size: [1, 2] } },
      recipes: { pod: { format: 1, name: 'pod', grid: ['C'] } },
    });
    // Three cells wide: two to the right its left wall would be on the first bay's right wall.
    expect(copyParts(b, reg, ['fabbay@2,1'], 2, 0)).toEqual({ ok: false, error: 'a copy of fabbay@2,1 would land on fabbay@2,1 at (3, 1)' });
    const r = done(copyParts(b, reg, ['fabbay@2,1'], 3, 0));
    expect(part(r.blueprint, 'fabbay@5,1')).toEqual({ id: 'fabbay@5,1', part: 'fabbay', x: 5, y: 1, rot: 0, tags: ['bay', 'fabbay@5,1'], makes: 'pod', size: [1, 2] });
    expect(r.blueprint.recipes).toEqual(b.recipes);
    const laser = bp({ parts: [{ part: 'core', x: 0, y: 0 }, { part: 'laser', x: 1, y: 0, tags: ['beam'] }] });
    expect(copyParts(laser, reg, ['laser@1,0'], 0, 1)).toEqual({ ok: false, error: 'a copy of laser@1,0 would land on laser@1,0 at (1, 1)' });
    expect(part(done(copyParts(laser, reg, ['laser@1,0'], 0, 2)).blueprint, 'laser@1,2')?.tags).toEqual(['beam', 'laser@1,2']);
  });

  it("gives the copy of a part with a hand-written id its cell's id", () => {
    const b = bp({ parts: [{ part: 'core', x: 0, y: 0 }, { id: 'left-gun', part: 'gun', x: 1, y: 0, tags: ['guns'] }] });
    const r = done(copyParts(b, reg, ['left-gun'], 1, 0));
    expect([...r.ids]).toEqual([['left-gun', 'gun@2,0']]);
    expect(part(r.blueprint, 'gun@2,0')).toEqual({ id: 'gun@2,0', part: 'gun', x: 2, y: 0, rot: 0, tags: ['guns', 'gun@2,0'] });
    expect(part(r.blueprint, 'left-gun')).toEqual(part(b, 'left-gun'));
  });

  it("a copy of a placed missile's part stays in that missile's scope: its core's controls reach it by the same tag", () => {
    const b = bp({
      grid: ['K  f  .', 'D  .  .', 'C  F  F'],
      legend: { K: { part: 'core', tags: ['missile1'] }, f: { part: 'fin', tags: ['missile1', 'missile1.fins'] }, D: { part: 'decoupler' } },
      cores: { 'core@0,2': { scope: 'missile1', bindings: [{ key: 'x', mode: 'hold', target: 'fins', channel: 'deflect', value: 1 }], scripts: [] } },
    });
    const r = done(copyParts(b, reg, ['fin@1,2'], 1, 0));
    const copy = part(r.blueprint, 'fin@2,2');
    expect(copy?.tags).toEqual(['missile1', 'missile1.fins', 'fin@2,2']);
    expect(matchesTarget(scopedView(copy as { id: string; part: string; tags: string[] }, 'missile1'), 'fins')).toBe(true);
    expect(r.blueprint.cores).toEqual(b.cores);
  });

  it('changes nothing with no parts to copy, and refuses a step that is not whole cells', () => {
    const d = drone();
    expect(copyParts(d, reg, [], 1, 0)).toEqual({ ok: true, blueprint: d, ids: new Map() });
    expect(copyParts(d, reg, ['nothing@9,9'], 1, 0)).toEqual({ ok: true, blueprint: d, ids: new Map() });
    expect(copyParts(d, reg, ['propeller@3,0'], 0.5, 0)).toMatchObject({ ok: false });
  });
});

describe('stampOfParts and placePartStamp (a copy held in the hand)', () => {
  it('a stamp holds the parts as they are, measured from the anchor', () => {
    const d = drone();
    const s = stampOfParts(d, ['rotator@0,0', 'gun@0,1']);
    expect(s.parts).toEqual([
      { id: 'gun@0,1', part: 'gun', x: 0, y: 1, rot: 90, tags: ['guns', 'turret1.gun', 'gun@0,1'] },
      { id: 'rotator@0,0', part: 'rotator', x: 0, y: 0, rot: 0, tags: ['turret1.rot', 'rotator@0,0'] },
    ]);
    // Held by the gun instead.
    expect(stampOfParts(d, ['rotator@0,0', 'gun@0,1'], 'gun@0,1').parts.map((p) => [p.x, p.y])).toEqual([[0, 0], [0, -1]]);
    expect(stampOfParts(d, ['nothing@9,9'])).toEqual({ parts: [] });
    // The stamp is its own copy: editing the blueprint's part later does not reach it.
    expect(s.parts[0]?.tags).not.toBe(part(d, 'gun@0,1')?.tags);
  });

  it('places the stamp with its anchor on a cell, any number of times', () => {
    const d = drone();
    const s = stampOfParts(d, ['rotator@0,0', 'gun@0,1']);
    const once = done(placePartStamp(d, reg, s, { x: 2, y: 1 }));
    const twice = done(placePartStamp(once.blueprint, reg, s, { x: 3, y: 1 }));
    expect(twice.blueprint.parts.slice(-4).map((p) => p.id)).toEqual(['gun@2,2', 'rotator@2,1', 'gun@3,2', 'rotator@3,1']);
    expect(twice.blueprint.parts.filter((p) => p.tags.includes('guns'))).toHaveLength(3);
    expect(placePartStamp(d, reg, { parts: [] }, { x: 2, y: 1 })).toEqual({ ok: true, blueprint: d, ids: new Map() });
  });

  it('turns the stamp around its anchor', () => {
    const d = drone();
    const s = stampOfParts(d, ['rotator@0,0', 'gun@0,1']);
    // A quarter turn counterclockwise: the gun that was above the rotator is now to its left, turned with it.
    expect(stampPlacement(s, { x: 5, y: 5 }, reg, { rot: 90 }).map((p) => [p.part, p.x, p.y, p.rot])).toEqual([['gun', 4, 5, 180], ['rotator', 5, 5, 90]]);
    const r = done(placePartStamp(d, reg, s, { x: 3, y: 2 }, { rot: 90 }));
    expect(part(r.blueprint, 'gun@2,2')).toEqual({ id: 'gun@2,2', part: 'gun', x: 2, y: 2, rot: 180, tags: ['guns', 'turret1.gun', 'gun@2,2'] });
  });

  it('a stamp held by a cannon flips onto its cannon cells (review E5, as placeBlueprint)', () => {
    const d = bp({ parts: [{ part: 'cannon', x: 2, y: 1 }, { part: 'heavyrotator', x: 2, y: 0 }, { part: 'core', x: 5, y: 0 }] });
    const s = stampOfParts(d, ['cannon@2,1', 'heavyrotator@2,0'], 'cannon@2,1');
    const cellsOf = (parts: ReturnType<typeof stampPlacement>, type: string): string[] =>
      parts.filter((p) => p.part === type).flatMap((p) => partCells(p, reg).map((c) => `${c.cell.x},${c.cell.y}`)).sort();
    for (const rot of [0, 180] as const) {
      const plain = stampPlacement(s, { x: 10, y: 5 }, reg, { rot });
      const flipped = stampPlacement(s, { x: 10, y: 5 }, reg, { rot, mirror: true });
      expect(cellsOf(flipped, 'cannon'), `turned ${rot}`).toEqual(cellsOf(plain, 'cannon'));
    }
    // Upright, the rotator under the cannon's left column goes under its right one.
    const flipped = stampPlacement(s, { x: 10, y: 5 }, reg, { mirror: true });
    expect(flipped.map((p) => [p.part, p.x, p.y])).toEqual([['cannon', 10, 5], ['heavyrotator', 11, 4]]);
  });

  it('flips the stamp left to right, for the mirror twin of a copy', () => {
    const d = bp({ grid: ['.  .  .  .  .', 'g  r  C  .  .'], legend: { g: { part: 'gun', rot: 90, tags: ['guns'] }, r: { part: 'rotator', rot: 90, tags: ['rots'] } } });
    const s = stampOfParts(d, ['rotator@1,0', 'gun@0,0'], 'rotator@1,0');
    // The twin of a gun pointing left on the rotator's left is a gun pointing right on its right.
    const r = done(placePartStamp(d, reg, s, { x: 3, y: 0 }, { mirror: true }));
    expect(r.blueprint.parts.slice(-2)).toEqual([
      { id: 'gun@4,0', part: 'gun', x: 4, y: 0, rot: 270, tags: ['guns', 'gun@4,0'] },
      { id: 'rotator@3,0', part: 'rotator', x: 3, y: 0, rot: 270, tags: ['rots', 'rotator@3,0'] },
    ]);
    // Both halves or neither: the caller places the copy and its twin, and keeps the blueprint only if both land.
    const left = placePartStamp(d, reg, s, { x: 1, y: 1 });
    const right = left.ok ? placePartStamp(left.blueprint, reg, s, { x: 2, y: 0 }, { mirror: true }) : left;
    expect(left.ok).toBe(true);
    expect(right).toEqual({ ok: false, error: 'a copy of rotator@1,0 would land on core@2,0 at (2, 0)' });
  });
});
