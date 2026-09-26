import { describe, expect, it } from 'vitest';
import carJson from '../../../blueprints/car.json';
import { expandBlueprint } from '../src/blueprint/expand';
import type { Blueprint } from '../src/blueprint/types';
import {
  addTagToParts,
  blankBlueprint,
  erasePartAt,
  partAt,
  placePart,
  removeParts,
  removeTagFromParts,
  setBindings,
  setPartRotation,
} from '../src/blueprint/edit';
import { mirrorBlueprint, mirrorRotation, mirrorX } from '../src/blueprint/mirror';
import { staticStats } from '../src/blueprint/stats';
import { toFileJson } from '../src/blueprint/serialize';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();

function car(): Blueprint {
  const r = expandBlueprint(carJson);
  if (!r.blueprint) throw new Error('car should expand');
  return r.blueprint;
}

describe('edit operations', () => {
  it('blankBlueprint is empty', () => {
    expect(blankBlueprint('new')).toEqual({ format: 1, name: 'new', parts: [], bindings: [], scripts: [], continuations: [] });
  });

  it('placePart appends a part with a default id', () => {
    const bp = placePart(blankBlueprint('b'), reg, 'frame', 2, 3, 0);
    expect(bp.parts).toEqual([{ id: 'frame@2,3', part: 'frame', x: 2, y: 3, rot: 0, tags: ['frame@2,3'] }]);
    expect(partAt(bp, reg, 2, 3)?.id).toBe('frame@2,3');
    expect(partAt(bp, reg, 2, 4)).toBeUndefined();
  });

  it('placing over a different part replaces it and drops its tags', () => {
    const c = car();
    const bp = placePart(c, reg, 'battery', 0, 0, 0);
    expect(partAt(bp, reg, 0, 0)).toEqual({ id: 'battery@0,0', part: 'battery', x: 0, y: 0, rot: 0, tags: ['battery@0,0'] });
    expect(bp.parts).toHaveLength(8);
    expect(c.parts.some((p) => p.id === 'wheel@0,0')).toBe(true);
  });

  it('placing an identical part returns the same blueprint', () => {
    const c = car();
    expect(placePart(c, reg, 'frame', 0, 1, 0)).toBe(c);
  });

  it('placing the same part with another rotation replaces it', () => {
    const bp = placePart(placePart(blankBlueprint('b'), reg, 'thruster', 0, 0, 0), reg, 'thruster', 0, 0, 90);
    expect(bp.parts).toEqual([{ id: 'thruster@0,0', part: 'thruster', x: 0, y: 0, rot: 90, tags: ['thruster@0,0'] }]);
  });

  it('erasePartAt removes the covering part, or returns the same blueprint', () => {
    const c = car();
    expect(erasePartAt(c, reg, 2, 1).parts.some((p) => p.id === 'core@2,1')).toBe(false);
    expect(erasePartAt(c, reg, 9, 9)).toBe(c);
  });

  it('removeParts removes by id', () => {
    expect(removeParts(car(), ['wheel@0,0', 'wheel@5,0']).parts).toHaveLength(6);
  });

  it('tags: add to many, keep the id tag, dedupe, remove', () => {
    let bp = addTagToParts(car(), ['frame@0,1', 'frame@1,1'], 'left');
    bp = addTagToParts(bp, ['frame@0,1'], 'left');
    expect(bp.parts.find((p) => p.id === 'frame@0,1')?.tags).toEqual(['left', 'frame@0,1']);
    bp = removeTagFromParts(bp, ['frame@0,1'], 'left');
    bp = removeTagFromParts(bp, ['frame@0,1'], 'frame@0,1');
    expect(bp.parts.find((p) => p.id === 'frame@0,1')?.tags).toEqual(['frame@0,1']);
    expect(bp.parts.find((p) => p.id === 'wheel@0,0')?.tags).toEqual(['wheels', 'wheel@0,0']);
  });

  it('setPartRotation and setBindings', () => {
    const bp = setPartRotation(placePart(blankBlueprint('b'), reg, 'thruster', 0, 0, 0), reg, 'thruster@0,0', 270);
    expect(bp.parts[0]?.rot).toBe(270);
    const b2 = setBindings(bp, [{ key: 'w', mode: 'hold', target: 'thruster@0,0', channel: 'throttle', value: 1 }]);
    expect(b2.bindings).toHaveLength(1);
    expect(bp.bindings).toHaveLength(0);
  });

  it('a new part never reuses an id held by a part elsewhere', () => {
    const raw = { format: 1, name: 'b', parts: [{ id: 'frame@0,0', part: 'frame', x: 5, y: 5 }] };
    const src = expandBlueprint(raw).blueprint as Blueprint;
    const bp = placePart(src, reg, 'frame', 0, 0, 0);
    expect(bp.parts.map((p) => p.id)).toEqual(['frame@0,0', 'frame@0,0#2']);
  });
});

