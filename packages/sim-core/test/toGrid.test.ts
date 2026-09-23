import { describe, expect, it } from 'vitest';
import { expandBlueprint } from '../src/blueprint/expand';
import type { Blueprint } from '../src/blueprint/types';
import { toGrid } from '../src/blueprint/toGrid';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();

function bp(raw: object): Blueprint {
  const r = expandBlueprint({ format: 1, name: 't', ...raw });
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
}

describe('toGrid', () => {
  it('renders the car with default tokens', () => {
    const g = toGrid(bp({ grid: ['F  F  C  B  F  F', 'W  .  .  .  .  W'] }), reg);
    expect(g?.grid).toEqual(['F F C B F F', 'W . . . . W']);
    expect(g?.legend).toEqual({});
  });

  it('round-trips parts with custom tags through generated tokens', () => {
    const src = bp({ grid: ['.  P  .', 'W< C  T>'], legend: { P: { part: 'propeller', tags: ['props'] } } });
    const g = toGrid(src, reg);
    expect(g).not.toBeNull();
    expect(bp({ grid: g?.grid, legend: g?.legend }).parts).toEqual(src.parts);
  });

  it('keeps parts at their cells so ids survive', () => {
    const src = bp({ parts: [{ part: 'core', x: 5, y: 3 }, { part: 'frame', x: 6, y: 3 }] });
    const g = toGrid(src, reg);
    expect(g?.grid).toEqual(['. . . . . C F', '. . . . . . .', '. . . . . . .', '. . . . . . .']);
    expect(bp({ grid: g?.grid, legend: g?.legend }).parts.map((p) => p.id)).toEqual(['core@5,3', 'frame@6,3']);
  });

  it('pads columns to the widest token', () => {
    const g = toGrid(bp({ parts: [{ part: 'frame', x: 0, y: 0 }, { part: 'thruster', x: 1, y: 0, rot: 270 }] }), reg);
    expect(g?.grid).toEqual(['F  T>']);
  });

  it('returns null when the grid form cannot express the blueprint', () => {
    expect(toGrid(bp({ parts: [{ part: 'frame', x: -1, y: 0 }] }), reg)).toBeNull();
    expect(toGrid(bp({ parts: [{ id: 'hull', part: 'frame', x: 0, y: 0 }] }), reg)).toBeNull();
  });
});
