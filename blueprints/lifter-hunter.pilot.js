// Lifter hunter (M16, Logan: "a very fast mobile thruster drone with a laser that can fly in and take out your
// thrusters"). A small thruster drone with a laser on a hinge at each end. It goes after the nearest flying enemy,
// reads where every one of its lifters is, which way each pushes, what is in front of each, and where its guns point,
// and burns the lifter whose loss tips it the most for the least burning. Made to be built in a fabricator bay and
// sent in one after another: it will probably be shot down, so it never waits for a perfect shot.
//
// How it decides (everything from contacts and scan(), nothing typed in about the target):
// - Target: the robot its carrier named when it let it go (a message with `id`), else the nearest enemy of `minMass`
//   kg or more with a live core. One that has already lost too much lift to stay up is left for one that still flies,
//   if there is one. One whose core it burnt but that still hangs in the air (its lifters keep their last throttle) it
//   goes on bringing down while there is nothing else.
// - The target's lift, side by side: every part that pushes (`has: 'throttle'`, with `acts`) whose push points up its
//   own body is a lifter, with the push its kind gives (LIFT below). It remembers each one from first sight, so it
//   knows what is already gone. Left and right are taken about its center of mass, along its own body.
// - Which side: a robot keeps level by running its lifters on one side less. So the lift it can still hold level is
//   the weaker side at full plus the stronger side cut back to balance it. Burning a lifter costs that much lift: a
//   lifter on the side already hurt, far from the middle, costs it the most; one on the strong side may cost nothing.
// - Which lifter, from where: it looks at the target from 8 directions in turn (one every few ticks). From each, the
//   engine says how much of the robot is in front of each lifter (`cover`, the health the beam must burn first). A
//   lifter's score is the lift its loss costs over the health to burn (its own, damaged ones are cheap, plus its cover),
//   plus a little for the flight there and for every gun of the target that could reach that spot and point at it
//   (`fear`). It burns the best, and looks again every round of the 8 directions or when the part is gone.
// - Guns (`goal` 1): the same, but it goes for the target's guns, lasers, cannons, and lances, the least covered
//   first, worth twice as much when the barrel points toward where it will fire from (it can turn on it). With no
//   guns left it goes for the lifters, and on a robot with nothing that lifts (a car, a tower) for the guns.
// - Where it fires from: `standoff` meters from the part, the way that direction looked, never under `floor`.
//   It flies there at up to `speed` m/s, matching the target's speed, around the target (never through it), and
//   holds still while it burns. The hinge aims the laser on the side facing the part (a beam takes no time), allowing
//   for its own spin.
// - Fires only while the laser's sight shows an enemy part first on the line within reach (never a friend, itself, or
//   the ground) and the barrel is on the part.
// - It stops burning a target that has lost the lift to hold itself up and is falling, and goes after another if it
//   sees one (it saves the energy; it starts again if the target stops falling).
// - Something light coming at it fast (under `threat` kg: a missile, a drone bomb) is burnt first: a beam is there at
//   once and a missile breaks in a tenth of a second.
// - Energy: a laser burns 2400 J a second. Under `reserve` of its energy it stops burning, flies off to the side away
//   from the target, and lands.
// - Let go from a bay: straight up `clearDist` meters at the tilt it was let go at, before anything else.
// `smart` 0 is for comparison: it burns the nearest part of the target from wherever it comes in, nothing weighed.

const goal = param('goal', 0, { min: 0, max: 1 }); // 0: knock out its lifters; 1: knock out its guns
const smart = param('smart', 1, { min: 0, max: 1 }); // 1: weigh lift, cover and guns; 0: burn the nearest part (to compare)
const standoff = param('standoff', 170, { min: 30, max: 290 }); // m from the part it burns (guns shoot at 150, lasers reach 300)
const speed = param('speed', 70, { min: 5, max: 150 }); // m/s, the fastest it flies
const floor = param('floor', 15, { min: 2, max: 200 }); // m over the ground it never flies under while hunting
const ceiling = param('ceiling', 230, { min: 20, max: 1000 }); // m over the ground it never flies above
const reserve = param('reserve', 0.08, { min: 0, max: 1 }); // share of its energy it keeps to fly away and land on
const fear = param('fear', 1, { min: 0, max: 10 }); // how much a spot in reach of the target's guns counts against it
const travel = param('travel', 1, { min: 0, max: 5 }); // health each meter of flight to a spot is worth (a meter of flight costs about the energy of a point of beam)
const clearDist = param('clearDist', 12, { min: 0, max: 50 }); // m it climbs straight up when let go, before it hunts
const minMass = param('minMass', 10, { min: 0, max: 100000 }); // kg: lighter robots (missiles, drone bombs) are not hunted
const lean = (param('lean', 75, { min: 10, max: 85 }) * Math.PI) / 180; // degrees it leans at most
const accel = param('accel', 30, { min: 1, max: 60 }); // m/s^2 it speeds up or slows down at most
const threatMass = param('threat', 20, { min: 0, max: 1000 }); // kg: lighter things of the other side coming at it are burnt first
const say = param('say', 1, { min: 0, max: 1 }); // 1: logs each new pick and why

