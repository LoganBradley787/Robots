// titan-shatter gunship pilot (made by tournaments/gen/titan-shatter.mjs; every gunship runs a copy).
// Wakes when the comb comes apart. It flies to its own place on a ring over the main enemy, and its two turrets blast
// at that robot's core, or at something small and close that is coming for it.
// The main enemy (titan-darts, 2026-10, Logan): picked from what its radar reports, never by id: the heaviest enemy
// with a live core of `mainMass` kg or more, kept while it is seen unless one twice as heavy shows up. It is forgotten
// the moment it dies (it stays in view as debris, with no live core), `memory` s after it vanished alive (a jammer's
// bubble or smoke), or at once when it vanished out at the radar's edge. The turrets blast at a remembered one only
// in those `memory` s.
// Titans v2 (2026-10):
// - Radio: every gunship looks on the same tick (radar and radio on one tick in `look`), so on that tick each one
//   hears what all the others see. A gunship near a hidden enemy (sensors within 150 m see through a jammer's bubble)
//   tells the whole swarm, the king and the darts in flight where it is.
// - Hunting: a main enemy that vanished alive is searched for: the ring shrinks to `seek` m round its last place, so
//   the gunships come close enough to see through its bubble, and they spread round it to cover where it went.
// - With no main enemy seen for a while, a lighter enemy with a live core will do (a lone small robot in the sandbox).
// - No typed-in edges: the ceiling comes from the global `arena` (none in the open sandbox), and with nothing ever
//   seen it waits where it woke (or, in a match, flies to the mirror of its start, where the other side began).
const slot = param('slot', 0, { min: 0, max: 999 });
const scout = param('scout', 0, { min: 0, max: 1 }); // 1: a light scout (no armor), which searches the outer part of the ring
const look = param('look', 10, { min: 2, max: 60 }); // ticks between radar looks
const reach = param('reach', 298, { min: 10, max: 300 }); // m, how far the beams burn (a laser reaches 300)
const flyDraw = param('flyDraw', 75, { min: 0, max: 1000 }); // W its flying takes, about (seven propellers, gyro, radar, radio, rotators)
const match = param('match', 240, { min: 10, max: 100000 }); // s a match lasts (only with an arena)
const spare = param('spare', 3000, { min: 0, max: 100000 }); // energy kept over what flying to the end takes
const keepOpen = param('keepOpen', 15000, { min: 0, max: 100000 }); // energy kept for flying in the open sandbox
const speed = param('speed', 50, { min: 1, max: 80 }); // m/s, its fastest sideways
const lean = param('lean', 0.5, { min: 0.05, max: 1.2 }); // rad, its most lean
const mainMass = param('mainMass', 30, { min: 0, max: 100000 }); // kg: the main enemy is never lighter (darts, pods)
const memory = param('memory', 15, { min: 0, max: 120 }); // s a main enemy that vanished alive is remembered
const lostAt = param('lostAt', 900, { min: 50, max: 2000 }); // m: one that vanished further off went out of the radar's reach and is forgotten
const room = param('room', 16, { min: 0, max: 60 }); // m it keeps from friends (two gunships that touch can lock together and fall)
const manyGuns = param('manyGuns', 30, { min: 1, max: 10000 }); // guns: a main enemy with this many is fought from outside their reach
const standoff = param('standoff', 270, { min: 50, max: 1000 }); // m: the ring round such a robot (its guns blast about 290 m, the beams burn 300; round 5: 320 was out of the beams' reach)
const recount = param('recount', 15, { min: 1, max: 240 }); // s between counts of its guns
const seek = param('seek', 105, { min: 20, max: 300 }); // m: ring round a main enemy that vanished alive (within 150 m its bubble is seen through)
const fallback = param('fallback', 8, { min: 0, max: 120 }); // s with no main enemy before a lighter one will do
const heavyMass = param('heavyMass', 300, { min: 0, max: 100000 }); // kg: a robot this heavy is a main enemy before any lighter one
const fallbackMatch = param('fallbackMatch', 45, { min: 0, max: 240 }); // s with no heavy one, in a match, before a lighter one will do
const fast = param('fast', 90, { min: 10, max: 1000 }); // m/s: a robot this fast is a dart, never the main enemy
const slow = param('slow', 25, { min: 0, max: 200 }); // m/s: a lighter one must be slower than this (not a dart)
const widen = param('widen', 12, { min: 0, max: 100 }); // m/s the search ring grows while nothing is found
const wideHome = param('wideHome', 600, { min: 50, max: 2000 }); // m: the same round where it woke, in the open sandbox with nothing seen
const wide = param('wide', 420, { min: 50, max: 1000 }); // m: the search ring starts over past this
const probe = param('probe', 2, { min: 0.2, max: 60 }); // s between looks for a cheaper line into the main enemy's core
const step = param('step', 0.21, { min: 0.02, max: 1 }); // rad its bearing round the main enemy moves at most per look
const probeParts = param('probeParts', 150, { min: 1, max: 100000 }); // parts: a main enemy this big is worth looking for a line into
const bareCover = param('bareCover', 60, { min: 0, max: 10000 }); // points of parts in front of an enemy weapon, at most, for the beams to go at it first
const ramMass = param('ramMass', 1500, { min: 0, max: 100000 }); // kg: an enemy this heavy seen faster than `ramSpeed` rams
const ramSpeed = param('ramSpeed', 50, { min: 10, max: 1000 }); // m/s: an enemy this heavy seen this fast comes for the king (a 12 t brick crossed the arena at 60 to grind it down)
const escort = param('escort', 0, { min: 0, max: 1000 }); // m: the ring round the king against a ram (0: off; tried at 130 and the ram ended the king sooner)
const kingMass = param('kingMass', 100, { min: 0, max: 100000 }); // kg: a friend this heavy is the king
const gunCost = param('gunCost', 400, { min: 0, max: 100000 }); // points a place on an enemy gun's line counts as, when it looks for a line in
const gunCone = param('gunCone', 0.08, { min: 0, max: 1 }); // rad either side of a gun's line counted as on it (its shells spread 1.5 degrees; the robot turns a little)
const gunReach = param('gunReach', 300, { min: 10, max: 1000 }); // m a gun's shells carry
const coreFirst = param('coreFirst', 700, { min: 0, max: 100000 }); // points: a core with less than this in front of it is burned before any weapon (Palisade's: 300)
const say = param('say', 0, { min: 0, max: 1 }); // 1: the gunship in slot 4 logs its looks for a line in
const G = 9.81;
const LIFT = 120;
const SWING = Math.PI / 2;

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// What the piece is: mass, how hard it is to turn, and its two propeller groups (tags lp and rp, told apart by where
// they sit along the body, so a flipped copy works). Measured again only when it loses parts.
function measure() {
  const c = Math.cos(self.angle);
  const s = Math.sin(self.angle);
  let m = 0;
  let cx = 0;
  let cy = 0;
  for (const p of parts) {
    m += p.mass;
    cx += p.mass * p.pos.x;
    cy += p.mass * p.pos.y;
  }
  cx /= m;
  cy /= m;
  const f = { n: parts.length, m: m, inertia: 0, sa: 0, na: 0, sb: 0, nb: 0, gyros: 0 };
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    f.inertia += p.mass * (dx * dx + dy * dy + 0.17);
    if (p.type === 'propeller') {
      const r = dx * c + dy * s;
      if (p.tags.indexOf('lp') >= 0) {
        f.sa += r;
        f.na++;
      } else if (p.tags.indexOf('rp') >= 0) {
        f.sb += r;
        f.nb++;
      }
    } else if (p.type === 'heavygyro' && p.tags.indexOf('stab') >= 0) f.gyros++;
  }
  state.body = f;
}

