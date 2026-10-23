import type { ExplodeSpec } from '../parts/types';
import { cos, powInt, sin } from '../math/fdlibm';

/** A part cell in world space: its center and its body's angle. */
export interface BlastCell {
  x: number;
  y: number;
  angle: number;
}

/** A box that blocks a blast (terrain), in world space. */
export interface BlastBox {
  x: number;
  y: number;
  hx: number;
  hy: number;
  angle: number;
}

export interface BlastEffect {
  /** Damage to each cell, same order as the cells passed in (0 outside the radius). */
  damage: number[];
  /** Push on each cell in N s, away from the center (0 outside the push radius). */
  push: { jx: number; jy: number }[];
}

/** Every cell or box in the way halves the damage (`03`, Explosions: cover). */
export const COVER_FACTOR = 0.5;
/**
 * Cells block with a slightly smaller box than they are, so a line running exactly along the seam between two
 * neighbors (or grazing a corner) does not count them as cover.
 */
const COVER_HALF = 0.45;

/**
 * The v1 blast model (`03`, M6 plan): damage falls linearly from `damage` at the center to 0 at `radius`, halved by
 * every other part cell and terrain box the straight line to the cell's center crosses. Every cell within
 * `pushRadius` is pushed with `push * (1 - d / pushRadius)` N s, away from a point `lift` below the center.
 * Pure and order independent.
 */
export function blastEffects(center: { x: number; y: number }, spec: ExplodeSpec, cells: readonly BlastCell[], terrain: readonly BlastBox[]): BlastEffect {
  const damage = cells.map(() => 0);
  const push = cells.map(() => ({ jx: 0, jy: 0 }));
  // Only cells near enough to block a line inside the radius can be cover.
  const reach = spec.radius + 1;
  const blockers = cells.flatMap((c, i) => {
    const dx = c.x - center.x;
    const dy = c.y - center.y;
    return Math.sqrt(dx * dx + dy * dy) <= reach ? [i] : [];
  });
  cells.forEach((c, i) => {
    const dx = c.x - center.x;
    const dy = c.y - center.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < spec.radius) {
      let hits = 0;
      for (const j of blockers) {
        const b = cells[j] as BlastCell;
        if (j !== i && segmentHitsBox(center.x, center.y, c.x, c.y, b.x, b.y, COVER_HALF, COVER_HALF, b.angle)) hits++;
      }
      for (const t of terrain) if (segmentHitsBox(center.x, center.y, c.x, c.y, t.x, t.y, t.hx, t.hy, t.angle)) hits++;
      damage[i] = spec.damage * (1 - d / spec.radius) * powInt(COVER_FACTOR, hits);
    }
    if (d < spec.pushRadius && d > 1e-9) {
      const j = spec.push * (1 - d / spec.pushRadius);
      // Measured from `lift` below the center: a blast throws things up and out, so it can knock a car over
      // instead of only rolling it along on its wheels.
      const ly = dy + spec.lift;
      const l = Math.sqrt(dx * dx + ly * ly);
      // A cell exactly `lift` below the center has no direction of its own (review S5: it got a NaN push): up.
      push[i] = l > 1e-9 ? { jx: (j * dx) / l, jy: (j * ly) / l } : { jx: 0, jy: j };
    }
  });
  return { damage, push };
}

/** Whether the segment from (ax, ay) to (bx, by) crosses the box (center, half extents, angle). Slab test. */
export function segmentHitsBox(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, hx: number, hy: number, angle: number): boolean {
  return segmentHitsTurnedBox(ax, ay, bx, by, cx, cy, hx, hy, cos(angle), sin(angle));
}

/** `segmentHitsBox` given the cosine `c` and sine `s` of the box's angle, for a caller that tests one box many times. */
export function segmentHitsTurnedBox(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, hx: number, hy: number, c: number, s: number): boolean {
  // Into the box's frame.
  const px = c * (ax - cx) + s * (ay - cy);
  const py = -s * (ax - cx) + c * (ay - cy);
  const qx = c * (bx - cx) + s * (by - cy);
  const qy = -s * (bx - cx) + c * (by - cy);
  let t0 = 0;
  let t1 = 1;
  // Across x, then across y.
  let d = qx - px;
  if (Math.abs(d) < 1e-12) {
    if (px < -hx || px > hx) return false;
  } else {
    let ta = (-hx - px) / d;
    let tb = (hx - px) / d;
    if (ta > tb) {
      const t = ta;
      ta = tb;
      tb = t;
    }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  d = qy - py;
  if (Math.abs(d) < 1e-12) {
    if (py < -hy || py > hy) return false;
  } else {
    let ta = (-hy - py) / d;
    let tb = (hy - py) / d;
    if (ta > tb) {
      const t = ta;
      ta = tb;
      tb = t;
    }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}
