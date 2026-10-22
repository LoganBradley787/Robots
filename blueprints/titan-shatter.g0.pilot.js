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
const look = param('look', 10, { min: 2, max: 60 }); // ticks between radar looks
const reach = param('reach', 285, { min: 10, max: 300 }); // m, how far the guns blast
const speed = param('speed', 30, { min: 1, max: 80 }); // m/s, its fastest sideways
const lean = param('lean', 0.5, { min: 0.05, max: 1.2 }); // rad, its most lean
const mainMass = param('mainMass', 30, { min: 0, max: 100000 }); // kg: the main enemy is never lighter (darts, pods)
const memory = param('memory', 15, { min: 0, max: 120 }); // s a main enemy that vanished alive is remembered
const lostAt = param('lostAt', 900, { min: 50, max: 2000 }); // m: one that vanished further off went out of the radar's reach and is forgotten
const room = param('room', 16, { min: 0, max: 60 }); // m it keeps from friends (two gunships that touch can lock together and fall)
const seek = param('seek', 105, { min: 20, max: 300 }); // m: ring round a main enemy that vanished alive (within 150 m its bubble is seen through)
const fallback = param('fallback', 8, { min: 0, max: 120 }); // s with no main enemy before a lighter one will do
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
  const hard = brake || 2.5; // m/s2 it counts on to stop; a dash passes more
  const vside = brake ? vmax : vmax * clamp(1 - (Math.abs(ey) - 15) / 60, 0.3, 1);
  const vdx = Math.sign(ex) * Math.min(vside, 0.5 * Math.abs(ex), Math.sqrt(2 * hard * Math.abs(ex)));
  const vc = vclimb || 12;
  const vdy = clamp(Math.sign(ey) * Math.min(0.8 * Math.abs(ey), Math.sqrt(6 * Math.abs(ey))), -Math.max(10, vc), vc);
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
    const q = push / LIFT;
    ta = (pq * nb - q * sb) / det;
    tb = (q * sa - pq * na) / det;
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
  state.mainAt = -100; // when a main enemy (`mainMass` or more) was last seen
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
  state.firing = { gunA: false, gunB: false };
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
  for (const c of contacts) {
    if (c.side === 'friend') {
      if (c.distance < 320) friends.push({ x: c.pos.x, y: c.pos.y });
      continue;
    }
    if (c.id === root.id && (c.side !== 'enemy' || !c.core)) gone = true;
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.mass >= mainMass) {
      if (c.id === root.id) kept = c;
      if (!heaviest || c.mass > heaviest.mass) heaviest = c;
    } else if (!light || c.mass > light.mass) light = c;
    if (!near) near = c;
    if (!small && c.mass < 60 && c.distance < 140) small = c;
  }
  let main = kept && !(heaviest && heaviest.mass > 2 * kept.mass) ? kept : heaviest;
  if (main) state.mainAt = time;
  // No main enemy for a while: a lighter one with a live core is chased instead (until a heavy one shows up).
  else if (light && time - state.mainAt > fallback && (!state.live || root.id === light.id)) main = light;
  if (main) {
    state.root = { id: main.id, x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, t: time, d: main.distance };
    state.live = true;
    if (main.id !== root.id) state.hider = false;
    state.seenAt = time;
    state.dead = false;
  } else if (state.live && (gone || time - root.t > memory || root.d > lostAt)) {
    state.live = false;
  }
  if (gone && !main) state.dead = true;
  state.friends = friends;
  const pick = small || near;
  state.near = pick ? { x: pick.pos.x, y: pick.pos.y, vx: pick.vel.x, vy: pick.vel.y, t: time, small: pick === small } : null;
}

// Where a remembered robot is now (it keeps its speed for a second, then is taken as still).
function now(r) {
  const age = time - r.t;
  const k = age < 1 ? age : 0;
  return { x: r.x + r.vx * k, y: r.y + r.vy * k, vx: age < 1 ? r.vx : 0, vy: age < 1 ? r.vy : 0 };
}

