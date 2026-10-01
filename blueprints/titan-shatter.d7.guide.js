// titan-shatter dart guide: a copy of tech-missile.guide.js (made by tournaments/gen/titan-shatter.mjs).
// Seeker guide (M8): flies to the point its launcher sent it, and follows the robot its seeker tracks there.
// Starts when the dart wakes (its decoupler lets go) or on deploy. G turns it off and on.
// - setup() reads the launcher's point from inbox (and `arc` if the launcher chose the path for this shot). With none,
//   it flies straight and follows the first robot it tracks.
// - While the seeker tracks the robot, it aims ahead of it by the robot's speed. If it loses track, it flies to the
//   last point it had (a robot on the ground there is hit on impact); with nothing there it flies on and keeps looking.
// - It flies straight for `clear` seconds and `clearDist` meters after release, so it turns only once clear of its
//   launcher. It drives a thruster or a booster (`thrust` must match: 160 or 400), either gyro (`gyroTorque`: 40
//   or 200), and either warhead.
// - arc 1: climbs toward `height` meters above the point, then dives onto it once the point is `dive` degrees below
//   it, holding `arcSpeed` while arcing so it can turn tighter.
// - Steering as dart-v2: the push cancels gravity and sideways speed, the rest goes along the line; the gyro turns
//   the nose as fast as it can and still stop.
// Parts are found by type, so it works however the dart was placed on its launcher.
// Tech dart additions (the seeker guide plus):
// - A swiveling thruster pushes like a booster and also swivels to give the turn what the gyro cannot (a positive
//   swivel turns it clockwise). Given the gyro's whole command as well, it doubled the turn the guide planned on and
//   the dart swung back and forth 2 to 4 times a second (Logan: "a very wiggly path"); a plain dart, once.
// - A distance charge is armed and set off like a warhead.
// - A gun in its nose blasts once armed, while its sight shows an enemy within `gunRange` meters.
// - Fins behind the middle act as a weathervane: straight, they push its nose back onto its path (at 50 m/s and 10
//   degrees off, harder than the heavy gyro can turn it; Logan: "it cannot steer well at all"). Held along the air
//   they push nothing, so it angles them off that by just what the turn needs beyond the gyro: the torque a fin
//   gives per radian off the air is 0.6 * area * speed^2 times its arm behind the center of mass. Angled toward the
//   wanted heading instead, they sprang it back and forth (Logan: "constantly overcorrecting... a very wiggly path").

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
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other darts) are ignored
const acquire = param('acquire', 60, { min: 1, max: 1000 }); // m: a robot this close to the point is the one it follows
const proximity = param('proximity', 2, { min: 0, max: 10 }); // m: goes off this close to a tracked robot (from its warhead)
const passBy = param('passBy', 15, { min: 0, max: 50 }); // m it keeps over a friendly robot's core on its way (a drone may be 15 wide)
const passMass = param('passMass', 25, { min: 0, max: 1000 }); // kg: friendly robots this heavy or more are flown over (drones, not other darts)
const near = param('near', 5, { min: 0, max: 20 }); // m: losing sight of a tracked robot this close (from its warhead) sets it off too
const arrive = param('arrive', 3, { min: 0, max: 20 }); // m: this close to the point with nothing tracked, it flies on straight and keeps looking
const gunRange = param('gunRange', 150, { min: 0, max: 300 }); // m: the nose gun blasts at an enemy its sight shows this close
const swivelAngle = param('swivelAngle', 15, { min: 1, max: 90 }); // degrees, the swiveling thruster's most swivel
const finDeflect = param('finDeflect', 20, { min: 1, max: 90 }); // degrees, the fin part's most deflection
const finArea = param('finArea', 0.6, { min: 0.01, max: 10 }); // m^2, the fin part's area
const SIGHT_ENEMY = 3; // a gun's sightSide when an enemy is on its line

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Which way the nose points: from the motors (their middle, for a dart with two side by side) to the dart's
 * center of mass. Not to the core: on a dart two cells wide the core sits off the middle line.
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

