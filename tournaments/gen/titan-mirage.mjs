// Generator for titan-mirage (titans tournament, theme 6: Trickster). Run from anywhere: node tournaments/gen/titan-mirage.mjs
// Writes blueprints/titan-mirage.json, its helm script, its ghost recipe's guide, and a standalone copy of the ghost.
//
// The titan: a long flying spar. Stern (left as authored): the main core in an armor box under a block of jammer pods,
// lit one at a time all match, so no sensor outside the bubble sees the hull. Bow: radars, far outside the bubble, so
// the hull still sees. Between them: fabricator bays that build ghosts (darts with a distance charge nose that light
// their own jammer pod and fly their last seconds unseen and blind, straight at the point the hull handed them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../blueprints');
const NAME = 'titan-mirage';

// ---- layout numbers ----
const BAYS = 20; // fabricator bays
const BAY_STEP = 7; // columns per bay: 5 for the bay, 2 for deck propellers
const BAY_X0 = 28; // first bay's first hollow column
const HOLLOW = [3, 5];
const POD_COLS = 11;
const POD_ROWS = 5;
const KEEP = 11; // the keep: a square block at the stern, plate outside, batteries inside, the main core in its middle
const POD_X0 = KEEP + 2;
const BASE = 1; // the bottom row holds only the keep's own boosters
const BELLY = 1; // a row of plate under the propeller rows (it carries them, and takes what comes from below)
const UNDER = 3; // rows of propellers between the belly and the keel
const W = BAY_X0 + BAYS * BAY_STEP + 8; // hull length in cells
const KEEL = BASE + BELLY + UNDER; // first battery row
const DECK = KEEL + 2; // frame deck
const TOP = DECK + 1; // what stands on the deck
const H = TOP + Math.max(POD_ROWS, HOLLOW[1] + 1);
const CORE = { x: 1 + (KEEP - 1) / 2, y: BASE + (KEEP - 1) / 2 };
const HULL_X0 = KEEP + 1; // the spar starts here

const MASS = { F: 1, Z: 3, A: 5, C: 2, O: 1, P: 1, K: 1.5, J: 0.5 };
const GHOST_MASS = 12.5;

// ---- the grid, [y][x], y 0 at the bottom ----
const cells = [];
for (let y = 0; y < H; y++) cells.push(new Array(W).fill('.'));
const put = (x, y, t) => {
  if (cells[y][x] !== '.') throw new Error(`cell ${x},${y} taken by ${cells[y][x]} (wanted ${t})`);
  cells[y][x] = t;
};
const legend = {
  ka: { part: 'booster', rot: 270, tags: ['pf'], auto: false }, // at the stern, pushes toward the bow
  kb: { part: 'booster', rot: 90, tags: ['pr'], auto: false }, // at the bow, pushes toward the stern
  pa: { part: 'propeller', rot: 0, tags: ['la'], auto: false },
  pb: { part: 'propeller', rot: 0, tags: ['lb'], auto: false },
  kc: { part: 'booster', rot: 0, tags: ['la'], auto: false }, // under the keep
  kd: { part: 'booster', rot: 0, tags: ['lb'], auto: false },
};
const props = []; // filled in, then tagged by which side of the center of mass they are on

