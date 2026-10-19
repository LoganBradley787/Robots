import { describe, expect, it } from 'vitest';
import { FramePace, frameSimBudget, runsText, ScriptScheduler, scriptBudget, SMOOTH_FLOOR, SMOOTH_MARGIN_MS, ticksPerWindow } from '../src/app/scriptScheduler';
import { FixedStepper } from '../src/app/FixedStepper';

const costs = (m: Record<number, number>) => (id: number): number | undefined => m[id];

describe('Smooth: which scripts run each tick', () => {
  it('runs everything that fits, in order, and skips what does not; smaller ones after a skip may still fit', () => {
    const s = new ScriptScheduler();
    expect(s.plan([1, 2, 3, 4], costs({ 1: 2, 2: 5, 3: 1, 4: 1 }), 4.5)).toEqual([2]);
    expect(s.lastSkipped).toBe(1);
    expect(s.waiting(2)).toBe(1);
    expect(s.waiting(1)).toBe(0);
  });

  it('runs all when the budget holds them, and a robot not measured yet always runs', () => {
    const s = new ScriptScheduler();
    expect(s.plan([1, 2, 3], costs({ 1: 1, 2: 1 }), 2)).toEqual([]);
    expect(s.plan([1, 2, 3], costs({ 1: 1, 2: 1 }), 0)).toEqual([1, 2]);
  });

  it('is fair: the robots that waited longest go first, so the slow ones take turns', () => {
    const s = new ScriptScheduler();
    const cost = costs({ 1: 3, 2: 3, 3: 3 });
    // Room for one a tick: each runs every third tick, in turn.
    const ran: number[] = [];
    for (let t = 0; t < 9; t++) {
      const skip = s.plan([1, 2, 3], cost, 3);
      ran.push(...[1, 2, 3].filter((id) => !skip.includes(id)));
    }
    expect(ran).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(s.rate(1)).toEqual({ ran: 3, of: 9 });
  });

  it(`has a floor: every robot runs at least every ${SMOOTH_FLOOR}th tick, over budget or not`, () => {
    const s = new ScriptScheduler();
    const ticksRun: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    const ids = [1, 2, 3, 4, 5, 6];
    for (let t = 0; t < 40; t++) {
      // No room at all: physics alone fills the frame.
      const skip = s.plan(ids, costs({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 }), 0);
      for (const id of ids) if (!skip.includes(id)) ticksRun[id]?.push(t);
    }
    for (const id of ids) {
      const ts = ticksRun[id] ?? [];
      expect(ts[0]).toBeLessThan(SMOOTH_FLOOR);
      for (let i = 1; i < ts.length; i++) expect((ts[i] ?? 0) - (ts[i - 1] ?? 0)).toBeLessThanOrEqual(SMOOTH_FLOOR);
    }
    // At the floor exactly: every 4th tick.
    expect(ticksRun[1]?.slice(0, 3)).toEqual([3, 7, 11]);
  });

  it('a robot far past the budget runs only at the floor; on those ticks it spends the budget, and the cheap ones wait', () => {
    const s = new ScriptScheduler();
    let heavy = 0;
    for (let t = 0; t < 60; t++) {
      const skip = s.plan([1, 2, 3], costs({ 1: 20, 2: 0.5, 3: 0.5 }), 4);
      // The tick it runs is over budget already: the others sit it out and go first on the next.
      expect(skip).toEqual(skip.includes(1) ? [1] : [2, 3]);
      if (!skip.includes(1)) heavy++;
    }
    expect(heavy).toBe(15);
    expect(runsText(s.rate(1))).toBe('runs 1 tick in 4');
    expect(runsText(s.rate(2))).toBe('skips 1 tick in 4');
  });

  it('forgets robots no longer listed, and starts over when cleared', () => {
    const s = new ScriptScheduler();
    s.plan([1, 2], costs({ 1: 5, 2: 5 }), 5);
    expect(s.waiting(2)).toBe(1);
    s.plan([1], costs({ 1: 5 }), 5);
    expect(s.waiting(2)).toBe(0);
    expect(s.rate(2)).toBeUndefined();
    s.clear();
    expect(s.rate(1)).toBeUndefined();
  });
});

