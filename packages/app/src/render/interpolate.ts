import type { BodyState } from '@robots/sim-core';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolates along the shortest arc so a body crossing the pi boundary does not spin the long way. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export function interpolateState(prev: BodyState, curr: BodyState, alpha: number): BodyState {
  return {
    x: lerp(prev.x, curr.x, alpha),
    y: lerp(prev.y, curr.y, alpha),
    angle: lerpAngle(prev.angle, curr.angle, alpha),
    vx: curr.vx,
    vy: curr.vy,
    w: curr.w,
  };
}
