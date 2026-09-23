import { describe, expect, it } from 'vitest';
import { TIME_SCALES, TimeControls } from '../src/app/TimeControls';

describe('TimeControls', () => {
  it('starts running at 1x', () => {
    const t = new TimeControls();
    expect(t.paused).toBe(false);
    expect(t.timeScale).toBe(1);
  });

  it('steps through the scale table and clamps at both ends', () => {
    const t = new TimeControls();
    for (let i = 0; i < 10; i++) t.faster();
    expect(t.timeScale).toBe(TIME_SCALES[TIME_SCALES.length - 1]);
    for (let i = 0; i < 10; i++) t.slower();
    expect(t.timeScale).toBe(TIME_SCALES[0]);
  });

  it('requestStep pauses and queues exactly one tick', () => {
    const t = new TimeControls();
    t.requestStep();
    t.requestStep();
    expect(t.paused).toBe(true);
    expect(t.takePendingSteps()).toBe(2);
    expect(t.takePendingSteps()).toBe(0);
  });
});
