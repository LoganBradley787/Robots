import type { ExplodeSpec } from '../parts/types';

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
      damage[i] = spec.damage * (1 - d / spec.radius) * COVER_FACTOR ** hits;
    }
    if (d < spec.pushRadius && d > 1e-9) {
      const j = spec.push * (1 - d / spec.pushRadius);
      // Measured from `lift` below the center: a blast throws things up and out, so it can knock a car over
      // instead of only rolling it along on its wheels.
      const ly = dy + spec.lift;
      const l = Math.sqrt(dx * dx + ly * ly);
      push[i] = { jx: (j * dx) / l, jy: (j * ly) / l };
    }
  });
  return { damage, push };
}

/** Whether the segment from (ax, ay) to (bx, by) crosses the box (center, half extents, angle). Slab test. */
export function segmentHitsBox(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, hx: number, hy: number, angle: number): boolean {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Into the box's frame.
  const toLocal = (x: number, y: number): [number, number] => [c * (x - cx) + s * (y - cy), -s * (x - cx) + c * (y - cy)];
  const [px, py] = toLocal(ax, ay);
  const [qx, qy] = toLocal(bx, by);
  let t0 = 0;
  let t1 = 1;
  for (const [p, d, h] of [
    [px, qx - px, hx],
    [py, qy - py, hy],
  ] as const) {
    if (Math.abs(d) < 1e-12) {
      if (p < -h || p > h) return false;
      continue;
    }
    let ta = (-h - p) / d;
    let tb = (h - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}
