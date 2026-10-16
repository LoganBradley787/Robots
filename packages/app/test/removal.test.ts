import { describe, expect, it } from 'vitest';
import { DEFAULT_FAR, farIds, loadFarDistance, outlineEdges, robotsText, saveFarDistance, teamCounts, teamIds } from '../src/world/removal';

function memoryStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('removing robots (M16)', () => {
  it('far away is measured from the middle of the world on the ground, up included', () => {
    const spots = [
      { id: 1, x: 0, y: 3 },
      { id: 2, x: -600, y: 2 },
      { id: 3, x: 300, y: 400 },
      { id: 4, x: 499, y: 0 },
    ];
    expect(farIds(spots, 500)).toEqual([2]);
    expect(farIds(spots, 250)).toEqual([2, 3, 4]);
    expect(farIds(spots, 1000)).toEqual([]);
  });

  it('a team is its robots and the pieces that broke off them, which keep its team', () => {
    const robots = [
      { id: 1, team: 0 },
      { id: 2, team: 1 },
      { id: 5, team: 1 },
      { id: 7, team: 2 },
    ];
    expect(teamIds(robots, 1)).toEqual([2, 5]);
    expect(teamCounts(robots)).toEqual([
      { team: 0, count: 1 },
      { team: 1, count: 2 },
      { team: 2, count: 1 },
    ]);
    expect(teamCounts([])).toEqual([]);
    expect(robotsText(1)).toBe('1 robot');
    expect(robotsText(3)).toBe('3 robots');
  });

  it('the distance is remembered, and anything but a choice reads as the default', () => {
    const store = memoryStore();
    expect(loadFarDistance(store)).toBe(DEFAULT_FAR);
    saveFarDistance(store, 1000);
    expect(loadFarDistance(store)).toBe(1000);
    store.setItem('robots.removeFar', '42');
    expect(loadFarDistance(store)).toBe(DEFAULT_FAR);
    expect(loadFarDistance(undefined)).toBe(DEFAULT_FAR);
  });

  it('the outline goes round the cells and not between them', () => {
    // An L of three cells: 8 unit edges round it.
    const edges = outlineEdges([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
    expect(edges.length).toBe(8);
    // None runs along x = 0.5 between (0,0) and (1,0).
    expect(edges.some((e) => e.x1 === 0.5 && e.x2 === 0.5 && e.y1 === -0.5)).toBe(false);
  });
});
