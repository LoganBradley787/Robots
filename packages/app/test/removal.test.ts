import { describe, expect, it } from 'vitest';
import { DEFAULT_FAR, farIds, loadFarDistance, outlineEdges, robotsText, saveFarDistance, teamCounts, teamIds } from '../src/world/removal';

function memoryStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('removing robots (M16)', () => {
  it('far away is measured from the camera, up included', () => {
    const spots = [
      { id: 1, x: 0, y: 3 },
      { id: 2, x: -2600, y: 2 },
      { id: 3, x: 1200, y: 1600 },
      { id: 4, x: 1999, y: 0 },
    ];
    const middle = { x: 0, y: 0 };
    expect(farIds(spots, 2000, middle)).toEqual([2]);
    expect(farIds(spots, 1000, middle)).toEqual([2, 3, 4]);
    expect(farIds(spots, 5000, middle)).toEqual([]);
  });

  it('a fight watched off to one side stays, and the middle of the world can be the far one', () => {
    const spots = [
      { id: 1, x: 0, y: 2 },
      { id: 2, x: 3000, y: 5 },
      { id: 3, x: 3400, y: 300 },
    ];
    // Logan watches the fight at x 3100: it stays, the robot back at the middle is 3100 m away.
    expect(farIds(spots, 2000, { x: 3100, y: 10 })).toEqual([1]);
    expect(farIds(spots, 1000, { x: 3100, y: 10 })).toEqual([1]);
    expect(farIds(spots, 5000, { x: 3100, y: 10 })).toEqual([]);
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
    expect(DEFAULT_FAR).toBe(2000);
    saveFarDistance(store, 5000);
    expect(loadFarDistance(store)).toBe(5000);
    store.setItem('robots.removeFar', '42');
    expect(loadFarDistance(store)).toBe(DEFAULT_FAR);
    // The old choices: 250 and 500 are gone and read as the default, 1000 is still one and keeps.
    store.setItem('robots.removeFar', '250');
    expect(loadFarDistance(store)).toBe(DEFAULT_FAR);
    store.setItem('robots.removeFar', '500');
    expect(loadFarDistance(store)).toBe(DEFAULT_FAR);
    store.setItem('robots.removeFar', '1000');
    expect(loadFarDistance(store)).toBe(1000);
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
