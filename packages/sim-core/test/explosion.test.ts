import { describe, expect, it } from 'vitest';
import { blastEffects, segmentHitsBox } from '../src/damage/explosion';
import { defaultRegistry } from '../src/parts/registry';
import type { ExplodeSpec } from '../src/parts/types';

const WARHEAD = defaultRegistry().get('warhead').onDestroyed?.explode as ExplodeSpec;
const O = { x: 0, y: 0 };
const cell = (x: number, y: number, angle = 0) => ({ x, y, angle });

/** Farthest distance at which a lone part of this health is destroyed by a warhead. */
function killDistance(health: number): number {
  return WARHEAD.radius * (1 - health / WARHEAD.damage);
}

describe('blast model (M6)', () => {
  it('kills by distance: frames within 1.5 m (a 3 m hole), batteries 2.25 m, propellers 2.625 m', () => {
    const health = Object.fromEntries(defaultRegistry().list().map((d) => [d.id, d.health]));
    expect(killDistance(health.frame as number)).toBeCloseTo(1.5, 9);
    expect(killDistance(health.battery as number)).toBeCloseTo(2.25, 9);
    expect(killDistance(health.propeller as number)).toBeCloseTo(2.625, 9);
    const fx = blastEffects(O, WARHEAD, [cell(1.4, 0), cell(0, 1.6), cell(0, -2.5), cell(3, 0)], []);
    expect(fx.damage[0]).toBeGreaterThanOrEqual(60);
    expect(fx.damage[1]).toBeLessThan(60);
    expect(fx.damage[2]).toBeCloseTo(120 / 6, 9);
    expect(fx.damage[3]).toBe(0);
  });

  it('every cell in the way halves the damage', () => {
    const behind = blastEffects(O, WARHEAD, [cell(1, 0), cell(2, 0)], []);
    expect(behind.damage[1]).toBeCloseTo((120 / 3) * 0.5, 9);
    const two = blastEffects(O, WARHEAD, [cell(0.9, 0), cell(1.7, 0), cell(2.5, 0)], []);
    expect(two.damage[2]).toBeCloseTo((120 / 6) * 0.25, 9);
  });

  it('a battery 2 m away dies in the open but survives behind one frame: armor works', () => {
    const battery = defaultRegistry().get('battery').health;
    expect(blastEffects(O, WARHEAD, [cell(2, 0)], []).damage[0]).toBeGreaterThanOrEqual(battery);
    const fx = blastEffects(O, WARHEAD, [cell(1, 0), cell(2, 0)], []);
    expect(fx.damage[1]).toBeCloseTo(20, 9);
    expect(fx.damage[1]).toBeLessThan(battery);
  });

  it('a line along the seam between two rows is not covered', () => {
    const fx = blastEffects({ x: 0, y: 0.5 }, WARHEAD, [cell(1, 0), cell(1, 1), cell(2, 0.5)], []);
    expect(fx.damage[2]).toBeCloseTo(120 / 3, 9);
  });

  it('terrain blocks the blast', () => {
    const wall = { x: 1, y: 0, hx: 0.2, hy: 3, angle: 0 };
    const fx = blastEffects(O, WARHEAD, [cell(2, 0)], [wall]);
    expect(fx.damage[0]).toBeCloseTo((120 / 3) * 0.5, 9);
  });

  it('pushes up and out, falling to 0 at the push radius', () => {
    const fx = blastEffects(O, WARHEAD, [cell(2.5, 0), cell(-2.5, 1.5), cell(5, 0)], []);
    const p = fx.push[0] as { jx: number; jy: number };
    expect(Math.hypot(p.jx, p.jy)).toBeCloseTo(40 * 0.5, 9);
    // From 1.5 m below the center: up and to the right.
    expect(p.jy / p.jx).toBeCloseTo(1.5 / 2.5, 9);
    expect(fx.push[1]?.jx).toBeLessThan(0);
    expect(fx.push[1]?.jy).toBeGreaterThan(0);
    expect(fx.push[2]).toEqual({ jx: 0, jy: 0 });
  });

  it('segment against a rotated box', () => {
    expect(segmentHitsBox(-2, 0, 2, 0, 0, 0, 0.5, 0.5, 0)).toBe(true);
    expect(segmentHitsBox(-2, 1, 2, 1, 0, 0, 0.5, 0.5, 0)).toBe(false);
    // Turned 45 degrees, the box's corner reaches 0.707 up.
    expect(segmentHitsBox(-2, 0.6, 2, 0.6, 0, 0, 0.5, 0.5, Math.PI / 4)).toBe(true);
    expect(segmentHitsBox(-2, 0.6, -1, 0.6, 0, 0, 0.5, 0.5, Math.PI / 4)).toBe(false);
  });
});
