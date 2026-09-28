import { faceDir, rotateFace } from '../parts/faces';
import type { Behavior, BehaviorContext } from './registry';
import type { Face } from '../parts/types';

/**
 * Thrusters and propellers: throttle * maxForce along the direction the part acts (its `acts` face, rotated with
 * the part and its body), applied at the part's cell center as a force for the tick. Draws energy by throttle.
 *
 * Batch, swiveling thrusters: a def whose behaviorConfig has `swivel` (degrees, above 0) also reads a `swivel` input
 * (-1 to 1) and tilts the push that many degrees counterclockwise per unit (negative: clockwise). The push still
 * lands at the part's cell center, so a tilted push turns the robot as well as moving it. Without `swivel` in the
 * config nothing changes.
 */
export const thrust: Behavior = {
  config: ['maxForce'],
  needsActs: true,
  plan(ctx) {
    const t = ctx.value('throttle');
    const acts = ctx.part.def.acts;
    if (t === 0 || acts === undefined) return undefined;
    return { load: t, run: (grant) => push(ctx, acts, t * grant, swivelAngle(ctx)) };
  },
};

/** Batch: how far the push is tilted this tick, in radians counterclockwise (0 for a part with no `swivel` config). */
function swivelAngle(ctx: BehaviorContext): number {
  const max = ctx.config('swivel');
  if (max <= 0) return 0;
  return (Math.max(-1, Math.min(1, ctx.value('swivel'))) * max * Math.PI) / 180;
}

/** Pushes with `t` (0 to 1) of maxForce, as a force for this tick at the part's cell center, tilted by `tilt` radians. */
function push(ctx: BehaviorContext, acts: Face, t: number, tilt: number): void {
  const face = faceDir(rotateFace(acts, ctx.part.rot));
  // Turn the push direction by the swivel (exactly the face direction when there is none).
  const dir = tilt === 0 ? face : { x: Math.cos(tilt) * face.x - Math.sin(tilt) * face.y, y: Math.sin(tilt) * face.x + Math.cos(tilt) * face.y };
  const s = ctx.physics.state(ctx.group.bodyId);
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  const dx = c * dir.x - n * dir.y;
  const dy = n * dir.x + c * dir.y;
  const px = s.x + c * ctx.part.localX - n * ctx.part.localY;
  const py = s.y + n * ctx.part.localX + c * ctx.part.localY;
  const force = t * ctx.config('maxForce');
  ctx.physics.addForceAt(ctx.group.bodyId, dx * force, dy * force, px, py);
}
