// @behavior Guide
// @about Steers toward the enemy it tracks and flies into it, for a missile or a drone that should close on its target.
// @version 2
// @slot push throttle "what pushes" required many owns
// @slot steer spin|swivel|deflect "what steers" required many owns
// @slot blast detonate "what goes off" optional many
// @needs sensor "something that sees, such as a seeker"
// @note It starts when its core wakes: on deploy, or when the missile is let go of its launcher.
// @note A launcher may send it where to go: send(scope, { x, y, vx, vy, id }). With no message it follows the first enemy it tracks.
// @note With nothing to follow it flies straight on the way it pointed when it started.
// @note What goes off is armed once it is clear of where it started, set off beside its target, and at the end of its fuse.
//
// How it works (the seeker guide of the missiles, with nothing typed in by hand):
// - What pushes: every part in the group `push` with a `throttle` input; its full push is `spec.config.maxForce` and
//   it pushes along `angle + rot + spec.acts`. The nose is the way they push together.
// - Steering: nothing holds it up but its push. Each tick it works out which way to point so the push cancels gravity
//   and its speed across the line to its target, and spends the rest along that line. It turns the nose there as
//   fast as it can and still stop, with how heavy it is to turn worked out from its parts.
// - What steers, each from what it can give: parts with a `spin` input (`spec.config.maxTorque`) take the turn first;
//   what they cannot give goes to parts with a `swivel` input (a push tilted `spec.config.swivel` degrees, times how
//   far behind the middle it is), and what is left to parts with a `deflect` input (plates in the air,
//   `spec.config.area`, held along the air and angled off it by just what the turn needs).
// - Target: the robot the launcher named, else the enemy with a live core nearest the launcher's point (or nearest of
//   all with no point), aimed ahead by its speed. Lost, it flies to the last point it had and keeps looking.
// - Friends on the way are flown over.

const fuse = param('fuse', 12, { min: 0.5, max: 60 }); // s of flight before what goes off is set off anyway
const clear = param('clear', 0.15, { min: 0, max: 3 }); // s it flies straight before steering, to clear what let it go
const clearDist = param('clearDist', 0, { min: 0, max: 50 }); // and m from where it started (both must pass)
const proximity = param('proximity', 2, { min: 0, max: 10 }); // m: it goes off this close to the robot it follows

const G = 9.81;
const RAD = Math.PI / 180;
const MARGIN = 0.7; // share of its turning power it plans its braking on
const HOLD = 6; // how fast it takes out speed across its line (per second)
const SIDE = 0.8; // most of its push it spends sideways (about 53 degrees off its line)
const LIGHT = 10; // kg: lighter robots (other missiles) are not followed
const ACQUIRE = 60; // m: a robot this close to the launcher's point is the one it follows
const NEAR = 5; // m: losing sight of the robot it follows this close sets it off too
const ARRIVE = 3; // m: this close to its point with nothing tracked, it flies on straight and keeps looking
const PASS = 15; // m it keeps over a friend's core on its way
const PASS_MASS = 25; // kg: friends this heavy or more are flown over (drones, not other missiles)

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Says a thing once, and again only when it changes. */
function say(text) {
  if (state.said === text) return;
  state.said = text;
  if (text !== '') log(text);
}

/**
 * Where a part's weight is: the middle of its cells (`center`, from its position when built unturned), turned as the
 * part is. A part of one cell is its position; a cannon or a fabricator bay is meters off its first cell.
 */
function middle(p) {
  const c = p.center;
  if (!c || (c.x === 0 && c.y === 0)) return p.pos;
  const a = p.angle + p.rot * RAD;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return { x: p.pos.x + c.x * cs - c.y * sn, y: p.pos.y + c.x * sn + c.y * cs };
}

/**
 * The robot as it flies, from every part still attached: where its weight is, how heavy it is to turn, what pushes it
 * (each with its full push, the way it pushes with its swivel straight, and where it is from the middle), the way they
 * push together (the nose), and the parts that steer and go off.
 */
