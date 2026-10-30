/**
 * Batch: crash damage. A hard hit hurts the parts near where it lands, not only a warhead's fuze (`impact`).
 * Pure functions. Crash round 2: the World reads every contact's impulse (`PhysicsWorld.contactImpulses`), works out
 * the energy a group of touching bodies lost to its contacts, spreads it over the interfaces that carried the hit
 * (`crashLoad`), splits each interface's share between its two sides by hardness, and gives each side the speed that
 * energy is over its mass (`crashFelt`, `crashMass`). That speed goes through the same curve and falloff as before
 * (`crashFraction`, `crashWeight`): a body stopped dead against the ground feels the speed it hit at.
 */
import type { CrashSpec } from '../parts/types';

/** Batch: a felt speed (m/s in one step) a part shrugs off unless its def says otherwise. Drone landings are 2 to 5, a robot set down from the 6 m spawn 10. */
export const CRASH_SAFE = 12;
/** Batch: meters per second over `safe` at which a part is destroyed (before the weighting by distance). */
export const CRASH_RANGE = 8;
/** Titans: meters from where a hit lands at which its damage has fallen to nothing, so armor depth protects. */
export const CRASH_REACH = 6;
/** The weight of a part right at the hit (the nose of a missile, a falling car's wheels). */
export const CRASH_PEAK = 1.5;
/** A part's center is half a cell from its own face, so a part that close is at the hit. */
export const CRASH_HALF_CELL = 0.5;
/**
 * Review S3: a velocity change (m/s in one step) under which no part takes anything (the softest fuze is 5 m/s), so a
 * body that touches nothing is looked at no further, and a felt speed no part is hurt by. A part def with a lower
 * threshold needs this lowered with it.
 */
export const CRASH_FLOOR = 2;

/**
 * A body jolted past this (m/s in one step, or turning that fast at its farthest part) has its contacts read. Well under
 * `CRASH_FLOOR`: a heavy body stopped by a light one with the ground behind it (a slab landing on a small robot) slows
 * over several steps, the solver being slow to carry a push through a much lighter body, about 1 m/s a step for a
 * 3.2 t slab on a 27 kg robot, and every step of that is a lot of energy.
 */
export const CRASH_JOLT = 0.5;

/** A velocity change (m/s, gravity aside) as a hit: its size, and the unit direction it came from (the change points away from it). */
export function crashHit(dvx: number, dvy: number): { dv: number; ux: number; uy: number } {
  const dv = Math.sqrt(dvx * dvx + dvy * dvy);
  return { dv, ux: dv > 0 ? -dvx / dv : 0, uy: dv > 0 ? -dvy / dv : 0 };
}

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

/** The distance from a point to the nearest of `points` (at least one), as a function of the point. */
export function nearestDistance(landed: readonly { x: number; y: number }[]): (x: number, y: number) => number {
  // Touches in squares as wide as the reach: a point looks only in its square and the eight around it, and anything
  // farther is past the reach anyway (a long slab landing flat has hundreds of touches).
  const far = CRASH_REACH + CRASH_HALF_CELL;
  const key = (ix: number, iy: number): number => (ix + 32768) * 65536 + (iy + 32768);
  const squares = new Map<number, { x: number; y: number }[]>();
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

/**
 * Crash by contact: how hard a part is to crush (`crash.hardness` on its def). Where two sides touch, the softer one
 * takes more of the hit: each side's share is its softness (1 / hardness) over the two sides' together, like two
 * springs pressed together. Static terrain is infinitely hard (softness 0).
 */
export const CRASH_HARDNESS = 1;
/** Crash by contact: the hardness of a world file's dynamic box. */
export const CRASH_BOX_HARDNESS = 1;
/**
 * Crash by contact: a contact counts as where its hit landed when it pushed at least this share as hard as the
 * hardest contact of its interface, so a part resting on the same enemy far from the ram is not where the ram hit.
 */
export const CRASH_LANDED_SHARE = 0.05;

/**
 * The work (J) a contact did over one step: its impulse `(jx, jy)` on side 2, times the average over the step of
 * side 1's velocity at the contact point relative to side 2's (before `b`, after `a`). Positive when it took energy
 * out (a hit), negative when it put some in (the solver pushing overlapping parts apart). Summed over every contact of
 * a group of bodies it is the kinetic energy they lost to their contacts (exact when nothing else pushed them: the
 * velocities change linearly with the impulses), turning included; a load resting still does no work, and neither
 * does a perfectly elastic bounce.
 */
export function contactWork(jx: number, jy: number, bx: number, by: number, ax: number, ay: number): number {
  return (jx * (bx + ax) + jy * (by + ay)) / 2;
}

/**
 * How much of a group's lost energy an interface takes (the contacts between two sides): the square of its impulse
 * `(jx, jy)` (the vector sum, so pushes that cancel do not count), times its softness, the impulse-weighted sum
 * `soft` of its sides' softness over the sum of its contacts' impulse sizes `push`. Two springs carrying the same
 * force in series store energy in proportion to their softness, and to the force squared: a slab driven through a box
 * into a wall puts the hit on both faces of the box, a robot crushed under a ram onto the ground takes it top and
 * bottom.
 */
export function crashLoad(jx: number, jy: number, push: number, soft: number): number {
  if (!(push > 0)) return 0;
  return (jx * jx + jy * jy) * (soft / push);
}

/**
 * The mass a side's share of a hit is spread over: the touching body's own, `mass`, raised when its joints pushed it
 * into the hit (a car's wheel driven into a wall stops the whole car). `(jx, jy)` is the impulse the hit gave the body
 * and `(px, py)` that impulse plus what its joints gave it (its momentum change less its other contacts'), so the
 * mass is `mass * |j| / (p along j)`; at least `mass` and at most `most`, the robot's.
 */
export function crashMass(mass: number, most: number, jx: number, jy: number, px: number, py: number): number {
  const j = Math.sqrt(jx * jx + jy * jy);
  if (!(j > 0)) return mass;
  const along = (px * jx + py * jy) / j;
  if (!(along > (mass * j) / most)) return most;
  return Math.min(most, Math.max(mass, (mass * j) / along));
}

/** The speed a side feels from its share of a hit's energy, spread over `mass`: `sqrt(2 E / m)`. Against terrain, a body that stops dead feels the speed it hit at. */
export function crashFelt(energy: number, mass: number): number {
  return energy > 0 && mass > 0 ? Math.sqrt((2 * energy) / mass) : 0;
}