// under rows: propellers between frame posts
// the keep: depth is what saves a core from a hard hit, a blast, or a shell
for (let y = 0; y < KEEP; y++) {
  for (let x = 1; x <= KEEP; x++) {
    const ring = x === 1 || x === KEEP || y === 0 || y === KEEP - 1;
    const inner = Math.abs(x - CORE.x) <= 1 && Math.abs(y + BASE - CORE.y) <= 1;
    if (x === CORE.x && y + BASE === CORE.y) put(x, y + BASE, 'C');
    else put(x, y + BASE, ring || inner ? 'A' : 'Z');
  }
}
// The keep's own lift: boosters under it and propellers on it, in both lift groups, so the helm can still set it down
// gently (or hold it up) when the spar is gone. Its batteries are inside it.
for (let x = 1; x <= KEEP; x++) {
  put(x, 0, x <= CORE.x ? 'kc' : 'kd');
  props.push({ x, y: KEEP + BASE });
}
for (let x = HULL_X0; x <= W - 3; x++) put(x, BASE, 'A');
// the bow tower: plate the height of the keep, so what comes along the rows meets plate first; it carries the bow boosters
for (let y = 0; y < KEEP; y++) put(W - 2, y + BASE, 'A');
for (let y = BASE + BELLY; y < BASE + BELLY + UNDER; y++) {
  for (let x = HULL_X0; x <= W - 3; x++) {
    if (x === HULL_X0 || x % 8 === 1) put(x, y, 'A'); // posts of plate: a line of fire along a row must not cut the rows below loose
    else props.push({ x, y });
  }
}
// keel: dense batteries, the core in its armor box
for (let y = KEEL; y <= KEEL + 1; y++) {
  for (let x = HULL_X0; x <= W - 3; x++) {
    if (y === KEEL + 1 && x >= 60 && x % 20 === 0) put(x, y, 'O'); // radars inside the hull: robots do not block a sensor, and the deck ones go first
    else if (y === KEEL || x % 2 === 0) put(x, y, 'Z');
    else put(x, y, 'F');
  }
}
// deck
for (let x = HULL_X0; x <= W - 3; x++) put(x, DECK, 'F');
// side boosters on both ends
for (let y = 0; y < KEEP; y++) {
  put(0, y + BASE, 'ka');
  put(W - 1, y + BASE, 'kb');
}
// jammer pods: a block on the stern deck, lit from the top row down so what is left always stands on the deck
let pod = 0;
for (let r = POD_ROWS - 1; r >= 0; r--) {
  for (let c = 0; c < POD_COLS; c++) {
    const t = `j${pod}`;
    legend[t] = { part: 'jammer', tags: [t] };
    put(POD_X0 + c, TOP + r, t);
    pod++;
  }
}
// bays
const bayXs = [];
for (let k = 0; k < BAYS; k++) {
  const x0 = BAY_X0 + k * BAY_STEP;
  const t = `g${String.fromCharCode(97 + k)}`; // ga, gb, ...: a held ghost's scope is the tag and a count (ga1, ga2)
  legend[t] = { part: 'fabbay', rot: 0, tags: [t], makes: 'ghost', size: HOLLOW };
  put(x0 - 1, TOP, '=');
  put(x0, TOP, t);
  for (let i = 1; i <= HOLLOW[0]; i++) put(x0 + i, TOP, '=');
  for (let y = TOP + 1; y <= TOP + HOLLOW[1]; y++) {
    put(x0 - 1, y, '=');
    put(x0 + HOLLOW[0], y, '=');
    for (let i = 0; i < HOLLOW[0]; i++) cells[y][x0 + i] = '_'; // hollow: stays empty
  }
  bayXs.push(x0 + (HOLLOW[0] - 1) / 2);
}
// radars at the bow, then propellers on every free deck cell
const radarXs = [W - 8, W - 6, W - 4];
for (const x of radarXs) put(x, TOP, 'O');
for (let x = POD_X0 + POD_COLS + 1; x <= W - 2; x++) if (cells[TOP][x] === '.') props.push({ x, y: TOP });

// center of mass along the hull, to split the lift into a stern group and a bow group
let m = 0;
let mx = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = cells[y][x];
    const kg = t === 'ka' || t === 'kb' || t === 'kc' || t === 'kd' ? MASS.K : t.startsWith('j') ? MASS.J : MASS[t];
    if (kg === undefined) continue;
    m += kg;
    mx += kg * x;
  }
}
const bayMass = HOLLOW[0] + 2 + 2 * HOLLOW[1] + GHOST_MASS;
for (const x of bayXs) {
  m += bayMass;
  mx += bayMass * x;
}
m += props.length * MASS.P;
mx += props.reduce((s, p) => s + p.x, 0) * MASS.P;
const com = mx / m;
for (const p of props) put(p.x, p.y, p.x < com ? 'pa' : 'pb');

const grid = [];
for (let y = H - 1; y >= 0; y--) grid.push(cells[y].map((t) => (t === '_' ? '.' : t)).join(' '));

// ---- the ghost ----
const ghost = (file) => ({
  format: 1,
  name: 'titan-mirage-ghost',
  grid: ['Xd H', 'H  C', 'y  E', 'E  J', 'k  k'],
  legend: {
    y: { part: 'heavygyro', rot: 0, auto: false },
    k: { part: 'booster', rot: 0, auto: false },
    H: { part: 'heavywarhead', auto: false },
  },
  scripts: [{ id: 'guide', source: { file } }],
});

