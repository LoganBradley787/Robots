// Seeker guide (M8): flies to the point its launcher sent it, and follows the robot its seeker tracks there.
// Starts when the missile wakes (its decoupler lets go) or on deploy. G turns it off and on.
// - setup() reads the launcher's point from inbox (and `arc` if the launcher chose the path for this shot). With none,
//   it flies straight and follows the first robot it tracks.
// - While the seeker tracks the robot, it aims ahead of it by the robot's speed. If it loses track, it flies to the
//   last point it had (a robot on the ground there is hit on impact); with nothing there it flies on and keeps looking.
// - It flies straight for `clear` seconds and `clearDist` meters after release, so it turns only once clear of its
//   launcher. It drives a thruster or a booster (`thrust` must match: 160 or 400), either gyro (`gyroTorque`: 40
//   or 200), and either warhead.
// - arc 1: climbs toward `height` meters above the point, then dives onto it once the point is `dive` degrees below
//   it, holding `arcSpeed` while arcing so it can turn tighter.
// - Steering as missile-v2: the push cancels gravity and sideways speed, the rest goes along the line; the gyro turns
//   the nose as fast as it can and still stop.
// Parts are found by type, so it works however the missile was placed on its launcher.
// Missilenator additions (Logan's design: nine boosters in three columns, nine heavy warheads, five turrets):
// - Turning is shared: the gyro first, then the booster columns. A booster off the middle line turns the missile as
//   it pushes (its push times how far it sits to the side), so the side turning it the wrong way throttles down and
//   the other side up if it has room. Two columns 2 m apart give about 1600 N m, eight times the heavy gyro, and the
//   turn is planned on that, not the gyro alone (it is 10 tall: on its gyro alone a quarter turn took about 3 s).
// - Boosters are set by their tags (`bl`, `bc`, `br`: one per column), so each column can differ.
// - The warheads go off together: one armed warhead's blast sets off the others.

const fuse = param('fuse', 12, { min: 0.5, max: 30 }); // seconds of flight before it detonates
const thrust = param('thrust', 160, { min: 10, max: 1000 }); // N, the motor's full push (thruster 160, booster 400)
const gyroTorque = param('gyroTorque', 40, { min: 1, max: 1000 }); // N m, the gyro's full torque (gyro 40, heavy gyro 200)
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of the gyro's torque it plans its braking on
const hold = param('hold', 6, { min: 0, max: 20 }); // how fast it takes out speed across its line (per second)
const climbHold = param('climbHold', 1.5, { min: 0, max: 20 }); // the same while climbing for an arc: gentle, so its heading does not swing
const sideMax = param('sideMax', 0.8, { min: 0.1, max: 0.95 }); // most of the push it spends sideways (0.8 is about 53 degrees off its line)
const clear = param('clear', 0.15, { min: 0, max: 2 }); // seconds flying straight before steering, to clear the launcher
const clearDist = param('clearDist', 0, { min: 0, max: 50 }); // and meters from where it was let go (both must pass)
const lead = param('lead', 1, { min: 0, max: 2 }); // 1 aims ahead of a tracked robot by its speed, 0 at where it is
const arc = param('arc', 0, { min: 0, max: 1 }); // 1: climb above the point, then come down onto it
const height = param('height', 40, { min: 5, max: 300 }); // m above the point it climbs to when arcing
const spread = param('spread', 0.25, { min: 0, max: 1 }); // each arc's height varies by up to this share (seeded), so two arcs rarely meet
const arcSpeed = param('arcSpeed', 30, { min: 5, max: 200 }); // m/s it holds while arcing, so it can turn tighter
const dive = param('dive', 45, { min: 10, max: 89 }) * (Math.PI / 180); // when arcing, it turns down once the point is this steeply below it
const turnLag = param('turnLag', 1, { min: 0, max: 3 }); // s its nose takes to swing round into the dive
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other missiles) are ignored
const acquire = param('acquire', 60, { min: 1, max: 1000 }); // m: a robot this close to the point is the one it follows
const proximity = param('proximity', 2, { min: 0, max: 10 }); // m: goes off this close to a tracked robot (from its warhead)
const passBy = param('passBy', 15, { min: 0, max: 50 }); // m it keeps over a friendly robot's core on its way (a drone may be 15 wide)
const passMass = param('passMass', 25, { min: 0, max: 1000 }); // kg: friendly robots this heavy or more are flown over (drones, not other missiles)
const near = param('near', 5, { min: 0, max: 20 }); // m: losing sight of a tracked robot this close (from its warhead) sets it off too
const arrive = param('arrive', 3, { min: 0, max: 20 }); // m: this close to the point with nothing tracked, it flies on straight and keeps looking
const gunRange = param('gunRange', 150, { min: 0, max: 300 }); // m: the nose gun blasts at an enemy its sight shows this close
const topSpeed = param('topSpeed', 1000, { min: 5, max: 1000 }); // m/s it holds once diving or straight in (1000: no limit)
const minAlong = param('minAlong', 0.4, { min: 0, max: 1 }); // share of full push that always goes along its line
const columnTime = param('columnTime', 0, { min: 0, max: 2 }); // s the booster columns take to stop a spin error (0: as the gyro)
const columnRate = param('columnRate', 0, { min: 0, max: 60 }); // most a column's throttle changes a second (0: at once)
const aimMiddle = param('aimMiddle', 0, { min: 0, max: 1 }); // 1: aims at the middle of the robot's parts, not its core
const aimLift = param('aimLift', 0, { min: 0, max: 20 }); // m: and never lower than this over its lowest part, on the ground
const aimGround = param('aimGround', 2, { min: 0, max: 20 }); // m: a robot whose lowest part is under this is on the ground
const boosterPush = param('boosterPush', 400, { min: 1, max: 5000 }); // N, one booster's full push (the booster part)
const SIGHT_ENEMY = 3; // a gun's sightSide when an enemy is on its line

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Which way the nose points: from the motors (their middle, for a missile with two side by side) to the missile's
 * center of mass. Not to the core: on a missile two cells wide the core sits off the middle line.
 */
