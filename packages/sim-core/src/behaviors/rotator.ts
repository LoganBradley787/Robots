import { wrapAngle } from '../physics/PhysicsWorld';
import type { Behavior } from './registry';

/**
 * A rotator (Q5, M6): a motorized hinge that aims what it carries. `turn` (Z and X by auto controls) swings its aim
 * at up to `turnSpeed` rad/s within +-`range` of straight; with no input it holds the aim. The position motor's gains
 * come from the inertia of what it carries about the hinge, for a response near `frequency` rad/s critically damped,
 * so a heavy turret aims as crisply as a light one until the torque cap. Draws energy in proportion to the torque it
 * needs. `angle` reads the aim as a fraction of the range.
 */
export const rotator: Behavior = {
  config: ['range', 'turnSpeed', 'frequency'],
  needsJoint: true,
  plan(ctx) {
    const joint = ctx.group.joint;
    const spec = ctx.part.def.joint;
    // Locked, or its base was shot away: nothing to turn against.
    if (!joint || !spec || joint.partId !== ctx.part.id) return undefined;
    const range = ctx.config('range');
    const turn = ctx.value('turn');
    const next = Math.max(-range, Math.min(range, (ctx.part.aim ?? 0) + turn * ctx.config('turnSpeed') * ctx.dt));
    const mp = ctx.physics.massProperties(ctx.group.bodyId);
    // The body's origin is the rotator's cell: the hinge.
    const hinge = ctx.physics.state(ctx.group.bodyId);
    const inertia = mp.inertia + mp.mass * ((mp.comX - hinge.x) ** 2 + (mp.comY - hinge.y) ** 2);
    const f = ctx.config('frequency');
    const stiffness = inertia * f * f;
    const damping = 2 * inertia * f;
    const need = Math.abs(stiffness * wrapAngle(next - ctx.physics.jointAngle(joint.jointId))) / spec.maxTorque;
    return {
      load: Math.min(1, Math.max(Math.abs(turn), need)),
      run(grant) {
        if (grant > 0) ctx.part.aim = next;
        ctx.physics.setPositionMotor(joint.jointId, ctx.part.aim ?? 0, stiffness, damping, spec.maxTorque * grant);
      },
    };
  },
  output(part, name) {
    const range = part.def.behaviorConfig?.range ?? 0;
    return name === 'angle' && range > 0 ? (part.aim ?? 0) / range : undefined;
  },
};
