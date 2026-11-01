import { describe, expect, it } from 'vitest';
import { BURN_STEPS, burnStep, unburntSide } from '../src/render/burnRing';

describe('burnRing', () => {
  it('shows all brown only at 1', () => {
    expect(burnStep(0)).toBe(0);
    expect(burnStep(1)).toBe(BURN_STEPS);
    expect(burnStep(0.999)).toBe(BURN_STEPS - 1);
    expect(burnStep(2)).toBe(BURN_STEPS);
    expect(unburntSide(BURN_STEPS)).toBe(0);
  });

  it('the brown covers the burnt share of the part: what is left is the rest', () => {
    for (let step = 0; step <= BURN_STEPS; step++) expect(unburntSide(step) ** 2).toBeCloseTo(1 - step / BURN_STEPS, 12);
  });
});