/** How hard the dart is to turn: each part's mass times its squared distance from the center of mass, plus its own box. */
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
  // tracks an enemy: safe while it rides on a launcher and while it clears it, and a dart knocked loose by a hit
  // (no message) stays a dud unless it finds a target.
  if (!state.armed && (state.launched || seen) && time - state.start >= clear && Math.hypot(self.pos.x - state.origin.x, self.pos.y - state.origin.y) >= clearDist) {
    set('warhead', 'arm', 1);
    set('heavywarhead', 'arm', 1);
    set('charge', 'arm', 1);
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
    // Over friendly robots on the way (`passMass` or more: drones, not other darts): its line is raised to pass
    // `passBy` meters over any it would pass closer to. In a 5v5 the fab drones' darts flipped over the top and flew
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
  // Some push always goes along: with none, which way it points would depend only on which way it drifts, and it
  // would flip between two headings. Diving, it pushes at full.
  if (state.phase === 'climb') {
    const speed = Math.hypot(self.vel.x, self.vel.y);
    along = clamp(self.mass * (2 * (arcSpeed - speed) + 9.81 * Math.sin(aim)), Math.min(along, 0.4 * thrust), along);
  }
  // Right after release, only hold the aim: swinging the nose would swing the tail into the launcher.
  const clearing = time - state.start < clear || Math.hypot(self.pos.x - state.origin.x, self.pos.y - state.origin.y) < clearDist;
  const want = clearing ? state.aim : aim + Math.atan2(side, along);
  const err = wrap(want - nose());
  // Push only as far as the nose points where it wants to go: pointing the wrong way (swinging round into a dive),
  // full push would only speed it the wrong way.
  const throttle = Math.min(1, Math.hypot(side, along) / thrust) * clamp(Math.cos(err), 0, 1);
  set('thruster', 'throttle', throttle);
  set('booster', 'throttle', throttle);
  set('swivelthruster', 'throttle', throttle);
  // The nose gun: once armed, while its sight shows an enemy close enough.
  const gun = parts.find((p) => p.type === 'gun');
  if (gun) set('gun', 'fire', state.armed && gun.out.sightSide === SIGHT_ENEMY && gun.out.sight <= gunRange ? 1 : 0);

  // Turn the nose as fast as the gyro can and brake just in time (as dart-v2).
  const inertia = turnInertia();
  const spinUp = (margin * gyroTorque) / inertia;
  const spin = Math.sign(err) * Math.min(Math.sqrt(2 * spinUp * Math.abs(err)), 8 * Math.abs(err));
  const torque = (inertia * (spin - self.angVel)) / (3 * dt); // counterclockwise positive
  const spinCmd = clamp(-torque / gyroTorque, -1, 1); // a gyro's spin is clockwise positive
  set('gyro', 'spin', spinCmd);
  set('heavygyro', 'spin', spinCmd);
  // What the gyro cannot give (counterclockwise positive) goes to the swivel, then what is left to the fins, each
  // from how much torque it gives per unit of its input. Held straight while clearing the launcher.
  const speed = Math.hypot(self.vel.x, self.vel.y);
  const heading = nose();
  const path = speed > 1 ? Math.atan2(self.vel.y, self.vel.x) : heading;
  let cx = 0;
  let cy = 0;
  let m = 0;
  for (const p of parts) {
    m += p.mass;
    cx += p.mass * p.pos.x;
    cy += p.mass * p.pos.y;
  }
  // How far a part sits behind the center of mass, along the nose.
  const behind = (p) => (m > 0 ? (cx / m - p.pos.x) * Math.cos(heading) + (cy / m - p.pos.y) * Math.sin(heading) : 0);
  let rest = clearing ? 0 : torque + spinCmd * gyroTorque;
  // A swivel of 1 tilts the push `swivelAngle` degrees and turns the dart clockwise: -push * sin * arm counterclockwise.
  let swivelGain = 0;
  for (const p of parts) if (p.type === 'swivelthruster') swivelGain += thrust * throttle * Math.sin((swivelAngle * Math.PI) / 180) * behind(p);
  const swivel = swivelGain > 1 ? clamp(-rest / swivelGain, -1, 1) : 0;
  set('swivelthruster', 'swivel', swivel);
  rest += swivel * swivelGain;
  // Fins: a fin's plate is turned `deflect` counterclockwise from the body's axis, so it lies along the air at
  // deflect = path - nose; turned u radians less than that, the fins behind the center of mass give k * u
  // counterclockwise, k = 0.6 * area * speed^2 * arm each.
  let k = 0;
  for (const p of parts) if (p.type === 'fin') k += 0.6 * finArea * speed * speed * behind(p);
  const u = Math.abs(k) < 1 ? 0 : rest / k;
  set('fin', 'deflect', clamp((wrap(path - heading) - u) / ((finDeflect * Math.PI) / 180), -1, 1));
}
