import { describe, expect, it } from 'vitest';
import { dashesOf, drawnShare, outlineOf } from '../src/render/RepairSparks';

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

describe('repair sparks: the dots that show how far along it is', () => {
  const cell = outlineOf([{ x: 0, y: 0 }], 0);
  const drawn = (dash: { x: number; y: number }[]): number => dash.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - (dash[i] as typeof p).x, p.y - (dash[i] as typeof p).y), 0);

  it('a build starts as dots a quarter of their spacing and ends closed', () => {
    expect(drawnShare('build', 0, 6)).toBeCloseTo(0.25, 8);
    expect(drawnShare('build', 0.5, 6)).toBeGreaterThan(0.6);
    expect(drawnShare('build', 1, 6)).toBe(1);
  });

  it('a build holds closed before it is done, a scrap comes apart', () => {
    expect(drawnShare('build', 1 - 0.05 / 6, 6)).toBe(1);
    expect(drawnShare('scrap', 0, 3)).toBe(1);
    expect(drawnShare('scrap', 1, 3)).toBeCloseTo(0.25, 8);
  });

  it('dots fit the loop evenly and cover the share asked for, round corners too', () => {
    const dashes = dashesOf(cell, 4, 0.25);
    expect(dashes).toHaveLength(8);
    for (const dash of dashes) expect(drawn(dash)).toBeLessThan(0.15);
    const wide = dashesOf(cell, 4, 0.9);
    expect(wide.reduce((n, d) => n + drawn(d), 0)).toBeCloseTo(3.6, 1);
  });

  it('all of it drawn is one closed line', () => {
    const [line, ...rest] = dashesOf(cell, 4, 1);
    expect(rest).toEqual([]);
    expect(line).toHaveLength(5);
    expect(line?.[0]).toEqual(line?.[4]);
  });
});
