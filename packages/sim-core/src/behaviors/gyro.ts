import type { Behavior } from './registry';

/**
 * A reaction wheel (Gate 3, Logan). `spin` (Q/E by auto controls) turns the robot with up to `maxTorque`, positive
 * clockwise like the wheels' forward. With no spin input it damps rotation only: a small torque, at most
 * `dampTorque`, that stops the robot's turning over about `dampTime` seconds. It does not level the robot or hold an
 * angle (that is a script's job), and it cannot beat a hard spin. `damp` at 0 turns the damping off.
 * The torque is fixed per gyro, so bigger robots need more gyros. Draws energy in proportion to the torque it applies.
 */
export const gyro: Behavior = {
  config: ['maxTorque', 'dampTorque', 'dampTime'],
  plan(ctx) {
    const body = ctx.group.bodyId;
    const max = ctx.config('maxTorque');
    const spin = ctx.value('spin');
    if (spin !== 0) return { load: Math.abs(spin), run: (grant) => ctx.physics.addTorque(body, -spin * max * grant) };
    const damp = ctx.value('damp');
    const w = ctx.physics.state(body).w;
    if (damp === 0 || w === 0) return undefined;
    // Whole-robot inertia about its center of mass, so the damping settles in dampTime however the robot is built.
    let mass = 0;
    let mx = 0;
    let my = 0;
    const props = ctx.robot.groups.map((g) => ctx.physics.massProperties(g.bodyId));
    for (const p of props) {
      mass += p.mass;
      mx += p.mass * p.comX;
      my += p.mass * p.comY;
    }
    const cx = mx / mass;
    const cy = my / mass;
    const inertia = props.reduce((sum, p) => sum + p.inertia + p.mass * ((p.comX - cx) ** 2 + (p.comY - cy) ** 2), 0);
    const cap = damp * ctx.config('dampTorque');
    const torque = Math.max(-cap, Math.min(cap, (-inertia * w) / ctx.config('dampTime')));
    return { load: Math.abs(torque) / max, run: (grant) => ctx.physics.addTorque(body, torque * grant) };
  },
};
