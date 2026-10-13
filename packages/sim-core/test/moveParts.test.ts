import { describe, expect, it } from 'vitest';
import { expandBlueprint } from '../src/blueprint/expand';
import { moveParts, movePartsBy } from '../src/blueprint/edit';
import { mirrorX } from '../src/blueprint/mirror';
import { toFileJson } from '../src/blueprint/serialize';
import { validateBlueprint } from '../src/blueprint/validate';
import type { Blueprint } from '../src/blueprint/types';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();

function bp(raw: Record<string, unknown>): Blueprint {
  const r = expandBlueprint({ format: 1, name: 'x', ...raw });
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
}

/** The moved blueprint, or a throw with the reason. */
function moved(r: ReturnType<typeof moveParts>): { blueprint: Blueprint; ids: Map<string, string> } {
  if (!r.ok) throw new Error(r.error);
  return r;
}

const part = (b: Blueprint, id: string) => b.parts.find((p) => p.id === id);

/** A drone: a core, a frame each side, a tagged propeller on each end, and a thruster with every setting off its default. */
const drone = (): Blueprint =>
  bp({
    grid: ['l  F  C  F  r', '.  .  t  .  .'],
    legend: {
      l: { part: 'propeller', tags: ['lprop', 'props'] },
      r: { part: 'propeller', tags: ['rprop', 'props'] },
      t: { part: 'thruster', rot: 180, tags: ['down'], auto: false },
    },
    bindings: [
      { key: 'j', mode: 'hold', target: 'propeller@0,1', channel: 'throttle', value: 1 },
      { key: 'k', mode: 'hold', target: 'props', channel: 'throttle', value: 1 },
      { key: 'l', mode: 'hold', target: 'thruster', channel: 'throttle', value: 1 },
    ],
  });

