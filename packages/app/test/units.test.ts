import { describe, expect, it } from 'vitest';
import { PIXELS_PER_METER, toScreen, toScreenAngle, toWorld } from '../src/render/units';

describe('units', () => {
  it('flips y and scales by pixels per meter', () => {
    expect(toScreen({ x: 2, y: 3 })).toEqual({ x: 2 * PIXELS_PER_METER, y: -3 * PIXELS_PER_METER });
  });

  it('round-trips', () => {
    const p = toWorld(toScreen({ x: -1.5, y: 0.25 }));
    expect(p.x).toBeCloseTo(-1.5, 9);
    expect(p.y).toBeCloseTo(0.25, 9);
  });

  it('negates angles because screen y points down', () => {
    expect(toScreenAngle(0.7)).toBe(-0.7);
  });
});
