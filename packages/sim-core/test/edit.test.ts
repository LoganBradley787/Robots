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
  setPartRotations,
  setPartsSize,
} from '../src/blueprint/edit';
import { mirrorBlueprint, mirrorRotation, mirrorX } from '../src/blueprint/mirror';
import { staticStats } from '../src/blueprint/stats';
import { toFileJson } from '../src/blueprint/serialize';
import { validateBlueprint } from '../src/blueprint/validate';
import { defaultSize } from '../src/parts/footprint';
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
    expect(removeParts(car(), ['wheel@0,0', 'wheel@5,0'], reg).parts).toHaveLength(6);
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

describe('parts never share a cell after an edit (review E1)', () => {
  const laserBot = (): Blueprint => {
    const r = expandBlueprint({ format: 1, name: 'l', grid: ['. . = .', '. F Lz^ F', 'C F F F'] });
    if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
    return r.blueprint;
  };

  it('a turn onto another part is refused, with the reason', () => {
    const bp = laserBot();
    expect(setPartRotation(bp, reg, 'laser@2,1', 90)).toBe(bp);
    expect(setPartRotations(bp, reg, new Map([['laser@2,1', 90]]))).toEqual({ ok: false, error: 'laser@2,1 turned would overlap frame@1,1 at (1, 1)' });
    // Into free cells it turns: with the frame gone the barrel has room.
    const open = removeParts(bp, ['frame@1,1'], reg);
    expect(setPartRotation(open, reg, 'laser@2,1', 90).parts.find((p) => p.id === 'laser@2,1')?.rot).toBe(90);
  });

  it('parts turned together are checked where they end up', () => {
    // One laser with its barrel up, one two cells right with its barrel pointing left, into the cell between them.
    const bp = expandBlueprint({ format: 1, name: 'l', grid: ['=   .   .', 'Lz^ =   Lz<'] }).blueprint as Blueprint;
    // Turned alone, the first one's barrel lands on the second one's.
    expect(setPartRotations(bp, reg, new Map([['laser@0,0', 270]])).ok).toBe(false);
    // Turned together, the second barrel has left the cell the first one swings into.
    const both = setPartRotations(bp, reg, new Map([['laser@0,0', 270], ['laser@2,0', 0]]));
    expect(both.ok && both.blueprint.parts.map((p) => p.rot)).toEqual([270, 0]);
  });

  it('a blueprint with two parts on one cell is saved whole, in the parts form, and the validator names the overlap', () => {
    const bp = laserBot();
    const overlapping: Blueprint = { ...bp, parts: bp.parts.map((p) => (p.id === 'laser@2,1' ? { ...p, rot: 90 as const } : p)) };
    const json = toFileJson(overlapping, reg) as Record<string, unknown>;
    expect(json.grid).toBeUndefined();
    expect(json.parts).toHaveLength(7);
    expect(expandBlueprint(json).blueprint?.parts).toHaveLength(7);
    expect(validateBlueprint(json, reg).issues.map((i) => i.code)).toContain('OVERLAP');
  });

  it('a bay grown onto another part keeps both, and the validator names the overlap', () => {
    // A frame one cell right of the bay's right wall: one cell wider and the wall is on it.
    const [w] = defaultSize(reg.get('fabbay')) ?? [0, 0];
    const bp = expandBlueprint({ format: 1, name: 'b', parts: [{ part: 'fabbay', x: 1, y: 0 }, { part: 'frame', x: w + 2, y: 0 }] }).blueprint as Blueprint;
    expect(validateBlueprint(toFileJson(bp, reg), reg).issues.map((i) => i.code)).not.toContain('OVERLAP');
    const grown = setPartsSize(bp, ['fabbay@1,0'], (s) => [s[0] + 1, s[1]], reg);
    const json = toFileJson(grown, reg) as Record<string, unknown>;
    expect(json.parts).toHaveLength(2);
    expect(validateBlueprint(json, reg).issues.map((i) => i.code)).toContain('OVERLAP');
  });
});