const G = 9.81;
const RAD = Math.PI / 180;
const VIEWS = 8; // directions it looks at the target from
const LOOK = 4; // ticks between looks
const LOOK_HUGE = 10; // ticks between looks at a huge robot
const TRACK = 3; // ticks between asking a huge robot where the part it burns is
const HUGE = 600; // parts: a robot bigger than this is asked only for what is near each direction
const NEAREST = 150; // parts asked for per look at a huge robot
const SIGHT = { nothing: 0, own: 1, friend: 2, enemy: 3, none: 4, terrain: 5 };
// What another robot's parts can do. A script reads its own parts' numbers off `spec`; another robot's it cannot,
// so these are the part list's numbers (`pnpm sim parts`).
const LIFT = { propeller: 120, thruster: 160, booster: 400, swivelthruster: 400 }; // N of push
const WEAPONS = ['gun', 'laser', 'cannon', 'lance'];
const BLASTS = ['warhead', 'heavywarhead', 'charge']; // a motor with one of these just ahead of it is a carried missile's
const REACH = { gun: 160, laser: 310, cannon: 260, lance: 410 }; // m it can hurt us from
const DANGER = { gun: 60, laser: 300, cannon: 200, lance: 200 }; // health a spot in its reach counts as
const WORTH = { gun: 1, laser: 3, cannon: 3, lance: 3 }; // goal 1: worth of knocking one out