function body() {
  let mass = 0;
  let mx = 0;
  let my = 0;
  for (const p of parts) {
    const m = middle(p);
    mass += p.mass;
    mx += p.mass * m.x;
    my += p.mass * m.y;
  }
  const cx = mass > 0 ? mx / mass : self.pos.x;
  const cy = mass > 0 ? my / mass : self.pos.y;
  let inertia = 0;
  let thrust = 0;
  let nx = 0;
  let ny = 0;
  let torqueMax = 0;
  const pushers = [];
  const spinners = [];
  const plates = [];
  const blasts = [];
  for (const p of parts) {
    const m = middle(p);
    const rx = m.x - cx;
    const ry = m.y - cy;
    // Each part is a 1 m box: m / 6 about its own center, plus m r^2 about the center of mass.
    inertia += p.mass * (rx * rx + ry * ry + 1 / 6);
    const acts = p.spec.acts === undefined ? undefined : p.angle + (p.rot + p.spec.acts) * RAD;
    const steers = p.tags.includes('steer');
    if (p.tags.includes('push') && p.in.throttle !== undefined && p.spec.config.maxForce > 0 && acts !== undefined) {
      const force = p.spec.config.maxForce;
      const ux = Math.cos(acts);
      const uy = Math.sin(acts);
      thrust += force;
      nx += force * ux;
      ny += force * uy;
      // A push tilted by its swivel turns the robot by push * sin(tilt) * (how far ahead of the middle it is).
      const tilt = steers && p.in.swivel !== undefined && p.spec.config.swivel > 0 ? force * Math.sin(p.spec.config.swivel * RAD) * (rx * ux + ry * uy) : 0;
      pushers[pushers.length] = { id: p.id, tilt };
    }
    if (steers && p.in.spin !== undefined && p.spec.config.maxTorque > 0) {
      torqueMax += p.spec.config.maxTorque;
      spinners[spinners.length] = p.id;
    }
    if (steers && p.in.deflect !== undefined && p.spec.config.area > 0 && p.spec.config.deflect > 0 && acts !== undefined) plates[plates.length] = { id: p.id, axis: acts, area: p.spec.config.area, most: p.spec.config.deflect * RAD, rx, ry };
    if (p.tags.includes('blast') && p.in.detonate !== undefined) blasts[blasts.length] = p;
  }
  return { inertia: Math.max(0.1, inertia), thrust, nose: thrust > 0 ? Math.atan2(ny, nx) : self.angle, torqueMax, pushers, spinners, plates, blasts };
}

function setup() {
  const b = body();
  state.start = time;
  state.origin = { x: self.pos.x, y: self.pos.y };
  state.aim = b.nose;
  state.seenAt = -1;
  state.said = '';
  // The launcher's point: the last message with one in it.
  for (const m of inbox) {
    const d = m.data;
    if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') continue;
    state.point = { x: d.x, y: d.y };
    state.launched = true;
    state.vel = { x: typeof d.vx === 'number' ? d.vx : 0, y: typeof d.vy === 'number' ? d.vy : 0 };
    if (typeof d.id === 'number') state.id = d.id;
  }
}

