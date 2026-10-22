// titan-bastion dart guide: the seeker guide (missile-up.guide.js), kept by hand since the titan-darts fixes (2026-10).
// - The robot the base named is followed whatever it weighs.
// - Its fuse fits the flight: `fuse` s at least, and the time to the launcher's point at `fuseSpeed` plus `fuseSpare`
//   when that is longer, up to `fuseMax`.
// - It arms only within `armDist` m of the point it flies to (the robot it tracks, else the launcher's point), as the
//   hive's darts do. Armed 15 m out of its bay, darts let go 0.05 s apart bumped each other over the fortress and blew
//   up there (a third of them); unarmed, a bump or a shell on the way only breaks one.
// - (titans v2, 2026-10) It also arms the moment its seeker sees ANY enemy robot close ahead (`armNear` m plus a
//   size from its part count, measured to its core), so a dart that runs into a panel or a drone on its way goes off
//   instead of breaking. And once it is clear of its own volley (`armOut` m from where it was let go and no friendly
//   robot within `armSafe` m) it arms anyway: a robot hidden in a jammer bubble is never seen, and its hull is hit
//   on the way to the guessed point. Darts of one volley still touching each other stay safe.
// - (titans v2, 2026-10) A way in: the launcher may send `via`, a list of points given from the robot it follows (so
//   they move with it). The dart flies through them in turn at `viaSpeed` (slow enough to turn round), then straight
//   at the robot, led as usual. The base uses it to come in on the robot's thinnest side, its back most often.
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

const fuse = param('fuse', 12, { min: 0.5, max: 30 }); // s of flight before it detonates, at least (a far point gives it more)
const fuseSpeed = param('fuseSpeed', 50, { min: 5, max: 500 }); // m/s: the fuse is at least the time to the launcher's point at this speed
const fuseSpare = param('fuseSpare', 5, { min: 0, max: 30 }); // s added to that (the climb out, a target that moves away)
const fuseMax = param('fuseMax', 40, { min: 1, max: 120 }); // s at most, so a dart that lost everything still ends
const thrust = param('thrust', 160, { min: 10, max: 1000 }); // N, the motor's full push (thruster 160, booster 400)
const gyroTorque = param('gyroTorque', 40, { min: 1, max: 1000 }); // N m, the gyro's full torque (gyro 40, heavy gyro 200)
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of the gyro's torque it plans its braking on
const hold = param('hold', 6, { min: 0, max: 20 }); // how fast it takes out speed across its line (per second)
const climbHold = param('climbHold', 1.5, { min: 0, max: 20 }); // the same while climbing for an arc: gentle, so its heading does not swing
const sideMax = param('sideMax', 0.8, { min: 0.1, max: 0.95 }); // most of the push it spends sideways (0.8 is about 53 degrees off its line)
const clear = param('clear', 0.15, { min: 0, max: 2 }); // seconds flying straight before steering, to clear the launcher
const clearDist = param('clearDist', 0, { min: 0, max: 50 }); // and meters from where it was let go (both must pass)
const lead = param('lead', 1, { min: 0, max: 2 }); // 1 aims ahead of a tracked robot by its speed, 0 at where it is
const minClose = param('minClose', 100, { min: 10, max: 1000 }); // m/s: the closing speed it counts on at least when leading
const floor = param('floor', 0.5, { min: 0, max: 50 }); // m: it never aims lower than this (the ground is at 0)
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
const viaSpeed = param('viaSpeed', 45, { min: 5, max: 200 }); // m/s it holds on its way through the `via` points
const viaReach = param('viaReach', 25, { min: 2, max: 200 }); // m: this close to a `via` point it goes on to the next
const viaSpread = param('viaSpread', 8, { min: 0, max: 50 }); // m each `via` point is moved at random, so darts of a volley do not meet there
const viaMax = param('viaMax', 25, { min: 1, max: 120 }); // s at most on the `via` points, then straight in
const armDist = param('armDist', 200, { min: 5, max: 2000 }); // m from the point it flies to: it arms inside this
const armNear = param('armNear', 40, { min: 0, max: 500 }); // m (plus the robot's size): an enemy seen this close arms it
const armOut = param('armOut', 60, { min: 0, max: 2000 }); // m from where it was let go: past this, clear of its volley, it arms
const armSafe = param('armSafe', 7, { min: 0, max: 50 }); // m: a friendly robot (a dart of its volley) this close keeps it safe

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
    if (p.type !== 'thruster' && p.type !== 'booster') continue;
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