const blueprint = {
  format: 1,
  name: NAME,
  grid,
  legend,
  autoControls: false,
  scripts: [{ id: 'helm', params: { pods: pod, bays: BAYS }, source: { file: `${NAME}.helm.js` } }],
  recipes: { ghost: ghost(`${NAME}.ghost.guide.js`) },
};

// ---- scripts ----
const HELM = `// Helm of titan-mirage: the one script on the hull (cloak, flight, and letting ghosts go).
// - Cloak: one jammer pod of the stern block is lit every \`period\` s, so the main core is always inside a bubble and
//   no sensor outside it sees the hull. The radars stand at the bow, outside the bubble, so the hull still sees.
// - Flight: propellers in a stern group (la) and a bow group (lb) hold the height and keep the hull level; the
//   boosters on the ends (pf toward the bow, pr toward the stern) hold its place \`standoff\` m from what it tracks.
//   Left and right are worked out from where the parts are, so it flies the same deployed flipped.
// - Ghosts: when enough bays hold a finished ghost, all of them are handed the same point and speed and let go on one
//   tick. The point is the tracked robot with the enemy's main core; with nothing tracked, the place it was last
//   seen, else the mirror of the hull's own start (a hidden enemy stays about there).
const pods = param('pods', 55, { min: 1, max: 500 });
const bays = param('bays', 20, { min: 1, max: 64 });
const period = param('period', 4.5, { min: 1, max: 5 }); // s between pods (a pod jams 5 s)
const height = param('height', 200, { min: 5, max: 240 }); // m the core flies at
const roof = param('roof', 215, { min: 5, max: 245 }); // m the core never asks to fly above (250 is out of bounds, and a ram from below lifts it)
const heavy = param('heavy', 300, { min: 0, max: 100000 }); // kg: an enemy this heavy may be a ram
const danger = param('danger', 380, { min: 0, max: 1000 }); // m: a heavy enemy this close is stepped over or under
const step = param('step', 110, { min: 0, max: 250 }); // m of height kept from it
const standoff = param('standoff', 880, { min: 100, max: 1500 }); // m kept from the tracked robot (inside radar reach, outside a search around its own start)
const cornered = param('cornered', 250, { min: 0, max: 1000 }); // m: held closer than this against the edge, it takes the other side
const backoff = param('backoff', 250, { min: 0, max: 600 }); // m it backs away from its start with nothing tracked
const edge = param('edge', 650, { min: 100, max: 990 }); // it never flies its core past this x either way (well inside: shells push, and a wreck that drifts over x 1000 has lost)
const cruise = param('cruise', 24, { min: 1, max: 60 }); // m/s sideways at most
const reach = param('reach', 960, { min: 50, max: 1000 }); // m: a salvo only at something this close
const salvo = param('salvo', 20, { min: 1, max: 64 }); // ready bays that make a salvo
const wait = param('wait', 6, { min: 0, max: 60 }); // s after the first ghost is ready before a short salvo goes anyway
const blindGap = param('blindGap', 45, { min: 1, max: 120 }); // s between salvos at a place it cannot see
const groundY = param('groundY', 4, { min: 0, max: 200 }); // m: the height it aims at with nothing ever seen
const close = param('close', 320, { min: 0, max: 1000 }); // m: at something this close, every finished ghost goes at once
const level = (param('level', 25, { min: 1, max: 90 }) * Math.PI) / 180; // lets go only this level
const minMass = param('minMass', 40, { min: 0, max: 100000 }); // kg: lighter robots are never the main target

function measure() {
  let m = 0;
  let mx = 0;
  let my = 0;
  for (const p of parts) {
    m += p.mass;
    mx += p.mass * p.pos.x;
    my += p.mass * p.pos.y;
  }
  if (!(m > 0)) return;
  const cx = mx / m;
  const cy = my / m;
  let inertia = 0;
  let fa = 0;
  let xa = 0;
  let fb = 0;
  let xb = 0;
  let ff = 0;
  let fr = 0;
  let bow = 0;
  let stern = 0;
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    inertia += p.mass * (dx * dx + dy * dy);
    if (p.type === 'propeller') {
      if (p.tags.indexOf('la') >= 0) {
        fa += 120;
        xa += 120 * dx;
      } else if (p.tags.indexOf('lb') >= 0) {
        fb += 120;
        xb += 120 * dx;
      }
    } else if (p.type === 'booster') {
      if (p.tags.indexOf('la') >= 0) {
        fa += 400;
        xa += 400 * dx;
      } else if (p.tags.indexOf('lb') >= 0) {
        fb += 400;
        xb += 400 * dx;
      } else if (p.tags.indexOf('pf') >= 0) {
        ff += 400;
        stern += p.pos.x - self.pos.x;
      } else if (p.tags.indexOf('pr') >= 0) {
        fr += 400;
        bow += p.pos.x - self.pos.x;
      }
    }
  }
  state.m = m;
  state.inertia = inertia;
  state.fa = fa;
  state.fb = fb;
  state.ra = fa > 0 ? xa / fa : -1;
  state.rb = fb > 0 ? xb / fb : 1;
  state.ff = ff;
  state.fr = fr;
  if (ff > 0 || fr > 0) state.dir = bow - stern >= 0 ? 1 : -1;
}

function setup() {
  state.x0 = self.pos.x;
  state.dir = self.pos.x <= 0 ? 1 : -1; // the way the bow points along x
  state.main = -1; // the contact id of the robot with the enemy's main core
  state.last = null; // where it was last seen
  state.firstReady = -1;
  state.lastSalvo = -100;
  state.dodge = 0;
  state.dodgeAt = -100;
  state.side = 0; // which side of the tracked robot it keeps to (-1 left, 1 right)
  measure();
}

/** The robot to go after: the one with the enemy's main core, else the nearest tracked of some weight. */
function target() {
  let best = null;
  let named = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id === 1 || c.id === 2) named = c; // the two titans are robots 1 and 2: this is the piece with the main core
    if (c.mass >= minMass && !best) best = c; // nearest first: what is on its way here is stopped before it arrives
  }
  return named || best;
}

function tick() {
  set('j' + Math.min(pods - 1, Math.floor(time / period)), 'ignite', 1);
  if (frame % 30 === 0) measure();

  // what it goes after, and where that was last
  const t = target();
  if (t) state.last = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, at: time };

  // height: its own, or well over or under a heavy enemy that is close (a ram flies level)
  let high = height;
  let threat = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < heavy) continue;
    if (Math.abs(c.pos.x - self.pos.x) > danger) continue;
    threat = c;
    break;
  }
  if (threat) {
    // Over or under, picked once per close pass (a ram that follows must not be crossed).
    // Something low is stayed over at its own height or more; only something near its own height is ducked under.
    if (state.dodge === 0) state.dodge = threat.pos.y < height - 60 ? 1 : -1;
    state.dodgeAt = time;
    high = state.dodge > 0 ? Math.max(height, threat.pos.y + step) : threat.pos.y - step;
  } else if (time - state.dodgeAt > 4) {
    state.dodge = 0;
  }
  high = clamp(high, 25, roof);
  const vyWant = clamp(1.0 * (high - self.pos.y), -Math.min(22, Math.sqrt(2 * 6 * Math.max(0, self.pos.y - 15))), 22);
  const az = clamp(2.5 * (vyWant - self.vel.y), -8, 10);
  const lift = state.m * (9.81 + az);
  const w = 1.3;
  const torque = state.inertia * (-(w * w) * self.angle - 2 * w * self.angVel);
  const ra = state.ra;
  const rb = state.rb;
  let pushA = lift / 2;
  if (Math.abs(ra - rb) > 1e-6) pushA = (torque - rb * lift) / (ra - rb);
  let pushB = lift - pushA;
  // Lopsided lift (one side's propellers worn away): level comes first. The side that cannot give its share gives
  // what it has, and the good side is throttled down to what balances it, so the hull sinks level instead of rolling.
  if (Math.abs(ra) > 1e-6 && Math.abs(rb) > 1e-6) {
    if (pushA > state.fa) {
      pushA = state.fa;
      pushB = (torque - ra * pushA) / rb;
    } else if (pushB > state.fb) {
      pushB = state.fb;
      pushA = (torque - rb * pushB) / ra;
    }
  }
  set('la', 'throttle', clamp(pushA / Math.max(state.fa, 1e-9), 0, 1));
  set('lb', 'throttle', clamp(pushB / Math.max(state.fb, 1e-9), 0, 1));

  // place: standoff from the tracked robot, on the side it is on unless only the other side has the room
  let want = state.x0 - state.dir * backoff;
  if (t) {
    if (state.side === 0) state.side = self.pos.x === t.pos.x ? -state.dir : sign(self.pos.x - t.pos.x);
    const held = Math.abs(clamp(t.pos.x + state.side * standoff, -edge, edge) - t.pos.x);
    const other = Math.abs(clamp(t.pos.x - state.side * standoff, -edge, edge) - t.pos.x);
    if (held < cornered && other > held + 200) state.side = -state.side;
    want = t.pos.x + state.side * standoff;
    // On its own side it never comes nearer the middle than where it started (that is where everyone looks first).
    if (state.side === -state.dir) want = state.side * Math.max(state.side * want, state.side * state.x0);
  }
  want = clamp(want, -edge, edge);
  // No faster than it can still stop in the room left (its boosters are small for its weight).
  const stop = (0.6 * Math.min(state.ff, state.fr)) / Math.max(state.m, 1);
  const room = Math.abs(want - self.pos.x);
  const vWant = sign(want - self.pos.x) * Math.min(cruise, Math.sqrt(2 * stop * room));
  const ax = clamp(1.5 * (vWant - self.vel.x), -3, 3) * state.dir; // along the bow
  set('pf', 'throttle', clamp((ax * state.m) / Math.max(state.ff, 1e-9), 0, 1));
  set('pr', 'throttle', clamp((-ax * state.m) / Math.max(state.fr, 1e-9), 0, 1));

  // ghosts
  let ready = 0;
  let alive = 0;
  for (let i = 0; i < bays; i++) {
    const r = get('g' + String.fromCharCode(97 + i), 'ready');
    if (r === undefined || r === null) continue;
    alive++;
    if (r > 0) ready++;
  }
  if (ready === 0) {
    state.firstReady = -1;
    return;
  }
  if (state.firstReady < 0) state.firstReady = time;
  if (Math.abs(self.angle) > level) return;
  const hot = t && t.distance < close;
  if (!hot && ready < Math.min(salvo, alive) && time - state.firstReady < wait) return;
  let aim = null;
  if (t) {
    // Not at something close under the deck: a ghost would dive through its own hull.
    const fore = (t.pos.x - self.pos.x) * state.dir; // m along the hull from the core toward the bow
    const under = t.pos.y < self.pos.y - 4 && fore > -40 && fore < 215;
    if (t.distance <= reach && !under) aim = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y };
  } else if (time - state.lastSalvo >= blindGap) {
    // Nothing tracked: the place it was last seen (it kept its speed for a few seconds at most), else the mirror of the start.
    const l = state.last;
    if (l && time - l.at < 4) aim = { x: l.x + l.vx * (time - l.at), y: l.y + l.vy * (time - l.at), vx: l.vx, vy: l.vy };
    else if (l) aim = { x: l.x, y: l.y, vx: 0, vy: 0 };
    else aim = { x: -state.x0, y: groundY, vx: 0, vy: 0 };
    if (Math.hypot(aim.x - self.pos.x, aim.y - self.pos.y) > reach + 200) aim = null;
  }
  if (!aim) return;
  for (let i = 0; i < bays; i++) {
    const tag = 'g' + String.fromCharCode(97 + i);
    if (!(get(tag, 'ready') > 0)) continue;
    send(tag + get(tag, 'built'), aim);
    set(tag, 'release', 1);
  }
  state.lastSalvo = time;
  state.firstReady = -1;
}
`;