function setup() {
  for (const m of inbox) if (m.data && typeof m.data.id === 'number') state.want = m.data.id;
  state.start = { x: self.pos.x, y: self.pos.y, angle: self.angle };
  state.cleared = clearDist <= 0;
  state.id = 0;
  state.t = undefined;
  state.retired = false;
  state.landed = 0;
  state.firing = false;
  state.skip = {};
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ---------- the target ----------

/** A fresh record of a target: what it knows of its parts and from where it looked. */
function fresh(c) {
  return { id: c.id, known: {}, weapons: {}, bad: {}, view: 0, looked: 0, round: 0, radius: 5, pick: undefined, spot: undefined, picked: -Infinity, lostLift: false, said: '' };
}

/** The 8 directions it looks from, around the target's center, `standoff` plus its size out. */
function viewPoint(t, c, k) {
  const a = (k * 2 * Math.PI) / VIEWS - Math.PI / 2; // the first looks from straight under
  const r = standoff + t.radius;
  return { x: c.center.x + r * Math.cos(a), y: c.center.y + r * Math.sin(a), ux: Math.cos(a), uy: Math.sin(a) };
}

/**
 * Where the target's body points: the angle most of the scanned parts share (on most robots they all share the
 * core's body). The scan of its lifters holds no core, and the first lifter may be on a hinge or a piece of its own.
 */
function bodyAngle(list) {
  const count = {};
  let best = 0;
  let most = 0;
  for (const p of list) {
    const k = String(p.angle);
    const n = (count[k] || 0) + 1;
    count[k] = n;
    if (n > most) {
      most = n;
      best = p.angle;
    }
  }
  return best;
}

/** Updates what it knows of the target's lifters from a scan; `whole` when the scan saw every one of them. */
function learnLift(t, c, list, k, whole) {
  if (!list || list.length === 0) return;
  const a = bodyAngle(list);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const seen = {};
  for (const p of list) {
    seen[p.id] = true;
    let q = t.known[p.id];
    if (!q) {
      const force = LIFT[p.type] || 150;
      // How much of its push is along the target's own up.
      const up = p.acts === undefined ? 1 : Math.cos(p.acts - a - Math.PI / 2);
      q = t.known[p.id] = { id: p.id, type: p.type, force, up, cover: [], gone: false, x: 0 };
    }
    q.gone = false;
    q.pos = { x: p.pos.x, y: p.pos.y };
    q.acts = p.acts;
    q.hp = p.health;
    q.max = p.maxHealth;
    // Its place along the target's body, from the center of mass (only when the scan saw it: a lost part keeps its last).
    q.x = (p.pos.x - c.center.x) * ca + (p.pos.y - c.center.y) * sa;
    if (k !== undefined && p.cover !== undefined) q.cover[k] = { cover: p.cover, round: t.round };
    const d = Math.hypot(p.pos.x - c.center.x, p.pos.y - c.center.y) + 1;
    if (d > t.radius) t.radius = d;
  }
  if (whole) for (const id in t.known) if (!seen[id]) t.known[id].gone = true;
}

/** Same for its weapons. */
function learnWeapons(t, c, list, k, whole) {
  if (!list) return;
  const seen = {};
  t.blasts = [];
  for (const p of list) {
    if (BLASTS.includes(p.type)) {
      t.blasts.push({ x: p.pos.x, y: p.pos.y });
      continue;
    }
    seen[p.id] = true;
    let q = t.weapons[p.id];
    if (!q) q = t.weapons[p.id] = { id: p.id, type: p.type, cover: [], gone: false };
    q.gone = false;
    q.pos = { x: p.pos.x, y: p.pos.y };
    q.acts = p.acts;
    q.hp = p.health;
    if (k !== undefined && p.cover !== undefined) q.cover[k] = { cover: p.cover, round: t.round };
    const d = Math.hypot(p.pos.x - c.center.x, p.pos.y - c.center.y) + 1;
    if (d > t.radius) t.radius = d;
  }
  if (whole && list.length > 0) for (const id in t.weapons) if (!seen[id]) t.weapons[id].gone = true;
}

/**
 * The lift the target can still hold level: the weaker side at full, the stronger side cut back to balance it, and
 * whatever is in the middle. Sums are by side: force, and force times distance from the middle.
 */
function levelLift(s) {
  const fl = s.A > 0 ? s.FL * Math.min(1, s.B / s.A) : 0;
  const fr = s.B > 0 ? s.FR * Math.min(1, s.A / s.B) : 0;
  return fl + fr + s.FC;
}

/**
 * Whether a motor is a carried missile's (or a bay's copy's), not lift: a warhead just ahead of where it pushes. It
 * sits idle until it is let go, so burning it costs the robot no lift (it does disarm that missile).
 */
function missile(t, q) {
  // A propeller is never a missile's motor (missiles fly on thrusters and boosters).
  if (q.missile || !q.pos || q.acts === undefined || q.type === 'propeller') return q.missile === true;
  const ux = Math.cos(q.acts);
  const uy = Math.sin(q.acts);
  for (const w of t.blasts || []) {
    const dx = w.x - q.pos.x;
    const dy = w.y - q.pos.y;
    const along = dx * ux + dy * uy;
    if (along > 0.5 && along < 4.5 && Math.abs(dx * uy - dy * ux) < 1.6) q.missile = true;
  }
  return q.missile;
}

function liftSums(t) {
  const s = { FL: 0, FR: 0, FC: 0, A: 0, B: 0, lostL: 0, lostR: 0, nL: 0, nR: 0, goneL: 0, goneR: 0 };
  for (const id in t.known) {
    const q = t.known[id];
    if (q.up < 0.5 || missile(t, q)) continue;
    const f = q.force * q.up;
    const side = q.x < -0.3 ? -1 : q.x > 0.3 ? 1 : 0;
    if (side < 0) s.nL++;
    else if (side > 0) s.nR++;
    if (q.gone) {
      if (side < 0) {
        s.lostL += f;
        s.goneL++;
      } else if (side > 0) {
        s.lostR += f;
        s.goneR++;
      }
      continue;
    }
    if (side < 0) {
      s.FL += f;
      s.A += f * -q.x;
    } else if (side > 0) {
      s.FR += f;
      s.B += f * q.x;
    } else s.FC += f;
  }
  return s;
}

/** The lift the target loses with this lifter gone (it holds level). */
function liftCost(s, h, q) {
  const f = q.force * q.up;
  let FL = s.FL;
  let FR = s.FR;
  let FC = s.FC;
  let A = s.A;
  let B = s.B;
  if (q.x < -0.3) {
    FL -= f;
    A -= f * -q.x;
  } else if (q.x > 0.3) {
    FR -= f;
    B -= f * q.x;
  } else FC -= f;
  const fl = A > 0 ? FL * Math.min(1, B / A) : 0;
  const fr = B > 0 ? FR * Math.min(1, A / B) : 0;
  return h - (fl + fr + FC);
}

/** A spot `standoff` from `pos` along (ux, uy), never under the floor: undefined when that leaves it too close. */
function spotFrom(pos, ux, uy) {
  let d = standoff;
  if (uy < -0.01) d = Math.min(d, (pos.y - floor) / -uy);
  if (uy > 0.01) d = Math.min(d, (ceiling - pos.y) / uy);
  if (d < 30) return undefined;
  return { x: pos.x + d * ux, y: pos.y + d * uy, ux, uy, d };
}

/** What the target's weapons make of a spot: the danger of each that could reach it and turn to it. */
function danger(t, spot) {
  let sum = 0;
  for (const id in t.weapons) {
    const w = t.weapons[id];
    if (w.gone) continue;
    const dx = spot.x - w.pos.x;
    const dy = spot.y - w.pos.y;
    if (Math.hypot(dx, dy) > (REACH[w.type] || 200)) continue;
    // A barrel pointing at the spot is the danger; one pointing within 90 degrees of it may be on a turret that turns
    // to it, which counts for less; one pointing away cannot swing round to it (a turret turns 90 degrees either way).
    const off = w.acts === undefined ? 0 : Math.abs(wrap(Math.atan2(dy, dx) - w.acts));
    if (off > 100 * RAD) continue;
    sum += (DANGER[w.type] || 60) * (off < 12 * RAD ? 1 : 0.15);
  }
  return sum * fear;
}

/** The best part to burn and where from, by the rules at the top. */
function choose(t, c) {
  const s = liftSums(t);
  // Nothing that lifts (a car, a tower): its guns instead. Set to guns and none are left: its lifters.
  let armed = false;
  for (const id in t.weapons) if (!t.weapons[id].gone) armed = true;
  const lifts = s.FL + s.FR + s.FC > 0;
  const guns = armed && (goal >= 0.5 || !lifts);
  t.guns = guns;
  const list = guns ? t.weapons : t.known;
  const h = levelLift(s);
  t.sums = s;
  t.level = h;
  // Not enough left to hold itself up: it is coming down.
  t.lostLift = !guns && s.nL + s.nR > 0 && h < 0.85 * c.mass * G;
  // The danger of each direction, worked out once at the spot that direction gives from the target's middle (a
  // titan has hundreds of guns: not once for each part).
  const spots = [];
  const near = [];
  let mine;
  for (let k = 0; k < VIEWS; k++) {
    const v = viewPoint(t, c, k);
    spots[k] = v;
    const at = spotFrom(c.center, v.ux, v.uy);
    near[k] = at ? danger(t, at) : 0;
  }
  let best;
  for (const id in list) {
    const q = list[id];
    if (q.gone || !q.pos) continue;
    let value;
    if (guns) value = WORTH[q.type] || 1;
    else {
      if (q.up < 0.5 || missile(t, q)) continue;
      value = liftCost(s, h, q);
      if (!(value > 0)) value = 0.01 * q.force * q.up;
    }
    const hp = Math.max(1, q.hp);
    for (let k = 0; k < VIEWS; k++) {
      const cv = q.cover[k];
      if (!cv || t.round - cv.round > 1 || t.bad[q.id + '/' + k]) continue;
      const v = spots[k];
      // The spot (spotFrom, without making an object for each of a titan's thousands of pairs).
      let d = standoff;
      if (v.uy < -0.01) d = Math.min(d, (q.pos.y - floor) / -v.uy);
      if (v.uy > 0.01) d = Math.min(d, (ceiling - q.pos.y) / v.uy);
      if (d < 30) continue;
      const sx = q.pos.x + d * v.ux;
      const sy = q.pos.y + d * v.uy;
      let worth = value;
      if (guns && q.acts !== undefined && Math.abs(wrap(Math.atan2(v.uy, v.ux) - q.acts)) < 90 * RAD) worth *= 2;
      const cost = hp + cv.cover + near[k] + travel * Math.hypot(sx - self.pos.x, sy - self.pos.y);
      const score = worth / cost;
      const isMine = t.pick !== undefined && t.pick.id === q.id && t.pick.k === k;
      if (best && score <= best.score && !isMine) continue;
      const b = { id: q.id, k, score, value, cover: cv.cover, spot: { x: sx, y: sy, ux: v.ux, uy: v.uy, d }, type: q.type, x: q.x };
      if (!best || score > best.score) best = b;
      if (isMine) mine = b;
    }
  }
  // It keeps the part and the way it comes in unless another is much better (a new spot is a new flight).
  if (mine && best && best.score < 1.5 * mine.score) return mine;
  return best;
}

/** Words for a direction it fires from. */
function fromWords(ux, uy) {
  const v = uy < -0.4 ? 'below' : uy > 0.4 ? 'above' : '';
  const h = ux < -0.4 ? 'left' : ux > 0.4 ? 'right' : '';
  return v && h ? v + ' ' + h : v || h || 'level';
}

function explain(t, c, b) {
  if (say < 0.5 || !b) return;
  let text;
  if (t.guns) text = 'guns: burning ' + b.id + ' (cover ' + Math.round(b.cover) + ') from ' + fromWords(b.spot.ux, b.spot.uy);
  else {
    const s = t.sums;
    const side = b.x < -0.3 ? 'left' : b.x > 0.3 ? 'right' : 'middle';
    // The side that tips it is the one with less turn about its weight (push times distance), not less push.
    const weak = s.A < s.B ? 'left' : s.B < s.A ? 'right' : 'neither';
    text =
      'lift L ' + Math.round(s.FL) + ' N (' + s.goneL + '/' + s.nL + ' gone) R ' + Math.round(s.FR) + ' N (' + s.goneR + '/' + s.nR + ' gone), turn L ' + Math.round(s.A) + ' R ' + Math.round(s.B) + ' N m (' + weak + ' weaker), holds ' +
      Math.round(t.level / G) + ' of ' + Math.round(c.mass) + ' kg: burning ' + side + ' ' + b.id + ' (costs it ' + Math.round(b.value) + ' N, cover ' + Math.round(b.cover) + ') from ' + fromWords(b.spot.ux, b.spot.uy);
  }
  const key = b.id + b.k;
  if (key === t.said) return;
  t.said = key;
  log(text);
}

// ---------- flying ----------

/** The drone as a body: its lifters (push and lever arm along its own body), how hard it is to turn. */
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
  const c = Math.cos(self.angle);
  const s = Math.sin(self.angle);
  let inertia = 0;
  for (const p of parts) inertia += p.mass * ((p.pos.x - cx) ** 2 + (p.pos.y - cy) ** 2 + 1 / 6);
  const lifts = [];
  let full = 0;
  let torque = 0;
  let lean0 = 0; // N m an equal throttle of 1 on every lifter turns it by (lifters lost on one side)
  let gyro = 0;
  const gyros = []; // anything in the group `level` that spins it (none as built: the boosters level it)
  for (const p of parts) {
    if (p.tags.includes('level') && p.in.spin !== undefined) {
      gyro += p.spec.config.maxTorque || 0;
      gyros.push(p.id);
    }
    if (!p.tags.includes('lift') || p.in.throttle === undefined || p.spec.acts === undefined) continue;
    const f = p.spec.config.maxForce || 0;
    const arm = (p.pos.x - cx) * c + (p.pos.y - cy) * s; // along its own body: positive is right of the middle
    lifts.push({ id: p.id, f, arm });
    full += f;
    torque += f * Math.abs(arm);
    lean0 += f * arm;
  }
  return { inertia: Math.max(1, inertia), lifts, full, torque, lean0, gyro, gyros };
}