// Flies the piece toward (tx, ty) on its propellers: a wanted speed from how far off it is, a lean for the push
// sideways, and the two propeller groups solved together for the lift and the turning it needs. The heavy gyro
// gives what it can first.
function fly(tx, ty, vmax, maxLean, vclimb, brake) {
  if (!state.body || state.body.n !== parts.length) measure();
  const th = wrap(self.angle);
  const c = Math.cos(th);
  const m = state.body.m;
  const inertia = state.body.inertia;
  const sa = state.body.sa;
  const na = state.body.na;
  const sb = state.body.sb;
  const nb = state.body.nb;
  const gyros = state.body.gyros;
  const ex = tx - self.pos.x;
  const ey = ty - self.pos.y;
  // The wanted speed falls off with the square root of the distance left, so it can stop in time at a gentle lean.
  // Far off its height it goes slower sideways: at speed a leaning body rides the air and will not sink.
  const hard = brake || 4; // m/s2 it counts on to stop (round 5: 2.5 was for the armored gunships; a battery gunship leans to 5.4)
  const vside = brake ? vmax : vmax * clamp(1 - (Math.abs(ey) - 15) / 60, 0.7, 1); // round 5: 0.3, and the swarm crawled to the enemy at 11 m/s
  const vdx = Math.sign(ex) * Math.min(vside, 0.5 * Math.abs(ex), Math.sqrt(2 * hard * Math.abs(ex)));
  const vc = vclimb || 12;
  // Going down no faster than it can stop with the lift it has to spare (titans v2): an armored gunship has about
  // 2 m/s2 of it, came down at 11 m/s and hit the ground before it could stop.
  const up = Math.max(0.5, ((na + nb) * LIFT * Math.cos(maxLean)) / m - G);
  const down = Math.min(Math.sqrt(6 * Math.abs(ey)), Math.sqrt(1.4 * up * Math.abs(ey)));
  const vdy = clamp(ey > 0 ? Math.min(0.8 * ey, Math.sqrt(6 * ey)) : -Math.min(0.8 * -ey, down), -Math.max(10, vc), vc);
  const ax = clamp(1.2 * (vdx - self.vel.x), brake ? -14 : -7, brake ? 14 : 7);
  const ay = clamp(2 * (vdy - self.vel.y), -5, 6);
  const want = clamp(Math.atan2(-ax, G + ay), -maxLean, maxLean);
  const lift = (na + nb) * LIFT;
  const push = clamp(c > 0.2 ? (m * (G + ay)) / c : 0.3 * lift, 0, lift);
  const w = 3.5;
  const torque = inertia * (w * w * wrap(want - th) - 2 * w * self.angVel);
  const gmax = gyros * 200;
  const tg = clamp(torque, -gmax, gmax);
  if (gyros > 0) set('stab', 'spin', -tg / gmax);
  const det = sa * nb - sb * na;
  let ta = push / Math.max(lift, 1e-9);
  let tb = ta;
  if (na > 0 && nb > 0 && Math.abs(det) > 1e-6) {
    const arm = (Math.abs(sa) + Math.abs(sb)) / (na + nb);
    const most = 0.4 * lift * arm;
    const pq = clamp(torque - tg, -most, most) / LIFT;
    let q = push / LIFT;
    // Keeping level comes before lift (titans v2): a push both groups cannot give on top of the turn would clip the
    // turn, and a gunship asked to climb hard while leaning rolled over and fell. The push is cut to what leaves room.
    const a0 = (pq * nb) / det;
    const a1 = -sb / det;
    const b0 = (-pq * na) / det;
    const b1 = sa / det;
    if (a1 > 1e-9 && a0 + a1 * q > 1) q = Math.max(0, (1 - a0) / a1);
    if (b1 > 1e-9 && b0 + b1 * q > 1) q = Math.max(0, (1 - b0) / b1);
    ta = a0 + a1 * q;
    tb = b0 + b1 * q;
  }
  set('lp', 'throttle', clamp(ta, 0, 1));
  set('rp', 'throttle', clamp(tb, 0, 1));
}

