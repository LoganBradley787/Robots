import type { Behavior } from './registry';

/**
 * A piston (Batch): a linear actuator, the rotator's sliding cousin. The part is the moving head: it slides out of its
 * cell along the way it acts (away from its mount face) by 0 to `stroke` meters, carrying what is attached to its other
 * faces. `extend` (-1 to 1) moves the target at up to `extendSpeed` m/s; with no input it holds. The motor's spring and
 * damper follow the mass it carries for a response near `frequency` rad/s, its integral term learns the load resting
 * on the head, and the joint's `maxForce` caps it. Draws energy in proportion to the force it needs. `position` reads
 * the extension as a fraction of the stroke.
 */
/** How far the target may run ahead of the head while it is moving, in meters. */
const TARGET_LEAD = 0.25;

export const piston: Behavior = {
  config: ['stroke', 'extendSpeed', 'frequency'],
  needsJoint: true,
  plan(ctx) {
    const joint = ctx.group.joint;
    const spec = ctx.part.def.joint;
    // Locked, or its base was shot away: nothing to push against.
    if (!joint || !spec || joint.partId !== ctx.part.id) return undefined;
    const stroke = ctx.config('stroke');
    const maxForce = spec.maxForce ?? 0;
    const extend = ctx.value('extend');
    const actual = ctx.physics.sliderPosition(joint.jointId);
    // The gains follow the mass being moved: the head's own, plus the weight the motor has learned to carry (a car on
    // it). A fixed gain that suits a light head would ring under a heavy load.
    const mass = Math.max(ctx.physics.massProperties(ctx.group.bodyId).mass, 1) + ctx.physics.sliderCarriedMass(joint.jointId);
    const speed = ctx.config('extendSpeed');
    let next = (ctx.part.aim ?? 0) + extend * speed * ctx.dt;
    if (extend !== 0) next = Math.max(actual - TARGET_LEAD, Math.min(actual + TARGET_LEAD, next));
    next = Math.max(0, Math.min(stroke, next));
    // How fast the target moves this tick, so the motor tracks it instead of lagging behind.
    const rate = Math.max(-speed, Math.min(speed, (next - (ctx.part.aim ?? 0)) / ctx.dt));
    const f = ctx.config('frequency');
    const stiffness = mass * f * f;
    const damping = 2 * mass * f;
    const need = Math.abs(stiffness * (next - actual)) / maxForce;
    // Holding a load up costs energy too: the weight of what the head carries, as a share of the force cap.
    const hold = (mass * Math.abs(ctx.physics.gravityY)) / maxForce;
    return {
      load: Math.min(1, Math.max(Math.abs(extend), need, hold)),
      run(grant) {
        if (grant > 0) ctx.part.aim = next;
        ctx.physics.setSliderMotor(joint.jointId, ctx.part.aim ?? 0, grant > 0 ? rate : 0, stiffness, damping, maxForce * grant);
      },
    };
  },
  output(part, name) {
    const stroke = part.def.behaviorConfig?.stroke ?? 0;
    return name === 'position' && stroke > 0 ? (part.aim ?? 0) / stroke : undefined;
  },
};