/** Flies toward a velocity (vx, vy), or holding the tilt `hold` when given. */
function fly(vx, vy, hold) {
  const b = body();
  if (b.full <= 0) return;
  const m = self.mass;
  const ax = clamp(1.5 * (vx - self.vel.x), -accel, accel);
  const ay = clamp(2 * (vy - self.vel.y), -0.7 * G, accel);
  // The push it wants, kept within what its lifters give with the height first.
  let tx = m * ax;
  let ty = m * (G + ay);
  const most = 0.95 * b.full;
  if (ty > most) ty = most;
  const side = Math.sqrt(Math.max(0, most * most - ty * ty));
  tx = clamp(tx, -side, side);
  // Never more sideways push than the most lean leaves with the height it wants: asked to drop and to speed up
  // sideways at once, pushing hard sideways held it up (and climbing on) instead of dropping.
  tx = clamp(tx, -Math.max(1, ty) * Math.tan(lean), Math.max(1, ty) * Math.tan(lean));
  let want = hold !== undefined ? hold : clamp(Math.atan2(-tx, Math.max(1, ty)), -lean, lean);
  // Pushing along its own up: how much of the wanted push it gives at the tilt it has now.
  const along = -Math.sin(self.angle) * tx + Math.cos(self.angle) * ty;
  let base = clamp(along / b.full, 0, 1);
  if (Math.cos(self.angle) < 0.3) base = Math.max(base, 0.3); // far over: keep enough push to turn back
  // Turning: time-optimal toward the tilt it wants, braking at the last moment it can.
  const off = wrap(want - self.angle);
  const room = Math.max(0.1, Math.min(base, 1 - base));
  const can = b.torque * room + b.gyro;
  const spinUp = (0.6 * can) / b.inertia;
  const spin = Math.sign(off) * Math.min(Math.sqrt(2 * spinUp * Math.abs(off)), 8 * Math.abs(off));
  const torque = clamp((b.inertia * (spin - self.angVel)) / (4 * dt), -can, can);
  const g = clamp(torque, -b.gyro, b.gyro);
  const rest = torque - g;
  // Split: lifters right of the middle push more to turn it counterclockwise, on top of what cancels the turn of an
  // equal throttle (more lifters left on one side, after a loss). The torque is counterclockwise positive and a
  // lifter right of the middle (arm > 0) pushing up turns it counterclockwise.
  const split = b.torque > 0 ? clamp((rest - base * b.lean0) / b.torque, -room, room) : 0;
  for (const l of b.lifts) set(l.id, 'throttle', clamp(base + split * Math.sign(l.arm), 0, 1));
  for (const id of b.gyros) set(id, 'spin', clamp(-g / b.gyro, -1, 1)); // a gyro's spin is clockwise positive
}

