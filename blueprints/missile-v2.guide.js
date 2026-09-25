// Guide v2: fly along the line the missile was released on (where it was, the way it pointed), steering back onto
// that line when it drifts off it (v1 only stopped drifting further), then blow up if nothing was hit.
// Starts the moment the missile wakes (when its decoupler lets go) or on deploy. G turns it off and on.
// The thruster is at the tail and the core near the nose, so the nose points from the thruster to the core:
// this works however the missile was placed (turned, mirrored) on its launcher. Parts are found by type,
// so a part you replace by hand in the builder still works.
// Steering: nothing holds a missile up but its motor. Each tick it works out which way to point the motor
// so the push cancels gravity and any sideways drift off the aim direction, and spends the rest of the
// push along it. The gyro turns the nose that way.

const fuse = param('fuse', 10, { min: 0.5, max: 30 }); // seconds of flight before it detonates
const gyroTorque = param('gyroTorque', 40, { min: 1, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of the gyro's torque it plans its braking on
const hold = param('hold', 2, { min: 0, max: 10 }); // how fast sideways drift is taken out (per second)
const thrust = param('thrust', 160, { min: 10, max: 1000 }); // N, the motor's full push (the thruster part)
const approach = param('approach', 6, { min: 0.5, max: 50 }); // m/s^2 of sideways push it plans on to get back to its line and stop on it
const cut = param('cut', 20, { min: 1, max: 60 }); // most degrees it cuts across toward its line
const ease = param('ease', 1, { min: 0.1, max: 10 }); // close to the line, its sideways speed per meter off it (lower eases in sooner)
const clear = param('clear', 0.05, { min: 0, max: 2 }); // seconds flying straight before steering, to clear the launcher

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function nose() {
  const motor = parts.find((p) => p.type === 'thruster');
  if (!motor) return self.angle;
  return Math.atan2(self.pos.y - motor.pos.y, self.pos.x - motor.pos.x);
}

/** How hard the missile is to turn: each part's mass times its squared distance from the center of mass, plus its own box. */
function turnInertia() {
  let m = 0;
  let mx = 0;
  let my = 0;
  for (const p of parts) {
    m += p.mass;
    mx += p.mass * p.pos.x;
    my += p.mass * p.pos.y;
  }
  if (m <= 0) return 1;
  let i = 0;
  for (const p of parts) i += p.mass * ((p.pos.x - mx / m) ** 2 + (p.pos.y - my / m) ** 2 + 1 / 6);
  return Math.max(0.1, i);
}

function setup() {
  state.aim = nose();
  state.origin = { x: self.pos.x, y: self.pos.y };
  state.start = time;
}

function tick() {
  set('thruster', 'throttle', 1);
  if (time - state.start > fuse) set('warhead', 'detonate', 1);

  // Across the aim direction: how far it is off its line, and how fast it moves across it.
  const nx = -Math.sin(state.aim);
  const ny = Math.cos(state.aim);
  const across = nx * self.vel.x + ny * self.vel.y;
  const off = nx * (self.pos.x - state.origin.x) + ny * (self.pos.y - state.origin.y);
  // Back to the line as fast as it can still stop on it: the sideways speed it wants is the fastest it could brake
  // from before reaching the line (v^2 = 2 a d), no more than a cut of `cut` degrees across its forward speed, and a
  // gentle straight line in the last meter so it settles instead of chattering.
  const forward = Math.max(1, Math.abs(-ny * self.vel.x + nx * self.vel.y));
  const back = Math.min(Math.sqrt(2 * approach * Math.abs(off)), ease * Math.abs(off), forward * Math.tan((cut * Math.PI) / 180));
  const wantAcross = -Math.sign(off) * back;
  const side = clamp(self.mass * (9.81 * Math.cos(state.aim) + hold * (wantAcross - across)), -0.9 * thrust, 0.9 * thrust);
  const along = Math.sqrt(thrust * thrust - side * side);
  // Right after release, only hold the aim: swinging the nose up would swing the tail into the launcher.
  const want = time - state.start < clear ? state.aim : state.aim + Math.atan2(side, along);

  const now = nose();
  // Turn the nose as fast as the gyro can and brake just in time (like missile-drone-10prop's lean): the fastest spin
  // it can still stop from before the nose points where it wants (v^2 = 2 a d), with the inertia worked out from its
  // parts, and a straight line close in so it settles.
  const err = wrap(want - now);
  const inertia = turnInertia();
  const spinUp = (margin * gyroTorque) / inertia;
  const spin = Math.sign(err) * Math.min(Math.sqrt(2 * spinUp * Math.abs(err)), 8 * Math.abs(err));
  const torque = (inertia * (spin - self.angVel)) / (3 * dt); // counterclockwise positive
  set('gyro', 'spin', clamp(-torque / gyroTorque, -1, 1)); // the gyro's spin is clockwise positive
}