describe('Smooth: the time budget', () => {
  it('is a tick of real time less drawing and the margin, split between the ticks a frame runs, less the rest of a tick', () => {
    const tick = 1000 / 60;
    expect(frameSimBudget({ frameMs: tick, viewMs: 3 })).toBeCloseTo(tick - SMOOTH_MARGIN_MS - 3, 9);
    // At 120 Hz too: Smooth aims for 60 frames a second, one drawn per tick.
    expect(frameSimBudget({ frameMs: tick / 2, viewMs: 3 })).toBeCloseTo(tick - SMOOTH_MARGIN_MS - 3, 9);
    // A browser that gives 30 frames a second: a frame holds two ticks and their scripts.
    expect(frameSimBudget({ frameMs: 2 * tick, viewMs: 3 })).toBeCloseTo(2 * tick - SMOOTH_MARGIN_MS - 3, 9);
    expect(scriptBudget({ frameMs: 2 * tick, viewMs: 3, restMs: 2, timeScale: 1 })).toBeCloseTo((2 * tick - SMOOTH_MARGIN_MS - 3) / 2 - 2, 9);
    expect(ticksPerWindow({ frameMs: 2 * tick, timeScale: 4 })).toBeCloseTo(8, 9);
    expect(ticksPerWindow({ frameMs: tick / 2, timeScale: 1 })).toBeCloseTo(1, 9);
    expect(frameSimBudget({ frameMs: tick, viewMs: 40 })).toBe(2);
    expect(scriptBudget({ frameMs: tick, viewMs: 3, restMs: 2, timeScale: 1 })).toBeCloseTo(tick - SMOOTH_MARGIN_MS - 3 - 2, 9);
    expect(scriptBudget({ frameMs: tick, viewMs: 3, restMs: 2, timeScale: 4 })).toBeCloseTo((tick - SMOOTH_MARGIN_MS - 3) / 4 - 2, 9);
    // Slower than 1x: still one tick's worth in one frame.
    expect(scriptBudget({ frameMs: tick, viewMs: 3, restMs: 2, timeScale: 0.25 })).toBeCloseTo(tick - SMOOTH_MARGIN_MS - 3 - 2, 9);
    expect(scriptBudget({ frameMs: tick, viewMs: 3, restMs: 20, timeScale: 1 })).toBe(0);
  });

  it("learns the browser's frame pace from frames the game did not hold back, and does not settle at a rate it caused", () => {
    const tick = 1000 / 60;
    const p = new FramePace();
    // 120 Hz, little work: it follows the display down at once.
    for (let i = 0; i < 60; i++) p.update(tick / 2, 2);
    expect(p.ms).toBeCloseTo(tick / 2, 1);
    // A browser holding the window at 30 frames a second while the game does little: the pace is 33 ms.
    const q = new FramePace();
    for (let i = 0; i < 60; i++) q.update(2 * tick, 6);
    expect(q.ms).toBeCloseTo(2 * tick, 1);
    // Frames whose work would not fit a 60 Hz frame may be the game's doing: the pace drifts back toward a tick.
    for (let i = 0; i < 200; i++) q.update(2 * tick, 30);
    expect(q.ms).toBeLessThan(tick + 1);
    const r = new FramePace();
    for (let i = 0; i < 60; i++) r.update(40, 38);
    expect(r.ms).toBeCloseTo(tick, 9);
  });

  it('says how often a robot runs, plainly', () => {
    expect(runsText(undefined)).toBeUndefined();
    expect(runsText({ ran: 60, of: 60 })).toBeUndefined();
    expect(runsText({ ran: 20, of: 60 })).toBe('runs 1 tick in 3');
    expect(runsText({ ran: 30, of: 60 })).toBe('runs 1 tick in 2');
    expect(runsText({ ran: 54, of: 60 })).toBe('skips 1 tick in 10');
    expect(runsText({ ran: 40, of: 60 })).toBe('skips 1 tick in 3');
  });

  it('the stepper catches up at most the cap it is given for a frame', () => {
    const s = new FixedStepper(1000 / 60);
    expect(s.advance(200, 1, 2)).toBe(2);
    // The time it had no room for is dropped, not owed.
    expect(s.advance(1000 / 60, 1, 2)).toBe(1);
    expect(s.advance(200, 1)).toBe(12);
  });
});
