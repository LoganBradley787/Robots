import { describe, expect, it } from 'vitest';
import { interpolateState, lerp, lerpAngle } from '../src/render/interpolate';

describe('interpolate', () => {
  it('lerp is linear', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });

  it('lerpAngle takes the short way around', () => {
    const r = lerpAngle(3.0, -3.0, 0.5);
    expect(Math.abs(Math.abs(r) - Math.PI)).toBeLessThan(1e-9);
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 9);
  });

  it('interpolateState blends position and angle, keeps current velocity', () => {
    const prev = { x: 0, y: 0, angle: 0, vx: 0, vy: 0, w: 0 };
    const curr = { x: 2, y: -4, angle: 1, vx: 3, vy: 4, w: 5 };
    expect(interpolateState(prev, curr, 0.5)).toEqual({ x: 1, y: -2, angle: 0.5, vx: 3, vy: 4, w: 5 });
  });
});
