import { describe, expect, it } from 'vitest';
import { defaultRegistry, expandBlueprint, placeBlueprint, type Blueprint } from '@robots/sim-core';
import { controlCores, controlsOf, withControls } from '../src/builder/coreControls';
import { placeStamp, stampGhost, type Stamp } from '../src/builder/stamp';

const reg = defaultRegistry();
const bp = (raw: unknown): Blueprint => {
  const r = expandBlueprint(raw);
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
};
const missile = bp({ format: 1, name: 'missile', grid: ['T> C  X'], bindings: [{ key: 'x', mode: 'pulse', target: 'warhead', channel: 'detonate', value: 1 }], scripts: [{ id: 'guide', source: 'function tick() {}' }] });
const car = bp({ format: 1, name: 'car', grid: ['F  F  C  B  F  F', 'W  .  .  .  .  W'] });
const off = { on: false, axisHalfCells: 0 };
const stamp = (over: Partial<Stamp> = {}): Stamp => ({ name: 'missile', bp: missile, rot: 0, flipped: false, ...over });
const cells = (b: Blueprint, from: number): string[] => b.parts.slice(from).map((p) => `${p.part}@${p.x},${p.y}:${p.rot}`);

describe('placing a held blueprint (M7)', () => {
  it('places a copy with its core on the cell, as placeBlueprint does', () => {
    const r = placeStamp(car, stamp(), { x: 2, y: 2 }, off, reg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(cells(r.bp, car.parts.length)).toEqual(['thruster@1,2:270', 'core@2,2:0', 'warhead@3,2:0']);
    expect(r.bp.cores?.[0]?.scope).toBe('missile1');
  });

  it('turns and flips the held copy', () => {
    const turned = placeStamp(car, stamp({ rot: 90 }), { x: 2, y: 3 }, off, reg);
    expect(turned.ok && cells(turned.bp, car.parts.length)).toEqual(['thruster@2,2:0', 'core@2,3:90', 'warhead@2,4:90']);
    const flipped = placeStamp(car, stamp({ flipped: true }), { x: 2, y: 2 }, off, reg);
    expect(flipped.ok && cells(flipped.bp, car.parts.length)).toEqual(['thruster@3,2:90', 'core@2,2:0', 'warhead@1,2:0']);
  });

  it('in mirror mode also places the mirror image across the axis, as one change', () => {
    const r = placeStamp(car, stamp(), { x: 1, y: 3 }, { on: true, axisHalfCells: 5 }, reg);
    expect(r.ok && cells(r.bp, car.parts.length)).toEqual(['thruster@0,3:270', 'core@1,3:0', 'warhead@2,3:0', 'thruster@5,3:90', 'core@4,3:0', 'warhead@3,3:0']);
    expect(r.ok && r.bp.cores?.map((c) => c.scope)).toEqual(['missile1', 'missile2']);
  });

  it('refuses an overlap, and the ghost still shows where it would go, marked refused', () => {
    expect(placeStamp(car, stamp(), { x: 2, y: 1 }, off, reg)).toEqual({ ok: false, error: 'missile would overlap frame@1,1 at (1, 1)' });
    const g = stampGhost(car, stamp(), { x: 2, y: 1 }, off, reg);
    expect(g.ok).toBe(false);
    expect(g.parts.map((p) => `${p.x},${p.y}`)).toEqual(['1,1', '2,1', '3,1']);
    expect(stampGhost(car, stamp(), { x: 2, y: 2 }, off, reg).ok).toBe(true);
  });
});

describe("each core's controls (M7)", () => {
  const placed = placeBlueprint(car, missile, { x: 2, y: 2 }, reg);
  if (!placed.ok) throw new Error(placed.error);
  const withMissile = placed.blueprint;

  it('lists the main core first, then every other core by its scope', () => {
    expect(controlCores(withMissile, reg)).toEqual([{ label: 'main core' }, { core: 'core@2,2', label: 'missile1 (core@2,2)' }]);
    expect(controlCores(car, reg)).toEqual([{ label: 'main core' }]);
  });

  it('reads and writes the right entry', () => {
    const view = controlsOf(withMissile, reg, 'core@2,2');
    expect(view).toMatchObject({ core: 'core@2,2', scope: 'missile1', autoOn: true });
    expect(view.bindings.map((b) => b.key)).toEqual(['x']);
    const edited = withControls(withMissile, reg, 'core@2,2', { bindings: [], autoOn: false });
    expect(edited.cores).toEqual([{ core: 'core@2,2', scope: 'missile1', bindings: [], scripts: view.scripts, autoControls: false }]);
    expect(edited.bindings).toEqual(withMissile.bindings);
    // The main core is the top level.
    const main = withControls(withMissile, reg, undefined, { autoOn: false });
    expect(main.autoControls).toBe(false);
    expect(controlsOf(main, reg, 'core@2,1')).toMatchObject({ autoOn: false });
  });

  it('adding controls to a core that had none creates its entry; emptying it drops the entry', () => {
    const twoCores = bp({ format: 1, name: 't', grid: ['C  F  C'] });
    const added = withControls(twoCores, reg, 'core@2,0', { bindings: [{ key: 'k', mode: 'hold', target: 'core', channel: 'x', value: 1 }] });
    expect(added.cores?.map((c) => c.core)).toEqual(['core@2,0']);
    expect(withControls(added, reg, 'core@2,0', { bindings: [] }).cores).toBeUndefined();
  });
});
