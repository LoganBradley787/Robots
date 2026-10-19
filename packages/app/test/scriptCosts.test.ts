import { describe, expect, it } from 'vitest';
import { msText, ScriptCosts } from '../src/app/scriptCosts';

describe('script costs, per robot', () => {
  it('takes the first run in full, then smooths: one slow call moves it only a little', () => {
    const c = new ScriptCosts(0.1);
    expect(c.cost(1)).toBeUndefined();
    c.add(1, 2);
    expect(c.cost(1)).toBe(2);
    c.add(1, 12);
    expect(c.cost(1)).toBeCloseTo(3, 9);
    for (let i = 0; i < 200; i++) c.add(1, 1);
    expect(c.cost(1)).toBeCloseTo(1, 6);
  });

  it('lists the slowest robots first and forgets the ones that are gone', () => {
    const c = new ScriptCosts();
    c.add(1, 0.5);
    c.add(2, 3);
    c.add(3, 0.5);
    c.add(4, 1);
    expect(c.slowest(3)).toEqual([
      { robot: 2, ms: 3 },
      { robot: 4, ms: 1 },
      { robot: 1, ms: 0.5 },
    ]);
    c.keep([1, 4]);
    expect(c.slowest(5).map((s) => s.robot)).toEqual([4, 1]);
    c.clear();
    expect(c.slowest(5)).toEqual([]);
  });

  it('says a time plainly', () => {
    expect(msText(0.042)).toBe('0.04 ms');
    expect(msText(1.43)).toBe('1.4 ms');
    expect(msText(23.4)).toBe('23 ms');
  });
});