/**
 * A velocity to a point, matching `vel`, braking in time: sideways at `brake`, a climb at what gravity stops it with
 * (it cannot push down), a descent at `brake`.
 */
function toward(goalPos, vel, brake) {
  const dx = goalPos.x - self.pos.x;
  const dy = goalPos.y - self.pos.y;
  const vx = Math.sign(dx) * Math.min(speed, Math.sqrt(2 * brake * Math.abs(dx)), 0.8 * Math.abs(dx));
  const up = dy > 0 ? 0.6 * G : brake;
  const vy = Math.sign(dy) * Math.min(speed, Math.sqrt(2 * up * Math.abs(dy)), 0.8 * Math.abs(dy));
  const v = Math.hypot(vx, vy);
  const k = v > speed ? speed / v : 1;
  return { x: vel.x + vx * k, y: vel.y + vy * k };
}

/** Around the target, never through it: a point beside it when the straight way passes too close. */
function around(goalPos, c, r) {
  const px = self.pos.x;
  const py = self.pos.y;
  const dx = goalPos.x - px;
  const dy = goalPos.y - py;
  const len2 = dx * dx + dy * dy;
  const k = len2 > 0 ? clamp(((c.x - px) * dx + (c.y - py) * dy) / len2, 0, 1) : 0;
  const qx = px + k * dx - c.x;
  const qy = py + k * dy - c.y;
  const d = Math.hypot(qx, qy);
  if (d >= r) return goalPos;
  let nx = d > 0.5 ? qx / d : -dy / Math.sqrt(len2 || 1);
  let ny = d > 0.5 ? qy / d : dx / Math.sqrt(len2 || 1);
  let w = { x: c.x + (r + 15) * nx, y: c.y + (r + 15) * ny };
  if (w.y < floor || w.y > ceiling) w = { x: c.x - (r + 15) * nx, y: c.y - (r + 15) * ny };
  // Neither side fits between the floor and the ceiling: round the side, as high or low as it may go.
  if (w.y < floor || w.y > ceiling) w = { x: c.x + (r + 15) * Math.sign(px - c.x || 1), y: clamp(w.y, floor, ceiling) };
  return w;
}

/** Keeps off the ground, under the ceiling, and away from friends close by. */
function guard(v, low) {
  const y = self.pos.y;
  // Never sinking faster than it can stop before its floor.
  v.y = Math.max(v.y, -Math.sqrt(2 * 8 * Math.max(0, y - low)));
  if (y < low) v.y = Math.max(v.y, 2 * (low - y));
  if (y > ceiling) v.y = Math.min(v.y, -2 * (y - ceiling));
  for (const c of contacts) {
    if (c.side !== 'friend' || c.distance > 12 || c.distance < 0.01) continue;
    const ax = (self.pos.x - c.pos.x) / c.distance;
    const ay = (self.pos.y - c.pos.y) / c.distance;
    v.x += ax * 8 * (1 - c.distance / 12);
    v.y += ay * 8 * (1 - c.distance / 12);
  }
  return v;
}

// ---------- the lasers ----------

/** Each laser with the hinge that carries it, where it points at rest, and where its beam starts. */
function lasers() {
  const out = [];
  for (const p of parts) {
    if (p.in.fire === undefined || p.out.sightSide === undefined) continue;
    const hinge = parts.find((q) => q.id === p.on);
    const range = hinge && hinge.spec.config.range ? hinge.spec.config.range : 0;
    const aim = p.out.aim;
    const rest = hinge ? aim - get(hinge.id, 'angle') * range : aim;
    const reach = p.spec.laser && p.spec.laser.range ? p.spec.laser.range : 300;
    out.push({ p, hinge, range, rest, aim, reach, from: { x: p.pos.x + 1.5 * Math.cos(aim), y: p.pos.y + 1.5 * Math.sin(aim) } });
  }
  return out;
}

