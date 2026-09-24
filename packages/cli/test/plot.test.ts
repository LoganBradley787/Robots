import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '@robots/sim-core';
import { plotPaths } from '../src/report/plot';

const world = parseWorldFile({ name: 't', ground: { width: 100, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [{ x: 6, y: 1, w: 2, h: 2 }] });

describe('plotPaths', () => {
  it('draws a side view: ground, a box, the path in lowercase, the last spot in uppercase, blasts', () => {
    const lines = plotPaths({
      world,
      tracks: [{ mark: 'A', points: [0, 1, 2, 3, 4].map((x) => ({ x, y: 3 - 0.5 * x })) }],
      blasts: [{ x: 8, y: 1 }],
      width: 20,
    });
    const body = lines.filter((l) => l.includes('|')).map((l) => l.slice(l.indexOf('|') + 1));
    // Every row is the fixed width; y grows upward (top row first).
    expect(body.every((r) => r.length === body[0]?.length)).toBe(true);
    const rowOf = (ch: string): number => body.findIndex((r) => r.includes(ch));
    expect(rowOf('a')).toBeLessThan(rowOf('A'));
    expect(body.join('').includes('*')).toBe(true);
    // The bottom rows are ground, the box stands on it to the right of the path.
    expect(body.at(-1)).toMatch(/^#+$/);
    const boxRow = body.findIndex((r) => /#/.test(r) && !/^#+$/.test(r));
    expect(boxRow).toBeGreaterThan(-1);
    expect(body[boxRow]?.indexOf('#')).toBeGreaterThan(body[rowOf('A')]?.indexOf('A') ?? 99);
    // A scale line and x labels.
    expect(lines[0]).toMatch(/1 column = [0-9.]+ m, 1 row = [0-9.]+ m/);
    expect(lines.at(-1)).toMatch(/x +-?[0-9.]+/);
  });

  it('keeps a still robot readable and a long flight within the row cap', () => {
    const still = plotPaths({ world, tracks: [{ mark: 'A', points: [{ x: 0, y: 1 }] }], blasts: [], width: 40 });
    expect(still.filter((l) => l.includes('|')).length).toBeGreaterThanOrEqual(6);
    const tall = plotPaths({ world, tracks: [{ mark: 'A', points: [{ x: 0, y: 1 }, { x: 1, y: 200 }] }], blasts: [], width: 60, maxRows: 20 });
    expect(tall.filter((l) => l.includes('|')).length).toBeLessThanOrEqual(20);
  });

  it('later tracks draw over earlier ones', () => {
    const lines = plotPaths({ world, tracks: [{ mark: 'A', points: [{ x: 0, y: 2 }] }, { mark: 'B', points: [{ x: 0, y: 2 }] }], blasts: [], width: 20 });
    expect(lines.join('\n')).toContain('B');
    expect(lines.join('\n')).not.toContain('A');
  });
});
