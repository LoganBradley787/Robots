import { describe, expect, it } from 'vitest';
import { runWithin } from '../src/app/tickBudget';

/** A clock where each step costs `cost` ms. */
function clocked(cost: number): { now: () => number; step: () => void } {
  let t = 0;
  return { now: () => t, step: () => (t += cost) };
}

describe('runWithin', () => {
  it('runs every tick when they fit', () => {
    const c = clocked(1);
    expect(runWithin(4, 10, c.now, c.step)).toBe(4);
  });

  it('stops once the budget is spent', () => {
    const c = clocked(4);
    expect(runWithin(16, 10, c.now, c.step)).toBe(3);
  });

  it('always runs at least one tick, and none when asked for none', () => {
    const c = clocked(50);
    expect(runWithin(16, 10, c.now, c.step)).toBe(1);
    expect(runWithin(0, 10, c.now, c.step)).toBe(0);
  });
});