/** The robot it follows: the one the launcher named, else the enemy nearest its point (or nearest of all without one). */
function pick() {
  let best = null;
  let bestD = Infinity;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < LIGHT) continue;
    if (state.id !== undefined && c.id === state.id) return c;
    const d = state.point ? Math.hypot(c.pos.x - state.point.x, c.pos.y - state.point.y) : c.distance;
    if (state.point && d > ACQUIRE) continue;
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function tick() {
  const b = body();
  if (b.thrust <= 0) {
    say('Guide: nothing in the group "push" pushes. Put the parts that push in that group.');
    return;
  }
  /** Sets off everything in the group `blast`. */
  const boom = () => {
    for (const p of b.blasts) set(p.id, 'detonate', 1);
  };
  if (time - state.start > fuse) boom();

  const seen = pick();
  // Lost sight of what it was about to reach: it passed out of view close by, or the robot is now seen somewhere
  // else (at a decoy). It goes off, as a near miss. Only on the tick right after.
  const was = state.close && time - state.close.t <= 1.5 * dt ? state.close : undefined;
  if (was && (!seen || Math.hypot(seen.pos.x - was.x, seen.pos.y - was.y) > NEAR)) boom();
  state.close = undefined;
  const clearing = time - state.start < clear || Math.hypot(self.pos.x - state.origin.x, self.pos.y - state.origin.y) < clearDist;
  // Armed once clear of where it started, and only when it was sent at something or tracks an enemy: safe while it
  // rides and while it clears, and one knocked loose by a hit stays a dud unless it finds a target.
  if (!state.armed && (state.launched || seen) && !clearing) {
    for (const p of b.blasts) if (p.in.arm !== undefined) set(p.id, 'arm', 1);
    state.armed = true;
  }
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
    // Close enough to the robot it follows: measured from what goes off (else its core), counting where both will be
    // by the next tick (at 100 m/s it covers 2 m a tick, past the point before it looks again).
    if (seen) {
      const w = b.blasts.length > 0 ? b.blasts[0].pos : self.pos;
      const rx = p.x - w.x;
      const ry = p.y - w.y;
      const vx = seen.vel.x - self.vel.x;
      const vy = seen.vel.y - self.vel.y;
      const v2 = vx * vx + vy * vy;
      const t = v2 > 0 ? clamp(-(rx * vx + ry * vy) / v2, 0, dt) : 0;
      const pass = Math.hypot(rx + vx * t, ry + vy * t);
      if (pass < proximity) boom();
      if (pass < NEAR && state.armed) state.close = { x: p.x, y: p.y, t: time };
    }
    // Reached the last point with nothing tracked: fly on the way it is going and keep looking.
    if (!seen && dist < ARRIVE) {
      state.point = undefined;
      state.aim = Math.atan2(self.vel.y, self.vel.x);
    }
    // Aim ahead of a moving robot: time left from how fast the gap closes.
    const closing = Math.max(20, (dx * (self.vel.x - state.vel.x) + dy * (self.vel.y - state.vel.y)) / Math.max(dist, 1));
    const tgo = dist / closing;
    const gx = p.x + state.vel.x * tgo;
    let gy = p.y + state.vel.y * tgo;
    // Over friends on the way: its line is raised to pass `PASS` meters over any it would pass closer to.
    const lx = gx - self.pos.x;
    const ly = gy - self.pos.y;
    const l2 = lx * lx + ly * ly;
    for (const c of contacts) {
      if (c.side !== 'friend' || c.mass < PASS_MASS || l2 < 1) continue;
      const fx = c.pos.x - self.pos.x;
      const fy = c.pos.y - self.pos.y;
      const u = (fx * lx + fy * ly) / l2;
      if (u <= 0 || u >= 1 || Math.abs(fx * ly - fy * lx) / Math.sqrt(l2) >= PASS) continue;
      gy = Math.max(gy, self.pos.y + (fy + PASS) / Math.max(u, 0.2));
    }
    mark(gx, gy, 'guide');
    aim = Math.atan2(gy - self.pos.y, gx - self.pos.x);
  }

  // Across the line to where it is going: push to cancel gravity and take out the speed across it; the rest along it.
  const ax = -Math.sin(aim);
  const ay = Math.cos(aim);
  const across = ax * self.vel.x + ay * self.vel.y;
  const side = clamp(self.mass * (G * ay - HOLD * across), -SIDE * b.thrust, SIDE * b.thrust);
  const along = Math.sqrt(b.thrust * b.thrust - side * side);
  // Right after it starts, only hold the aim: swinging the nose would swing the tail into what let it go.
  const want = clearing ? state.aim : aim + Math.atan2(side, along);
  const err = wrap(want - b.nose);
  // Push only as far as the nose points where it wants to go: pointing the wrong way, full push would only speed it
  // the wrong way. With nothing that spins it, it turns by its push alone, so some push always stays on.
  const throttle = clamp(Math.cos(err), b.torqueMax > 0 ? 0 : 0.3, 1);
  for (const p of b.pushers) set(p.id, 'throttle', throttle);

  // What the swivels and the plates can give at most right now, per unit of their inputs (counterclockwise positive
  // for a positive input).
  let tilt = 0;
  for (const p of b.pushers) tilt += p.tilt * throttle;
  const speed = Math.hypot(self.vel.x, self.vel.y);
  const path = speed > 1 ? Math.atan2(self.vel.y, self.vel.x) : b.nose;
  // A plate along the air pushes nothing. Turned u radians off it, one behind the middle gives k * u counterclockwise,
  // k = 0.6 * area * speed^2 * (how far behind the middle it is, along the path).
  let plate = 0;
  let plateMost = 0;
  for (const f of b.plates) {
    f.k = -0.6 * f.area * speed * speed * (f.rx * Math.cos(path) + f.ry * Math.sin(path));
    plate += f.k;
    plateMost += Math.abs(f.k) * f.most;
  }
  // Turn the nose as fast as it can and brake just in time: the fastest spin it can still stop from before the nose
  // points where it wants (v^2 = 2 a d), and a straight line close in so it settles. It plans on what spins in full
  // and on half of what the swivels and plates give (they change with its push and its speed).
  const power = b.torqueMax + 0.5 * (Math.abs(tilt) + plateMost);
  if (b.spinners.length === 0 && b.plates.length === 0 && !b.pushers.some((p) => p.tilt !== 0)) say('Guide: nothing in the group "steer" can turn it. Put a gyro, a swiveling thruster, or fins in that group.');
  const spinUp = (MARGIN * power) / b.inertia;
  const spin = Math.sign(err) * Math.min(Math.sqrt(2 * spinUp * Math.abs(err)), 8 * Math.abs(err));
  const torque = (b.inertia * (spin - self.angVel)) / (3 * dt); // counterclockwise positive
  // What spins takes the turn first (a spin input is clockwise positive).
  const spun = b.torqueMax > 0 ? clamp(torque, -b.torqueMax, b.torqueMax) : 0;
  for (const id of b.spinners) set(id, 'spin', -spun / b.torqueMax);
  // What it cannot give goes to the swivels, then what is left to the plates. Held straight while clearing.
  let rest = clearing ? 0 : torque - spun;
  const swivel = Math.abs(tilt) > 1 ? clamp(rest / tilt, -1, 1) : 0;
  for (const p of b.pushers) if (p.tilt !== 0) set(p.id, 'swivel', swivel);
  rest -= swivel * tilt;
  const off = Math.abs(plate) < 1 ? 0 : rest / plate;
  for (const f of b.plates) {
    // Along the air: the plate has two ends, so the nearer of the two ways round.
    let lie = wrap(path - f.axis);
    if (lie > Math.PI / 2) lie -= Math.PI;
    if (lie < -Math.PI / 2) lie += Math.PI;
    set(f.id, 'deflect', clamp((lie - off) / f.most, -1, 1));
  }
}
