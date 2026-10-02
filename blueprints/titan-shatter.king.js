// titan-shatter king (made by tournaments/gen/titan-shatter.mjs): the main core's script.
// Tick 0: fires every roof decoupler (tag split), so each gunship under it becomes its own robot and wakes.
// Then it lets its darts go in two waves, each told where the other side's main robot is (the enemy contact with the
// lowest id), hides in its jammer bubbles, and flies to a quiet spot on its own side, moving on when found.
const waveGap = param('waveGap', 40, { min: 1, max: 240 }); // s before the second wave of darts
const pods = param('pods', 52, { min: 0, max: 200 }); // jammer pods it carries (tags jam0, jam1, ...)
const darts = param('darts', 16, { min: 0, max: 64 }); // darts on its deck (cores d0.., grips g0..)
const open = param('open', 240, { min: 0, max: 240 }); // s it hides from the start, pod after pod, whatever it sees
const roam = param('roam', 25, { min: 1, max: 240 }); // s between moves to a new quiet spot
const danger = param('danger', 450, { min: 0, max: 1000 }); // m: an enemy this close makes it hide
const ram = param('ram', 1500, { min: 0, max: 100000 }); // kg: an enemy this heavy is a ram to get out of the way of
const threat = param('threat', 550, { min: 0, max: 1000 }); // m: a ram this close makes it move
const G = 9.81;
const LIFT = 120;

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

function newHide() {
  for (let i = 0; i < 6; i++) {
    const x = state.sgn * (520 + 300 * random()); // short of the arena's end: what is bumped past it loses
    const y = 236 + 3 * random(); // over the reach of a gun sight on a tall roof, under the arena's ceiling of 250
    state.hide = { x: x, y: y };
    if (Math.hypot(x - self.pos.x, y - self.pos.y) > 150) return;
  }
}

function setup() {
  state.t0 = time;
  state.sgn = self.pos.x < 0 ? -1 : 1;
  state.guess = { x: -self.pos.x, y: 30 };
  state.root = null;
  state.rootId = 1e9;
  state.hide = { x: state.sgn * (560 + 260 * random()), y: 236 + 3 * random() };
  state.moved = time;
  // Each wave takes pairs spread evenly over the deck, so it stays balanced; within a wave the darts nearest the other
  // side go first, and the ones behind climb higher before they turn (their clearDist), so their paths do not cross.
  state.order = [15, 14, 9, 8, 7, 6, 1, 0, 13, 12, 11, 10, 5, 4, 3, 2];
  state.next = 0;
  state.jam = 0;
  state.jamUntil = -1;
  state.evade = -100;
}

function hasPod(k) {
  const tag = 'jam' + k;
  for (const p of parts) if (p.type === 'jammer' && p.tags.indexOf(tag) >= 0) return true;
  return false;
}

function tick() {
  const t = time - state.t0;
  if (t < 0.1) set('split', 'fire', 1);

  let near = Infinity;
  let big = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.distance < near) near = c.distance;
    if (c.mass >= ram && c.distance < threat && !big) big = c;
    if (c.id <= state.rootId) {
      state.rootId = c.id;
      state.root = { id: c.id, x: c.pos.x, y: c.pos.y, vx: c.vel.x, vy: c.vel.y };
    }
  }

  // Darts: one every 0.12 s within a wave, told the main robot's place and id (or the mirror of the start).
  const half = darts / 2;
  if (state.next < darts && state.next < state.order.length) {
    const due = state.next < half ? 0.15 + 0.12 * state.next : waveGap + 0.12 * (state.next - half);
    if (t >= due) {
      const k = state.order[state.next];
      const r = state.root;
      send('d' + k, r ? { x: r.x, y: r.y, vx: r.vx, vy: r.vy, id: r.id, arc: 0 } : { x: state.guess.x, y: state.guess.y, arc: 0 });
      set('g' + k, 'fire', 1);
      state.next++;
    }
  }

  // Jammer pods: one after another through the opening; later only while an enemy is close (it looks for a few
  // ticks between pods, since it is blind inside its own bubble).
  const opening = t > 1.2 && t < open;
  const looked = time >= state.jamUntil + 0.07;
  if ((opening && time >= state.jamUntil - 0.05) || (!opening && t >= open && looked && near < danger)) {
    while (state.jam < pods && !hasPod(state.jam)) state.jam++;
    if (state.jam < pods) {
      set('jam' + state.jam, 'ignite', 1);
      state.jam++;
      state.jamUntil = time + 5;
      if (!opening && near < 350) newHide();
    }
  }

  // Hidden, it cannot see, so it moves on to a new quiet spot now and then (high up: gun sights reach 150 m).
  if (time - state.moved > roam) {
    state.moved = time;
    newHide();
  }
  // A ram coming (seen only when it is not hiding): off to the far side of it, and to the other end of the sky.
  if (big) {
    state.evade = time;
    const away = self.pos.x >= big.pos.x ? 1 : -1;
    state.hide = { x: clamp(self.pos.x + away * 150, -820, 820), y: big.pos.y > 120 ? 35 : 232 };
  }
  fly(state.hide.x, clamp(state.hide.y, 20, 240), 30, 0.35, time - state.evade < 8 ? 25 : 12);
}
