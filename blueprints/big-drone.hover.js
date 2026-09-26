// Big drone hover (the flying silo hover, M10 extras): hold a height. W and S move the height, A and D lean it to fly sideways.
// H turns it off and on. The hunter drone's hover, lifting on boosters instead of propellers: the drone's own boosters
// are off auto controls and tagged lboost and rboost (left and right), so throttling one side more than the other
// leans it; its own heavy gyros are tagged stab and help (the missiles' boosters and gyros are left alone).
// Leaning is time-optimal (Logan, Gate 6): the drone works out how hard it can turn (every propeller on one side at
// full and the other side off, plus the gyro) and how heavy it is to turn (its moment of inertia, from its parts),
// throws itself toward the lean it wants at full torque, and brakes at the last moment it still can without
// overshooting. The weight being off center (one missile gone) is worked out from the parts too, so it never tilts.
// With a load off center (a turret swung to one side), the side that brakes a lean is not the side that starts it:
// it plans its braking on the braking side's torque, so it neither overshoots toward the load nor stops short away (M8).

const climb = param('climb', 10, { min: 0.5, max: 30 }); // m/s up or down while W or S is held
const lift = param('lift', 400, { min: 10, max: 2000 }); // N, one booster's full push (the booster part)
const gyroTorque = param('gyroTorque', 800, { min: 0, max: 20000 }); // N m, all its stab gyros together (4 heavy gyros)
const lean = (param('lean', 30, { min: 0, max: 70 }) * Math.PI) / 180; // degrees of lean with A or D
const brake = param('brake', 0.04, { min: 0, max: 0.3 }); // radians of lean against each m/s of sideways speed, with A and D let go
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its full turning or climbing power it plans its braking on (the rest is room for error)

function setup() {
  state.target = self.pos.y; // the height it holds; none while W or S is held
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
  let right = 0; // lever arms of the propellers right of the center of mass: all at full, the rest off, is the hardest turn
  let left = 0;
  for (const p of parts) {
    if (!(p.tags.includes('lboost') || p.tags.includes('rboost'))) continue;
    const u = along(p) - cu;
    sum += u;
    split += p.tags.includes('rboost') ? u : -u;
    // By where they are, not their tags, so it works deployed flipped (the rprop ones are then on the left).
    if (u > 0) right += u;
    else left -= u;
  }
  return { inertia, sum, split, right, left };
}

function tick() {
  // Up and down, the same way as leaning (Logan, Gate 6): W and S ask for a climb or sink speed, and it gets there with
  // all the push it has; let go and it stops at the height it can stop at soonest, braking just in time.
  const g = 9.81;
  const props = parts.filter((p) => p.tags.includes('lboost') || p.tags.includes('rboost')).length;
  // Leaning tips the push sideways: only the upward part of it counts.
  const up = props * lift * Math.max(0.3, Math.cos(self.angle));
  const rise = Math.max(0.5, up / self.mass - g); // the most it can speed up upward (or brake a fall)
  let climbing = 0;
  if (keys.down('w')) climbing = climb;
  if (keys.down('s')) climbing = -climb;
  if (climbing !== 0) state.target = undefined;
  else if (state.target === undefined) {
    // Just let go: hold where it comes to rest braking hard (gravity stops a climb, the propellers stop a fall).
    const stop = self.vel.y > 0 ? g : rise;
    state.target = self.pos.y + (self.vel.y * Math.abs(self.vel.y)) / (2 * margin * stop);
  }
  if (state.target !== undefined) {
    const err = state.target - self.pos.y;
    // Moving up is braked by gravity, moving down by the propellers: the fastest speed it can still stop from.
    const stop = err > 0 ? g : rise;
    climbing = Math.sign(err) * Math.min(Math.sqrt(2 * margin * stop * Math.abs(err)), 3 * Math.abs(err), climb);
  }
  const upward = clamp(5 * (climbing - self.vel.y), -g, rise);
  const throttle = clamp((self.mass * (g + upward)) / up, 0, 1);

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
  // Braking is done by the other side: turning toward a load hanging off center, the side that brakes is the weaker one.
  const stopping = off >= 0 ? cw : ccw;
  // The fastest spin it can still stop from before reaching the lean it wants: v^2 = 2 a d, planned on part of the
  // torque so there is some left to brake harder if it needs. Close in, a straight line so it settles without chatter.
  const spinUp = (margin * stopping) / Math.max(1, b.inertia);
  const fast = Math.sqrt(2 * spinUp * Math.abs(off));
  const spin = Math.sign(off) * Math.min(fast, 6 * Math.abs(off));
  // Torque to reach that spin within a few ticks: this is full torque almost all the way, then full braking.
  const torque = clamp((b.inertia * (spin - self.angVel)) / (4 * dt), -cw, ccw);

  // Share the torque: the gyro takes what it can, the propellers the rest, on top of the split that cancels the
  // weight being off center (equal throttle would turn it by lift * throttle * sum).
  const gyro = clamp(torque, -gyroTorque, gyroTorque);
  // Turning comes first: the height gets the throttle that leaves room for the whole split (a real flight
  // controller does the same), so a hard turn may cost a little height but never turns short. The base throttle
  // then differs from what the height asked for, and with the weight off center the base turns the drone too, so
  // the split is worked out against the base actually used (a few rounds settle it).
  let base = throttle;
  let diff = 0;
  for (let i = 0; i < 4; i++) {
    diff = (b.split !== 0 ? (torque - gyro - lift * base * b.sum) / (lift * b.split) : 0) + state.trim;
    const d = Math.abs(diff);
    base = d >= 0.5 ? 0.5 : clamp(throttle, d, 1 - d);
  }
  set('lboost', 'throttle', clamp(base - diff, 0, 1));
  set('rboost', 'throttle', clamp(base + diff, 0, 1));
  set('stab', 'spin', gyroTorque > 0 ? clamp(-gyro / gyroTorque, -1, 1) : 0); // the gyro's spin is clockwise positive
}
