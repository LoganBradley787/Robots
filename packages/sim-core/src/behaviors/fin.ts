import { faceDir, rotateFace } from '../parts/faces';
import type { Behavior } from './registry';

/** Density of the air, kg per cubic meter. A fin's k is half of this times its area. */
export const AIR_DENSITY = 1.2;

/**
 * Fins (Batch): a flat plate along the part's `acts` axis that pushes on the air. In still air the air velocity at the
 * fin's cell is minus the body's velocity there (the center of mass velocity plus the spin times the arm), and the
 * plate takes the force F = -k * (v . n) * |v| * n at its cell, where n is the plate's normal (perpendicular to
 * `acts`, turned by the deflection) and k = 0.5 * 1.2 * area. Along the plate (v . n = 0) nothing happens; across it
 * the force grows with the square of the speed. So fins behind the middle keep a nose into the wind, and the
 * `deflect` input (-1 to 1, times the def's `deflect` degrees, counterclockwise positive) turns the plate to steer.
 * No energy. Reads `area` and `deflect` from behaviorConfig.
 */
export const fin: Behavior = {
  config: ['area', 'deflect'],
  needsActs: true,
  plan(ctx) {
    const acts = ctx.part.def.acts;
    if (acts === undefined) return undefined;
    const bodyId = ctx.group.bodyId;
    const s = ctx.physics.state(bodyId);
    const c = Math.cos(s.angle);
    const sn = Math.sin(s.angle);
    const px = s.x + c * ctx.part.localX - sn * ctx.part.localY;
    const py = s.y + sn * ctx.part.localX + c * ctx.part.localY;
    // The body's velocity at the cell: the center of mass moves at (vx, vy) and the body turns at w about it.
    const com = ctx.physics.massProperties(bodyId);
    const vx = s.vx - s.w * (py - com.comY);
    const vy = s.vy + s.w * (px - com.comX);
    // sqrt, not hypot: the spec lets engines approximate hypot, and this feeds forces every tick.
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed === 0) return undefined;
    // The plate's axis in the world, then its normal: a quarter turn counterclockwise, turned again by the deflection.
    const dir = faceDir(rotateFace(acts, ctx.part.rot));
    const ax = c * dir.x - sn * dir.y;
    const ay = sn * dir.x + c * dir.y;
    const turn = Math.max(-1, Math.min(1, ctx.value('deflect'))) * ctx.config('deflect') * (Math.PI / 180);
    const nx = Math.cos(turn) * -ay - Math.sin(turn) * ax;
    const ny = Math.cos(turn) * ax - Math.sin(turn) * ay;
    const across = vx * nx + vy * ny;
    if (across === 0) return undefined;
    const f = -0.5 * AIR_DENSITY * ctx.config('area') * across * speed;
    return { load: 0, run: () => ctx.physics.addForceAt(bodyId, f * nx, f * ny, px, py) };
  },
};