function nose() {
  let n = 0;
  let mx = 0;
  let my = 0;
  let m = 0;
  let cx = 0;
  let cy = 0;
  for (const p of parts) {
    m += p.mass;
    cx += p.mass * p.pos.x;
    cy += p.mass * p.pos.y;
    if (p.type !== 'thruster' && p.type !== 'booster' && p.type !== 'swivelthruster') continue;
    n++;
    mx += p.pos.x;
    my += p.pos.y;
  }
  if (n === 0 || m <= 0) return self.angle;
  return Math.atan2(cy / m - my / n, cx / m - mx / n);
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

/** Where its blast would be: its warhead or distance charge, else its core. */
function warheadAt() {
  for (const p of parts) if (p.type === 'warhead' || p.type === 'heavywarhead' || p.type === 'charge') return p.pos;
  return self.pos;
}

/** Sets off the warhead or charge, whichever it carries. */
function boom() {
  set('warhead', 'detonate', 1);
  set('heavywarhead', 'detonate', 1);
  set('charge', 'detonate', 1);
}

function setup() {
  state.start = time;
  state.origin = { x: self.pos.x, y: self.pos.y };
  state.aim = nose();
  state.phase = arc > 0.5 ? 'climb' : 'direct';
  state.height = height * (1 + spread * (2 * random() - 1));
  state.seenAt = -1;
  // The launcher's point: the last message with one in it.
  for (const m of inbox) {
    const d = m.data;
    if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') continue;
    state.point = { x: d.x, y: d.y };
    state.launched = true;
    state.vel = { x: typeof d.vx === 'number' ? d.vx : 0, y: typeof d.vy === 'number' ? d.vy : 0 };
    if (typeof d.id === 'number') state.id = d.id;
    // The launcher may choose the path for this shot: `arc: 1` over the top, `arc: 0` straight in.
    if (typeof d.arc === 'number') state.phase = d.arc > 0.5 ? 'climb' : 'direct';
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

/**
 * The booster columns, by tag: for each, the torque (counterclockwise) its boosters give at full throttle, from how far
 * each sits to the side of the center of mass across the nose.
 */
function columns() {
  let m = 0;
  let cx = 0;
  let cy = 0;
  for (const p of parts) {
    m += p.mass;
    cx += p.mass * p.pos.x;
    cy += p.mass * p.pos.y;
  }
  const h = nose();
  const hx = Math.cos(h);
  const hy = Math.sin(h);
  const by = {};
  for (const p of parts) {
    if (p.type !== 'booster' || m <= 0) continue;
    const tag = p.tags.find((t) => t === 'bl' || t === 'bc' || t === 'br');
    if (!tag) continue;
    // Push along the nose from where the booster sits: r x F, counterclockwise positive.
    const turn = boosterPush * ((p.pos.x - cx / m) * hy - (p.pos.y - cy / m) * hx);
    by[tag] = (by[tag] || 0) + turn;
  }
  return Object.keys(by).map((tag) => ({ tag, turn: by[tag] }));
}

/**
 * Where to aim at a robot: its core, or with `aimMiddle` the middle of its parts from a scan, never lower than `aimLift`
 * over its lowest part when that is on the ground (Logan: against a silo whose core is buried at ground level it hit the ground short of it).
 */
function middleOf(c) {
  if (aimMiddle < 0.5) return { x: c.pos.x, y: c.pos.y };
  const list = scan(c.id);
  if (!list || list.length === 0) return { x: c.pos.x, y: c.pos.y };
  let sx = 0;
  let sy = 0;
  let low = Infinity;
  for (const q of list) {
    sx += q.pos.x;
    sy += q.pos.y;
    low = Math.min(low, q.pos.y);
  }
  // Only a robot standing on the ground (its lowest part under `aimGround` m) gets the lift: on a drone 3 m tall it aimed
  // over the top.
  return { x: sx / list.length, y: low < aimGround ? Math.max(sy / list.length, low + aimLift) : sy / list.length };
}

/** The most the columns can turn it either way at this throttle: one side eased off entirely. */
function columnTorque(throttle) {
  let most = 0;
  for (const c of columns()) most = Math.max(most, Math.abs(c.turn));
  return most * throttle;
}

function tick() {
  if (time - state.start > fuse) boom();

  const seen = pick();
  // Lost sight of what it was about to reach (M11): it passed out of the seeker's cone close by, or the robot is now
  // seen somewhere else (at a flare). It goes off, as a near miss.
  // Only on the tick right after: a script switched off and on again later starts fresh.
  const was = state.close && time - state.close.t <= 1.5 * dt ? state.close : undefined;
  if (was && (!seen || Math.hypot(seen.pos.x - was.x, seen.pos.y - was.y) > near)) boom();
  state.close = undefined;
  // Armed (M10) once clear of its launcher, and only when it was launched at something (a message with a point) or
  // tracks an enemy: safe while it rides on a launcher and while it clears it, and a missile knocked loose by a hit
  // (no message) stays a dud unless it finds a target.
  if (!state.armed && (state.launched || seen) && time - state.start >= clear && Math.hypot(self.pos.x - state.origin.x, self.pos.y - state.origin.y) >= clearDist) {
    set('warhead', 'arm', 1);
    set('heavywarhead', 'arm', 1);
    set('charge', 'arm', 1);
    state.armed = true;
  }
  if (seen) {
    state.point = middleOf(seen);
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
    // Close enough to the tracked robot (M11): measured from the warhead, and counting where it will be by the next
    // tick. The nose reaches something light (a flare) first and would push straight through it, and at 100 m/s it
    // covers 2 m a tick, past the point before it looks again.
    if (seen) {
      const w = warheadAt();
      const rx = p.x - w.x;
      const ry = p.y - w.y;
      const vx = seen.vel.x - self.vel.x;
      const vy = seen.vel.y - self.vel.y;
      const v2 = vx * vx + vy * vy;
      const t = v2 > 0 ? clamp(-(rx * vx + ry * vy) / v2, 0, dt) : 0;
      const pass = Math.hypot(rx + vx * t, ry + vy * t);
      if (pass < proximity) boom();
      if (pass < near && state.armed) state.close = { x: p.x, y: p.y, t: time };
    }
    // Reached the last point with nothing tracked (it moved, or was never there): fly on the way it is going and keep
    // looking. A robot on the ground there was hit on impact already.
    if (!seen && dist < arrive) {
      state.point = undefined;
      state.aim = Math.atan2(self.vel.y, self.vel.x);
    }
    // Aim ahead of a moving robot: time left from how fast the gap closes.
    const closing = Math.max(20, (dx * (self.vel.x - state.vel.x) + dy * (self.vel.y - state.vel.y)) / Math.max(dist, 1));
    const tgo = dist / closing;
    let gx = p.x + lead * state.vel.x * tgo;
    let gy = p.y + lead * state.vel.y * tgo;
    if (state.phase === 'climb') {
      // Up toward `height` above the point, then down: once the point is steeply enough below it, or once the ground
      // left is about what it needs to stop moving sideways (v^2 / 2a with its sideways push, plus the ground it covers
      // while its nose swings round), whichever comes first.
      const vx = Math.abs(self.vel.x);
      const push = (sideMax * thrust) / Math.max(0.1, self.mass);
      const stop = (vx * vx) / (2 * push) + vx * turnLag;
      const ground = Math.abs(gx - self.pos.x);
      if (Math.atan2(self.pos.y - gy, ground) > dive || ground < stop) state.phase = 'down';
      else gy += state.height;
    }
    // Over friendly robots on the way (`passMass` or more: drones, not other missiles): its line is raised to pass
    // `passBy` meters over any it would pass closer to. In a 5v5 the fab drones' missiles flipped over the top and flew
    // back through the drones beside them (Logan).
    const lx = gx - self.pos.x;
    const ly = gy - self.pos.y;
    const l2 = lx * lx + ly * ly;
    for (const c of contacts) {
      if (c.side !== 'friend' || c.mass < passMass || l2 < 1) continue;
      const fx = c.pos.x - self.pos.x;
      const fy = c.pos.y - self.pos.y;
      const u = (fx * lx + fy * ly) / l2;
      if (u <= 0 || u >= 1 || Math.abs(fx * ly - fy * lx) / Math.sqrt(l2) >= passBy) continue;
      gy = Math.max(gy, self.pos.y + (fy + passBy) / Math.max(u, 0.2));
    }
    mark(gx, gy, state.phase);
    aim = Math.atan2(gy - self.pos.y, gx - self.pos.x);
  }

  // Across the line to where it is going: push to cancel gravity and take out the speed across it; the rest along it.
  const nx = -Math.sin(aim);
  const ny = Math.cos(aim);
  const across = nx * self.vel.x + ny * self.vel.y;
  const side = clamp(self.mass * (9.81 * ny - (state.phase === 'climb' ? climbHold : hold) * across), -sideMax * thrust, sideMax * thrust);
  let along = Math.sqrt(thrust * thrust - side * side);
  // Climbing for an arc, it holds `arcSpeed` along its line (easing off the push along it) and keeps full push for
  // turning: slower means a tighter turn over the top.
  // Some push always goes along (`minAlong` of full): with none, which way it points would depend only on which way it
  // drifts, and it would flip between two headings. Otherwise it holds `topSpeed` (Logan's missilenator: at 6 g of
  // push it dove at 85 m/s, too fast to turn onto its target, and hit the ground 70 m past it).
  const speed = Math.hypot(self.vel.x, self.vel.y);
  const cap = state.phase === 'climb' ? arcSpeed : topSpeed;
  along = clamp(self.mass * (2 * (cap - speed) + 9.81 * Math.sin(aim)), Math.min(along, minAlong * thrust), along);
  // Right after release, only hold the aim: swinging the nose would swing the tail into the launcher.
  const clearing = time - state.start < clear || Math.hypot(self.pos.x - state.origin.x, self.pos.y - state.origin.y) < clearDist;
  const want = clearing ? state.aim : aim + Math.atan2(side, along);
  const err = wrap(want - nose());
  // Push only as far as the nose points where it wants to go: pointing the wrong way (swinging round into a dive),
  // full push would only speed it the wrong way.
  const throttle = Math.min(1, Math.hypot(side, along) / thrust) * clamp(Math.cos(err), 0, 1);
  set('thruster', 'throttle', throttle);

  // Turn the nose as fast as the gyro can and brake just in time (as missile-v2).
  const inertia = turnInertia();
  const spinUp = (margin * (gyroTorque + columnTorque(throttle))) / inertia;
  const spin = Math.sign(err) * Math.min(Math.sqrt(2 * spinUp * Math.abs(err)), 8 * Math.abs(err));
  const torque = (inertia * (spin - self.angVel)) / (3 * dt); // counterclockwise positive
  const spinCmd = clamp(-torque / gyroTorque, -1, 1); // a gyro's spin is clockwise positive
  set('gyro', 'spin', spinCmd);
  set('heavygyro', 'spin', spinCmd);
  // What the gyro cannot give (counterclockwise positive) comes from the booster columns: raise the ones that help
  // (if they have room), then ease off the ones that fight it.
  // The columns work on a gentler turn than the gyro's (`columnTime` s to take out the spin error, not 3 ticks): all or
  // nothing, they overcorrected and it shook (Logan: its guns could not hold a lock). Eased by `columnRate` a second.
  const soft = columnTime > 0 ? (inertia * (spin - self.angVel)) / Math.max(columnTime, 3 * dt) : torque;
  let rest = clearing ? 0 : soft + spinCmd * gyroTorque;
  if (rest * soft < 0) rest = 0;
  const cols = columns();
  let help = 0;
  let fight = 0;
  for (const c of cols) {
    if (c.turn * rest > 0) help += c.turn;
    else fight += c.turn;
  }
  const up = Math.abs(help) > 1e-6 ? clamp(rest / ((1 - throttle) * help || 1e-6), 0, 1) : 0;
  const left = rest - up * (1 - throttle) * help;
  const down = Math.abs(fight) > 1e-6 && throttle > 0 ? clamp(left / (-throttle * fight), 0, 1) : 0;
  if (!state.cols) state.cols = {};
  for (const c of cols) {
    const want = c.turn * rest > 0 ? throttle + (1 - throttle) * up : throttle * (1 - down);
    const was = state.cols[c.tag] === undefined ? want : state.cols[c.tag];
    const now = columnRate > 0 ? was + clamp(want - was, -columnRate * dt, columnRate * dt) : want;
    state.cols[c.tag] = now;
    set(c.tag, 'throttle', now);
  }
}
