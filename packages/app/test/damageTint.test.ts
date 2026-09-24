import { describe, expect, it } from 'vitest';
import { damageTint } from '../src/render/damageTint';

describe('damageTint', () => {
  it('is white when whole and a scorched brown when nearly gone', () => {
    expect(damageTint(1)).toBe(0xffffff);
    expect(damageTint(0)).toBe(0x6e5446);
    expect(damageTint(2)).toBe(0xffffff);
  });

  it('darkens steadily as health drops', () => {
    const red = (c: number): number => c >> 16;
    expect(red(damageTint(0.75))).toBeGreaterThan(red(damageTint(0.5)));
    expect(red(damageTint(0.5))).toBeGreaterThan(red(damageTint(0.25)));
  });
});
