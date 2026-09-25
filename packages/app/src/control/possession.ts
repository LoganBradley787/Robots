/** What possession needs to know about a robot, in spawn order. */
export interface Candidate {
  id: number;
  controllable: boolean;
}

/**
 * The robot `,` moves to after `current`: the next controllable robot in spawn order, wrapping around. When no robot
 * can be controlled it cycles through all of them (camera only). Undefined when there are no robots.
 */
export function nextRobot(robots: readonly Candidate[], current: number | undefined): number | undefined {
  const pool = robots.some((r) => r.controllable) ? robots.filter((r) => r.controllable) : robots;
  if (pool.length === 0) return undefined;
  const i = pool.findIndex((r) => r.id === current);
  return pool[(i + 1) % pool.length]?.id;
}

/** Whether you can take over a robot (M8, Logan): only your own side's (team 0), and only with a live core. */
export function canPossess(robot: { team: number; controllable: boolean }): boolean {
  return robot.team === 0 && robot.controllable;
}

/** A pointer press and release this close together (pixels) is a click, not a drag-to-pan. */
export const CLICK_SLOP_PX = 4;

export function isClick(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP_PX;
}
