import { describe, expect, it } from 'vitest';
import { expandBlueprint } from '../src/blueprint/expand';
import { toGrid } from '../src/blueprint/toGrid';

describe('toGrid', () => {
  it('renders the car with default tokens', () => {
    const bp = expandBlueprint({ format: 1, name: 'car', grid: ['F  F  C  B  F  F', 'W  .  .  .  .  W'] }).blueprint;
    if (!bp) throw new Error('expected a blueprint');
    const g = toGrid(bp);
    expect(g.grid).toEqual(['F F C B F F', 'W . . . . W']);
    expect(g.legend).toEqual({});
  });

  it('round-trips parts with custom tags through generated tokens', () => {
    const src = expandBlueprint({
      format: 1,
      name: 't',
      grid: ['.  P  .', 'W< C  T>'],
      legend: { P: { part: 'propeller', tags: ['props'] } },
    }).blueprint;
    if (!src) throw new Error('expected a blueprint');
    const g = toGrid(src);
    const back = expandBlueprint({ format: 1, name: 't', grid: g.grid, legend: g.legend }).blueprint;
    expect(back?.parts).toEqual(src.parts);
  });

  it('pads columns to the widest token and handles negative coordinates', () => {
    const bp = expandBlueprint({ format: 1, name: 't', parts: [{ part: 'frame', x: -1, y: 0 }, { part: 'thruster', x: 0, y: 0, rot: 270 }] })
      .blueprint;
    if (!bp) throw new Error('expected a blueprint');
    expect(toGrid(bp).grid).toEqual(['F  T>']);
  });
});
