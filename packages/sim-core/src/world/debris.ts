import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { REST_SPEED, REST_SPIN } from '../metrics/robotMetrics';
import type { Robot } from './Robot';
import { hypot } from '../math/fdlibm';

/** Batch: how long a broken-off, coreless piece must rest before it is swept away, seconds. */
export const DEBRIS_REST_SECONDS = 10;
/** Batch: the most broken-off, coreless pieces that stay in the world; past this the oldest go first. */
export const DEBRIS_CAP = 200;

/** A part's cell center this far under the surface (y = 0, in meters) has its whole cell under it. */
export const UNDER_SURFACE = -0.5;

/**
 * Batch: debris is a piece that broke off something (`brokeFrom`) and has no core in charge. A robot spawned coreless
 * on purpose (a wall, a bomb, a target) never broke off anything, so it is never debris. Integration: a piece holding
 * an armed part (a distance charge dropped as a ground charge, a bomb let go) is live, not debris, so it never fades.
 */
export function isDebris(robot: Robot): boolean {
  if (robot.brokeFrom === undefined || robot.primaryCoreId !== undefined) return false;
  for (const part of robot.parts.values()) if (part.armed === true) return false;
  return true;
}

/** Every body of the robot is nearly still (the same thresholds as robotMetrics' resting). */
function atRest(physics: PhysicsWorld, robot: Robot): boolean {
  for (const g of robot.groups) {
    const s = physics.state(g.bodyId);
    if (hypot(s.vx, s.vy) >= REST_SPEED || Math.abs(s.w) >= REST_SPIN) return false;
  }
  return true;
}

/**
 * Whether every part of the robot is wholly under the ground's surface. Nothing can get there through the ground, so
 * it has left over the ground's edge and fallen past it. Every tick for every robot, so a body above the line settles
 * it at once and only a robot with all its bodies under it has its parts walked.
 */
export function isUnderground(physics: PhysicsWorld, robot: Robot): boolean {
  if (robot.parts.size === 0) return false;
  for (const g of robot.groups) if (physics.state(g.bodyId).y >= UNDER_SURFACE) return false;
  for (const part of robot.parts.values()) {
    const g = robot.groups[part.group];
    if (!g) continue;
    const s = physics.state(g.bodyId);
    const { c, n } = physics.turn(g.bodyId);
    if (s.y + n * part.localX + c * part.localY >= UNDER_SURFACE) return false;
  }
  return true;
}

/**
 * Batch: one tick of the debris sweep. `rest` counts the consecutive ticks each resting debris piece has been still
 * (only pieces with a count above 0 have an entry). Returns the robots to remove: pieces that rested for `restTicks`,
 * then, if more than DEBRIS_CAP debris pieces remain, the oldest (lowest id) until the cap holds. `robots` is in
 * creation order, so the walk and the result are stable.
 */
export function sweepDebris(physics: PhysicsWorld, robots: readonly Robot[], rest: Map<number, number>, restTicks: number): Robot[] {
  const gone: Robot[] = [];
  const kept: Robot[] = [];
  for (const robot of robots) {
    if (!isDebris(robot)) {
      rest.delete(robot.id);
      continue;
    }
    if (!atRest(physics, robot)) {
      rest.delete(robot.id);
      kept.push(robot);
      continue;
    }
    const n = (rest.get(robot.id) ?? 0) + 1;
    if (n >= restTicks) gone.push(robot);
    else {
      rest.set(robot.id, n);
      kept.push(robot);
    }
  }
  if (kept.length > DEBRIS_CAP) {
    const over = [...kept].sort((a, b) => a.id - b.id).slice(0, kept.length - DEBRIS_CAP);
    gone.push(...over);
  }
  return gone;
}