/** Points the laser that can reach `pos` at it and burns when on target; the others rest. Returns whether it burns. */
function aimAt(all, pos, vel, allowed) {
  let use;
  let useOff = Infinity;
  for (const l of all) {
    const want = Math.atan2(pos.y - l.from.y, pos.x - l.from.x);
    const off = Math.abs(wrap(want - l.rest));
    if (off < useOff) {
      use = l;
      useOff = off;
    }
  }
  let burning = false;
  for (const l of all) {
    if (l !== use) {
      set(l.p.id, 'fire', 0);
      if (l.hinge) set(l.hinge.id, 'turn', clamp(-3 * get(l.hinge.id, 'angle'), -1, 1));
      continue;
    }
    // A tick ahead of how the point moves against us.
    const px = pos.x + (vel.x - self.vel.x) * dt - l.from.x;
    const py = pos.y + (vel.y - self.vel.y) * dt - l.from.y;
    const want = Math.atan2(py, px);
    const dist = Math.hypot(px, py);
    const moving = state.want === undefined ? 0 : wrap(want - state.want) / dt;
    state.want = want;
    const err = wrap(want - l.aim);
    if (l.hinge) set(l.hinge.id, 'turn', clamp((moving - self.angVel + 6 * err) / Math.max(0.1, l.hinge.spec.config.turnSpeed || 2), -1, 1));
    const side = l.p.out.sightSide;
    const within = Math.max(0.004, Math.atan2(0.6, dist)) * (state.firing ? 2 : 1);
    // A wreck (nobody's) just in front of the part is burnt through too (a piece burnt off it, hanging on the line).
    const wreck = side === SIGHT.none && l.p.out.sight < dist + 2 && l.p.out.sight > dist - 15;
    state.onAim = allowed && Math.abs(err) < within && dist <= l.reach;
    burning = state.onAim && (side === SIGHT.enemy || wreck) && l.p.out.sight <= l.reach;
    set(l.p.id, 'fire', burning ? 1 : 0);
  }
  state.firing = burning;
  return burning;
}

function rest(all) {
  state.firing = false;
  state.want = undefined;
  for (const l of all) {
    set(l.p.id, 'fire', 0);
    if (l.hinge) set(l.hinge.id, 'turn', clamp(-3 * get(l.hinge.id, 'angle'), -1, 1));
  }
}

// ---------- each tick ----------

function pickTarget() {
  let best;
  for (const c of contacts) {
    // Light robots are not taken up, but one it is already hunting is kept as it loses parts.
    if (c.side !== 'enemy' || !c.core || (c.mass < minMass && c.id !== state.id)) continue;
    let d = c.distance;
    if (c.id === state.want) d -= 100000;
    if (c.id === state.id) d *= 0.7;
    if ((state.skip[c.id] || 0) > time) d += 50000; // brought down already: others first
    if (!best || d < best.d) best = { c, d };
  }
  if (best) return best.c;
  // Nothing with a core left: the one it was hunting, if it lost its core but still hangs in the air (its lifters keep
  // the throttle they last had), until it comes down.
  const wreck = contacts.find((c) => c.id === state.id && c.side === 'none' && c.pos.y > floor + 10 && c.vel.y > -3);
  return wreck;
}

