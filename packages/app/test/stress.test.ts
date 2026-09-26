import { describe, expect, it } from 'vitest';
import type { WorldFile } from '@robots/sim-core';
import { HOVER_GRID, placeGrid, surfaceAt } from '../src/world/stress';
import { PerfMeter } from '../src/app/perfMeter';

const world = (over: Partial<WorldFile> = {}): WorldFile => ({ name: 't', ground: { width: 1000, thickness: 2 }, boxes: [], spawn: { x: 0, y: 6 }, ...over });

describe('stress test layout (M9)', () => {
  it('reads the terrain top from the ground and fixed boxes, and nothing past the ends', () => {
    const file = world({ boxes: [{ x: 20, y: 1, w: 4, h: 2, angleDeg: 0, dynamic: false, mass: 0 }, { x: -20, y: 1, w: 4, h: 2, angleDeg: 0, dynamic: true, mass: 1 }] });
    expect(surfaceAt(file, 0)).toBe(0);
    expect(surfaceAt(file, 21)).toBe(2);
    expect(surfaceAt(file, -20)).toBe(0);
    expect(surfaceAt(file, 600)).toBeUndefined();
  });

  it('fills rows around the center, each spot its lift above the terrain under it', () => {
    const spots = placeGrid({ x: 100 }, HOVER_GRID(12), (x) => (x > 100 ? 5 : 0), () => true);
    expect(spots).toHaveLength(12);
    expect(spots[0]).toEqual({ x: 100 - 4.5 * 16, y: 8 });
    expect(spots[9]).toEqual({ x: 100 + 4.5 * 16, y: 13 });
    expect(spots[10]).toEqual({ x: 100 - 4.5 * 16, y: 20 });
  });

  it('skips spots with no room and keeps going', () => {
    const spots = placeGrid({ x: 0 }, HOVER_GRID(10), () => 0, (at) => at.x !== -72);
    expect(spots).toHaveLength(10);
    expect(spots.some((s) => s.x === -72)).toBe(false);
  });

  it('places fewer, and stops, on a world narrower than the grid', () => {
    const narrow = world({ ground: { width: 40, thickness: 2 } });
    const tried: number[] = [];
    const spots = placeGrid({ x: 0 }, HOVER_GRID(100), (x) => surfaceAt(narrow, x), (at) => {
      tried.push(at.x);
      return true;
    });
    // Only the two middle columns (x = -8 and 8) have ground under them, over 30 rows.
    expect(new Set(spots.map((s) => s.x))).toEqual(new Set([-8, 8]));
    expect(spots).toHaveLength(60);
    expect(tried).toHaveLength(60);
  });
});

describe('perf meter (M9)', () => {
  it('averages a window of frames into per-tick and per-frame numbers', () => {
    const m = new PerfMeter(100);
    expect(m.readout).toBeUndefined();
    m.add({ frameMs: 50, ticks: 3, simMs: 6, scriptMs: 3, scriptCalls: 30, viewMs: 2 });
    expect(m.readout).toBeUndefined();
    m.add({ frameMs: 50, ticks: 1, simMs: 2, scriptMs: 1, scriptCalls: 10, viewMs: 4 });
    expect(m.readout).toEqual({ fps: 20, ticksPerFrame: 2, simMs: 2, scriptMs: 1, restMs: 1, scriptCallsPerTick: 10, viewMs: 3 });
    expect(m.lines(5)[1]).toBe('sim 2.00 ms/tick = scripts 1.00 + rest 1.00   (a frame has 16.7 ms)');
  });

  it('starts a new window after each readout', () => {
    const m = new PerfMeter(10);
    m.add({ frameMs: 10, ticks: 1, simMs: 1, scriptMs: 0, scriptCalls: 0, viewMs: 0 });
    m.add({ frameMs: 10, ticks: 2, simMs: 8, scriptMs: 4, scriptCalls: 2, viewMs: 1 });
    expect(m.readout?.simMs).toBe(4);
    expect(m.readout?.fps).toBe(100);
  });

  it('shows no per-tick numbers for a paused window', () => {
    const m = new PerfMeter(10);
    m.add({ frameMs: 16, ticks: 0, simMs: 0, scriptMs: 0, scriptCalls: 0, viewMs: 1 });
    expect(m.readout).toMatchObject({ ticksPerFrame: 0, simMs: 0, scriptMs: 0 });
  });
});
