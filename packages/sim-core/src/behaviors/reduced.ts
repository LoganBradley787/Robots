import type { MassProperties } from '../physics/PhysicsWorld';

/**
 * S4 (review 2026-10-09): what a joint motor actually turns or pushes. Its torque or force acts on both sides of the
 * joint, so a light mount under a heavy hull is what moves, and gains sized from the carried side alone overshoot it.
 * Each side is a whole body group (every part welded together on that side), as `massProperties` reports it.
 */

/**
 * The inertia (kg m^2) a hinge's motor drives between its two sides, each taken about the hinge (hx, hy, world):
 * `Ic Ip / (Ic + Ip)`, the reduced inertia. A mount much heavier than what it carries gives the carried side's own
 * (the gain before S4), a light mount under a heavy hull gives about the mount's. It never exceeds the lighter side's,
 * so the motor's damping stays inside its stability limit for either.
 */
export function hingeInertia(child: MassProperties, parent: MassProperties, hx: number, hy: number): number {
  const ic = aboutPoint(child, hx, hy);
  const ip = aboutPoint(parent, hx, hy);
  return Math.max((ic * ip) / Math.max(ic + ip, 1e-9), 1e-6);
}

/** A body's moment of inertia about a world point, by the parallel axis theorem. */
export function aboutPoint(mp: MassProperties, x: number, y: number): number {
  const dx = mp.comX - x;
  const dy = mp.comY - y;
  return mp.inertia + mp.mass * (dx * dx + dy * dy);
}

/**
 * How far past the pair's reduced inertia (or mass) a motor's gains may be sized. The gains still follow what the joint
 * carries, as before S4: that is right when the mount is held (a hull on the ground, which a free pair's reduced inertia
 * leaves out), and turrets, walkers and lifts were tuned on it. Only where the carried side is more than twice the
 * reduced one (a light mount under a heavy hull) is it cut back. Sized for `m`, a motor's damping overshoots in one
 * step once the true inertia is under `2 f dt m` (a fifth of `m` at 12 rad/s and 60 Hz); at twice, it has 2.5 times
 * that to spare.
 */
export const MOTOR_REDUCED_LIMIT = 2;

/** The inertia or mass a joint motor's gains are sized for: what it carries, capped at `MOTOR_REDUCED_LIMIT` times the pair's reduced one. */
export function motorLoad(carried: number, reduced: number): number {
  return Math.min(carried, MOTOR_REDUCED_LIMIT * reduced);
}

/** The reduced mass (kg) of two bodies pushed apart by a force pair: `m1 m2 / (m1 + m2)`. */
export function reducedMass(a: number, b: number): number {
  return (a * b) / Math.max(a + b, 1e-9);
}