function setup() {
  // Every gunship looks on the same tick, so the radio carries the whole swarm's view at once.
  state.phase = 0;
  // Nothing seen yet: in a match the other side began at the mirror of its start; in the open sandbox it waits here.
  state.root = { id: -1, x: arena ? -self.pos.x : self.pos.x, y: arena ? 30 : self.pos.y, vx: 0, vy: 0, t: -100, d: 0 };
  state.live = false; // whether the root is a main enemy seen, or vanished alive within `memory` s
  state.dead = false; // whether the root was seen dead (debris)
  state.hider = false; // whether the main enemy has vanished alive once (it hides in a bubble): the ring comes closer
  state.seenAt = -100; // when anyone last saw the root (its own radar or a friend's over the radio)
  state.mainAt = 0; // when a heavy enemy (`heavyMass` or more) was last seen
  state.quick = {}; // ids of robots seen faster than `fast` (darts)
  state.rams = {}; // ids of heavy robots seen faster than `ramSpeed`
  state.king = null; // where the king was last seen
  state.home = self.pos.x;
  state.friends = [];
  state.near = null;
  // Its place: side by slot, then one of 24 angles up from level; neighbors in angle sit on different rings.
  const k = (slot >> 1) % 24;
  state.side = slot % 2;
  state.elev = ((12 + 2.75 * k) * Math.PI) / 180;
  state.ring = 150 + 40 * (k % 3);
  // Searching, it spreads all round the last place: its own bearing from the slot, 13 degrees apart.
  state.bearing = ((slot * 137.5) % 360) * (Math.PI / 180);
  state.firing = { beamA: false, beamB: false };
  state.guns = 0; // guns the main enemy carries, as last counted
  state.countedAt = -100;
}