function turret(gunTag, rotTag, target) {
  let gun = null;
  for (const p of parts) if (p.type === 'gun' && p.tags.indexOf(gunTag) >= 0) gun = p;
  if (!gun) return;
  const turned = get(rotTag, 'angle') || 0;
  if (!target) {
    set(rotTag, 'turn', clamp(-3 * turned, -1, 1));
    set(gunTag, 'fire', 0);
    return;
  }
  const aim = gun.out.aim;
  const px = target.x - gun.pos.x;
  const py = target.y - gun.pos.y;
  const rvx = target.vx - self.vel.x;
  const rvy = target.vy - self.vel.y;
  let t = Math.hypot(px, py) / 300;
  let qx = px;
  let qy = py;
  for (let i = 0; i < 2; i++) {
    qx = px + rvx * t;
    qy = py + rvy * t;
    t = Math.hypot(qx, qy) / 300;
  }
  const dist = Math.hypot(qx, qy);
  const want = Math.atan2(qy + 0.5 * G * t * t, qx);
  const rest = aim - turned * SWING;
  if (dist > reach || Math.abs(wrap(want - rest)) > SWING - 0.03) {
    set(rotTag, 'turn', clamp(-3 * turned, -1, 1));
    set(gunTag, 'fire', 0);
    return;
  }
  const err = wrap(want - aim);
  // The barrel turns with the body too: take the body's turn out, then close the gap.
  set(rotTag, 'turn', clamp((6 * err - self.angVel) / 2, -1, 1));
  const sight = gun.out.sightSide;
  // On the aim point within 1.5 m (twice that once blasting, so a barrel on the edge does not stutter).
  const tol = Math.max(0.012, 1.5 / Math.max(dist, 1)) * (state.firing[gunTag] ? 2 : 1);
  let ok = Math.abs(err) < tol && sight !== 1 && sight !== 2;
  if (ok) {
    const ux = Math.cos(aim);
    const uy = Math.sin(aim);
    for (const f of state.friends) {
      const fx = f.x - gun.pos.x;
      const fy = f.y - gun.pos.y;
      const along = fx * ux + fy * uy;
      // The sight covers friends within 150 m; this is for the ones further out, nearer than the target.
      if (along > 0 && along < dist && Math.abs(fx * uy - fy * ux) < 5) {
        ok = false;
        break;
      }
    }
  }
  state.firing[gunTag] = ok;
  set(gunTag, 'fire', ok ? 1 : 0);
}

function tick() {
  const f = frame % look;
  const on = f === state.phase ? 1 : 0;
  set('eye', 'on', on);
  set('ear', 'on', on);
  if (f === (state.phase + 1) % look) lookAround();

  const root = now(state.root);
  let px;
  let py;
  if (state.root.id >= 0 && !state.dead && time - state.seenAt > 1) {
    // Hunting (titans v2): the main enemy vanished alive (most likely into a jammer's bubble). Close round its last
    // place, each gunship on its own bearing, near enough that its radar sees through the bubble. It keeps at it
    // after the turrets have given it up: one gunship seeing it tells them all.
    px = root.x + seek * Math.cos(state.bearing);
    py = root.y + seek * Math.abs(Math.sin(state.bearing)) * 0.8 + 15;
    state.hider = true;
  } else {
    // Its place: on a ring around the main robot, on its own side or the far side, well above it. Round one that
    // hides (it vanished once), the ring is tighter, inside the 150 m where its bubble is seen through.
    const ring = state.hider ? seek + 0.25 * (state.ring - 150) : state.ring;
    const toward = state.home < root.x ? -1 : 1;
    const sideways = (state.side === 0 ? toward : -toward) * ring * Math.cos(state.elev);
    px = root.x + sideways;
    py = root.y + ring * Math.sin(state.elev);
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
  fly(px, Math.max(py, 20), speed, lean);

  // What the guns blast at: something small and close first, then the main robot's core, then whatever is nearest.
  let target = null;
  const near = state.near && time - state.near.t < 0.5 ? now(state.near) : null;
  if (near && state.near.small) target = near;
  else if (state.live && Math.hypot(root.x - self.pos.x, root.y - self.pos.y) < reach + 10) target = root;
  else if (near) target = near;
  turret('gunA', 'rotA', target);
  turret('gunB', 'rotB', target);
}
