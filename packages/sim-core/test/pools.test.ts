import { describe, expect, it } from 'vitest';
import { drainContainers, drainHeld, grantFactor, heldTotals, poolTotals, type Container, type Holder } from '../src/resources/pools';

const pool = (): Container[] => [
  { id: 'battery@2,0', stored: 1500, capacity: 1500 },
  { id: 'core@1,0', stored: 600, capacity: 600 },
  { id: 'battery@3,0', stored: 300, capacity: 1500 },
];

describe('pools', () => {
  it('sums a chunk of containers', () => {
    expect(poolTotals(pool())).toEqual({ stored: 2400, capacity: 3600 });
    expect(poolTotals([])).toEqual({ stored: 0, capacity: 0 });
  });

  it('drains in proportion to what each holds, so they empty together', () => {
    const p = pool();
    expect(drainContainers(p, 240)).toBeCloseTo(240, 9);
    expect(p.map((c) => c.stored)).toEqual([1350, 540, 270]);
  });

  it('a drain larger than the pool empties it and reports what was there', () => {
    const p = pool();
    expect(drainContainers(p, 5000)).toBe(2400);
    expect(p.every((c) => c.stored === 0)).toBe(true);
    expect(drainContainers(p, 10)).toBe(0);
  });

  it('the order the containers come in does not change the result', () => {
    const a = pool();
    const b = [...pool()].reverse();
    drainContainers(a, 777.7);
    drainContainers(b, 777.7);
    const byId = (cs: Container[]): Record<string, number> => Object.fromEntries(cs.map((c) => [c.id, c.stored]));
    expect(byId(b)).toEqual(byId(a));
  });

  it('parts holding their own amounts sum and drain exactly as containers do', () => {
    const held = (cs: Container[]): Holder[] => [...cs].sort((a, b) => (a.id < b.id ? -1 : 1)).map((c) => ({ stored: c.stored, def: { resource: { capacity: c.capacity } } }));
    for (const amount of [0, 0.1, 240, 777.7, 2399.9, 2400, 5000]) {
      const containers = pool();
      const parts = held(containers);
      expect(heldTotals(parts)).toEqual(poolTotals(containers));
      const { stored } = heldTotals(parts);
      expect(drainHeld(parts, stored, amount)).toBe(drainContainers(containers, amount));
      expect(parts.map((p) => p.stored)).toEqual([...containers].sort((a, b) => (a.id < b.id ? -1 : 1)).map((c) => c.stored));
    }
  });

  it('a part with nothing to hold counts for nothing', () => {
    const parts: Holder[] = [{ stored: 5, def: { resource: { capacity: 9 } } }, { def: { resource: { capacity: 9 } } }, { stored: 1, def: {} }];
    expect(heldTotals(parts)).toEqual({ stored: 5, capacity: 9 });
    expect(drainHeld(parts, 5, 2)).toBe(2);
    expect(parts.map((p) => p.stored)).toEqual([3, undefined, 1]);
  });

  it('grants everything, a fair share, or nothing', () => {
    expect(grantFactor(100, 50)).toBe(1);
    expect(grantFactor(25, 100)).toBe(0.25);
    expect(grantFactor(0, 100)).toBe(0);
    expect(grantFactor(0, 0)).toBe(1);
  });
});
