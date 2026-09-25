// Seeker guide (M8): flies to the point its launcher sent it, and follows the robot its seeker tracks there.
// Starts when the missile wakes (its decoupler lets go) or on deploy. G turns it off and on.
// - setup() reads the launcher's point from inbox. With none, it flies straight and follows the first robot it tracks.
// - While the seeker tracks the robot, it aims ahead of it by the robot's speed. If it loses track, it flies to the
//   last point it had and goes off there.
// - arc 1: climbs `height` meters above the point first, then comes down onto it.
// - Steering as missile-v2: the push cancels gravity and sideways speed, the rest goes along the line; the gyro turns
//   the nose as fast as it can and still stop.
// Parts are found by type, so it works however the missile was placed on its launcher.

const fuse = param('fuse', 12, { min: 0.5, max: 30 }); // seconds of flight before it detonates
const thrust = param('thrust', 160, { min: 10, max: 1000 }); // N, the motor's full push (the thruster part)
const gyroTorque = param('gyroTorque', 40, { min: 1, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of the gyro's torque it plans its braking on
const hold = param('hold', 1, { min: 0, max: 20 }); // how fast it takes out speed across its line (per second)
const sideMax = param('sideMax', 0.6, { min: 0.1, max: 0.95 }); // most of the push it spends sideways (0.6 is about 37 degrees off its line)
const clear = param('clear', 0.15, { min: 0, max: 2 }); // seconds flying straight before steering, to clear the launcher
const lead = param('lead', 1, { min: 0, max: 2 }); // 1 aims ahead of a tracked robot by its speed, 0 at where it is
const arc = param('arc', 0, { min: 0, max: 1 }); // 1: climb above the point, then come down onto it
const height = param('height', 40, { min: 5, max: 300 }); // m above the point it climbs to when arcing
const drop = param('drop', 1, { min: 0.2, max: 5 }); // when arcing, it turns down within this many heights of the point, sideways
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other missiles) are ignored
const acquire = param('acquire', 60, { min: 1, max: 1000 }); // m: a robot this close to the point is the one it follows
const proximity = param('proximity', 2, { min: 0, max: 10 }); // m: goes off this close to a tracked robot
const arrive = param('arrive', 3, { min: 0, max: 20 }); // m: goes off this close to the point when nothing is tracked

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
  state.start = time;
  state.aim = nose();
  state.phase = arc > 0.5 ? 'climb' : 'direct';
  state.seenAt = -1;
  // The launcher's point: the last message with one in it.
  for (const m of inbox) {
    const d = m.data;
    if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') continue;
    state.point = { x: d.x, y: d.y };
    state.vel = { x: typeof d.vx === 'number' ? d.vx : 0, y: typeof d.vy === 'number' ? d.vy : 0 };
    if (typeof d.id === 'number') state.id = d.id;
  }
}

/** The robot it follows: the one the launcher named, else the enemy nearest the point (or nearest at all without one). */
function pick() {
  let best = null;
  let bestD = Infinity;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < minMass) continue;
    if (state.id !== undefined && c.id === state.id) return c;
    const d = state.point ? Math.hypot(c.pos.x - state.point.x, c.pos.y - state.point.y) : c.distance;
    if (state.point && d > acquire) continue;
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function tick() {
  set('thruster', 'throttle', 1);
  if (time - state.start > fuse) set('warhead', 'detonate', 1);

  const seen = pick();
  if (seen) {
    state.point = { x: seen.pos.x, y: seen.pos.y };
    state.vel = { x: seen.vel.x, y: seen.vel.y };
    state.id = seen.id;
    state.seenAt = time;
  } else if (state.seenAt >= 0 && time - state.seenAt > 0.3) {
    // Lost track: fly to the last point it had.
    state.vel = { x: 0, y: 0 };
  }

  let aim = state.aim;
  if (state.point) {
    const p = state.point;
    const dx = p.x - self.pos.x;
    const dy = p.y - self.pos.y;
    const dist = Math.hypot(dx, dy);
    // Close enough to the tracked robot, or to the point when nothing is tracked.
    if (seen && dist < proximity) set('warhead', 'detonate', 1);
    if (!seen && dist < arrive) set('warhead', 'detonate', 1);
    // Aim ahead of a moving robot: time left from how fast the gap closes.
    const closing = Math.max(20, (dx * (self.vel.x - state.vel.x) + dy * (self.vel.y - state.vel.y)) / Math.max(dist, 1));
    const tgo = dist / closing;
    let gx = p.x + lead * state.vel.x * tgo;
    let gy = p.y + lead * state.vel.y * tgo;
    if (state.phase === 'climb') {
      if (Math.abs(gx - self.pos.x) < drop * height && self.pos.y > gy + 0.5 * height) state.phase = 'down';
      else gy += height;
    }
    mark(gx, gy, state.phase);
    aim = Math.atan2(gy - self.pos.y, gx - self.pos.x);
  }

  // Across the line to where it is going: push to cancel gravity and take out the speed across it; the rest along it.
  const nx = -Math.sin(aim);
  const ny = Math.cos(aim);
  const across = nx * self.vel.x + ny * self.vel.y;
  const side = clamp(self.mass * (9.81 * ny - hold * across), -sideMax * thrust, sideMax * thrust);
  const along = Math.sqrt(thrust * thrust - side * side);
  // Right after release, only hold the aim: swinging the nose would swing the tail into the launcher.
  const want = time - state.start < clear ? state.aim : aim + Math.atan2(side, along);

  // Turn the nose as fast as the gyro can and brake just in time (as missile-v2).
  const err = wrap(want - nose());
  const inertia = turnInertia();
  const spinUp = (margin * gyroTorque) / inertia;
  const spin = Math.sign(err) * Math.min(Math.sqrt(2 * spinUp * Math.abs(err)), 8 * Math.abs(err));
  const torque = (inertia * (spin - self.angVel)) / (3 * dt); // counterclockwise positive
  set('gyro', 'spin', clamp(-torque / gyroTorque, -1, 1)); // the gyro's spin is clockwise positive
}
