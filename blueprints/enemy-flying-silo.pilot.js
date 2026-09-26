// Pilot for an enemy flying silo (M10): Logan's flying-silo flying and firing by itself. No keys; it runs from deploy.
// - Track: holds a spot `standoff` meters to the side of the nearest robot on the other side its radar tracks (the
//   side it is already on) and `above` meters higher, never more than `ceiling` over where it was deployed. With
//   nothing tracked it waits `idle` meters above where it was deployed.
// - Fire: `settle` seconds after it first tracks something, one missile every `reload` seconds (plus a seeded bit of
//   `jitter`), while it is nearly level and in range, at the tracked robot sent the fewest missiles so far (nearest
//   first), so its twelve spread over several targets. Straight in at a target level or above, over the top onto one
//   well below, as the flying silo does. It does not dodge: it is big and slow.
// Flying is the flying silo's hover (time-optimal leaning on its boosters, balance from its parts, height braking just
// in time), asked for a sideways speed and a height instead of keys. Left and right are worked out from where the
// boosters are, so it works deployed flipped.

const climb = param('climb', 8, { min: 0.5, max: 30 }); // m/s, fastest climb or sink it asks for
const lift = param('lift', 400, { min: 10, max: 2000 }); // N, one booster's full push (the booster part)
const gyroTorque = param('gyroTorque', 3600, { min: 0, max: 20000 }); // N m, all its stab gyros together (18 heavy gyros)
const lean = (param('lean', 30, { min: 0, max: 70 }) * Math.PI) / 180; // most it leans, degrees
const steer = param('steer', 0.05, { min: 0.01, max: 0.5 }); // radians of lean per m/s it is off the sideways speed it wants
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its turning or climbing power it plans braking on
const speed = param('speed', 8, { min: 1, max: 40 }); // m/s, fastest it flies sideways to get somewhere
const standoff = param('standoff', 80, { min: 5, max: 400 }); // m to the side of the robot it tracks
const above = param('above', 20, { min: 0, max: 100 }); // m above it
const ceiling = param('ceiling', 40, { min: 0, max: 500 }); // m above where it was deployed it never climbs past
const idle = param('idle', 10, { min: 0, max: 100 }); // m above where it was deployed it waits with nothing tracked
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (missiles) are not tracked or shot at
const below = param('below', 10, { min: -100, max: 100 }); // m: a target more than this far below gets an arc shot, the rest a direct one
const minRange = param('minRange', 30, { min: 0, max: 500 }); // m: closer than this it holds fire
const maxRange = param('maxRange', 300, { min: 10, max: 1000 }); // m: further than this it holds fire
const level = (param('level', 15, { min: 1, max: 90 }) * Math.PI) / 180; // launches only within this many degrees of level
const reload = param('reload', 1.5, { min: 0.2, max: 60 }); // s between launches
const jitter = param('jitter', 0.5, { min: 0, max: 10 }); // up to this many seconds more, at random (seeded)
const settle = param('settle', 1.5, { min: 0, max: 30 }); // s it holds fire after it first tracks a robot
const COUNT = 12; // grip k holds missile-up k

function setup() {
  state.home = { x: self.pos.x, y: self.pos.y + idle };
  state.lastShot = -Infinity;
  state.wait = jitter * random();
  state.sent = {};
  state.trim = 0;
}

/** The silo as a body that turns: moment of inertia and booster lever arms, from every part still attached. */
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
  let inertia = 0;
  for (const p of parts) inertia += p.mass * ((along(p) - cu) ** 2 + (across(p) - cv) ** 2 + 1 / 6);
  let sum = 0;
  let split = 0;
  let right = 0;
  let left = 0;
  for (const p of parts) {
    if (!(p.tags.includes('lboost') || p.tags.includes('rboost'))) continue;
    const u = along(p) - cu;
    sum += u;
    split += p.tags.includes('rboost') ? u : -u;
    if (u > 0) right += u;
    else left -= u;
  }
  return { inertia, sum, split, right, left };
}

/** Flies toward a sideways speed `vx` and a height `height`. */
function fly(vx, height) {
  const g = 9.81;
  const props = parts.filter((p) => p.tags.includes('lboost') || p.tags.includes('rboost')).length;
  const up = Math.max(1, props * lift * Math.max(0.3, Math.cos(self.angle)));
  const rise = Math.max(0.5, up / self.mass - g);
  const err = height - self.pos.y;
  const stop = err > 0 ? g : rise;
  const climbing = Math.sign(err) * Math.min(Math.sqrt(2 * margin * stop * Math.abs(err)), 3 * Math.abs(err), climb);
  const upward = clamp(5 * (climbing - self.vel.y), -g, rise);
  const throttle = clamp((self.mass * (g + upward)) / up, 0, 1);

  // Leaning left (counterclockwise) pushes it left: lean against the sideways speed it is short of.
  const want = clamp(-steer * (vx - self.vel.x), -lean, lean);
  const off = want - self.angle;
  state.trim = clamp(state.trim + 0.05 * off * dt, -0.2, 0.2);
  const b = body();
  const ccw = lift * b.right + gyroTorque;
  const cw = lift * b.left + gyroTorque;
  const stopping = off >= 0 ? cw : ccw;
  const spinUp = (margin * stopping) / Math.max(1, b.inertia);
  const spin = Math.sign(off) * Math.min(Math.sqrt(2 * spinUp * Math.abs(off)), 6 * Math.abs(off));
  const torque = clamp((b.inertia * (spin - self.angVel)) / (4 * dt), -cw, ccw);
  const gyro = clamp(torque, -gyroTorque, gyroTorque);
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

/** Launches the next missile at the tracked enemy sent the fewest so far (nearest first). */
function fire() {
  let t = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < minMass || c.distance < minRange || c.distance > maxRange) continue;
    if (!t || (state.sent[c.id] || 0) < (state.sent[t.id] || 0)) t = c;
  }
  if (!t) return;
  for (let k = 1; k <= COUNT; k++) {
    if (!(get('grip' + k, 'armed') > 0)) continue;
    const arc = t.pos.y < self.pos.y - below ? 1 : 0;
    send('missile-up' + k, { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc });
    set('grip' + k, 'fire', 1);
    state.sent[t.id] = (state.sent[t.id] || 0) + 1;
    state.lastShot = time;
    state.wait = jitter * random();
    return;
  }
}

function tick() {
  const target = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (!target) state.trackedSince = undefined;
  else if (state.trackedSince === undefined) state.trackedSince = time;

  let goal = state.home;
  if (target) {
    const side = self.pos.x >= target.pos.x ? 1 : -1;
    goal = { x: target.pos.x + side * standoff, y: Math.min(target.pos.y + above, state.home.y - idle + ceiling) };
    const ready = time - state.lastShot >= reload + state.wait && time - state.trackedSince >= settle && Math.abs(self.angle) < level;
    if (ready) fire();
  }
  const vx = clamp(0.3 * (goal.x - self.pos.x), -speed, speed);
  fly(vx, goal.y);
  mark(goal.x, goal.y, target ? 'hold' : 'home');
}