function tick() {
  const all = lasers();
  // Just let go: straight up at the tilt it left at, nothing else, until clear. Deployed on its own (no friend right
  // next to it) it has nothing to clear.
  if (state.alone === undefined) {
    state.alone = !contacts.some((o) => o.side === 'friend' && o.distance < 15);
    if (state.alone) state.cleared = true;
  }
  if (!state.cleared) {
    rest(all);
    if (self.pos.y - state.start.y < clearDist) {
      fly(0, 15, Math.hypot(self.pos.x - state.start.x, self.pos.y - state.start.y) < 4 ? state.start.angle : undefined);
      return;
    }
    state.cleared = true;
  }
  const cap = self.energy.capacity;
  if (!state.retired && cap > 0 && self.energy.stored < reserve * cap) {
    state.retired = true;
    log('out of energy for the laser: flying off to land');
  }
  const c = state.retired ? undefined : pickTarget();
  if (state.retired || !c) {
    rest(all);
    if (state.retired) return retire();
    // Nothing to hunt: hold where it is, over the floor.
    if (!state.hold) state.hold = { x: self.pos.x, y: Math.max(self.pos.y, floor + 10) };
    const v = guard(toward(state.hold, { x: 0, y: 0 }, 6), floor);
    return fly(v.x, v.y);
  }
  state.hold = undefined;
  if (!state.t || state.t.id !== c.id) {
    state.t = fresh(c);
    state.id = c.id;
  }
  const t = state.t;
  const huge = c.parts > HUGE;

  if (smart >= 0.5) look(t, c, huge);
  else nearest(t, c, all);

  // Follow the part it burns: where it is now and what is in front of it from our barrel.
  let aimPos;
  if (t.pick) {
    const l = closestLaser(all, t.pick.pos || c.pos);
    // A titan is asked every few ticks (each scan of one costs the host a pass over its thousands of parts); in
    // between the part is where it was against the target's core, which a titan's slow turn hardly moves.
    const ask = !huge || !t.pick.off || frame - (t.pick.asked || 0) >= TRACK;
    const now = ask ? scan(c.id, { of: [t.pick.id], from: l ? l.from : self.pos, wide: 0.5 }) : null;
    if (ask) t.pick.asked = frame;
    if (!ask && t.pick.off) aimPos = { x: c.pos.x + t.pick.off.x, y: c.pos.y + t.pick.off.y };
    if (now && now.length === 0) {
      // Burnt through: choose again on the next look.
      markGone(t, t.pick.id);
      t.pick = undefined;
      t.picked = -Infinity;
    } else if (now && now[0]) {
      t.pick.pos = { x: now[0].pos.x, y: now[0].pos.y };
      t.pick.off = { x: now[0].pos.x - c.pos.x, y: now[0].pos.y - c.pos.y };
      t.pick.cover = now[0].cover;
      aimPos = t.pick.pos;
    }
  }
  if (t.lostLift && contacts.some((o) => o.side === 'enemy' && o.core && o.mass >= minMass && o.id !== c.id)) {
    // It has lost the lift to stay up: someone else next, for a while.
    state.skip[c.id] = time + 15;
  }

  // Flying: to the spot, moving with the target, around it, over the floor.
  const r = t.radius + 10;
  let goalPos;
  if (t.pick && t.pick.pos && t.pick.ux !== undefined) {
    const s = spotFrom(t.pick.pos, t.pick.ux, t.pick.uy);
    goalPos = s ? { x: s.x, y: s.y } : { x: t.pick.pos.x + t.pick.ux * 40, y: Math.max(floor, t.pick.pos.y + t.pick.uy * 40) };
  } else {
    // Still looking: close in to the standoff along the way it comes in.
    const dx = self.pos.x - c.center.x;
    const dy = self.pos.y - c.center.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    goalPos = { x: c.center.x + (dx / d) * (standoff + t.radius), y: Math.max(floor, c.center.y + (dy / d) * (standoff + t.radius)) };
  }
  // On the way, it keeps out of the reach of the target's guns' sights where it can (never so far that it cannot
  // reach its spot).
  let ring = r;
  for (const id in t.weapons) if (!t.weapons[id].gone) {
    ring = Math.max(ring, t.radius + 100);
    break;
  }
  ring = Math.max(r, Math.min(ring, Math.hypot(goalPos.x - c.center.x, goalPos.y - c.center.y) - 5));
  const way = around(goalPos, c.center, ring);
  const v = toward(way, c.vel, 0.6 * accel);
  // Inside that ring (the target came at it, or it is still on its way round): straight out, harder the deeper it is.
  const dc = Math.hypot(self.pos.x - c.center.x, self.pos.y - c.center.y);
  if (dc < ring) {
    const out = Math.min(speed, 20 + 2 * (ring - dc));
    v.x += ((self.pos.x - c.center.x) / Math.max(1, dc)) * out;
    v.y += ((self.pos.y - c.center.y) / Math.max(1, dc)) * out;
  }
  dodge(v, c, r);
  guard(v, floor);
  fly(v.x, v.y);

  // Something light coming at it (a missile, a drone bomb): burn that first, a beam is there at once.
  const th = threat();
  if (th) {
    if (state.aiming !== th.id) state.want = undefined;
    state.aiming = th.id;
    aimAt(all, th.pos, th.vel, true);
    mark(th.pos.x, th.pos.y, 'threat');
  } else if (aimPos) {
    if (state.aiming !== c.id) state.want = undefined;
    state.aiming = c.id;
    // It cannot hold itself up any more and is coming down: save the energy for the next one.
    const falling = t.lostLift && c.vel.y < -2;
    // Not yet where it planned to fire from and the line from here has more in front: wait until it gets there (a
    // beam from the wrong side burns its energy on armor).
    // At its spot it takes some more than it planned (the target moves); on the way, hardly any (a beam swept across
    // the near side's lifters on its way to a far one, and tipped the target the other way).
    const there = t.pick.spot !== undefined && Math.hypot(self.pos.x - goalPos.x, self.pos.y - goalPos.y) < 25;
    const worse = t.pick.cover !== undefined && t.pick.plan !== undefined && t.pick.cover > (there ? 1.5 * t.pick.plan + 40 : t.pick.plan + 10);
    const burning = aimAt(all, aimPos, c.vel, !falling && !worse);
    if (burning) mark(aimPos.x, aimPos.y, 'burn');
    // On the part but something not the target's is in the way (another robot, a wreck, the ground): after a while it
    // gives up that part from that side and chooses again.
    state.stuck = state.onAim && !burning ? (state.stuck || 0) + dt : 0;
    if (state.stuck > 1.5 && t.pick) {
      t.bad[t.pick.id + '/' + t.pick.k] = true;
      t.pick = undefined;
      state.stuck = 0;
    }
  } else rest(all);
  if (t.pick && t.pick.spot) mark(t.pick.spot.x, t.pick.spot.y, 'spot');
}

/**
 * Something light (under `threat` kg: a missile, a drone bomb) of the other side coming at it: closing faster than
 * 15 m/s, within 280 m, passing within 25 m in the next 4 s. The soonest, or undefined.
 */
function threat() {
  let best;
  for (const o of contacts) {
    if (o.side !== 'enemy' || o.mass >= threatMass || o.distance > 280) continue;
    const rx = o.pos.x - self.pos.x;
    const ry = o.pos.y - self.pos.y;
    const vx = o.vel.x - self.vel.x;
    const vy = o.vel.y - self.vel.y;
    const v2 = vx * vx + vy * vy;
    const closing = -(rx * vx + ry * vy) / Math.max(0.1, o.distance);
    if (closing < 15 || v2 < 1) continue;
    const t = -(rx * vx + ry * vy) / v2;
    if (t > 4 || Math.hypot(rx + vx * t, ry + vy * t) > 25) continue;
    if (!best || t < best.t) best = { o, t };
  }
  return best && best.o;
}

/**
 * Out of the way of a target coming at it (at 5 m/s or more toward the hunter): where the target's middle passes
 * closest in the next 3 s, at its speed against ours; nearer than its size, it moves away across that line (up
 * rather than down when straight on).
 */
