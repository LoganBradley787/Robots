import { wrapAngle } from '../physics/PhysicsWorld';
import type { Behavior } from './registry';

/**
 * A rotator (Q5, M6): a motorized hinge that aims what it carries. `turn` (Z and X by auto controls) swings its aim
 * at up to `turnSpeed` rad/s within +-`range` of straight; with no input it holds the aim. The position motor's gains
 * come from the inertia of what it carries about the hinge, for a response near `frequency` rad/s critically damped,
 * so a heavy turret aims as crisply as a light one until the torque cap. Draws energy in proportion to the torque it
 * needs. `angle` reads the aim as a fraction of the range.
 */
/** How far the aim may run ahead of the turret while it is turning, in radians. */
const AIM_LEAD = 0.15;

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
    const actual = ctx.physics.jointAngle(joint.jointId);
    const mp = ctx.physics.massProperties(ctx.group.bodyId);
    // The body's origin is the rotator's cell: the hinge.
    const hinge = ctx.physics.state(ctx.group.bodyId);
    const hx = mp.comX - hinge.x;
    const hy = mp.comY - hinge.y;
    const inertia = mp.inertia + mp.mass * (hx * hx + hy * hy);
    // A heavy turret turns only as fast as the motor can stop it within about 0.2 rad (half its torque to spare for
    // gravity), and the aim never runs far ahead of it (M7): otherwise it swings far past where you let go.
    const speed = Math.min(ctx.config('turnSpeed'), Math.sqrt((0.2 * spec.maxTorque) / Math.max(inertia, 1e-6)));
    let next = (ctx.part.aim ?? 0) + turn * speed * ctx.dt;
    if (turn !== 0) next = Math.max(actual - AIM_LEAD, Math.min(actual + AIM_LEAD, next));
    next = Math.max(-range, Math.min(range, next));
    // How fast the aim moves this tick, so the motor tracks it instead of lagging behind.
    const rate = Math.max(-speed, Math.min(speed, (next - (ctx.part.aim ?? 0)) / ctx.dt));
    const f = ctx.config('frequency');
    const stiffness = inertia * f * f;
    const damping = 2 * inertia * f;
    const need = Math.abs(stiffness * wrapAngle(next - actual)) / spec.maxTorque;
    return {
      load: Math.min(1, Math.max(Math.abs(turn), need)),
      run(grant) {
        if (grant > 0) ctx.part.aim = next;
        ctx.physics.setPositionMotor(joint.jointId, ctx.part.aim ?? 0, stiffness, damping, spec.maxTorque * grant, grant > 0 ? rate : 0);
      },
    };
  },
  output(part, name) {
    const range = part.def.behaviorConfig?.range ?? 0;
    return name === 'angle' && range > 0 ? (part.aim ?? 0) / range : undefined;
  },
};
