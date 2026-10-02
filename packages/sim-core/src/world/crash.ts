/**
 * Batch: crash damage. A hard hit hurts the parts near where it lands, not only a warhead's fuze (`impact`).
 * Pure functions: the World measures each body's velocity change in one step (gravity aside), finds where the hit
 * landed, and applies the result.
 */
import type { CrashSpec } from '../parts/types';

/** Batch: a velocity change (m/s in one step) a part shrugs off unless its def says otherwise. Drone landings are 2 to 5, a robot set down from the 6 m spawn 10. */
export const CRASH_SAFE = 12;
/** Batch: meters per second over `safe` at which a part is destroyed (before the weighting by distance). */
export const CRASH_RANGE = 8;
/** Titans: meters from where a hit lands at which its damage has fallen to nothing, so armor depth protects. */
export const CRASH_REACH = 6;
/** The weight of a part right at the hit (the nose of a missile, a falling car's wheels). */
export const CRASH_PEAK = 1.5;
/** A part's center is half a cell from its own face, so a part that close is at the hit. */
export const CRASH_HALF_CELL = 0.5;
/** How well a contact's push must line up with a body's velocity change to be where its hit landed (the cosine of 60 degrees), so the ground under a robot rammed from the side does not count. */
export const CRASH_AGREE = 0.5;

/** The fraction of a part's health a hit of `dv` costs before weighting: 0 at or under safe, 1 at safe + range, squared between. */
export function crashFraction(dv: number, spec: CrashSpec | undefined): number {
  const safe = spec?.safe ?? CRASH_SAFE;
  if (!(dv > safe)) return 0;
  const x = (dv - safe) / (spec?.range ?? CRASH_RANGE);
  return x * x;
}

/**
 * Titans: crash damage is local. The weight of a part whose center is `distance` meters from where the hit landed:
 * `CRASH_PEAK` at the hit (within half a cell), falling in a straight line to 0 at `CRASH_REACH` past that. A robot a
 * few meters across is all within reach, nose first as before (a five cell missile goes from 1.5 to 0.5); a core
 * under seven cells of armor takes nothing.
 */
export function crashWeight(distance: number): number {
  const d = Math.max(0, distance - CRASH_HALF_CELL);
  return CRASH_PEAK * Math.max(0, 1 - d / CRASH_REACH);
}

/** A place a body was touched on the last step, with the unit direction the touch pushed it. */
export interface CrashTouch {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/**
 * How far a point is from where a hit landed, as a function of the point. `touches` are the robot's contact points on
 * that step and (ux, uy) the unit direction the hit came from (the body's velocity change points away from it). The
 * touches that pushed the body that way are where it landed, and the distance is to the nearest of them. With none
 * (a rope pulled tight, a hit passed on by something that is not a contact), `lead` gives the robot's leading face:
 * the largest offset along (ux, uy) of any of its parts, and the distance is the depth behind that face.
 */
export function crashDistance(touches: readonly CrashTouch[], ux: number, uy: number, lead: () => number): (x: number, y: number) => number {
  const landed = touches.filter((t) => -(t.nx * ux + t.ny * uy) > CRASH_AGREE);
  if (landed.length === 0) {
    const face = lead();
    return (x, y) => face - (x * ux + y * uy) + CRASH_HALF_CELL;
  }
  // Touches in squares as wide as the reach: a point looks only in its square and the eight around it, and anything
  // farther is past the reach anyway (a long slab landing flat has hundreds of touches).
  const far = CRASH_REACH + CRASH_HALF_CELL;
  const key = (ix: number, iy: number): number => (ix + 32768) * 65536 + (iy + 32768);
  const squares = new Map<number, CrashTouch[]>();
  for (const t of landed) {
    const k = key(Math.floor(t.x / far), Math.floor(t.y / far));
    const list = squares.get(k);
    if (list) list.push(t);
    else squares.set(k, [t]);
  }
  return (x, y) => {
    const ix = Math.floor(x / far);
    const iy = Math.floor(y / far);
    let best = Infinity;
    for (let i = ix - 1; i <= ix + 1; i++) {
      for (let j = iy - 1; j <= iy + 1; j++) {
        for (const t of squares.get(key(i, j)) ?? []) {
          const d = (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y);
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best);
  };
}
