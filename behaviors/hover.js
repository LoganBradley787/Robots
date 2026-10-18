// @behavior Hover
// @about Holds a height and stays level, on anything that lifts. W and S move the height, A and D fly it sideways: it leans, and runs whatever pushes that way.
// @version 3
// @slot lift throttle "what lifts/pushes" required many owns
// @slot level spin "what levels" optional many
// @note It reads each lifter's strength, place and direction off the part, and the robot's weight, every tick: add armor or one more lifter and it needs no retuning.
// @note Lifters in the group that point down are used to push down when cutting the lift is not enough.
// @note Ones that point sideways push it along with A and D and brake its sideways speed when the keys are let go, as hard as it can still stay level and keep its height.
// @note Without anything in "what levels" it levels by running the lifters on one side harder, which needs lifters on both sides of the middle.
//
// How it works (the hover of the fab drones, with nothing typed in by hand):
// - Each lifter is a part in the group `lift` with a `throttle` input. Its full push is `spec.config.maxForce`, it
//   pushes along `angle + rot + spec.acts`, tilted by its own `swivel` input if it has one, from where it is.
// - Height: W and S ask for a climb or sink speed; let go and it stops at the height it can stop at soonest, braking
//   just in time (gravity brakes a climb, the lifters a fall), then holds that height.
// - Level: it works out how hard it can turn (the lifters on one side at full and the others off, plus the group
//   `level`, each with `spec.config.maxTorque`) and how heavy it is to turn (from every part's mass and place), throws
//   itself toward the lean it wants and brakes at the last moment it still can. Weight off center is balanced from
//   the parts, so it does not tilt when one side is heavier or loses a lifter.
// - Sideways: the lifters that push across the robot run at full the way A or D asks, and against its sideways
//   speed with the keys let go. What they add upward and how they turn it is handed to the height and the leveling as
//   a known push, and they are held back to what the leveling can still cancel and the lift can still carry.
// - Plates in the air (parts with `spec.config.area`: fins, also those of a missile it carries) are worked out and
//   cancelled, so they do not tip it over at speed.

const height = param('height', 5, { min: 0, max: 200 }); // m it climbs when deployed, then holds (switched on later it holds where it is)
const hold = param('hold', 1, { min: 0.2, max: 3 }); // how firmly it holds its height: higher is stiffer, lower is softer
const climb = param('climb', 10, { min: 0.5, max: 30 }); // m/s up or down while W or S is held, and the fastest it moves to its height
const lean = (param('lean', 45, { min: 0, max: 70 }) * Math.PI) / 180; // degrees of lean with A or D
const fly = param('keys', 1, { min: 0, max: 1 }); // 1: W A S D fly it; 0: it only holds (another script or its own keys move it)

const G = 9.81;
const RAD = Math.PI / 180;
const MARGIN = 0.7; // share of its full turning or climbing power it plans its braking on (the rest is room for error)
const BRAKE = 0.04; // radians of lean against each m/s of sideways speed, with A and D let go
const SPARE = 1; // m/s^2 of climb it keeps in hand while leaning, so leaning never costs it height
const ARM = 0.05; // m: a lifter closer to the middle than this is on neither side
const SLOW = 3; // 1/s: how hard the sideways lifters brake its sideways speed, with A and D let go
const SHARE = 0.25; // share of its turning power the sideways lifters may use up by being off center

function setup() {
  // Just deployed: climb to its height. Switched on in flight: hold where it is.
  // `self.age` is how long this robot has been in the world (`time` is the world's clock, which runs before a deploy).
  state.target = self.pos.y + (self.age < 0.5 ? height : 0); // the height it holds; none while W or S is held
  state.trim = 0; // what the balance misses, learned slowly
  state.said = '';
}

/** Says a thing once, and again only when it changes. */
function say(text) {
  if (state.said === text) return;
  state.said = text;
  if (text !== '') log(text);
}

/**
 * The robot as a body that turns, from every part still attached: where its weight is, how heavy it is to turn about
 * that point, and what the air does to its plates there (the push upward and the turn, counterclockwise positive).
 */
function body() {
  let mass = 0;
  let mx = 0;
  let my = 0;
  for (const p of parts) {
    mass += p.mass;
    mx += p.mass * p.pos.x;
    my += p.mass * p.pos.y;
  }
  const cx = mass > 0 ? mx / mass : self.pos.x;
  const cy = mass > 0 ? my / mass : self.pos.y;
  // Each part is a 1 m box: m / 6 about its own center, plus m r^2 about the center of mass.
  let inertia = 0;
  let airUp = 0;
  let airTurn = 0;
  for (const p of parts) {
    const rx = p.pos.x - cx;
    const ry = p.pos.y - cy;
    inertia += p.mass * (rx * rx + ry * ry + 1 / 6);
    const area = p.spec.config.area;
    if (!(area > 0) || p.spec.acts === undefined) continue;
    // A plate along the way the part acts: across it the air pushes back with 0.6 * area * speed across * speed.
    const vx = self.vel.x - self.angVel * ry;
    const vy = self.vel.y + self.angVel * rx;
    const a = p.angle + (p.rot + p.spec.acts + 90 + (p.in.deflect || 0) * (p.spec.config.deflect || 0)) * RAD;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    const f = -0.6 * area * (vx * nx + vy * ny) * Math.sqrt(vx * vx + vy * vy);
    airUp += f * ny;
    airTurn += rx * f * ny - ry * f * nx;
  }
  return { cx, cy, inertia: Math.max(1, inertia), airUp, airTurn };
}