const GUIDE = `// Guide of a ghost (titan-mirage's dart): two boosters, a heavy gyro, a jammer pod, a distance charge nose and two
// heavy warheads behind it. It has no sensor. The hull hands it a point and that point's speed when it lets it go;
// the ghost flies to where the point will be, lights its pod \`cloak\` s of flight before it gets there (no sensor
// outside the bubble sees it from then on), and its charge goes off by itself next to the first enemy part.
// Let go with no point (knocked loose), it does nothing and stays safe.
const thrust = param('thrust', 800, { min: 1, max: 100000 }); // N, both boosters
const clear = param('clear', 14, { min: 0, max: 100 }); // m straight out of the bay before it turns
const over = param('over', 22, { min: 0, max: 200 }); // m it stays above where it left while still over the hull
const hull = param('hull', 190, { min: 0, max: 1000 }); // m sideways from where it left that count as over the hull
const armAt = param('armAt', 20, { min: 0, max: 1000 }); // m from where it left before it arms
const cloakAt = param('cloakAt', 45, { min: 31, max: 1000 }); // m from where it left before its pod may be lit (the hull's radars must stay outside its bubble)
const cloak = param('cloak', 4.7, { min: 0, max: 5 }); // s of flight left when the pod is lit
const cross = param('cross', 2.5, { min: 0, max: 20 }); // 1/s: how hard it kills speed across the line to the point
const along = param('along', 50, { min: 0, max: 500 }); // m/s^2 it asks for along the line
const turn = param('turn', 5, { min: 0.1, max: 50 }); // rad/s^2 it plans its turns on
const near = param('near', 2.5, { min: 0, max: 50 }); // m from the point where it sets itself off

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function setup() {
  state.t0 = time;
  state.lx = self.pos.x;
  state.ly = self.pos.y;
  state.a0 = self.angle;
  state.aim = null;
  state.best = Infinity;
  for (const msg of inbox) {
    const d = msg.data;
    if (d && typeof d.x === 'number' && typeof d.y === 'number') state.aim = { x: d.x, y: d.y, vx: d.vx || 0, vy: d.vy || 0 };
  }
  set('heavygyro', 'damp', 0);
}

function tick() {
  const aim = state.aim;
  if (!aim) return;
  const t = time - state.t0;
  const px = aim.x + aim.vx * t;
  const py = aim.y + aim.vy * t;
  const out = Math.hypot(self.pos.x - state.lx, self.pos.y - state.ly);
  const dist = Math.hypot(px - self.pos.x, py - self.pos.y);
  const speed = Math.hypot(self.vel.x - aim.vx, self.vel.y - aim.vy);

  if (out >= armAt) {
    set('charge', 'arm', 1);
    set('heavywarhead', 'arm', 1);
  }
  if (out >= cloakAt && dist / Math.max(speed, 140) <= cloak) set('jammer', 'ignite', 1);
  if (out >= armAt && (dist <= near || (dist > state.best + 3 && state.best < 12))) {
    set('charge', 'detonate', 1);
    set('heavywarhead', 'detonate', 1);
  }
  if (dist < state.best) state.best = dist;

  // where to push
  let want;
  if (out < clear) {
    want = state.a0;
  } else {
    let tx = px - self.pos.x;
    let ty = py - self.pos.y;
    // Still over the hull: do not dive through it.
    const floor = state.ly + over;
    if (Math.abs(self.pos.x - state.lx) < hull && py < floor) ty = floor - self.pos.y;
    const d = Math.max(1e-6, Math.hypot(tx, ty));
    tx /= d;
    ty /= d;
    const rvx = self.vel.x - aim.vx;
    const rvy = self.vel.y - aim.vy;
    const closing = rvx * tx + rvy * ty;
    const cx = rvx - closing * tx;
    const cy = rvy - closing * ty;
    const ax = along * tx - cross * cx;
    const ay = along * ty - cross * cy + 9.81;
    want = Math.atan2(ay, ax) - Math.PI / 2;
  }
  const err = wrap(want - self.angle);
  const rate = clamp(sign(err) * Math.sqrt(2 * turn * Math.abs(err)), -8, 8);
  set('heavygyro', 'spin', clamp(-2.5 * (rate - self.angVel), -1, 1));
  set('booster', 'throttle', Math.abs(err) < 0.6 || out < clear ? 1 : 0.2);
}
`;

fs.writeFileSync(path.join(out, `${NAME}.json`), JSON.stringify(blueprint, null, 1) + '\n');
fs.writeFileSync(path.join(out, `${NAME}.helm.js`), HELM);
fs.writeFileSync(path.join(out, `${NAME}.ghost.guide.js`), GUIDE);
fs.writeFileSync(path.join(out, `${NAME}-ghost.json`), JSON.stringify(ghost(`${NAME}-ghost.guide.js`), null, 1) + '\n');
fs.writeFileSync(path.join(out, `${NAME}-ghost.guide.js`), GUIDE);
console.log(`${NAME}: ${W} by ${H} cells, ${BAYS} bays, ${pod} pods, ${props.length} propellers, about ${Math.round(m)} kg, center of mass at column ${com.toFixed(1)}`);
