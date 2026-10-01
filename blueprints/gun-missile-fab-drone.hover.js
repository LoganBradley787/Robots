// Hover: hold a height. W and S move the height, A and D lean the drone to fly sideways. H turns it off and on.
// The propellers are off auto controls, so this script owns them (left ones tagged lprop, right ones rprop), and its
// own gyro is tagged stab (`gyro` by type would also turn the missiles' gyros while they hang on the rails).
// Leaning is time-optimal (Logan, Gate 6): the drone works out how hard it can turn (every propeller on one side at
// full and the other side off, plus the gyro) and how heavy it is to turn (its moment of inertia, from its parts),
// throws itself toward the lean it wants at full torque, and brakes at the last moment it still can without
// overshooting. The weight being off center (one missile gone) is worked out from the parts too, so it never tilts.
// With a load off center (a turret swung to one side), the side that brakes a lean is not the side that starts it:
// it plans its braking on the braking side's torque, so it neither overshoots toward the load nor stops short away (M8).

const climb = param('climb', 10, { min: 0.5, max: 30 }); // m/s up or down while W or S is held
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const gyroTorque = param('gyroTorque', 40, { min: 0, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const lean = (param('lean', 60, { min: 0, max: 70 }) * Math.PI) / 180; // degrees of lean with A or D
const brake = param('brake', 0.04, { min: 0, max: 0.3 }); // radians of lean against each m/s of sideways speed, with A and D let go
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its full turning or climbing power it plans its braking on (the rest is room for error)
const spare = param('spare', 1, { min: 0, max: 10 }); // m/s^2 of climb it keeps in hand while leaning: a heavy drone leans less than `lean`, so A and D never cost it height
const finArea = param('finArea', 0.6, { min: 0, max: 10 }); // m^2, one fin's plate (the fin part)
const finTurn = param('finTurn', 20, { min: 0, max: 90 }); // degrees a fin's plate turns at full deflect (the fin part)
const steady = param('steady', 0, { min: 0, max: 1 }); // 1: a turn never takes the propellers below what holds its weight (for a drone that hovers on more than half throttle: it turns slower and keeps its height)

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
    if (p.type !== 'propeller') continue;
    const u = along(p) - cu;
    sum += u;
    split += p.tags.includes('rprop') ? u : -u;
    // By where they are, not their tags, so it works deployed flipped (the rprop ones are then on the left).
    if (u > 0) right += u;
    else left -= u;
  }
  return { inertia, sum, split, right, left, cu, cv };
}

/**
 * What the air does to its fins, worked out the way the weight off center is (a fin is a plate: across it the air
 * pushes back with 0.6 * area * speed across * speed, along it nothing): the push upward and the turn about the
 * center of mass. A missile held in the bay is part of the drone until it leaves, fins and all, and at 25 m/s
 * sideways two fins up there push 450 N: it tipped the tech fab drone over when it braked.
 */
function fins(b) {
  let up = 0;
  let turn = 0;
  const c = Math.cos(self.angle);
  const s = Math.sin(self.angle);
  const cx = self.pos.x + b.cu * c - b.cv * s;
  const cy = self.pos.y + b.cu * s + b.cv * c;
  for (const p of parts) {
    if (p.type !== 'fin') continue;
    const rx = p.pos.x - cx;
    const ry = p.pos.y - cy;
    const vx = self.vel.x - self.angVel * ry;
    const vy = self.vel.y + self.angVel * rx;
    // The plate's normal: built standing up, its flat sides face left and right, turned with the part and its deflection.
    const a = p.angle + ((p.in.deflect || 0) * finTurn * Math.PI) / 180;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    const f = -0.6 * finArea * (vx * nx + vy * ny) * Math.sqrt(vx * vx + vy * vy);
    up += f * ny;
    turn += rx * f * ny - ry * f * nx;
  }
  return { up, turn };
}

function tick() {
  // Up and down, the same way as leaning (Logan, Gate 6): W and S ask for a climb or sink speed, and it gets there with
  // all the push it has; let go and it stops at the height it can stop at soonest, braking just in time.
  const g = 9.81;
  const props = parts.filter((p) => p.type === 'propeller').length;
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
  const b = body();
  const air = fins(b);
  const throttle = clamp((self.mass * (g + upward) - air.up) / Math.max(up, 1e-9), 0, 1);

  // The lean it wants: A and D, else leaning against its sideways speed to stop. Leaning tips the push sideways, so
  // it never leans further than its propellers at full still hold its weight with `spare` left to climb on (Logan:
  // the 105 kg tech fab drone leaned 60 degrees, where its lift holds 86 kg, and sank with W held).
  const most = Math.min(lean, Math.acos(clamp((self.mass * (g + spare)) / Math.max(props * lift, 1e-9), 0, 1)));
  let want = clamp(brake * self.vel.x, -most, most);
  if (keys.down('a')) want = most;
  if (keys.down('d')) want = -most;
  const off = want - self.angle; // counterclockwise positive
  state.trim = clamp(state.trim + 0.05 * off * dt, -0.2, 0.2);

  // How hard it can turn each way: one side's propellers at full, the other side off, plus the gyro. That is a split
  // of half the throttle either way around a base of half, and a heavy drone hovers on more than half: it sank every
  // time it swung over (Logan's tech fab drone, 9 m braking from 25 m/s). With `steady` the split is only what is
  // left over the throttle that holds its weight at this tilt (at least `0.15`, so it can always right itself).
  const room = steady > 0.5 ? clamp(1 - (self.mass * g) / Math.max(up, 1e-9), 0.15, 0.5) : 0.5;
  const ccw = lift * b.right * (2 * room) + gyroTorque;
  const cw = lift * b.left * (2 * room) + gyroTorque;
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
    diff = clamp((b.split !== 0 ? (torque - gyro - air.turn - lift * base * b.sum) / (lift * b.split) : 0) + state.trim, -room, room);
    const d = Math.abs(diff);
    base = d >= room ? 1 - room : clamp(throttle, d, 1 - d);
  }
  set('lprop', 'throttle', clamp(base - diff, 0, 1));
  set('rprop', 'throttle', clamp(base + diff, 0, 1));
  set('stab', 'spin', gyroTorque > 0 ? clamp(-gyro / gyroTorque, -1, 1) : 0); // the gyro's spin is clockwise positive
}
