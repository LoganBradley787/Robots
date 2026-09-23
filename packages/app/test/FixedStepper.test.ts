import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/app/FixedStepper';

const DT = 1000 / 60;

describe('FixedStepper', () => {
  it('runs one tick per 16.67 ms frame at 1x', () => {
    const s = new FixedStepper(DT);
    expect(s.advance(DT, 1)).toBe(1);
    expect(s.alpha).toBeCloseTo(0, 6);
  });

  it('accumulates fractional frames', () => {
    const s = new FixedStepper(DT);
    expect(s.advance(10, 1)).toBe(0);
    expect(s.alpha).toBeCloseTo(10 / DT, 6);
    expect(s.advance(10, 1)).toBe(1);
  });

  it('runs fewer ticks at 0.5x and more at 2x', () => {
    const slow = new FixedStepper(DT);
    expect(slow.advance(DT, 0.5)).toBe(0);
    expect(slow.advance(DT, 0.5)).toBe(1);
    const fast = new FixedStepper(DT);
    expect(fast.advance(DT, 2)).toBe(2);
  });

  it('clamps huge frames to avoid the spiral of death', () => {
    const s = new FixedStepper(DT, 250);
    expect(s.advance(5000, 1)).toBe(15);
  });

  it('reset drops the accumulator', () => {
    const s = new FixedStepper(DT);
    s.advance(10, 1);
    s.reset();
    expect(s.alpha).toBe(0);
  });
});
