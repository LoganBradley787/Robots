import { describe, expect, it } from 'vitest';
import { outlineOf } from '../src/render/RepairSparks';

const close = (a: { x: number; y: number }, x: number, y: number): void => {
  expect(a.x).toBeCloseTo(x, 8);
  expect(a.y).toBeCloseTo(y, 8);
};

describe('repair sparks: the outline they run round', () => {
  it('one cell is its four corners', () => {
    const loop = outlineOf([{ x: 3, y: 4 }], 0);
    expect(loop).toHaveLength(4);
    for (const p of loop) expect(Math.max(Math.abs(p.x - 3), Math.abs(p.y - 4))).toBeCloseTo(0.5, 8);
  });

  it('two cells share no edge: six corners, not eight', () => {
    expect(outlineOf([{ x: 0, y: 0 }, { x: 0, y: 1 }], 0)).toHaveLength(6);
  });

  it('turns with the body', () => {
    const loop = outlineOf([{ x: 0, y: 0 }], Math.PI / 2);
    expect(loop).toHaveLength(4);
    const far = outlineOf([{ x: 0, y: 0 }, { x: -1, y: 0 }], Math.PI / 2);
    expect(far).toHaveLength(6);
    close({ x: Math.min(...far.map((p) => p.x)), y: Math.max(...far.map((p) => p.y)) }, -1.5, 0.5);
  });

  it('an L goes all the way round', () => {
    expect(outlineOf([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 0)).toHaveLength(8);
  });

  it('nothing is nothing', () => {
    expect(outlineOf([], 0)).toEqual([]);
  });
});
