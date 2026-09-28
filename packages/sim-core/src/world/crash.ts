/**
 * Batch: crash damage. A hard hit hurts every part of the body it stops, not only a warhead's fuze (`impact`).
 * Pure functions: the World measures each body's velocity change in one step (gravity aside) and applies the result.
 */
import type { CrashSpec } from '../parts/types';

/** Batch: a velocity change (m/s in one step) a part shrugs off unless its def says otherwise. Drone landings are 2 to 5, a robot set down from the 6 m spawn 10. */
export const CRASH_SAFE = 12;
/** Batch: meters per second over `safe` at which a part is destroyed (before the nose-first weighting). */
export const CRASH_RANGE = 8;

/** The fraction of a part's health a hit of `dv` costs before weighting: 0 at or under safe, 1 at safe + range, squared between. */
export function crashFraction(dv: number, spec: CrashSpec | undefined): number {
  const safe = spec?.safe ?? CRASH_SAFE;
  if (!(dv > safe)) return 0;
  const x = (dv - safe) / (spec?.range ?? CRASH_RANGE);
  return x * x;
}

/**
 * Where a part sits along the hit (across its whole robot, so a car's wheels, each their own body, count as its lowest), from 0.5 (the far side of its body) to 1.5 (the side that took the hit). The hit
 * came from the direction the body's velocity change points away from, so `along` is a part's offset from its robot's
 * center projected on that direction (positive toward the impact) and `reach` the largest offset in the robot. A
 * robot of one part, or a hit with no spread, weighs 1. Rapier reports no contact points for multibody links, so this
 * stands in for "the parts nearest the impact take the most" (a falling car's wheels, a missile's nose).
 */
export function crashWeight(along: number, reach: number): number {
  if (!(reach > 1e-6)) return 1;
  return 1 + 0.5 * Math.max(-1, Math.min(1, along / reach));
}