function dodge(v, c, r) {
  const rx = self.pos.x - c.center.x;
  const ry = self.pos.y - c.center.y;
  const vx = c.vel.x - self.vel.x;
  const vy = c.vel.y - self.vel.y;
  const v2 = vx * vx + vy * vy;
  if (v2 < 25) return;
  // Only when the target itself comes at it (flying in, the hunter closing on it is no threat).
  if (c.vel.x * rx + c.vel.y * ry < 5 * Math.hypot(rx, ry)) return;
  const t = clamp((rx * vx + ry * vy) / v2, 0, 3);
  if (t <= 0) return;
  const mx = rx - vx * t;
  const my = ry - vy * t;
  const miss = Math.hypot(mx, my);
  if (miss > r + 10) return;
  let nx = miss > 0.5 ? mx / miss : -vy / Math.sqrt(v2);
  let ny = miss > 0.5 ? my / miss : vx / Math.sqrt(v2);
  if (miss <= 0.5 && ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  v.x += nx * speed;
  v.y += ny * speed;
}

function closestLaser(all, pos) {
  let use;
  let off = Infinity;
  for (const l of all) {
    const o = Math.abs(wrap(Math.atan2(pos.y - l.from.y, pos.x - l.from.x) - l.rest));
    if (o < off) {
      off = o;
      use = l;
    }
  }
  return use;
}

function markGone(t, id) {
  if (t.known[id]) t.known[id].gone = true;
  if (t.weapons[id]) t.weapons[id].gone = true;
}

/** One look every LOOK ticks from the next of the 8 directions; a choice after each round. */
function look(t, c, huge) {
  if (frame - t.looked < (huge ? LOOK_HUGE : LOOK) && t.pick) return;
  t.looked = frame;
  const k = t.view;
  const v = viewPoint(t, c, k);
  const at = { x: v.x, y: v.y };
  // Its weapons near that spot (all of them, on a robot that is not huge), with what covers them from there.
  // Cover only matters for guns it might burn: in lifter mode, where they are and point is enough.
  const wopts = { of: WEAPONS.concat(BLASTS), acts: true };
  if (goal >= 0.5 || t.guns) {
    wopts.from = at;
    wopts.wide = 0.5;
  }
  if (huge) {
    wopts.near = at;
    wopts.most = 60;
  }
  learnWeapons(t, c, scan(c.id, wopts), k, !huge);
  // Its lifters too, whatever it goes for: with its guns gone, a hunter set to guns goes for them.
  {
    const lopts = { has: 'throttle', acts: true, from: at, wide: 0.5 };
    if (huge) {
      lopts.near = at;
      lopts.most = NEAREST;
    }
    const list = scan(c.id, lopts);
    // A robot seen at a flare scans as the flare alone: no lifters, which is not the same as none left.
    learnLift(t, c, list, k, !huge && list && list.length > 0);
    // A huge robot: once a round, every lifter (no cover), to know which are gone.
    if (huge && k === 0 && t.round % 4 === 0) {
      const whole = scan(c.id, { has: 'throttle', acts: true });
      learnLift(t, c, whole, undefined, whole && whole.length > 0);
    }
  }
  t.view = (k + 1) % VIEWS;
  if (t.view === 0) t.round++;
  // Choose after each round, as soon as a first round is done, and right away when the part is gone.
  if (t.round > 0 && (t.view === 0 || !t.pick)) {
    const b = choose(t, c);
    if (b) {
      const old = t.pick;
      t.pick = { id: b.id, k: b.k, ux: b.spot.ux, uy: b.spot.uy, spot: b.spot, plan: b.cover, pos: old && old.id === b.id ? old.pos : (t.known[b.id] || t.weapons[b.id]).pos };
      explain(t, c, b);
    }
  }
}

/** For comparison: the nearest part of the target, burnt from the way it comes in. */
function nearest(t, c, all) {
  if (t.pick && frame - t.looked < 30) return;
  t.looked = frame;
  const l = all[0];
  const from = l ? l.from : self.pos;
  const p = scan(c.id, { near: from, most: 1 });
  if (!p || !p[0]) return;
  const dx = self.pos.x - p[0].pos.x;
  const dy = self.pos.y - p[0].pos.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const r = Math.hypot(p[0].pos.x - c.center.x, p[0].pos.y - c.center.y) + 1;
  if (r > t.radius) t.radius = r;
  if (!t.pick || t.pick.id !== p[0].id) t.pick = { id: p[0].id, k: 0, ux: dx / d, uy: dy / d, pos: { x: p[0].pos.x, y: p[0].pos.y } };
}

/** Out of energy for the laser: off to the side away from the target, and down slowly until it sits on the ground. */
function retire() {
  if (!state.away) {
    let dir = state.start.x <= self.pos.x ? -1 : 1;
    const t = state.t;
    if (t && t.radius) {
      const c = contacts.find((o) => o.id === t.id);
      if (c) dir = self.pos.x >= c.pos.x ? 1 : -1;
    }
    state.away = { x: self.pos.x + dir * 120 };
  }
  const vx = clamp(0.5 * (state.away.x - self.pos.x), -20, 20);
  // Down at up to 8 m/s, slowing to 2 near the ground (it cannot see the ground: y 0 is the ground of the stock worlds).
  let vy = Math.abs(state.away.x - self.pos.x) < 30 ? -clamp(0.4 * self.pos.y, 2, 8) : 0;
  // Sitting on the ground: told to sink and not sinking.
  if (vy < 0 && self.vel.y > -0.3) state.landed += dt;
  else state.landed = 0;
  if (state.landed > 1) {
    for (const p of parts) if (p.tags.includes('lift')) set(p.id, 'throttle', 0);
    return;
  }
  fly(vx, vy);
}