function lookAround() {
  const friends = [];
  let near = null;
  let small = null;
  let heaviest = null;
  let light = null;
  let kept = null;
  let gone = false;
  const root = state.root;
  let king = null;
  for (const c of contacts) {
    if (c.side === 'friend') {
      if (c.distance < 320) friends.push({ x: c.pos.x, y: c.pos.y });
      // The king: the heaviest friend with a core (a gunship weighs about 58 kg, the king near three times that).
      if (c.core && c.mass >= kingMass && (!king || c.mass > king.mass)) king = c;
      continue;
    }
    if (c.id === root.id && (c.side !== 'enemy' || !c.core)) gone = true;
    if (c.side !== 'enemy' || !c.core) continue;
    // Never one seen fast as the main enemy (titans v2): a titan's darts weigh over 30 kg too, and while the titan
    // hid, the swarm took its darts for it (one let go is slow for a moment, so once fast is fast for good).
    const v = Math.hypot(c.vel.x, c.vel.y);
    // Round 5: only a light one (under `heavyMass`): a 12 t brick ramming at 130 m/s was taken for a dart and let go.
    if (v > fast && c.mass < heavyMass) state.quick[c.id] = 1;
    // A heavy one seen this fast rams (round 5): the gunships guard the king from it, see `escort`.
    if (v > ramSpeed && c.mass >= ramMass) state.rams[c.id] = 1;
    // The one it has is kept however light it gets (a main enemy shot to pieces weighs less and less: a walker down to
    // its core and a few plates lay 60 s under the gunships, forgotten at under 30 kg).
    if (c.id === root.id && !state.quick[c.id]) kept = c;
    if (c.mass >= mainMass && !state.quick[c.id]) {
      if (c.mass >= heavyMass) {
        if (!heaviest || c.mass > heaviest.mass) heaviest = c;
      } else if (v < slow) {
        if (!light || c.mass > light.mass) light = c;
      }
    }
    if (!near) near = c;
    if (!small && c.mass < 60 && c.distance < 140) small = c;
  }
  let main = kept && !(heaviest && heaviest.mass > 2 * kept.mass) ? kept : heaviest;
  if (main && main.mass >= heavyMass) state.mainAt = time;
  // No heavy enemy (`heavyMass` or more) for a while: a lighter, slow one with a live core will do (until a heavy one
  // shows up). In a match it waits longer: a titan hidden from the first second is still out there somewhere.
  else if (!main && light && time - state.mainAt > (arena ? fallbackMatch : fallback)) main = light;
  if (main) {
    // How many guns it carries, by a scan of its guns only (once a new main enemy is seen, then every `recount` s, and
    // only of a robot this gunship's own radar sees): a gun titan is fought from outside its guns' reach.
    if ((main.id !== root.id || time - state.countedAt > recount) && main.by && main.by.indexOf('radio') < 0) {
      const g = scan(main.id, { of: ['gun', 'laser'] });
      if (g) {
        let n = 0;
        for (const q of g) if (q.type === 'gun') n++;
        state.guns = n;
        state.lasers = g.length - n;
        state.countedAt = time;
        state.scannedAt = frame;
      }
    }
    if (main.id !== root.id && time - state.countedAt > 0.5) {
      state.guns = 0;
      state.lasers = 0;
    }
    state.root = { id: main.id, x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, t: time, d: main.distance, size: sizeOf(main), parts: main.parts || 0, own: !!main.by && main.by.indexOf('radio') < 0 };
    state.live = true;
    if (main.id !== root.id) state.hider = false;
    state.seenAt = time;
    state.dead = false;
  } else if (state.live && (gone || time - root.t > memory || root.d > lostAt)) {
    state.live = false;
  }
  if (gone && !main) {
    state.dead = true;
    state.mainAt = -1e9; // it is dead: no reason to wait before chasing a lighter one
  }
  state.friends = friends;
  if (king) state.king = { x: king.pos.x, y: king.pos.y, t: time };
  const pick = small || near;
  state.near = pick ? { x: pick.pos.x, y: pick.pos.y, vx: pick.vel.x, vy: pick.vel.y, t: time, small: pick === small, size: sizeOf(pick) } : null;
}

