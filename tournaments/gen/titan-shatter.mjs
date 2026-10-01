// titan-shatter: one flying comb that comes apart on tick 0 into many robots, each with its own core and script.
// Run: node tournaments/gen/titan-shatter.mjs   (writes blueprints/titan-shatter.json and its script files)
//
// The comb, top to bottom:
// - the king: a wide deck with the main core, batteries, jammer pods, a row of propellers under it, and a rack of
//   darts (booster, heavy gyro, cells, radar, core, distance charge) standing on top, each held by a grip;
// - gunships hanging under the king in columns, each joined to the one above by a single decoupler on its roof.
// On tick 0 the king fires every roof decoupler, so every gunship wakes with its own pilot. The king then lets its
// darts go in two waves, hides in its jammer bubbles, and flies off to a quiet spot.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../blueprints');
const NAME = 'titan-shatter';

const COLS = 3; // gunship columns under the king
const ROWS = Number(process.env.SHATTER_ROWS ?? 16); // gunships per column
const PAIRS = 8; // dart pairs on the deck (two darts each)
const W = 40; // king width
const SHIP_W = 11;

// ---- grid of cells: cells[y][x] = { part, rot, tags, auto } ----
const H = 2 * ROWS + 11;
const cells = Array.from({ length: H }, () => Array.from({ length: W }, () => null));
const put = (x, y, part, rot = 0, tags = [], extra = {}) => {
  if (cells[y][x]) throw new Error(`cell ${x},${y} used twice`);
  cells[y][x] = { part, rot, tags, ...extra };
};
const cores = {};

// ---- gunships ----
const yP = 2 * ROWS; // the king's propeller row
const shipX = [3, 14, 26]; // left edge of each column (the core sits 5 in: columns 8, 19, 31)
let slot = 0;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const x0 = shipX[c];
    const yTop = yP - 1 - 2 * r;
    const yBody = yTop - 1;
    // body row: gun, rotator, armor, battery, gyro, core, radar, battery, armor, rotator, gun
    put(x0 + 0, yBody, 'gun', 90, ['gunA']);
    put(x0 + 1, yBody, 'rotator', 90, ['rotA'], { auto: false });
    put(x0 + 2, yBody, 'armorplate');
    put(x0 + 3, yBody, 'densebattery');
    put(x0 + 4, yBody, 'heavygyro', 0, ['stab'], { auto: false });
    put(x0 + 5, yBody, 'core');
    put(x0 + 6, yBody, 'radar', 0, ['eye']);
    put(x0 + 7, yBody, 'densebattery');
    put(x0 + 8, yBody, 'armorplate');
    put(x0 + 9, yBody, 'rotator', 270, ['rotB'], { auto: false });
    put(x0 + 10, yBody, 'gun', 270, ['gunB']);
    // roof row: three propellers, the decoupler that holds it to the piece above, three propellers
    for (const dx of [2, 3, 4]) put(x0 + dx, yTop, 'propeller', 0, ['lp'], { auto: false });
    put(x0 + 5, yTop, 'decoupler', 0, ['split']);
    for (const dx of [6, 7, 8]) put(x0 + dx, yTop, 'propeller', 0, ['rp'], { auto: false });
    cores[`core@${x0 + 5},${yBody}`] = {
      autoControls: false,
      bindings: [],
      scripts: [{ id: 'pilot', params: { slot }, source: { file: `${NAME}.g${slot}.pilot.js` } }],
    };
    slot++;
  }
}
const SHIPS = slot;

