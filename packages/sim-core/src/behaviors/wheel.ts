import type { Behavior } from './registry';

/**
 * An electric motor (`11`, Driving feel). With throttle t != 0 the velocity motor aims for t * maxSpeed with
 * torque min(|t| * maxTorque, motorFactor * speed error): full torque from standstill up to a knee, then falling
 * to zero at top speed. With t == 0 the motor goes nearly slack (coastTorque), so the robot coasts.
 * Forward (+1) rolls toward +x, whatever the wheel's rotation: that is clockwise, a negative relative velocity.
 */
export const wheel: Behavior = {
  config: ['maxSpeed', 'coastTorque'],
  needsJoint: true,
  apply(ctx) {
    const joint = ctx.group.joint;
    const spec = ctx.part.def.joint;
    if (!joint || !spec || joint.partId !== ctx.part.id) return;
    const t = ctx.value('speed');
    if (t === 0) ctx.physics.setMotor(joint.jointId, 0, spec.motorFactor, ctx.config('coastTorque'));
    else ctx.physics.setMotor(joint.jointId, -t * ctx.config('maxSpeed'), spec.motorFactor, Math.abs(t) * spec.maxTorque);
  },
};