describe('mirror', () => {
  it('mirrorRotation swaps left and right facing', () => {
    expect([0, 90, 180, 270].map((r) => mirrorRotation(r as 0 | 90 | 180 | 270))).toEqual([0, 270, 180, 90]);
  });

  it('mirrorX across a column center and across a cell boundary', () => {
    expect(mirrorX(0, 4)).toBe(4); // axis through x = 2
    expect(mirrorX(1, 5)).toBe(4); // axis at x = 2.5
  });

  it('mirrorBlueprint flips parts and rotations, keeping explicit tags', () => {
    const src = expandBlueprint({ format: 1, name: 'm', grid: ['T> C'], legend: { C: { part: 'core', tags: ['brain'] } } }).blueprint as Blueprint;
    const bp = mirrorBlueprint(src, 2, reg);
    expect(bp.parts).toEqual([
      { id: 'thruster@2,0', part: 'thruster', x: 2, y: 0, rot: 90, tags: ['thruster@2,0'] },
      { id: 'core@1,0', part: 'core', x: 1, y: 0, rot: 0, tags: ['brain', 'core@1,0'] },
    ]);
  });

  it('mirrorBlueprint moves everything that names a part by id', () => {
    const src = expandBlueprint({
      format: 1,
      name: 'm',
      grid: ['C  F  C  T>'],
      primaryCore: 'core@0,0',
      bindings: [{ key: 'f', mode: 'hold', target: 'thruster@3,0', channel: 'throttle', value: 1 }],
      cores: { 'core@2,0': { bindings: [{ key: 'g', mode: 'hold', target: 'thruster@3,0', channel: 'throttle', value: 1 }] } },
    }).blueprint as Blueprint;
    const bp = mirrorBlueprint(src, 3, reg);
    expect(bp.primaryCore).toBe('core@3,0');
    expect(bp.bindings[0]?.target).toBe('thruster@0,0');
    expect(bp.cores?.map((c) => [c.core, c.bindings[0]?.target])).toEqual([['core@1,0', 'thruster@0,0']]);
  });
});

describe('staticStats', () => {
  it('reports the car mass and center of mass from part defs', () => {
    const s = staticStats(car(), reg);
    expect(s.parts).toBe(8);
    expect(s.massKg).toBe(12);
    expect(s.comX).toBeCloseTo(2.5417, 3);
    expect(s.comY).toBeCloseTo(0.75, 6);
    expect(s.energy).toBe(2100); // core 600 + battery 1500
    expect(s.fullDraw).toBe(10); // two wheels at 5/s
  });

  it('is zero mass and origin for an empty blueprint', () => {
    expect(staticStats(blankBlueprint('b'), reg)).toEqual({ parts: 0, massKg: 0, comX: 0, comY: 0, energy: 0, fullDraw: 0 });
  });
});

describe('toFileJson', () => {
  it('writes the car in grid form and round-trips', () => {
    const c = car();
    const json = toFileJson(c, reg) as Record<string, unknown>;
    expect(json.grid).toEqual(['F F C B F F', 'a . . . . a']);
    expect(json.parts).toBeUndefined();
    const back = expandBlueprint(json).blueprint;
    expect(back?.parts).toEqual(c.parts);
    expect(back?.name).toBe('car');
  });

  it('includes bindings and falls back to the parts form when needed', () => {
    let bp = placePart(blankBlueprint('odd'), reg, 'core', -1, 0, 0);
    bp = setBindings(bp, [{ key: 'w', mode: 'hold', target: 'core@-1,0', channel: 'x', value: 1 }]);
    const json = toFileJson(bp, reg) as Record<string, unknown>;
    expect(json.grid).toBeUndefined();
    expect(json.parts).toEqual([{ part: 'core', x: -1, y: 0 }]);
    expect(json.bindings).toHaveLength(1);
    const back = expandBlueprint(json).blueprint;
    expect(back?.parts).toEqual(bp.parts);
  });

  it('writes non-default ids, rotations, and explicit tags in the parts form', () => {
    const src = expandBlueprint({ format: 1, name: 'p', parts: [{ id: 'hull', part: 'frame', x: 0, y: 0, rot: 90, tags: ['body'] }] })
      .blueprint as Blueprint;
    const json = toFileJson(src, reg) as Record<string, unknown>;
    expect(json.parts).toEqual([{ id: 'hull', part: 'frame', x: 0, y: 0, rot: 90, tags: ['body'] }]);
  });
});