describe('erasing the primary core promotes the next one with its controls (review E3)', () => {
  const errors = (bp: Blueprint): string[] => validateBlueprint(toFileJson(bp, reg, { inlineScripts: true }), reg).issues.filter((i) => i.severity === 'error').map((i) => i.message);
  const twoCores = (extra: object): Blueprint => {
    const r = expandBlueprint({ format: 1, name: 't', grid: ['C C T<'], ...extra });
    if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
    return r.blueprint;
  };
  const drive = { key: 'w', mode: 'hold', target: 'thruster', channel: 'throttle', value: 1 };
  const backup = { key: 'b', mode: 'hold', target: 'thruster', channel: 'throttle', value: 0.5 };

  it('its controls move to the top level and its entry goes, so the robot still validates', () => {
    const bp = twoCores({ bindings: [drive], cores: { 'core@1,0': { bindings: [backup], scripts: [{ id: 'limp', source: 'function tick() {}' }], autoControls: false } } });
    expect(errors(bp)).toEqual([]);
    const out = erasePartAt(bp, reg, 0, 0);
    expect(out.cores).toBeUndefined();
    // The robot's own controls stay, the promoted core's come after them.
    expect(out.bindings).toEqual([drive, backup]);
    expect(out.scripts.map((s) => s.id)).toEqual(['limp']);
    expect(out.autoControls).toBe(false);
    expect(errors(out)).toEqual([]);
  });

  it('a named pilot that is erased hands over the same way, and other cores keep their entries', () => {
    const r = expandBlueprint({ format: 1, name: 't', grid: ['C F C T<', '. C . .'], primaryCore: 'core@1,0', cores: { 'core@0,1': { bindings: [backup] }, 'core@2,1': { bindings: [drive] } } });
    const out = removeParts(r.blueprint as Blueprint, ['core@1,0'], reg);
    expect(out.primaryCore).toBeUndefined();
    expect(out.bindings).toEqual([backup]);
    expect(out.cores?.map((c) => c.core)).toEqual(['core@2,1']);
    expect(errors(out)).toEqual([]);
  });

  it('a binding both had is kept once, and a script id both had gets a new name its bindings follow', () => {
    const run = { key: 'g', mode: 'script', script: 'go' };
    const bp = twoCores({
      bindings: [drive, run],
      scripts: [{ id: 'go', source: 'function tick() { /* main */ }' }],
      cores: { 'core@1,0': { bindings: [drive, { ...run, key: 'h' }], scripts: [{ id: 'go', source: 'function tick() { /* backup */ }' }] } },
    });
    const out = erasePartAt(bp, reg, 0, 0);
    expect(out.bindings).toEqual([drive, run, { key: 'h', mode: 'script', script: 'go-2' }]);
    expect(out.scripts.map((s) => [s.id, s.source])).toEqual([['go', 'function tick() { /* main */ }'], ['go-2', 'function tick() { /* backup */ }']]);
    expect(errors(out)).toEqual([]);
  });

  it("a placed copy's core keeps aiming at its own parts: its targets get its scope", () => {
    const r = expandBlueprint({
      format: 1,
      name: 't',
      grid: ['C c t'],
      legend: { c: { part: 'core', tags: ['m1'] }, t: { part: 'thruster', rot: 90, tags: ['m1', 'm1.burn'] } },
      cores: { 'core@1,0': { scope: 'm1', bindings: [{ ...drive, target: 'burn' }, { ...backup, target: 'thruster@2,0' }] } },
    });
    const bp = r.blueprint as Blueprint;
    expect(errors(bp)).toEqual([]);
    const out = erasePartAt(bp, reg, 0, 0);
    expect(out.cores).toBeUndefined();
    expect(out.bindings.map((b) => b.target)).toEqual(['m1.burn', 'thruster@2,0']);
    expect(errors(out)).toEqual([]);
  });

  it('erasing a core that was not the pilot, or the only core, moves nothing', () => {
    const bp = twoCores({ bindings: [drive], cores: { 'core@1,0': { bindings: [backup] } } });
    const out = erasePartAt(bp, reg, 1, 0);
    expect([out.bindings, out.cores]).toEqual([[drive], undefined]);
    const lone = removeParts(out, ['core@0,0'], reg);
    expect(lone.bindings).toEqual([drive]);
  });
});