describe('moveParts (M16)', () => {
  it('moves a part by whole cells with its tags, settings and rotation, and gives it the id of its new cell', () => {
    const d = drone();
    const r = moved(moveParts(d, reg, ['thruster@2,0'], 1, 0));
    expect([...r.ids]).toEqual([['thruster@2,0', 'thruster@3,0']]);
    expect(part(r.blueprint, 'thruster@3,0')).toEqual({ id: 'thruster@3,0', part: 'thruster', x: 3, y: 0, rot: 180, tags: ['down', 'thruster@3,0'], auto: false });
    expect(part(r.blueprint, 'thruster@2,0')).toBeUndefined();
    // The same place in part order, and nothing else touched.
    expect(r.blueprint.parts.map((p) => p.id)).toEqual(d.parts.map((p) => (p.id === 'thruster@2,0' ? 'thruster@3,0' : p.id)));
    expect(r.blueprint.parts.filter((p) => p.id !== 'thruster@3,0')).toEqual(d.parts.filter((p) => p.id !== 'thruster@2,0'));
    expect(d.parts.some((p) => p.id === 'thruster@2,0')).toBe(true);
  });

  it('retargets a binding that named the old id and leaves tag and type bindings alone', () => {
    const r = moved(moveParts(drone(), reg, ['propeller@0,1'], 0, 1));
    expect(r.blueprint.bindings).toEqual([
      { key: 'j', mode: 'hold', target: 'propeller@0,2', channel: 'throttle', value: 1 },
      { key: 'k', mode: 'hold', target: 'props', channel: 'throttle', value: 1 },
      { key: 'l', mode: 'hold', target: 'thruster', channel: 'throttle', value: 1 },
    ]);
    expect(part(r.blueprint, 'propeller@0,2')?.tags).toEqual(['lprop', 'props', 'propeller@0,2']);
  });

  it('refuses, changing nothing, when a cell is taken by a part that is not moving', () => {
    const d = drone();
    const r = moveParts(d, reg, ['propeller@0,1'], 1, 0);
    expect(r).toEqual({ ok: false, error: 'propeller@0,1 would land on frame@1,1 at (1, 1)' });
    // One blocked part refuses the whole move.
    expect(moveParts(d, reg, ['propeller@4,1', 'thruster@2,0'], -1, 0).ok).toBe(false);
  });

  it('lets parts that move together pass through and trade each other\'s cells', () => {
    const d = drone();
    // The whole top row one cell right: every part lands where its neighbour stood.
    const row = ['propeller@0,1', 'frame@1,1', 'core@2,1', 'frame@3,1', 'propeller@4,1'];
    const r = moved(moveParts(d, reg, row, 1, 0));
    expect(r.blueprint.parts.map((p) => p.id)).toEqual(['propeller@1,1', 'frame@2,1', 'core@3,1', 'frame@4,1', 'propeller@5,1', 'thruster@2,0']);
    expect([...r.ids]).toEqual([
      ['propeller@0,1', 'propeller@1,1'],
      ['frame@1,1', 'frame@2,1'],
      ['core@2,1', 'core@3,1'],
      ['frame@3,1', 'frame@4,1'],
      ['propeller@4,1', 'propeller@5,1'],
    ]);
    // Two frames trade ids in one step: the one that was at 1,1 is now frame@2,1, not the one that was already near.
    expect(part(r.blueprint, 'frame@2,1')?.x).toBe(2);
    expect(r.blueprint.bindings[0]?.target).toBe('propeller@1,1');
  });

  it('moves a multi-cell part by every cell it covers', () => {
    const b = bp({ parts: [{ part: 'core', x: 0, y: 0 }, { part: 'frame', x: 1, y: 0 }, { part: 'laser', x: 2, y: 0, tags: ['beam'] }, { part: 'frame', x: 4, y: 1 }] });
    // The laser is two cells tall: its barrel at (2, 1) would land on the frame at (4, 1).
    expect(moveParts(b, reg, ['laser@2,0'], 2, 0)).toEqual({ ok: false, error: 'laser@2,0 would land on frame@4,1 at (4, 1)' });
    const r = moved(moveParts(b, reg, ['laser@2,0'], 1, 0));
    expect(part(r.blueprint, 'laser@3,0')).toEqual({ id: 'laser@3,0', part: 'laser', x: 3, y: 0, rot: 0, tags: ['beam', 'laser@3,0'] });
    // It may move onto its own old cells.
    expect(moved(moveParts(b, reg, ['laser@2,0'], 0, 1)).blueprint.parts[2]).toMatchObject({ id: 'laser@2,1', y: 1 });
  });

  it('moves a sized bay with its size and what it makes, and the grid `=` cells under it', () => {
    const recipe = { format: 1, name: 'pod', grid: ['C'] };
    const b = bp({
      grid: ['.  =  .  =  .', '.  =  .  =  .', '.  =  b  =  .', 'C  F  F  F  .'],
      legend: { b: { part: 'fabbay', tags: ['bay'], makes: 'pod', size: [1, 2] } },
      recipes: { pod: recipe },
    });
    const r = moved(moveParts(b, reg, ['fabbay@2,1'], 1, 0));
    expect(part(r.blueprint, 'fabbay@3,1')).toEqual({ id: 'fabbay@3,1', part: 'fabbay', x: 3, y: 1, rot: 0, tags: ['bay', 'fabbay@3,1'], makes: 'pod', size: [1, 2] });
    expect(r.blueprint.recipes).toEqual(b.recipes);
    expect(r.blueprint.continuations).toEqual(b.continuations.map((c) => ({ x: c.x + 1, y: c.y })));
    // The file it would be saved as still reads back as the same robot.
    const file = toFileJson(r.blueprint, reg);
    expect(validateBlueprint(file, reg).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('keeps a hand-written id and its binding, and moves the part', () => {
    const b = bp({
      parts: [{ part: 'core', x: 0, y: 0 }, { id: 'left-gun', part: 'gun', x: 1, y: 0, tags: ['guns'], armed: undefined }, { part: 'frame', x: 0, y: 1 }],
      bindings: [{ key: 'f', mode: 'hold', target: 'left-gun', channel: 'fire', value: 1 }],
    });
    const r = moved(moveParts(b, reg, ['left-gun', 'frame@0,1'], 0, 1));
    expect([...r.ids]).toEqual([['left-gun', 'left-gun'], ['frame@0,1', 'frame@0,2']]);
    expect(part(r.blueprint, 'left-gun')).toEqual({ id: 'left-gun', part: 'gun', x: 1, y: 1, rot: 0, tags: ['guns', 'left-gun'] });
    expect(r.blueprint.bindings).toEqual(b.bindings);
  });

  it('never gives two parts one id: a cell id a hand-written id already uses gets a number', () => {
    const b = bp({ parts: [{ part: 'core', x: 0, y: 0 }, { id: 'frame@2,0', part: 'frame', x: 0, y: 1 }, { part: 'frame', x: 1, y: 0 }] });
    const r = moved(moveParts(b, reg, ['frame@1,0'], 1, 0));
    expect(r.blueprint.parts.map((p) => p.id)).toEqual(['core@0,0', 'frame@2,0', 'frame@2,0#2']);
    expect(part(r.blueprint, 'frame@2,0#2')?.tags).toEqual(['frame@2,0#2']);
  });

  it('follows a moved core everywhere it is named: primaryCore, corePriority, its entry in cores, and scoped tags stay', () => {
    const b = bp({
      grid: ['K  w', 'D  .', 'C  F'],
      legend: {
        K: { part: 'core', tags: ['missile1', 'missile1.brain'] },
        w: { part: 'warhead', tags: ['missile1', 'missile1.tip'], armed: true },
        D: { part: 'decoupler', rot: 0 },
      },
      primaryCore: 'core@0,0',
      corePriority: ['core@0,0', 'core@0,2'],
      cores: {
        'core@0,2': {
          scope: 'missile1',
          bindings: [{ key: 'x', mode: 'pulse', target: 'tip', channel: 'detonate', value: 1 }, { key: 'y', mode: 'pulse', target: 'warhead@1,2', channel: 'arm', value: 1 }],
          scripts: [{ id: 'guide', source: "function tick() { set('tip', 'arm', 1); }" }],
        },
      },
    });
    // The missile (its core and warhead) moves up one; the robot's own core, one to the left with its frame.
    const up = moved(moveParts(b, reg, ['core@0,2', 'warhead@1,2', 'decoupler@0,1'], 0, 1));
    expect(up.blueprint.primaryCore).toBe('core@0,0');
    expect(up.blueprint.corePriority).toEqual(['core@0,0', 'core@0,3']);
    expect(up.blueprint.cores).toEqual([
      {
        core: 'core@0,3',
        scope: 'missile1',
        bindings: [{ key: 'x', mode: 'pulse', target: 'tip', channel: 'detonate', value: 1 }, { key: 'y', mode: 'pulse', target: 'warhead@1,3', channel: 'arm', value: 1 }],
        scripts: b.cores?.[0]?.scripts,
      },
    ]);
    expect(part(up.blueprint, 'warhead@1,3')).toEqual({ id: 'warhead@1,3', part: 'warhead', x: 1, y: 3, rot: 0, tags: ['missile1', 'missile1.tip', 'warhead@1,3'], armed: true });
    const left = moved(moveParts(b, reg, ['core@0,0'], -1, 0));
    expect(left.blueprint.primaryCore).toBe('core@-1,0');
    expect(left.blueprint.corePriority).toEqual(['core@-1,0', 'core@0,2']);
    expect(left.blueprint.cores?.[0]?.core).toBe('core@0,2');
  });

  it('keeps parts inside the area it is given', () => {
    const d = drone();
    const area = { minX: 0, minY: 0, maxX: 4, maxY: 3 };
    expect(moveParts(d, reg, ['propeller@4,1'], 0, 1, { area }).ok).toBe(true);
    expect(moveParts(d, reg, ['propeller@4,1'], 1, 0, { area })).toEqual({ ok: false, error: 'propeller@4,1 would leave the build area at (5, 1)' });
    // No area: a blueprint has no edge, and a cell left of the first column is a place like any other.
    expect(moved(moveParts(d, reg, ['propeller@0,1'], -2, 0)).blueprint.parts[0]).toMatchObject({ id: 'propeller@-2,1', x: -2 });
    // A two-cell part is held to it by its far cell.
    const tall = bp({ parts: [{ part: 'core', x: 0, y: 0 }, { part: 'laser', x: 1, y: 0 }] });
    expect(moveParts(tall, reg, ['laser@1,0'], 0, 1, { area: { minX: 0, minY: 0, maxX: 3, maxY: 1 } })).toEqual({ ok: false, error: 'laser@1,0 would leave the build area at (1, 2)' });
  });

  it('returns the same blueprint when there is nothing to move, and skips ids it does not have', () => {
    const d = drone();
    expect(moveParts(d, reg, ['thruster@2,0'], 0, 0)).toEqual({ ok: true, blueprint: d, ids: new Map() });
    expect(moveParts(d, reg, [], 1, 0).ok && moveParts(d, reg, [], 1, 0)).toMatchObject({ blueprint: d });
    expect(moveParts(d, reg, ['nothing@9,9'], 1, 0)).toEqual({ ok: true, blueprint: d, ids: new Map() });
    expect(moveParts(d, reg, ['thruster@2,0'], 0.5, 0)).toEqual({ ok: false, error: 'thruster@2,0 can only move by whole cells, not by (0.5, 0)' });
  });

  describe('mirror mode: each half by its own step, both or neither', () => {
    const axis = 4; // half cells: the core's column, x = 2.
    const twin = (id: string, b: Blueprint): string => {
      const p = part(b, id);
      const q = b.parts.find((o) => p !== undefined && o.part === p.part && o.x === mirrorX(p.x, axis) && o.y === p.y);
      return q?.id ?? '';
    };

    it('moves a part and its twin apart, each keeping its own tags', () => {
      const d = drone();
      const other = twin('propeller@0,1', d);
      expect(other).toBe('propeller@4,1');
      const r = moved(movePartsBy(d, reg, new Map([['propeller@0,1', { dx: 0, dy: 1 }], [other, { dx: 0, dy: 1 }]])));
      expect(part(r.blueprint, 'propeller@0,2')?.tags).toEqual(['lprop', 'props', 'propeller@0,2']);
      expect(part(r.blueprint, 'propeller@4,2')?.tags).toEqual(['rprop', 'props', 'propeller@4,2']);
    });

    it('moves the halves toward the axis by mirrored steps, and they may meet neighbours that move too', () => {
      const d = drone();
      // Each propeller and the frame beside it step outward: left by -1, right by +1.
      const steps = new Map([
        ['propeller@0,1', { dx: -1, dy: 0 }],
        ['frame@1,1', { dx: -1, dy: 0 }],
        ['propeller@4,1', { dx: 1, dy: 0 }],
        ['frame@3,1', { dx: 1, dy: 0 }],
      ]);
      const r = moved(movePartsBy(d, reg, steps));
      expect(r.blueprint.parts.map((p) => p.id)).toEqual(['propeller@-1,1', 'frame@0,1', 'core@2,1', 'frame@4,1', 'propeller@5,1', 'thruster@2,0']);
      // Still mirror images of each other across the same axis.
      for (const p of r.blueprint.parts) if (p.y === 1) expect(r.blueprint.parts.some((q) => q.part === p.part && q.x === mirrorX(p.x, axis) && q.y === p.y)).toBe(true);
    });

    it('lands neither half when one is blocked', () => {
      const d = bp({ grid: ['l  F  C  F  r  F'], legend: { l: { part: 'propeller', tags: ['lprop'] }, r: { part: 'propeller', tags: ['rprop'] } } });
      // The left propeller is free to step out; the right one would land on the extra frame.
      const r = movePartsBy(d, reg, new Map([['propeller@0,0', { dx: -1, dy: 0 }], ['propeller@4,0', { dx: 1, dy: 0 }]]));
      expect(r).toEqual({ ok: false, error: 'propeller@4,0 would land on frame@5,0 at (5, 0)' });
    });

    it('refuses two halves stepping onto one cell (a twin pair closing on the axis)', () => {
      const d = bp({ grid: ['l  .  r', 'F  C  F'], legend: { l: { part: 'propeller' }, r: { part: 'propeller' } } });
      const r = movePartsBy(d, reg, new Map([['propeller@0,1', { dx: 1, dy: 0 }], ['propeller@2,1', { dx: -1, dy: 0 }]]));
      expect(r).toEqual({ ok: false, error: 'propeller@2,1 would land on propeller@0,1 at (1, 1)' });
    });
  });
});