/** Where its blast would be: its warhead (in the nose), else its core. */
function warheadAt() {
  for (const p of parts) if (p.type === 'warhead' || p.type === 'heavywarhead') return p.pos;
  return self.pos;
}

/** Sets off the warhead, whichever kind it carries. */
function boom() {
  set('warhead', 'detonate', 1);
  set('heavywarhead', 'detonate', 1);
}

function setup() {
  state.start = time;
  state.origin = { x: self.pos.x, y: self.pos.y };
  state.aim = nose();
  state.phase = arc > 0.5 ? 'climb' : 'direct';
  state.height = height * (1 + spread * (2 * random() - 1));
  state.seenAt = -1;
  state.fixAt = time; // when the point and speed were last known (the launcher's message, then each sighting)
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
    // A way in (titans v2, 2026-10): points given from the robot, flown through in turn before going in.
    state.via = undefined;
    if (Array.isArray(d.via) && d.via.length > 0) {
      state.via = [];
      // Each dart's points shifted a little (seeded), so a volley does not meet itself at them.
      for (const v of d.via) if (v && typeof v.x === 'number' && typeof v.y === 'number' && state.via.length < 4) state.via.push({ x: v.x + viaSpread * (2 * random() - 1), y: v.y + viaSpread * (2 * random() - 1) });
      if (state.via.length > 0) {
        state.phase = 'via';
        state.viaK = 0;
      } else state.via = undefined;
    }
  }
  // The fuse fits the flight: a dart sent far gets the time to get there (titans let go from 900 m).
  state.fuse = fuse;
  if (state.point) {
    const far = Math.hypot(state.point.x - self.pos.x, state.point.y - self.pos.y);
    let path = far / fuseSpeed;
    if (state.via) {
      // Through the points first: the whole way at `viaSpeed` (titans v2, 2026-10).
      let x = self.pos.x;
      let y = self.pos.y;
      path = 0;
      for (const v of state.via) {
        path += Math.hypot(state.point.x + v.x - x, state.point.y + v.y - y);
        x = state.point.x + v.x;
        y = state.point.y + v.y;
      }
      path = (path + Math.hypot(state.point.x - x, state.point.y - y)) / viaSpeed;
    }
    state.fuse = clamp(fuseSpare + path, fuse, Math.max(fuse, fuseMax));
  }
}

/**
 * Where the robot it follows should be now: the last fix (the launcher's point, else the last sighting) carried on
 * by its speed for the time since, never under the ground. Without the time since, a dart flying blind 30 s aimed
 * at where the robot was when it was let go.
 */
function here() {
  const age = time - state.fixAt;
  return { x: state.point.x + state.vel.x * age, y: Math.max(floor, state.point.y + state.vel.y * age) };
}