// ---- the king ----
const yB = yP + 1; // body row
const yA = yP + 2; // attic row: more jammer pods between frame posts
const yD = yP + 3; // deck row
const yG = yP + 4; // grips and dart boosters
const propFrames = new Set([0, 4, 8, 13, 19, 25, 31, 35, 39]);
for (let x = 0; x < W; x++) {
  if (propFrames.has(x)) put(x, yP, 'frame');
  else put(x, yP, 'propeller', 0, [x < 19.5 ? 'lp' : 'rp'], { auto: false });
  put(x, yD, 'frame');
}
const body = { 13: 'armorplate', 14: 'densebattery', 15: 'densebattery', 16: 'densebattery', 17: 'densebattery', 18: 'radar', 19: 'core', 20: 'heavygyro', 21: 'densebattery', 22: 'densebattery', 23: 'densebattery', 24: 'densebattery', 25: 'armorplate' };
let pods = 0;
for (let x = 0; x < W; x++) {
  if (body[x]) put(x, yB, body[x], 0, body[x] === 'heavygyro' ? ['stab'] : body[x] === 'radar' ? ['eye'] : [], body[x] === 'heavygyro' ? { auto: false } : {});
  else if (propFrames.has(x)) put(x, yB, 'frame');
  else put(x, yB, 'jammer', 0, [`jam${pods++}`]);
}
// The attic: pods hang between frame posts (a spent pod is gone, so nothing may hold on through one).
for (let x = 0; x < W; x++) {
  if (propFrames.has(x)) put(x, yA, 'frame');
  else put(x, yA, 'jammer', 0, [`jam${pods++}`]);
}
const PODS = pods;
let dart = 0;
for (let j = 0; j < PAIRS; j++) {
  const x0 = 5 * j;
  for (const [gx, dx, rot] of [
    [x0, x0 + 1, 270],
    [x0 + 4, x0 + 3, 90],
  ]) {
    put(gx, yG, 'decoupler', rot, [`g${dart}`]);
    put(dx, yG, 'booster', 0, [], { auto: false });
    put(dx, yG + 1, 'heavygyro', 0, [], { auto: false });
    put(dx, yG + 2, 'cell');
    put(dx, yG + 3, 'cell');
    put(dx, yG + 4, 'radar');
    put(dx, yG + 5, 'core', 0, [`d${dart}`]);
    put(dx, yG + 6, 'charge');
    cores[`core@${dx},${yG + 5}`] = {
      autoControls: false,
      bindings: [],
      scripts: [
        {
          id: 'guide',
          params: { arc: 0, clear: 0.3, clearDist: Math.round(14 + 0.8 * (W - dx)), thrust: 400, gyroTorque: 200, fuse: 16, minMass: 10, passBy: 12, passMass: 20 },
          source: { file: `${NAME}.d${dart}.guide.js` },
        },
      ],
    };
    dart++;
  }
}
const DARTS = dart;

// ---- legend and grid text ----
const legend = {};
const tokenOf = new Map();
const token = (cell) => {
  const key = JSON.stringify(cell);
  let t = tokenOf.get(key);
  if (!t) {
    t = `q${tokenOf.size}`;
    tokenOf.set(key, t);
    const entry = { part: cell.part, rot: cell.rot };
    if (cell.tags.length > 0) entry.tags = cell.tags;
    if (cell.auto === false) entry.auto = false;
    legend[t] = entry;
  }
  return t;
};
const grid = [];
for (let y = H - 1; y >= 0; y--) grid.push(cells[y].map((c) => (c ? token(c) : '.').padEnd(4)).join(' ').trimEnd());

// ---- scripts ----
const FLY = String.raw`
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
function fly(tx, ty, vmax, maxLean, vclimb) {
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
  const vside = vmax * clamp(1 - (Math.abs(ey) - 15) / 60, 0.3, 1);
  const vdx = Math.sign(ex) * Math.min(vside, 0.5 * Math.abs(ex), Math.sqrt(5 * Math.abs(ex)));
  const vc = vclimb || 12;
  const vdy = clamp(Math.sign(ey) * Math.min(0.8 * Math.abs(ey), Math.sqrt(6 * Math.abs(ey))), -Math.max(10, vc), vc);
  const ax = clamp(1.2 * (vdx - self.vel.x), -7, 7);
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
`;