// About how far a robot's parts reach round its core, for how close a shell must go (titans v2): a quarter of the
// square root of its part count, at most 12 m (a titan of 1400 parts: 9 m; a walker of 87: 2 m).
function sizeOf(c) {
  return Math.min(12, 0.25 * Math.sqrt(c.parts || 1));
}

// The enemy weapon its beams should burn first: of the `most` lasers and guns of the main enemy nearest this gunship,
// a laser with less than `bareCover` of its robot in front of it (seen from here), else the barest gun under that.
// Kept as its offset from the enemy's core, which moves with the core until the next look.
function pickWeapon(root) {
  const w = scan(state.root.id, { of: ['laser', 'gun'], near: { x: self.pos.x, y: self.pos.y }, most: 8, from: { x: self.pos.x, y: self.pos.y } });
  state.arm = null;
  if (!w) return;
  let best = null;
  let bestKey = Infinity;
  for (const q of w) {
    if (q.cover === undefined || q.cover >= bareCover) continue;
    const d = Math.hypot(q.pos.x - self.pos.x, q.pos.y - self.pos.y);
    if (d > reach) continue;
    const key = (q.type === 'laser' ? 0 : 10000) + q.cover * 10 + d;
    if (key < bestKey) {
      bestKey = key;
      best = q;
    }
  }
  if (best) state.arm = { id: state.root.id, dx: best.pos.x - root.x, dy: best.pos.y - root.y, t: time };
}