/** The robot it follows: the one the launcher named, else the enemy nearest the point (or nearest at all without one). */
function pick() {
  let best = null;
  let bestD = Infinity;
  // The robot it was sent at died (titan-darts, 2026-10): it is in view as debris, with no live core. It forgets that
  // robot and its spot, flies on the way it is going, and takes the nearest enemy it sees.
  if (state.id !== undefined) {
    for (const c of contacts) {
      if (c.id === state.id && (c.side !== 'enemy' || !c.core)) {
        state.id = undefined;
        state.point = undefined;
        state.aim = Math.atan2(self.vel.y, self.vel.x);
        if (state.phase === 'via') state.phase = 'direct';
        break;
      }
    }
  }
  const at = state.point ? here() : null; // where it looks for the robot to follow
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (state.id !== undefined && c.id === state.id) return c; // titan-bastion: the named robot, whatever it weighs
    if (c.mass < minMass) continue;
    const d = at ? Math.hypot(c.pos.x - at.x, c.pos.y - at.y) : c.distance;
    if (at && d > acquire) continue;
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/**
 * Arming by what the seeker sees (titans v2, 2026-10): any enemy robot close ahead (its core within `armNear` plus a
 * size from its part count, a 100 part panel about 10 m, a 3000 part titan about 55), or, once `armOut` m out, no
 * friendly robot within `armSafe` m. Contacts come nearest first, so the loop stops early.
 */
function armByContacts(out) {
  let friendNear = false;
  for (const c of contacts) {
    if (c.side === 'enemy' && c.distance < armNear + Math.sqrt(c.parts)) return true;
    if (c.side === 'friend' && c.distance < armSafe) friendNear = true;
    if (c.distance > armNear + 100) break;
  }
  return out >= armOut && !friendNear;
}

function tick() {
  if (time - state.start > state.fuse) boom();

  const seen = pick();
  // Lost sight of what it was about to reach (M11): it passed out of the seeker's cone close by, or the robot is now
  // seen somewhere else (at a flare). It goes off, as a near miss.
  // Only on the tick right after: a script switched off and on again later starts fresh.
  const was = state.close && time - state.close.t <= 1.5 * dt ? state.close : undefined;
  if (was && (!seen || Math.hypot(seen.pos.x - was.x, seen.pos.y - was.y) > near)) boom();
  state.close = undefined;
  // Armed (M10) once clear of its launcher, and only when it was launched at something (a message with a point) or
  // tracks an enemy: safe while it rides on a launcher and while it clears it, and a missile knocked loose by a hit
  // (no message) stays a dud unless it finds a target. Only near where it is going (`armDist`).
  const to = seen ? seen.pos : state.point ? here() : null;
  const nearPoint = to && Math.hypot(to.x - self.pos.x, to.y - self.pos.y) < armDist;
  const out = Math.hypot(self.pos.x - state.origin.x, self.pos.y - state.origin.y);
  if (!state.armed && (state.launched || seen) && time - state.start >= clear && out >= clearDist && (nearPoint || armByContacts(out))) {
    set('warhead', 'arm', 1);
    set('heavywarhead', 'arm', 1);
    state.armed = true;
  }
  if (seen) {
    state.point = { x: seen.pos.x, y: seen.pos.y };
    state.vel = { x: seen.vel.x, y: seen.vel.y };
    state.id = seen.id;
    state.seenAt = time;
    state.fixAt = time;
  } else if (state.seenAt >= 0 && time - state.seenAt > 0.3) {
    // Lost track: fly to the last point it had (carried on to now, then held there).
    if (state.point) state.point = here();
    state.fixAt = time;
    state.vel = { x: 0, y: 0 };
  }

  let aim = state.aim;
  if (state.point) {
    const p = here();
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
    // At least `minClose`: counted at 20 m/s, a dart let go 900 m out led its point by 45 s of the robot's speed.
    const closing = Math.max(minClose, (dx * (self.vel.x - state.vel.x) + dy * (self.vel.y - state.vel.y)) / Math.max(dist, 1));
    const tgo = dist / closing;
    let gx = p.x + lead * state.vel.x * tgo;
    // Never under the ground: led by a falling or sinking robot's speed, darts flew into the ground short of it.
    let gy = Math.max(floor, p.y + lead * state.vel.y * tgo);
    if (state.phase === 'via') {
      // Through the way-in points (titans v2, 2026-10), each carried with the robot, never under the ground; no lead.
      const v = state.via[state.viaK];
      gx = p.x + v.x;
      gy = Math.max(floor + 2, p.y + v.y);
      if (Math.hypot(gx - self.pos.x, gy - self.pos.y) < viaReach || time - state.start > viaMax) {
        state.viaK++;
        if (state.viaK >= state.via.length) state.phase = 'direct';
      }
    } else if (state.phase === 'climb') {
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
  // Some push always goes along: with none, which way it points would depend only on which way it drifts, and it
  // would flip between two headings. Diving, it pushes at full.
  if (state.phase === 'climb' || state.phase === 'via') {
    const speed = Math.hypot(self.vel.x, self.vel.y);
    // On the way-in points it may ease off further (titans v2, 2026-10): at 0.4 it went 90 m/s and could not turn round.
    along = clamp(self.mass * (2 * ((state.phase === 'via' ? viaSpeed : arcSpeed) - speed) + 9.81 * Math.sin(aim)), Math.min(along, (state.phase === 'via' ? 0.1 : 0.4) * thrust), along);
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

  // Turn the nose as fast as the gyro can and brake just in time (as missile-v2).
  const inertia = turnInertia();
  const spinUp = (margin * gyroTorque) / inertia;
  const spin = Math.sign(err) * Math.min(Math.sqrt(2 * spinUp * Math.abs(err)), 8 * Math.abs(err));
  const torque = (inertia * (spin - self.angVel)) / (3 * dt); // counterclockwise positive
  const spinCmd = clamp(-torque / gyroTorque, -1, 1); // a gyro's spin is clockwise positive
  set('gyro', 'spin', spinCmd);
  set('heavygyro', 'spin', spinCmd);
}