const PILOT = String.raw`// titan-shatter gunship pilot (made by tournaments/gen/titan-shatter.mjs; every gunship runs a copy).
// Wakes when the comb comes apart. It flies to its own place on a ring over the other side's main robot (the enemy
// contact with the lowest id: pieces and copies always get newer ids), and its two turrets blast at that robot's core,
// or at something small and close that is coming for it. With the main robot hidden it uses the last place it saw it,
// or the mirror of its own start. The radar is on one tick in 'look', to keep the tick short.
const slot = param('slot', 0, { min: 0, max: 999 });
const look = param('look', 6, { min: 2, max: 60 }); // ticks between radar looks
const reach = param('reach', 285, { min: 10, max: 300 }); // m, how far the guns blast
const speed = param('speed', 30, { min: 1, max: 80 }); // m/s, its fastest sideways
const lean = param('lean', 0.5, { min: 0.05, max: 1.2 }); // rad, its most lean
const room = param('room', 16, { min: 0, max: 60 }); // m it keeps from friends (two gunships that touch can lock together and fall)
const G = 9.81;
const LIFT = 120;
const SWING = Math.PI / 2;
//@FLY@
function setup() {
  state.phase = slot % look;
  state.root = { id: -1, x: self.pos.x < 0 ? 400 : -400, y: 30, vx: 0, vy: 0, t: -100 };
  state.rootId = 1e9;
  state.home = self.pos.x;
  state.friends = [];
  state.near = null;
  // Its place: side by slot, then one of 24 angles up from level; neighbors in angle sit on different rings.
  const k = (slot >> 1) % 24;
  state.side = slot % 2;
  state.elev = ((12 + 2.75 * k) * Math.PI) / 180;
  state.ring = 150 + 40 * (k % 3);
  state.firing = { gunA: false, gunB: false };
}

function lookAround() {
  const friends = [];
  let near = null;
  let small = null;
  for (const c of contacts) {
    if (c.side === 'friend') {
      if (c.distance < 320) friends.push({ x: c.pos.x, y: c.pos.y });
      continue;
    }
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id <= state.rootId) {
      state.rootId = c.id;
      state.root = { id: c.id, x: c.pos.x, y: c.pos.y, vx: c.vel.x, vy: c.vel.y, t: time };
    }
    if (!near) near = c;
    if (!small && c.mass < 60 && c.distance < 140) small = c;
  }
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
  set('eye', 'on', f === state.phase ? 1 : 0);
  if (f === (state.phase + 1) % look) lookAround();

  // Its place: on a ring around the main robot, on its own side or the far side, well above it.
  const root = now(state.root);
  const toward = state.home < root.x ? -1 : 1;
  const sideways = (state.side === 0 ? toward : -toward) * state.ring * Math.cos(state.elev);
  let px = clamp(root.x + sideways, -1900, 1900);
  let py = clamp(root.y + state.ring * Math.sin(state.elev), 30, 240);
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
  else if (Math.hypot(root.x - self.pos.x, root.y - self.pos.y) < reach + 10) target = root;
  else if (near) target = near;
  turret('gunA', 'rotA', target);
  turret('gunB', 'rotB', target);
}
`.replace('//@FLY@', FLY);

const KING = String.raw`// titan-shatter king (made by tournaments/gen/titan-shatter.mjs): the main core's script.
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
//@FLY@
function newHide() {
  for (let i = 0; i < 6; i++) {
    const x = state.sgn * (520 + 420 * random());
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
  state.hide = { x: state.sgn * (620 + 280 * random()), y: 236 + 3 * random() };
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
    state.hide = { x: clamp(self.pos.x + away * 150, -940, 940), y: big.pos.y > 120 ? 35 : 232 };
  }
  fly(state.hide.x, clamp(state.hide.y, 20, 240), 30, 0.35, time - state.evade < 8 ? 25 : 12);
}
`.replace('//@FLY@', FLY);

const guide =
  '// titan-shatter dart guide: a copy of tech-missile.guide.js (made by tournaments/gen/titan-shatter.mjs).\n' +
  readFileSync(resolve(out, 'tech-missile.guide.js'), 'utf8').replace(/missiles/g, 'darts').replace(/missile/g, 'dart').replace(/Missile/g, 'Dart');

// ---- write ----
const blueprint = {
  format: 1,
  name: NAME,
  autoControls: false,
  grid,
  legend,
  primaryCore: `core@19,${yB}`,
  bindings: [],
  scripts: [{ id: 'king', params: { pods: PODS, darts: DARTS }, source: { file: `${NAME}.king.js` } }],
  cores,
};
writeFileSync(resolve(out, `${NAME}.json`), JSON.stringify(blueprint, null, 1) + '\n');
writeFileSync(resolve(out, `${NAME}.king.js`), KING);
for (let i = 0; i < SHIPS; i++) writeFileSync(resolve(out, `${NAME}.g${i}.pilot.js`), PILOT);
for (let k = 0; k < DARTS; k++) writeFileSync(resolve(out, `${NAME}.d${k}.guide.js`), guide);
console.log(`${NAME}: ${SHIPS} gunships, ${DARTS} darts, ${PODS} jammer pods, grid ${W} by ${H}`);
