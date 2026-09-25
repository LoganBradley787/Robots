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
const hold = param('hold', 2, { min: 0, max: 10 }); // how fast sideways drift is taken out (per second)
const thrust = param('thrust', 160, { min: 10, max: 1000 }); // N, the motor's full push (the thruster part)
const line = param('line', 1, { min: 0, max: 20 }); // how hard it steers back onto its line (per second squared; hold 2 and line 1 settle without overshoot)
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

function setup() {
  state.aim = nose();
  state.origin = { x: self.pos.x, y: self.pos.y };
  state.start = time;
}

function tick() {
  set('thruster', 'throttle', 1);
  if (time - state.start > fuse) set('warhead', 'detonate', 1);

  // Across the aim direction: how far it is off its line and how fast it drifts, and the push that holds the weight
  // and brings it back (a spring for the distance, a damper for the drift).
  const nx = -Math.sin(state.aim);
  const ny = Math.cos(state.aim);
  const across = nx * self.vel.x + ny * self.vel.y;
  const off = nx * (self.pos.x - state.origin.x) + ny * (self.pos.y - state.origin.y);
  const side = clamp(self.mass * (9.81 * Math.cos(state.aim) - hold * across - line * off), -0.9 * thrust, 0.9 * thrust);
  const along = Math.sqrt(thrust * thrust - side * side);
  // Right after release, only hold the aim: swinging the nose up would swing the tail into the launcher.
  const want = time - state.start < clear ? state.aim : state.aim + Math.atan2(side, along);

  const now = nose();
  const turn = 10 * wrap(want - now) - 3 * self.angVel; // counterclockwise positive
  set('gyro', 'spin', clamp(-turn, -1, 1)); // the gyro's spin is clockwise positive
}
