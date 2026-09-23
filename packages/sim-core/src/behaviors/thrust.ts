import { faceDir, rotateFace } from '../parts/faces';
import type { Behavior } from './registry';

/**
 * Thrusters and propellers: throttle * maxForce along the direction the part acts (its `acts` face, rotated with
 * the part and its body), applied at the part's cell center as a one-tick impulse.
 */
export const thrust: Behavior = {
  config: ['maxForce'],
  needsActs: true,
  apply(ctx) {
    const t = ctx.value('throttle');
    const acts = ctx.part.def.acts;
    if (t === 0 || acts === undefined) return;
    const dir = faceDir(rotateFace(acts, ctx.part.rot));
    const s = ctx.physics.state(ctx.group.bodyId);
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    const dx = c * dir.x - n * dir.y;
    const dy = n * dir.x + c * dir.y;
    const px = s.x + c * ctx.part.localX - n * ctx.part.localY;
    const py = s.y + n * ctx.part.localX + c * ctx.part.localY;
    const force = t * ctx.config('maxForce');
    ctx.physics.addForceAt(ctx.group.bodyId, dx * force, dy * force, px, py);
  },
};
