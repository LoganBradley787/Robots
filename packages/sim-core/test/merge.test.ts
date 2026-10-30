import { describe, expect, it } from 'vitest';
import { mergeCells, type CellRect, type MergeCell } from '../src/assembly/merge';

const HALF = 0.49;

/** Cells from rows of text, top row first: any letter is a cell of that part, with `mass` by letter. */
const cellsOf = (rows: string[], mass: (part: string) => number = () => 1): MergeCell[] => {
  const out: MergeCell[] = [];
  rows.forEach((row, r) => {
    [...row].forEach((ch, x) => {
      if (ch !== '.') out.push({ x, y: rows.length - 1 - r, owner: ch, mass: mass(ch) });
    });
  });
  return out;
};

/** Every cell a rectangle covers, with its owner. */
const covered = (rects: CellRect[]): Map<string, string> => {
  const out = new Map<string, string>();
  for (const r of rects) {
    expect(r.owners).toHaveLength(r.w * r.h);
    for (let cx = 0; cx < r.w; cx++) {
      for (let cy = 0; cy < r.h; cy++) {
        const key = `${r.x + cx},${r.y + cy}`;
        expect(out.has(key)).toBe(false);
        out.set(key, r.owners[cx * r.h + cy] as string);
      }
    }
  }
  return out;
};

const expectExactCover = (cells: MergeCell[], rects: CellRect[]): void => {
  expect(covered(rects)).toEqual(new Map(cells.map((c) => [`${c.x},${c.y}`, c.owner])));
};

describe('mergeCells', () => {
  it('a solid block is one rectangle, whatever the parts in it', () => {
    const cells = cellsOf(['abc', 'def', 'ghi']);
    const rects = mergeCells(cells, HALF);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 3, h: 3 });
    expectExactCover(cells, rects);
  });

  it('covers an L, a ring and scattered cells exactly, each cell once', () => {
    for (const shape of [['a..', 'a..', 'aaa'], ['aaaa', 'a..a', 'a..a', 'aaaa'], ['a.a.a', '.a.a.', 'a.a.a']]) {
      const cells = cellsOf(shape);
      expectExactCover(cells, mergeCells(cells, HALF));
    }
  });

  it('a checkerboard is the worst case: one rectangle a cell, never more', () => {
    const cells = cellsOf(['a.a.a', '.a.a.', 'a.a.a']);
    expect(mergeCells(cells, HALF)).toHaveLength(cells.length);
  });

  it('does not depend on the order of the cells', () => {
    const cells = cellsOf(['aab.c', 'aabcc', '.dddd', 'ee.dd']);
    expect(mergeCells([...cells].reverse(), HALF)).toEqual(mergeCells(cells, HALF));
    const shuffled = [...cells].sort((p, q) => (p.x * 7 + p.y * 13) % 5 - (q.x * 7 + q.y * 13) % 5);
    expect(mergeCells(shuffled, HALF)).toEqual(mergeCells(cells, HALF));
  });

  it('handles negative cells and a body spread far wider than it has cells', () => {
    const cells: MergeCell[] = [{ x: -5000, y: -3, owner: 'a', mass: 1 }, { x: -4999, y: -3, owner: 'b', mass: 1 }, { x: 5000, y: 7000, owner: 'c', mass: 1 }];
    const rects = mergeCells(cells, HALF);
    expect(rects).toHaveLength(2);
    expectExactCover(cells, rects);
  });

  it('adds mass, center of mass and inertia up exactly from each cell', () => {
    const mass = (p: string): number => ({ a: 20, b: 1, c: 0.5, d: 7 })[p] ?? 1;
    const cells = cellsOf(['abcd', 'abcd', 'dcba'], mass);
    const rects = mergeCells(cells, HALF);
    expect(rects).toHaveLength(1);
    const r = rects[0] as CellRect;
    const m = cells.reduce((s, c) => s + c.mass, 0);
    const cx = cells.reduce((s, c) => s + c.mass * c.x, 0) / m;
    const cy = cells.reduce((s, c) => s + c.mass * c.y, 0) / m;
    const i = cells.reduce((s, c) => s + c.mass * ((2 * HALF * HALF) / 3 + (c.x - cx) ** 2 + (c.y - cy) ** 2), 0);
    expect(r.mass).toBeCloseTo(m, 9);
    expect(r.comX).toBeCloseTo(cx, 9);
    expect(r.comY).toBeCloseTo(cy, 9);
    expect(r.inertia).toBeCloseTo(i, 8);
  });

  it('massless cells cost nothing and leave the rectangle at its middle', () => {
    const r = mergeCells(cellsOf(['ab'], () => 0), HALF)[0] as CellRect;
    expect(r).toMatchObject({ mass: 0, comX: 0.5, comY: 0, inertia: 0 });
  });

  it('nothing in, nothing out', () => {
    expect(mergeCells([], HALF)).toEqual([]);
  });
});
