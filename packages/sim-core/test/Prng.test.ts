import { describe, expect, it } from 'vitest';
import { Prng } from '../src/rng/Prng';

describe('Prng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    expect(sa).toEqual(sb);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Prng(1);
    const b = new Prng(2);
    expect(a.nextU32()).not.toBe(b.nextU32());
  });

  it('next() is in [0, 1) and range() respects bounds', () => {
    const p = new Prng(7);
    for (let i = 0; i < 1000; i++) {
      const v = p.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const r = p.range(-3, 5);
      expect(r).toBeGreaterThanOrEqual(-3);
      expect(r).toBeLessThan(5);
    }
  });
});
