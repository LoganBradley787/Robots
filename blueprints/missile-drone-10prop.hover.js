// Hover: hold a height. W and S move the height, A and D lean the drone to fly sideways. H turns it off and on.
// The propellers are off auto controls, so this script owns them (left ones tagged lprop, right ones rprop), and its
// own gyro is tagged stab (`gyro` by type would also turn the missiles' gyros while they hang on the rails).
// Leaning is time-optimal (Logan, Gate 6): the drone works out how hard it can turn (every propeller on one side at
// full and the other side off, plus the gyro) and how heavy it is to turn (its moment of inertia, from its parts),
// throws itself toward the lean it wants at full torque, and brakes at the last moment it still can without
// overshooting. The weight being off center (one missile gone) is worked out from the parts too, so it never tilts.

const climb = param('climb', 3, { min: 0.5, max: 10 }); // m/s the target height moves while W or S is held
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const gyroTorque = param('gyroTorque', 40, { min: 0, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const lean = param('lean', 0.7, { min: 0, max: 1.2 }); // radians of lean with A or D (about 40 degrees)
const brake = param('brake', 0.04, { min: 0, max: 0.3 }); // radians of lean against each m/s of sideways speed, with A and D let go
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of the full turning torque it plans its braking on (the rest is room for error)

function setup() {
  state.target = self.pos.y;
  // Throttle that just holds the weight, from the robot's mass and its propellers; learned more exactly below.
  const props = parts.filter((p) => p.type === 'propeller').length;
  state.base = props > 0 ? clamp((self.mass * 9.81) / (props * lift), 0, 1) : 0.5;
  state.trim = 0; // what the balance misses, learned slowly
}

/**
 * The drone as a body that turns, from every part still attached: where its weight is along the body, its moment of
 * inertia about that point, and for its propellers the lever arms that turn it.
 */
function body() {
  const c = Math.cos(self.angle);
  const s = Math.sin(self.angle);
  const along = (p) => (p.pos.x - self.pos.x) * c + (p.pos.y - self.pos.y) * s;
  const across = (p) => -(p.pos.x - self.pos.x) * s + (p.pos.y - self.pos.y) * c;
  let mass = 0;
  let mu = 0;
  let mv = 0;
  for (const p of parts) {
    mass += p.mass;
    mu += p.mass * along(p);
    mv += p.mass * across(p);
  }
  const cu = mass > 0 ? mu / mass : 0;
  const cv = mass > 0 ? mv / mass : 0;
  // Each part is a 1 m box: m / 6 about its own center, plus m r^2 about the center of mass.
  let inertia = 0;
  for (const p of parts) inertia += p.mass * ((along(p) - cu) ** 2 + (across(p) - cv) ** 2 + 1 / 6);
  let sum = 0; // sum of lever arms: equal throttle on every propeller turns it by lift * throttle * sum
  let split = 0; // right minus left: a throttle difference d turns it by lift * d * split
  let right = 0; // lever arms of the right propellers only: all of them at full, the left off, is the hardest turn
  let left = 0;
  for (const p of parts) {
    if (p.type !== 'propeller') continue;
    const u = along(p) - cu;
    sum += u;
    if (p.tags.includes('rprop')) {
      split += u;
      right += u;
    } else {
      split -= u;
      left -= u;
    }
  }
  return { inertia, sum, split, right, left };
}

function tick() {
  if (keys.down('w')) state.target += climb * dt;
  if (keys.down('s')) state.target -= climb * dt;

  // Height: push toward the target, brake vertical speed, and slowly learn the throttle that hovers.
  const err = state.target - self.pos.y;
  if (Math.abs(err) < 1) state.base = clamp(state.base + 0.1 * err * dt, 0, 1);
  // Leaning tips the push sideways: divide by the cosine so its upward part still holds the height.
  const throttle = clamp((state.base + 0.15 * err - 0.25 * self.vel.y) / Math.max(0.4, Math.cos(self.angle)), 0, 1);

  // The lean it wants: A and D, else leaning against its sideways speed to stop.
  let want = clamp(brake * self.vel.x, -lean, lean);
  if (keys.down('a')) want = lean;
  if (keys.down('d')) want = -lean;
  const off = want - self.angle; // counterclockwise positive
  state.trim = clamp(state.trim + 0.05 * off * dt, -0.2, 0.2);

  // How hard it can turn each way: one side's propellers at full, the other side off, plus the gyro.
  const b = body();
  const ccw = lift * b.right + gyroTorque;
  const cw = lift * b.left + gyroTorque;
  const reach = off >= 0 ? ccw : cw;
  // The fastest spin it can still stop from before reaching the lean it wants: v^2 = 2 a d, planned on part of the
  // torque so there is some left to brake harder if it needs. Close in, a straight line so it settles without chatter.
  const accel = (margin * reach) / Math.max(1, b.inertia);
  const fast = Math.sqrt(2 * accel * Math.abs(off));
  const spin = Math.sign(off) * Math.min(fast, 6 * Math.abs(off));
  // Torque to reach that spin within a few ticks: this is full torque almost all the way, then full braking.
  const torque = clamp((b.inertia * (spin - self.angVel)) / (4 * dt), -cw, ccw);

  // Share the torque: the gyro takes what it can, the propellers the rest, on top of the split that cancels the
  // weight being off center (equal throttle would turn it by lift * throttle * sum).
  const gyro = clamp(torque, -gyroTorque, gyroTorque);
  const fromProps = torque - gyro - lift * throttle * b.sum;
  const diff = (b.split !== 0 ? fromProps / (lift * b.split) : 0) + state.trim;
  set('lprop', 'throttle', clamp(throttle - diff, 0, 1));
  set('rprop', 'throttle', clamp(throttle + diff, 0, 1));
  set('stab', 'spin', gyroTorque > 0 ? clamp(-gyro / gyroTorque, -1, 1) : 0); // the gyro's spin is clockwise positive
}
