import type { Behavior } from './registry';

/**
 * An electric motor (`11`, Driving feel). With throttle t != 0 the velocity motor aims for t * maxSpeed with
 * torque min(|t| * maxTorque, motorFactor * speed error): full torque from standstill up to a knee, then falling
 * to zero at top speed. With t == 0, or no energy, the motor goes nearly slack (coastTorque), so the robot coasts.
 * Forward (+1) rolls toward +x, whatever the wheel's rotation: that is clockwise, a negative relative velocity.
 * Draws energy in proportion to |t|; coasting is free.
 *
 * Output `angularVelocity`: the wheel's spin against the body it is mounted on (its joint's relative velocity, what
 * the motor drives), radians a second, counterclockwise positive, after the last physics step. So rolling forward
 * reads negative, and full speed on flat ground reads about -maxSpeed. 0 when the wheel has no joint of its own
 * (locked, or its base is gone): it does not turn against anything.
 */
export const wheel: Behavior = {
  config: ['maxSpeed', 'coastTorque'],
  needsJoint: true,
  plan(ctx) {
    const joint = ctx.group.joint;
    const spec = ctx.part.def.joint;
    if (!joint || !spec || joint.partId !== ctx.part.id) return undefined;
    const t = ctx.value('speed');
    return {
      load: Math.abs(t),
      run(grant) {
        if (t === 0 || grant === 0) ctx.physics.setMotor(joint.jointId, 0, spec.motorFactor, ctx.config('coastTorque'));
        else ctx.physics.setMotor(joint.jointId, -t * ctx.config('maxSpeed'), spec.motorFactor, Math.abs(t) * spec.maxTorque * grant);
      },
    };
  },
  output(part, name, reads) {
    if (name !== 'angularVelocity') return undefined;
    const joint = reads.robot.groups[part.group]?.joint;
    if (!joint || joint.partId !== part.id) return 0;
    return reads.spin(part.group) - reads.spin(joint.parentGroup);
  },
};