/**
 * The lifters: every part in the group `lift` that has a throttle and a push. `up` are the ones that push up (as the
 * robot stands now), `down` the ones that push down, `side` the ones that push across it.
 */
function lifters(b) {
  const up = [];
  const down = [];
  const side = [];
  const c = Math.cos(self.angle);
  const s = Math.sin(self.angle);
  for (const p of parts) {
    if (!p.tags.includes('lift') || p.in.throttle === undefined) continue;
    const force = p.spec.config.maxForce;
    if (!(force > 0) || p.spec.acts === undefined) continue;
    const a = p.angle + (p.rot + p.spec.acts + (p.in.swivel || 0) * (p.spec.config.swivel || 0)) * RAD;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // How much of its push is along the robot's own up.
    const along = -ux * s + uy * c;
    const rx = p.pos.x - b.cx;
    const ry = p.pos.y - b.cy;
    const arm = rx * uy - ry * ux; // its turn on the robot per newton, counterclockwise positive
    const l = { id: p.id, force, ux, uy, arm, side: arm > ARM ? 1 : arm < -ARM ? -1 : 0 };
    if (along > 0.5) up[up.length] = l;
    else if (along < -0.5) down[down.length] = l;
    else side[side.length] = l;
  }
  return { up, down, side };
}

function tick() {
  const b = body();
  const { up, down, side } = lifters(b);
  if (up.length === 0) {
    say('Hover: nothing in the group "lift" pushes up. Put the parts that lift in that group.');
    return;
  }
  // The most it can push up (leaning tips the push sideways: only the upward part counts), and how that push turns it.
  let full = 0; // N, every up lifter at full, as built
  let lift = 0; // N upward at full, as it stands now
  let liftSplit = 0; // N upward that a split of 1 adds (the two sides rarely match exactly)
  let turnAll = 0; // N m at equal full throttle (weight off center)
  let turnSplit = 0; // N m a split of 1 gives
  let ccw = 0; // N m of the side that turns it counterclockwise, at full
  let cw = 0;
  for (const l of up) {
    const a = l.force * Math.max(0.3, l.uy);
    full += l.force;
    lift += a;
    liftSplit += l.side * a;
    turnAll += l.force * l.arm;
    turnSplit += l.side * l.force * l.arm;
    if (l.side > 0) ccw += l.force * l.arm;
    else if (l.side < 0) cw -= l.force * l.arm;
  }
  let push = 0; // N its down lifters add to its weight
  for (const l of down) push += l.force * Math.max(0.3, -l.uy);
  let torqueMax = 0; // N m of what levels
  const levelers = [];
  for (const p of parts) {
    if (!p.tags.includes('level') || p.in.spin === undefined) continue;
    const t = p.spec.config.maxTorque;
    if (!(t > 0)) continue;
    torqueMax += t;
    levelers[levelers.length] = p.id;
  }
  if (full < self.mass * G) say('Hover: the lifters hold ' + Math.floor(full / G) + ' kg and this robot weighs ' + Math.ceil(self.mass) + ' kg. It needs more lift.');
  else if ((ccw === 0 || cw === 0) && (Math.abs(turnAll) * self.mass * G) / full > torqueMax) say('Hover: all its lift is on one side of its weight, so holding itself up tips it over. Put lifters on both sides of the middle.');
  else if (torqueMax === 0 && turnSplit < 1) say('Hover: it cannot level itself. Put a gyro in the group "level", or lifters on both sides of the middle.');
  else say('');

  // Up and down: W and S ask for a climb or sink speed, and it gets there with all the push it has; let go and it
  // stops at the height it can stop at soonest, braking just in time.
  const rise = Math.max(0.5, lift / self.mass - G); // the most it can speed up upward (or brake a fall)
  let climbing = 0;
  if (fly > 0.5 && keys.down('w')) climbing = climb;
  if (fly > 0.5 && keys.down('s')) climbing = -climb;
  if (climbing !== 0) state.target = undefined;
  else if (state.target === undefined) {
    // Just let go: hold where it comes to rest braking hard (gravity stops a climb, the lifters stop a fall).
    const stop = self.vel.y > 0 ? G : rise;
    state.target = self.pos.y + (self.vel.y * Math.abs(self.vel.y)) / (2 * MARGIN * stop);
  }
  if (state.target !== undefined) {
    const err = state.target - self.pos.y;
    // Moving up is braked by gravity, moving down by the lifters: the fastest speed it can still stop from.
    const stop = err > 0 ? G : rise;
    climbing = Math.sign(err) * Math.min(Math.sqrt(2 * MARGIN * stop * Math.abs(err)), 3 * hold * Math.abs(err), climb);
  }
  const upward = clamp(5 * hold * (climbing - self.vel.y), -G - push / self.mass, rise);
  let need = self.mass * (G + upward) - b.airUp; // N upward it wants from its lifters

  // The lean it wants: A and D, else leaning against its sideways speed to stop. It never leans further than its
  // lifters at full still hold its weight with some left to climb on.
  const most = Math.min(lean, Math.acos(clamp((self.mass * (G + SPARE)) / Math.max(full, 1e-9), 0, 1)));
  let want = clamp(BRAKE * self.vel.x, -most, most);
  if (fly > 0.5 && keys.down('a')) want = most;
  if (fly > 0.5 && keys.down('d')) want = -most;
  const off = want - self.angle; // counterclockwise positive
  state.trim = clamp(state.trim + 0.05 * off * dt, -0.2, 0.2);

  // How hard it can turn each way: one side's lifters up and the other side's down by the same split, plus what
  // levels. The split is only what is left over the throttle that holds its weight at this tilt (at least 0.15, so it
  // can always right itself, at most a half): a heavy robot turns slower and keeps its height.
  const room = clamp(1 - (self.mass * G) / Math.max(lift, 1e-9), 0.15, 0.5);
  const ccwMax = ccw * 2 * room + torqueMax;
  const cwMax = cw * 2 * room + torqueMax;
  // Braking is done by the other side: turning toward a load hanging off center, the side that brakes is the weaker one.
  const stopping = off >= 0 ? cwMax : ccwMax;
  // The fastest spin it can still stop from before reaching the lean it wants: v^2 = 2 a d, planned on part of the
  // torque so there is some left to brake harder if it needs. Close in, a straight line so it settles without chatter.
  const spinUp = (MARGIN * stopping) / b.inertia;
  const spin = Math.sign(off) * Math.min(Math.sqrt(2 * spinUp * Math.abs(off)), 6 * Math.abs(off));
  // Torque to reach that spin within a few ticks: this is full torque almost all the way, then full braking.
  const torque = clamp((b.inertia * (spin - self.angVel)) / (4 * dt), -cwMax, ccwMax);

  // Sideways: A and D run the lifters that push that way at full; let go, they push against its sideways speed.
  let across = -SLOW * self.mass * self.vel.x; // N to the right it wants from them
  if (fly > 0.5 && keys.down('a')) across = -Infinity;
  if (fly > 0.5 && keys.down('d')) across = Infinity;
  const way = Math.sign(across);
  let reach = 0; // N that way with every one that pushes that way at full
  for (const l of side) if (l.ux * way > 0.3) reach += l.force * l.ux * way;
  let run = reach > 0 ? Math.min(1, Math.abs(across) / reach) : 0;
  let sideUp = 0; // N upward and N m they add at that throttle
  let sideTurn = 0;
  for (const l of side) {
    if (!(l.ux * way > 0.3)) continue;
    sideUp += l.force * l.uy;
    sideTurn += l.force * l.arm;
  }
  // Held back to what the leveling can still cancel, and (leaning, they push down too) to what the lift can carry.
  const spare = SHARE * Math.min(ccwMax, cwMax);
  if (Math.abs(sideTurn) * run > spare) run = spare / Math.abs(sideTurn);
  const load = 0.9 * lift - need;
  if (sideUp < 0 && -sideUp * run > load) run = Math.max(0, load) / -sideUp;
  sideUp *= run;
  sideTurn *= run;
  need -= sideUp;
  for (const l of side) set(l.id, 'throttle', l.ux * way > 0.3 ? run : 0);

  // Share the torque: what levels takes what it can, the lifters the rest, on top of the split that cancels the weight
  // being off center. Turning comes first: the height gets the throttle that leaves room for the whole split, and the
  // split is worked out against the throttle actually used (a few rounds settle it).
  const gyro = clamp(torque - sideTurn, -torqueMax, torqueMax);
  let base = clamp(need / Math.max(lift, 1e-9), 0, 1);
  let split = 0;
  for (let i = 0; i < 4; i++) {
    split = turnSplit > 1e-6 ? clamp((torque - gyro - b.airTurn - sideTurn - base * turnAll) / turnSplit + state.trim, -room, room) : 0;
    const d = Math.abs(split);
    base = d >= room ? 1 - room : clamp((need - split * liftSplit) / Math.max(lift, 1e-9), d, 1 - d);
  }
  for (const l of up) set(l.id, 'throttle', clamp(base + split * l.side, 0, 1));
  // Asked to go down faster than falling does: the down lifters give the rest.
  const sink = push > 0 ? clamp(-need / push, 0, 1) : 0;
  for (const l of down) set(l.id, 'throttle', sink);
  // A spin input is clockwise positive.
  const spinCmd = torqueMax > 0 ? clamp(-gyro / torqueMax, -1, 1) : 0;
  for (const id of levelers) set(id, 'spin', spinCmd);
}