// A place on a ring of `ring` m round `c` at bearing `th` (counterclockwise from the right), kept inside the sky the
// gunships use: 30 m up at least, under the match's ceiling.
function ringPoint(c, ring, th) {
  const y = c.y + ring * Math.sin(th);
  return { x: c.x + ring * Math.cos(th), y: clamp(y, 30, arena ? arena.y - 10 : Infinity) };
}

// Where a remembered robot is now (it keeps its speed for a second, then is taken as still).
function now(r) {
  const age = time - r.t;
  const k = age < 1 ? age : 0;
  return { x: r.x + r.vx * k, y: r.y + r.vy * k, vx: age < 1 ? r.vx : 0, vy: age < 1 ? r.vy : 0, size: r.size || 0 };
}

// Energy kept for flying (round 5): a beam takes 2400 W, the propellers about 70. In a match it keeps what flying
// to the end takes and `spare` more; in the open sandbox (no end) `keepOpen`.
function canBurn() {
  const keep = arena ? flyDraw * Math.max(0, match - time) + spare : keepOpen;
  return self.energy.stored > keep;
}

function turret(gunTag, rotTag, target) {
  // The laser's part object is refilled in place every tick: found again only when the parts change.
  if (!state.gunParts || state.gunParts.n !== parts.length) {
    state.gunParts = { n: parts.length };
    for (const p of parts) if (p.type === 'laser') state.gunParts[p.tags.indexOf('beamA') >= 0 ? 'beamA' : 'beamB'] = p;
  }
  const gun = state.gunParts[gunTag];
  if (!gun) return;
  const turned = get(rotTag, 'angle') || 0;
  if (!target) {
    set(rotTag, 'turn', clamp(-3 * turned, -1, 1));
    set(gunTag, 'fire', 0);
    state.firing[gunTag] = false;
    return;
  }
  const aim = gun.out.aim;
  // A beam has no flight time and no drop: it goes where the barrel points, so the aim is the target one tick on.
  const qx = target.x + (target.vx - self.vel.x) * dt - gun.pos.x;
  const qy = target.y + (target.vy - self.vel.y) * dt - gun.pos.y;
  const dist = Math.hypot(qx, qy);
  const want = Math.atan2(qy, qx);
  const rest = aim - turned * SWING;
  if (dist > reach + (target.size || 0) || Math.abs(wrap(want - rest)) > SWING - 0.03) {
    set(rotTag, 'turn', clamp(-3 * turned, -1, 1));
    set(gunTag, 'fire', 0);
    state.firing[gunTag] = false;
    return;
  }
  const err = wrap(want - aim);
  // The barrel turns with the body too: take the body's turn out, then close the gap.
  set(rotTag, 'turn', clamp((6 * err - self.angVel) / 2, -1, 1));
  const sight = gun.out.sightSide;
  // On the core's line within 2 m (twice that once burning, so a barrel on the edge does not stutter): a beam held on
  // one line burns a tunnel to the core, one swept over a hull burns a little of everything. It burns only when the
  // first thing on its line is an enemy's part within its reach (never its own robot, a friend, a wreck or air).
  const tol = Math.max(0.006, 2 / Math.max(dist, 1)) * (state.firing[gunTag] ? 2 : 1);
  const ok = Math.abs(err) < tol && sight === 3 && gun.out.sight < reach && canBurn();
  state.firing[gunTag] = ok;
  set(gunTag, 'fire', ok ? 1 : 0);
}

function tick() {
  const f = frame % look;
  const on = f === state.phase ? 1 : 0;
  set('eye', 'on', on);
  set('ear', 'on', on);
  // A scan sees only what its own radar saw: on the tick after the radar looks (round 5: scans on other ticks came
  // back empty). That tick carries at most 4 scans: every other one looks for a line in, the others for a weapon.
  const lookTick = f === (state.phase + 1) % look;
  const evenLook = Math.floor(frame / look) % 2 === 0;
  if (lookTick) lookAround();

  const root = now(state.root);
  let px;
  let py;
  if (!state.dead && time - state.seenAt > 1) {
    // Hunting (titans v2): the main enemy vanished alive (most likely into a jammer's bubble), or, in a match, nothing
    // was ever seen (it hid from the first second: its start is the mirror of ours; in the open sandbox, round where
    // the gunship woke: radars see 1000 m, so only a robot hidden in a bubble can be that close). Each gunship takes its own bearing
    // round the last place, on a ring that starts `seek` m out (its radar sees through a bubble within 150 m) and
    // grows while nothing is found, so the swarm sweeps the sky round it. One gunship seeing it tells them all.
    // Gunships start spread over the ring's width (scouts on the outer half), so the whole disc is looked over at once.
    const lost = time - Math.max(state.seenAt, 0);
    const w = (arena || state.root.id >= 0 ? wide : wideHome) - seek;
    const band = w / 2;
    const r = seek + ((((slot * 53) % band) + scout * band + widen * Math.max(0, lost - 1)) % w);
    const b = -0.35 + ((state.bearing % Math.PI) / Math.PI) * (Math.PI + 0.7); // from a little under level on one side to the other
    px = root.x + r * Math.cos(b);
    py = root.y + r * Math.sin(b) + 15;
    if (state.root.id >= 0) state.hider = true;
  } else {
    // Its place: on a ring around the main robot, on its own side or the far side, well above it. Round one that
    // hides (it vanished once), the ring is tighter, inside the 150 m where its bubble is seen through.
    // Round a robot with `manyGuns` guns or more it keeps at the edge of their reach (titans v2: in reach, 60 guns
    // against 140 lost the whole swarm in 30 s; round 5: just inside the beams' 300 m, where those guns' shells
    // spread over 7 m and a beam does not spread at all).
    const ring = state.guns >= manyGuns ? standoff + 0.25 * (state.ring - 150) : state.hider ? seek + 0.25 * (state.ring - 150) : state.ring;
    // Round 5: its place is a bearing round the main enemy (from its own side or the far side, `elev` up, at first),
    // moved toward the cheapest line into the core: every `probe` s it asks, by a scan from three places on its ring,
    // how much of the enemy stands in front of the core seen from each (`cover`), and takes a step toward the least.
    // A tunnel another beam burned is the cheapest line of all, so the beams gather on it.
    if (state.theta === undefined || state.thetaId !== state.root.id) {
      const toward = state.home < root.x ? -1 : 1;
      const right = (state.side === 0 ? toward : -toward) > 0;
      state.theta = right ? state.elev : Math.PI - state.elev;
      state.thetaId = state.root.id;
      state.probedAt = time - ((slot * 0.37) % probe);
    }
    if (state.live && state.root.own && state.root.parts >= probeParts && time - state.probedAt >= probe && lookTick && evenLook && state.scannedAt !== frame) {
      state.probedAt = time;
      let best = Infinity;
      let pick = state.theta;
      let bestCover = Infinity;
      // Its guns, and which way each points (`acts`): a place on a gun's line within its reach costs `gunCost` more.
      // A titan's guns fixed pointing up shred whatever hangs over it, and leave alone what keeps to its side.
      const guns = state.guns > 0 ? scan(state.root.id, { of: ['gun'], near: { x: self.pos.x, y: self.pos.y }, most: 60, acts: true }) : null;
      for (const th of [state.theta - step, state.theta, state.theta + step]) {
        const at = ringPoint(root, ring, th);
        const c = scan(state.root.id, { of: ['core'], near: { x: root.x, y: root.y }, most: 1, from: at });
        let cost = c && c.length > 0 && c[0].cover !== undefined ? c[0].cover : Infinity;
        if (guns) {
          for (const g of guns) {
            if (g.acts === undefined) continue;
            const gx = at.x - g.pos.x;
            const gy = at.y - g.pos.y;
            if (gx * gx + gy * gy < gunReach * gunReach && Math.abs(wrap(Math.atan2(gy, gx) - g.acts)) < gunCone) cost += gunCost;
          }
        }
        // Ties keep the bearing it has (no wandering over a face that costs the same everywhere).
        if (cost < best - 1 || (cost <= best + 1 && th === state.theta)) {
          best = cost;
          bestCover = c && c.length > 0 && c[0].cover !== undefined ? c[0].cover : Infinity;
          pick = th;
        }
      }
      state.theta = pick;
      state.cover = bestCover; // what stands in front of the core from there, guns left out
      if (say > 0.5 && slot === 4) log('probe', 'th', state.theta.toFixed(2), 'cover', bestCover, 'best', best, 'guns', guns ? guns.length : -1, 'n', state.guns);
    }
    let at = ringPoint(root, ring, state.theta);
    // Escort (round 5): a main enemy that rams goes for the king, faster than the gunships fly, and ground it down
    // far from them, unburned. So the gunships wait round the king instead, `escort` m out, and the ram comes into
    // their beams on its way in.
    const k = state.king;
    if (escort > 0 && state.rams[state.root.id] && k && time - k.t < 3) at = ringPoint(k, escort + 0.5 * (state.ring - 150), state.theta);
    px = at.x;
    py = at.y;
  }
  // The match's ceiling (the bounds hold only the main core, but a gunship over it is no use either).
  if (arena) py = Math.min(py, arena.y - 10);
  py = Math.max(py, 30);
  // Keep clear of friends: its place is pushed away from any within 'room'.
  for (const fr of state.friends) {
    const dx = self.pos.x - fr.x;
    const dy = self.pos.y - fr.y;
    const d = Math.hypot(dx, dy);
    if (d >= room) continue;
    const push = (2 * (room - d)) / Math.max(d, 0.5);
    px += dx * push;
    py += dy * push + (d < 0.5 ? (slot % 2 ? 6 : -6) : 0);
  }
  // No more lean than its lift allows while still holding its height (an armored gunship has little to spare).
  if (!state.body || state.body.n !== parts.length) measure();
  const spare = (state.body.m * G * 1.04) / Math.max(1, (state.body.na + state.body.nb) * LIFT);
  // Low, or far under where it should be, height comes first: barely leaning, it climbs on all it has.
  const climb = self.pos.y < 25 || (py - self.pos.y > 40 && spare > 0.8); // round 5: with lift to spare it leans while it climbs
  fly(px, Math.max(py, 20), speed, Math.min(climb ? 0.12 : lean, Math.acos(clamp(spare, 0, 1))));

  // What the guns blast at: something small and close first, then the main robot's core, then whatever is nearest.
  let target = null;
  const near = state.near && time - state.near.t < 0.5 ? now(state.near) : null;
  const rootIn = state.live && Math.hypot(root.x - self.pos.x, root.y - self.pos.y) < reach + 10;
  // Disarming (round 5): against a main enemy with beams of its own, or `manyGuns` guns, the beams first burn the
  // weapons that can reach this gunship: a laser in its sight (40 points, a fifteenth of a second) before any gun,
  // a gun with nothing in front of it next. A titan's two beams burned the whole swarm in ten seconds while every
  // beam went at its core.
  if (rootIn && state.root.own && ((state.lasers || 0) > 0 || state.guns >= manyGuns) && lookTick && !evenLook && state.scannedAt !== frame) pickWeapon(root);
  const arm = state.arm && time - state.arm.t < 0.4 && state.arm.id === state.root.id ? state.arm : null;
  if (near && state.near.small) target = near;
  else if (rootIn && arm && !(state.cover < coreFirst)) target = { x: root.x + arm.dx, y: root.y + arm.dy, vx: root.vx, vy: root.vy, size: 0 };
  else if (rootIn) target = root;
  else if (near) target = near;
  turret('beamA', 'rotA', target);
  turret('beamB', 'rotB', target);
}
