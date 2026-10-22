// titan-palisade: one script flies a module and runs its turrets. A gun panel (role 0) and the keep (role 1, the main
// core) run the same code: titan-palisade.keep.js is the one to edit, and the generator
// (tournaments/gen/titan-palisade.mjs) copies it to every panel's file.
// - Flight: propellers hold the height and the tilt (the side groups `pa` and `pb` throttled apart), thrusters `ta`
//   (toward the t1 guns' side) and `tb` (away) move it sideways, and past what they give it leans into the move, as
//   far as its spare lift allows (titans v2, 2026-10: level only, a panel could not keep up with a ram driving under
//   it). Holding its tilt comes before holding its height: a keep leaning past what its propellers could right sank
//   to the ground in its first seconds and sat there all match. Left, right and front are worked out from where the
//   parts are, so it flies the same flipped.
// - The ground it may use comes from `arena` ({ x, y }, or null in the open sandbox), never a typed-in edge.
// - The enemy's main robot (titan-darts, 2026-10, Logan): picked from what the radar reports, never by id: the heaviest
//   enemy with a live core of `mainMass` kg or more (nearest first on a tie), kept while it is seen unless one twice
//   as heavy shows up, and forgotten when it is seen as debris (no live core). A new one later is taken up the same way.
//   While the radar sees it, the panels hold a ring around it, `ring` meters off, panel `slot` at its own angle (low
//   slots low). Every few seconds a panel studies it (a few cheap scans spread over two ticks, never the whole robot):
//   where its guns are and which way they point, and how far it reaches from its core. A ground robot with a tall
//   mast gets the mast cut first (the cheapest band). Guns that point the same way from scan to scan (bolted on, or a
//   turret holding still) blast a straight strip: no panel or keep waits in one (titans v2, 2026-10: Juggernaut's
//   roof guns all point up, and the panels it drove under were cut down). Hidden (a jammer, smoke), they close to
//   `near` meters of where it was last seen (at first: the mirror of their own start) and blast that place for `fresh`
//   seconds; with nothing there they search: one over the other, walking out and back over the ground (the arena, or
//   `roam` m either side of where they started), batteries sweeping. Every gun blasts whenever its own sight reads an
//   enemy, and a sight that reads the main robot gives its place (until one is known, a sight on any robot not seen
//   lighter than `mainMass`).
// - Batteries take the main robot when it is in reach: its guns first, one after another (25 health each, and they
//   are what hurts), then its core. Else the nearest enemy they can swing to. The keep's guns take the nearest.
//   Aim leads the target and allows for the drop.
// - A panel with no guns left rams: it flies through the nearest enemy (titans v2, 2026-10).
// - The last `guards` panels stay by the keep (the heaviest friend with a live core) and blast whatever comes near it.
// - The keep fires every link on the first ticks, then waits high up and far back: in an arena at its own end, in the
//   open `standoff` m back from the main robot on the panels' side (with nothing seen for `restAfter` s, where it
//   is). There it sets down and waits on the ground, propellers off: its batteries do not last a match hovering.
//   From a heavy main robot that moves (a ram) it takes off and runs: away, and near the edge, or with the ram
//   close, it goes over or under it (whichever has room and is not a strip its fixed guns blast) and runs back.
const role = param('role', 0, { min: 0, max: 1 });
const slot = param('slot', 0, { min: 0, max: 100 });
const count = param('count', 12, { min: 1, max: 100 });
const ring = param('ring', 200, { min: 20, max: 290 }); // m from the enemy's main core while it is seen
const near = param('near', 110, { min: 20, max: 290 }); // m from the place it was last seen while it is hidden
const gap = param('gap', 24, { min: 5, max: 100 }); // m between neighbors along the ring
const floor = param('floor', 50, { min: 5, max: 200 }); // m: no slot is lower
const reach = param('reach', 285, { min: 1, max: 300 }); // m: a shell lives 1 s
const vmax = param('vmax', 32, { min: 1, max: 80 }); // m/s sideways
const chase = param('chase', 65, { min: 1, max: 100 }); // m/s: a panel's fastest, keeping up with a fast main robot
const keepSpeed = param('keepSpeed', 75, { min: 1, max: 100 }); // m/s, the keep's fastest
const below = param('below', 35, { min: 5, max: 200 }); // m under the arena's ceiling where the keep waits (it loses above it)
const back = param('back', 200, { min: 20, max: 900 }); // m in from the arena's edge where the keep waits with no ram about
const room = param('room', 140, { min: 20, max: 900 }); // m in from the edge: as far as the keep runs from a ram
const standoff = param('standoff', 650, { min: 300, max: 1000 }); // m back from the main robot the keep waits in the open
const waitUp = param('waitUp', 120, { min: 20, max: 400 }); // m over the main robot the keep waits in the open
const roam = param('roam', 1000, { min: 100, max: 5000 }); // m either side of the start a search walks in the open
const restAfter = param('restAfter', 25, { min: 1, max: 1000 }); // s with nothing seen before the keep sets down in the open
const ram = param('ram', 1500, { min: 0, max: 1000000 }); // kg: a main robot this heavy coming at the keep is run from
const ramFor = param('ramFor', 12, { min: 1, max: 100 }); // s a ram is still run from after it last came on
const clearance = param('clearance', 40, { min: 5, max: 150 }); // m the keep wants between itself and a ram's top or bottom
const tall = param('tall', 70, { min: 10, max: 1000 }); // m: a ground robot reaching this far over its core has a mast to cut
const cutMax = param('cutMax', 15000, { min: 0, max: 1000000 }); // the most a band may cost to be cut (health times 4 for frames, 10 for plates)
const rescan = param('rescan', 3, { min: 0.5, max: 60 }); // s between studies of the main robot
const fresh = param('fresh', 8, { min: 0, max: 100 }); // s a sighting of the hidden main robot is trusted
const wait = param('wait', 5, { min: 0, max: 100 }); // s in place with nothing seen before a search
const pace = param('pace', 12, { min: 1, max: 40 }); // m/s of a search
const debug = param('debug', 0, { min: 0, max: 1 });
const mainMass = param('mainMass', 30, { min: 0, max: 100000 }); // kg: the main robot is never lighter (darts, pods)
const guards = param('guards', 2, { min: 0, max: 100 }); // panels that stay by the keep while no ram is about
const guard = role < 0.5 && slot >= count - guards;
const HALF = Math.PI / 2;
const SHELL = 300;
const G = 9.81;
// The ground (titans v2, 2026-10): the edge and the ceiling of a match's arena, none in the open sandbox.
const EDGE = arena ? arena.x : Infinity;
const CEIL = arena ? arena.y : Infinity;
const WEAPONS = ['gun', 'laser', 'cannon', 'lance', 'core'];

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Reads the robot's own parts once (and again when one is lost): mass, turning numbers, propellers, turrets. */
function index() {
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
  const ca = Math.cos(self.angle);
  const sa = Math.sin(self.angle);
  let inertia = 0;
  let s1 = 0;
  let s2 = 0;
  let nprop = 0;
  let ax = 0;
  let na = 0;
  let nta = 0;
  let ntb = 0;
  let tauA = 0;
  let tauB = 0;
  let ngun = 0;
  const byName = {};
  const turrets = [];
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    inertia += p.mass * (dx * dx + dy * dy);
    const bx = dx * ca + dy * sa;
    if (p.type === 'propeller') {
      nprop++;
      s1 += bx;
      s2 += Math.abs(bx);
      if (p.tags.includes('pa')) {
        ax += bx;
        na++;
      }
    } else if (p.type === 'thruster') {
      // How much it turns the robot at full push (counterclockwise), from where it sits and the way it pushes.
      const a = p.angle + ((p.rot + p.spec.acts) * Math.PI) / 180;
      const tau = 160 * (dx * Math.sin(a) - dy * Math.cos(a));
      if (p.tags.includes('ta')) {
        nta++;
        tauA += tau;
      } else if (p.tags.includes('tb')) {
        ntb++;
        tauB += tau;
      }
    } else if (p.type === 'gun' || p.type === 'rotator') {
      if (p.type === 'gun') ngun++;
      const end = p.type === 'gun' ? '.gun' : '.rot';
      for (const t of p.tags) {
        if (!t.endsWith(end)) continue;
        const name = t.slice(0, -4);
        let e = byName[name];
        if (!e) {
          e = byName[name] = { name, n: turrets.length, rot: null, guns: [], want: undefined, at: 0, turn: undefined, all: 0, fires: [] };
          turrets.push(e);
        }
        if (p.type === 'gun') e.guns.push(p);
        else e.rot = p;
        if (name === 't1' && p.type === 'gun' && state.facing === undefined) state.facing = bx >= 0 ? 1 : -1;
      }
    }
  }
  state.n = parts.length;
  state.m = m;
  state.inertia = inertia;
  state.s1 = s1;
  state.s2 = s2;
  state.nprop = nprop;
  state.sa = na > 0 && ax < 0 ? -1 : 1;
  state.nta = nta;
  state.ntb = ntb;
  state.tauA = tauA;
  state.tauB = tauB;
  state.ngun = ngun;
  state.turrets = turrets;
}

function setup() {
  state.home = { x: self.pos.x, y: self.pos.y };
  state.last = undefined;
  state.seen = undefined;
  state.stale = 0;
  state.sx = undefined;
  state.sdir = 0;
  state.mode = 3;
  state.ticks = 0;
  state.guns = [];
  state.ext = undefined;
  state.scanAt = -100;
  state.step = 0; // a study runs over two ticks: 1 is its second
  state.gunsLeft = -1;
  state.same = 0;
  state.run = 0;
  state.pass = 0;
  state.ram = false;
  state.ramUntil = -100;
  state.mainId = -1;
  state.light = {}; // ids of enemy robots seen lighter than `mainMass`
  state.fixed = []; // the main robot's guns that point the same way scan to scan: { dx, dy, c, s } from its core
  state.dirs = {}; // gun id -> which way it pointed from its core's angle at the last study
  state.movers = []; // a ram's thrusters and propellers least covered from here: { dx, dy } from its core
  state.shift = 0; // m a panel's slot is moved out to keep it off a strip such guns blast
  state.shiftAt = -100;
  state.lift2 = 0; // m up a panel's slot is moved for the same reason
  state.lift = 0; // 1 while the keep rests on the ground
  state.down = 0; // s the keep has been sinking without moving
  state.landX = 0; // where it set down
  state.tilt = 0; // the lean it holds now, radians
  index();
  if (state.facing === undefined) state.facing = self.pos.x < 0 ? 1 : -1;
}

/**
 * Flight toward (wx, wy), at most `top` m/s sideways; `agile` lets it climb and drop as hard as it can. Thrusters
 * push first; past them it leans, at most `lean` radians and only as far as its spare lift keeps it up.
 */
function fly(wx, wy, top, agile, lean, vref) {
  const brake = agile ? 8 : 3; // the stop it plans on, twice its braking in m/s^2
  const m = state.m;
  const th = self.angle;
  const lift = 120 * state.nprop;
  const lim = agile ? 60 : 12;
  const ey = clamp(wy - self.pos.y, -lim, lim);
  const ay = agile ? clamp(3 * ey - 3.5 * self.vel.y, -9, 40) : 2.25 * ey - 3 * self.vel.y;
  const need = Math.max(0, m * (G + ay));
  const ex = wx - self.pos.x;
  // `vref`: how fast the spot itself moves (a ring round a moving robot), matched before closing on it.
  const v0 = vref || 0;
  const wantV = clamp(v0 + sign(ex) * Math.min(top, Math.sqrt(brake * Math.abs(ex)), 2 * Math.abs(ex)), -top, top);
  const axWant = clamp(2 * (wantV - self.vel.x), -20, 20);
  // Leaning first, as far as the lift left over from holding height allows (height before speed); the thrusters
  // only for the rest. A propeller pushes 12 N for each watt, a thruster 8: running on thrusters alone, the keep
  // emptied its batteries in 90 s of running from a ram.
  const spare = lift > 0 ? Math.acos(clamp(Math.max(need, m * G * 1.05) / (0.9 * lift), 0, 1)) : 0;
  const most = Math.min(lean, spare);
  const leanAcc = (G + Math.max(0, ay)) * Math.tan(most);
  const want = -clamp(Math.atan2(axWant, G + Math.max(0, ay)), -most, most);
  // The lean it holds swings over gently: a lean thrown from one side to the other at once overshot and rolled the
  // keep over.
  state.tilt += clamp(want - state.tilt, -0.6 * dt, 0.6 * dt);
  const err = wrap(th - state.tilt);
  // Leaning far past what it asked for: no push sideways and no climb until it is righted.
  const righting = Math.abs(err) > 0.25;
  const ath = Math.abs(axWant) > leanAcc ? axWant - sign(axWant) * leanAcc : 0;
  const f = righting ? 0 : m * ath * state.facing;
  const fa = state.nta > 0 ? clamp(f / (160 * state.nta), 0, 1) : 0;
  const fb = state.ntb > 0 ? clamp(-f / (160 * state.ntb), 0, 1) : 0;
  set('ta', 'throttle', fa);
  set('tb', 'throttle', fb);
  const tq = 120 * state.s2;
  let u = lift > 0 ? need / (lift * Math.max(0.5, Math.cos(th))) : 0;
  // The thrusters sit above or below its middle and turn it as they push: the propellers take that out first.
  let d = tq > 0 ? (state.inertia * (-6.25 * err - 5 * self.angVel) - fa * state.tauA - fb * state.tauB) / tq : 0;
  d = clamp(d, -0.6, 0.6);
  // The tilt first: leave the propellers room to right it, else a lean grows until the lift is gone.
  u = clamp(u, 0.05, righting ? 0.6 : Math.max(0.55, 1 - Math.abs(d)));
  if (state.s2 > 0) d -= (u * state.s1) / state.s2;
  d = clamp(d, -0.7, 0.7) * state.sa;
  set('pa', 'throttle', clamp(u + d, 0, 1));
  set('pb', 'throttle', clamp(u - d, 0, 1));
}

/** Everything off: resting on the ground. */
function idle() {
  set('pa', 'throttle', 0);
  set('pb', 'throttle', 0);
  set('ta', 'throttle', 0);
  set('tb', 'throttle', 0);
}

/** A huge robot's part nearest a point far off one way: its extreme that way, for one scan call. */
function far(main, x, y) {
  const s = scan(main.id, { near: { x: main.pos.x + x, y: main.pos.y + y }, most: 1 });
  return s && s.length > 0 ? s[0] : null;
}

/**
 * Studies the main robot: where its guns (and other weapons) sit from its core and which way they point, and how far
 * it reaches from its core each way. Never the whole of a big robot (a titan's 5000 parts cost a frame per scan):
 * first tick its weapons and its top and bottom, second tick its sides, and a mast, if it has one.
 */
function study(main) {
  const cx = main.pos.x;
  const cy = main.pos.y;
  const big = main.parts > 300;
  if (state.step === 0) {
    state.scanAt = time;
    const list = big ? scan(main.id, { of: WEAPONS, acts: true }) : scan(main.id, { acts: true });
    if (!list) return;
    const guns = [];
    const fixed = [];
    const dirs = {};
    // Its angle: the core nearest where the radar puts it.
    let ang = 0;
    let best = Infinity;
    for (const p of list) {
      if (p.type !== 'core') continue;
      const d = Math.abs(p.pos.x - cx) + Math.abs(p.pos.y - cy);
      if (d < best) {
        best = d;
        ang = p.angle;
      }
    }
    let hx = 0;
    let topY = 0;
    let botY = 0;
    for (const p of list) {
      const dx = p.pos.x - cx;
      const dy = p.pos.y - cy;
      if (!big) {
        if (Math.abs(dx) > hx) hx = Math.abs(dx);
        if (dy > topY) topY = dy;
        else if (dy < botY) botY = dy;
      }
      if (p.type === 'core' || p.acts === undefined || WEAPONS.indexOf(p.type) < 0) continue;
      if (guns.length < 200) guns.push({ dx, dy });
      // The same way as last time, from its core: it blasts a strip that stays put while the robot does.
      const rel = wrap(p.acts - ang);
      const was = state.dirs[p.id];
      if (was !== undefined && Math.abs(wrap(rel - was)) < 0.01 && fixed.length < 120) {
        // Its shells carry the robot's own speed: the strip leans the way it drives.
        const vx = SHELL * Math.cos(p.acts) + main.vel.x;
        const vy = SHELL * Math.sin(p.acts) + main.vel.y;
        const v = Math.hypot(vx, vy);
        fixed.push({ dx, dy, c: vx / v, s: vy / v });
      }
      dirs[p.id] = rel;
    }
    state.dirs = dirs;
    state.fixed = fixed;
    state.next = guns;
    if (big) {
      const t = far(main, 0, 1e5);
      const b = far(main, 0, -1e5);
      state.ext = { hx: state.ext ? state.ext.hx : 40, top: t ? t.pos.y - cy : 25, bot: b ? b.pos.y - cy : -25, topX: t ? t.pos.x - cx : 0 };
      state.step = 1;
      return;
    }
    state.ext = { hx, top: topY, bot: botY, topX: 0 };
    pickGuns(main, list, 0);
    if (state.ram) movers(main);
    return;
  }
  // The second tick of a big robot: its sides, then a mast.
  state.step = 0;
  const l = far(main, -1e5, 0);
  const r = far(main, 1e5, 0);
  if (l && r) state.ext.hx = Math.max(cx - l.pos.x, r.pos.x - cx);
  let column = null;
  if (state.ext.top > tall && cy + state.ext.bot < 8) {
    // The parts nearest the middle of where a cut could go, under its top.
    const mid = (30 + state.ext.top - 20) / 2;
    column = scan(main.id, { near: { x: cx + state.ext.topX, y: cy + mid }, most: 500 });
  }
  pickGuns(main, column, 1);
  if (state.ram) movers(main);
}

/**
 * What moves a ram (titans v2, 2026-10): its thrusters, boosters and propellers that this one can reach through the
 * least in front of them. A ram that cannot move cannot reach anyone, and a heavy one is all armor where it hits but
 * soft where it pushes from. On the ground only what pushes it sideways counts (its wheels and weight hold it up).
 */
function movers(main) {
  const me = { x: self.pos.x, y: self.pos.y };
  const list = scan(main.id, { has: 'throttle', acts: true, near: me, most: 160, from: me, wide: 0.6 });
  if (!list) return;
  const grounded = main.pos.y + (state.ext ? state.ext.bot : -1) < 8;
  const pick = [];
  for (const p of list) {
    if (p.acts === undefined || (grounded && Math.abs(Math.cos(p.acts)) < 0.6)) continue;
    pick.push({ dx: p.pos.x - main.pos.x, dy: p.pos.y - main.pos.y, cost: p.health + p.cover });
  }
  pick.sort((a, b) => a.cost - b.cost);
  state.movers = pick.slice(0, 24);
}

/** What the batteries aim at on the main robot: a band of its mast to cut, else its guns (`state.next`), else its core. */
function pickGuns(main, list, partial) {
  const cx = main.pos.x;
  const cy = main.pos.y;
  const ext = state.ext;
  if (list && ext.top > tall && cy + ext.bot < 8) {
    // A tall mast on a ground robot sweeps the whole sky: cut it. The 6 m band that takes the fewest shells to clear,
    // between 30 m up and 20 m under its top, is what the batteries blast until the top comes off. Of a big robot
    // only the parts round the mast were scanned: bands at the far ends of what came back are left out (some of
    // their parts were not counted).
    const cost = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of list) {
      const dy = p.pos.y - cy;
      if (dy < lo) lo = dy;
      if (dy > hi) hi = dy;
      if (dy < 30 || dy > ext.top - 20) continue;
      const b = Math.floor(dy / 6);
      cost[b] = (cost[b] || 0) + p.health * (p.type === 'armorplate' ? 10 : p.type === 'frame' ? 4 : 1);
    }
    if (partial) {
      lo += 6;
      hi -= 6;
    }
    let best = -1;
    for (let b = 5; b < cost.length; b++) if (cost[b] > 0 && b * 6 >= lo && b * 6 + 6 <= hi && (best < 0 || cost[b] < cost[best])) best = b;
    // Only a band worth cutting (a spar of frames; a mast of plates would take all match): else its guns.
    if (best >= 0 && cost[best] < cutMax) {
      const guns = [];
      for (const p of list) {
        const dy = p.pos.y - cy;
        if (Math.floor(dy / 6) === best && guns.length < 200) guns.push({ dx: p.pos.x - cx, dy });
      }
      state.gunsLeft = -1;
      state.same = 0;
      state.guns = guns;
      return;
    }
  }
  const guns = state.next || [];
  // Guns that never go down are behind something: after three studies with none lost, go for the core.
  state.same = guns.length === state.gunsLeft ? state.same + 1 : 0;
  state.gunsLeft = guns.length;
  state.guns = state.same >= 3 ? [] : guns;
}

/** How many of the main robot's fixed guns blast a strip through (x, y) (within `w` m of their line, in reach). */
function danger(main, x, y, w) {
  let n = 0;
  for (const g of state.fixed) {
    const rx = x - main.pos.x - g.dx;
    const ry = y - main.pos.y - g.dy;
    const along = rx * g.c + ry * g.s;
    if (along < 0 || along > 320) continue;
    if (Math.abs(ry * g.c - rx * g.s) < w) n++;
  }
  return n;
}

/** Where to point from (hx, hy) to hit a point at (x, y) moving at (vx, vy). */
function lead(x, y, tvx, tvy, hx, hy, out) {
  const rx = x - hx;
  const ry = y - hy;
  const vx = tvx - self.vel.x;
  const vy = tvy - self.vel.y;
  let t = Math.hypot(rx, ry) / SHELL;
  let px = rx + vx * t;
  let py = ry + vy * t;
  t = Math.hypot(px, py) / SHELL;
  px = rx + vx * t;
  py = ry + vy * t;
  out.dist = Math.hypot(px, py);
  out.angle = Math.atan2(py + 0.5 * G * t * t, px);
}

const sol = { dist: 0, angle: 0 };

function runTurret(e, main, list, spot) {
  const g0 = e.guns[0];
  if (!g0 || !e.rot) return;
  if ((state.ticks + e.n) % 2 === 1 && e.turn !== undefined) {
    // Every other tick a turret only repeats what it worked out the tick before (half the turrets each tick).
    set(e.name + '.rot', 'turn', e.turn);
    if (e.all >= 0) set(e.name + '.gun', 'fire', e.all);
    else for (let i = 0; i < e.guns.length; i++) set(e.guns[i].id, 'fire', e.fires[i] || 0);
    return;
  }
  const aim = g0.out.aim;
  const rest = aim - e.rot.out.angle * HALF;
  const hx = e.rot.pos.x;
  const hy = e.rot.pos.y;
  let found = false;
  let live = false;
  if (role < 0.5 && e.name !== 't4' && !(guard && !state.ram) && main && main.distance < reach + 40) {
    // The main robot: one of its guns (a different one for each battery, moving on every second or so), else its core.
    // Against a ram two batteries of three go for what moves it, the third for its mast or guns.
    const aims = state.ram && state.movers.length > 0 && e.n % 3 !== 0 ? state.movers : state.guns;
    const n = aims.length;
    if (n > 0) {
      const k = e.n * 7 + slot * 3 + Math.floor(time / 1.2);
      for (let i = 0; i < 3 && !found; i++) {
        const g = aims[(k + i * 5) % n];
        lead(main.pos.x + g.dx, main.pos.y + g.dy, main.vel.x, main.vel.y, hx, hy, sol);
        if (sol.dist < reach && Math.abs(wrap(sol.angle - rest)) < 1.5) found = live = true;
      }
    }
    if (!found) {
      lead(main.pos.x, main.pos.y, main.vel.x, main.vel.y, hx, hy, sol);
      if (Math.abs(wrap(sol.angle - rest)) < 1.5) found = live = true;
    }
  }
  if (!found) {
    for (const c of list) {
      lead(c.pos.x, c.pos.y, c.vel.x, c.vel.y, hx, hy, sol);
      if (sol.dist < reach && Math.abs(wrap(sol.angle - rest)) < 1.5) {
        found = live = true;
        break;
      }
    }
  }
  if (!found && main) {
    lead(main.pos.x, main.pos.y, main.vel.x, main.vel.y, hx, hy, sol);
    found = Math.abs(wrap(sol.angle - rest)) < 1.5;
  }
  let want;
  if (found) want = sol.angle;
  else if (state.mode === 1) {
    // The main robot is hidden but was just seen or hit there: blast that place.
    const rx = spot.x - hx;
    const ry = spot.y - hy;
    const t = Math.hypot(rx, ry) / SHELL;
    const a = Math.atan2(ry + 0.5 * G * t * t, rx) + 0.02 * Math.sin(3 * time + slot);
    sol.dist = Math.hypot(rx, ry);
    want = rest + clamp(wrap(a - rest), -1.45, 1.45);
    live = Math.abs(wrap(a - rest)) < 1.45;
  } else {
    // Nothing to aim at: sweep, straight out on a search, else around the place it was last known to be.
    const a = state.mode === 2 ? rest + 0.8 * Math.sin(1.5 * time + 0.7 * slot) : Math.atan2(spot.y - hy, spot.x - hx) + 0.45 * Math.sin(1.1 * time + 0.7 * slot);
    want = rest + clamp(wrap(a - rest), -1.45, 1.45);
  }
  const err = wrap(want - aim);
  const moving = found && e.want !== undefined ? wrap(want - e.want) / Math.max(dt, time - e.at) : 0;
  e.want = found ? want : undefined;
  e.at = time;
  e.turn = clamp((moving + 6 * err) / 2, -1, 1);
  set(e.name + '.rot', 'turn', e.turn);
  const on = live && sol.dist < reach && Math.abs(err) < Math.max(0.012, 1.2 / sol.dist);
  // Each gun goes by its own sight: an enemy on the line is always blasted, a friend or its own robot never.
  let sum = 0;
  const guns = e.guns;
  const fires = e.fires;
  for (let i = 0; i < guns.length; i++) {
    const o = guns[i].out;
    const side = o.sightSide;
    let fire = 0;
    if (side === 3) {
      fire = 1;
      if (!main && (state.mainId >= 0 ? o.sightId === state.mainId : !state.light[o.sightId])) {
        // A sight found the hidden main robot: that is where it is.
        state.last = { x: guns[i].pos.x + o.sight * Math.cos(o.aim), y: guns[i].pos.y + o.sight * Math.sin(o.aim) };
        state.seen = time;
        state.stale = 0;
      }
    } else if (on && !((side === 1 || side === 2 || side === 5) && o.sight < sol.dist)) fire = 1;
    fires[i] = fire;
    sum += fire;
  }
  e.all = sum === 0 ? 0 : sum === guns.length ? 1 : -1;
  if (e.all >= 0) set(e.name + '.gun', 'fire', e.all);
  else for (let i = 0; i < guns.length; i++) set(guns[i].id, 'fire', fires[i]);
}

/** Moves a spot out of the strips the main robot's fixed guns blast, sideways away from it (checked twice a second). */
function safe(main, wx, wy, w) {
  if (!main || state.fixed.length === 0) return wx;
  if (time - state.shiftAt > 0.5) {
    state.shiftAt = time;
    const out = wx >= main.pos.x ? 1 : -1;
    // A strip across (guns on its side) is left up or down, one going up (a roof's guns) outward.
    state.shift = 0;
    state.lift2 = 0;
    // Never far: out of reach of the batteries there is no point, and guns on every face leave no gap anyway.
    for (let k = 0; k < 12; k++) {
      const dy = k < 8 ? (k % 2 === 0 ? 1 : -1) * 15 * Math.ceil(k / 2) : 0;
      const dx = k < 8 ? 0 : out * 15 * (k - 7);
      if (wy + dy < floor) continue;
      if (danger(main, wx + dx, wy + dy, w) < 3) {
        state.shift = dx;
        state.lift2 = dy;
        break;
      }
    }
  }
  return wx + state.shift;
}

/** The keep's flight. */
function keepFlight(main) {
  const end = state.home.x !== 0 ? sign(state.home.x) : -state.facing;
  if (time < 3) {
    // First clear of the column of panels it was bolted under: back, holding its height.
    fly(state.home.x + end * 150, state.home.y, keepSpeed, true, 0.3);
    return;
  }
  if (!main || !state.ram) {
    state.run = 0;
    state.pass = 0;
    let wx;
    let wy;
    if (arena) {
      // An arena: wait toward its own end, high up, with room behind it (a bump past the edge is a loss).
      wx = end * (EDGE - back);
      wy = CEIL - below;
    } else if (main || state.last) {
      // The open: back from the main robot (or where it was last), behind the panels, high over it.
      const at = main ? main.pos : state.last;
      wx = at.x - state.facing * standoff;
      wy = Math.max(at.y + waitUp, state.home.y * 0.5);
    } else {
      wx = state.home.x;
      wy = state.home.y;
    }
    // Nothing seen for a long while in the open: it waits where it is.
    if (!arena && !main && (state.seen === undefined ? time : time - state.seen) > restAfter) wx = state.lift === 1 ? state.landX : self.pos.x;
    wx = safe(main, wx, wy, 14);
    // At its spot it sets down and waits on the ground with its propellers off (titans v2, 2026-10: hovering the
    // whole match ran its batteries dry before the end). It takes off again for a ram, or a spot moved far off.
    if (state.lift === 1 && Math.abs(wx - state.landX) < 200) {
      idle();
      return;
    }
    if (Math.abs(wx - self.pos.x) < 60) {
      fly(wx, self.pos.y - 15, 5, false, 0.1);
      state.down = self.vel.y > -0.5 ? state.down + dt : 0;
      if (state.down > 1.5) {
        state.lift = 1;
        state.landX = self.pos.x;
      }
      return;
    }
    state.lift = 0;
    state.down = 0;
    fly(wx, wy, keepSpeed, true, 0.45);
    return;
  }
  state.lift = 0;
  // A ram. Run from it; near the edge, or with it close, go over or under it and run back.
  const ext = state.ext || { hx: 40, top: 25, bot: -25 };
  const side = self.pos.x >= main.pos.x ? 1 : -1; // which side of it the keep is on
  const open = Math.abs(self.pos.x - main.pos.x) - ext.hx; // m of air between them, sideways
  const closing = (main.vel.x - self.vel.x) * side; // m/s it gains
  if (state.run === 0) state.run = side;
  const topY = main.pos.y + ext.top;
  const botY = main.pos.y + ext.bot;
  const over = topY + clearance;
  const under = botY - clearance;
  const hiY = Math.min(CEIL - 12, main.pos.y + 500);
  const grounded = botY < 8;
  // Room over or under it, and whether going that way crosses a strip its fixed guns blast (Juggernaut's roof guns
  // reach past the ceiling: running only along it is how the keep lives; titans v2, 2026-10).
  const roomOver = over < hiY;
  const roomUnder = !grounded && under > 14;
  const passOver = roomOver && danger(main, main.pos.x, Math.min(hiY, over + 8), 14) < 3;
  const passUnder = roomUnder && danger(main, main.pos.x, Math.max(12, under - 8), 14) < 3;
  const away = state.run * Math.min(EDGE - room, main.pos.x * state.run + 2000);
  if (state.pass === 0) {
    const cornered = arena && self.pos.x * state.run > EDGE - room - 220;
    if (state.run !== side) state.run = side; // it got past: the other way is now away
    else if (closing > 3 && ((cornered && open < 300) || open < 120 || open / closing < 3.5)) {
      // Over or under, whichever has more room and is the way it is not already moving (a flier follows the keep's
      // height; it takes a heavy one seconds to turn round).
      const upScore = passOver ? hiY - over - 4 * main.vel.y : -Infinity;
      const downScore = passUnder ? under - 14 + 4 * main.vel.y : -Infinity;
      if (upScore > -Infinity || downScore > -Infinity) state.pass = upScore >= downScore ? 1 : -1;
    }
  }
  let wy;
  let wx = away;
  if (state.pass !== 0) {
    wy = state.pass > 0 ? Math.min(hiY + 2, over + 8) : Math.max(12, under - 8);
    // Clear once past its height (kept: sinking a little on the way over must not turn it back into it).
    if (state.pass > 0 ? self.pos.y > over - 12 : self.pos.y < under + 12) state.clear = true;
    const clear = state.clear === true;
    // Once clear of its height, cross to its other side; until then keep running.
    if (clear) wx = -state.run * Math.min(EDGE - room, Math.abs(main.pos.x) + 2000);
    if (side !== state.run && open > 30) {
      // Across: that side is now away.
      state.run = side;
      state.pass = 0;
      state.clear = false;
    }
    if (state.pass > 0 ? !passOver && !clear : !passUnder && !clear) {
      state.pass = 0; // that way closed
      state.clear = false;
    }
  } else if (grounded) {
    // From a ground ram, high: a mast that reaches the ceiling is lighter up there than its hull is down here.
    wy = roomOver ? Math.min(hiY - 2, over + 30) : hiY - 2;
  } else {
    // From a flier, the middle of the air there is: room to go over or under it when it comes.
    wy = arena ? (hiY + 14) / 2 : Math.max(main.pos.y, 100);
  }
  fly(wx, clamp(wy, 12, hiY + 2), keepSpeed, true, 0.45);
}

function tick() {
  state.ticks++;
  if (role > 0.5 && state.ticks <= 3) set('decoupler', 'fire', 1);
  if (parts.length !== state.n) index();
  // What the radar shows: the main robot, and the nearest few in reach.
  // `mine`, the keep the guard panels stay by: the heaviest friend with a live core. The panels split off the keep, and
  // none can tell which robot it was part of (a script does not know its own robot's number), but the keep is three
  // times any panel (about 480 kg to 150) and nothing else of its side is on the field. Contacts come nearest first,
  // so a tie goes to the nearer.
  let mine = null;
  let heaviest = null;
  let kept = null;
  const list = [];
  for (const c of contacts) {
    if (c.side === 'friend' && c.core && (!mine || c.mass > mine.mass)) mine = c;
    if (c.id === state.mainId && (c.side !== 'enemy' || !c.core)) state.mainId = -1; // seen as debris: forgotten
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id === state.mainId) kept = c;
    if (c.mass < mainMass) state.light[c.id] = true;
    else if (!heaviest || c.mass > heaviest.mass) heaviest = c;
    if (c.distance < 300 && list.length < 8) list.push(c);
  }
  const main = kept && !(heaviest && heaviest.mass > 2 * kept.mass) ? kept : heaviest;
  if (main && main.id !== state.mainId) {
    // A new main robot: what was learnt of the last one is no use.
    state.ext = undefined;
    state.guns = [];
    state.fixed = [];
    state.dirs = {};
    state.movers = [];
    state.step = 0;
    state.gunsLeft = -1;
    state.same = 0;
    state.ram = false;
    state.ramUntil = -100;
    state.scanAt = -100;
  }
  if (main) state.mainId = main.id;
  if (main) {
    // A ram is a heavy main robot coming at the keep (or right by it), and it stays one for `ramFor` s after: one that
    // keeps its distance (a carrier) or sits still (a fortress) is not run from, and its propellers are not what the
    // batteries are for (titans v2, 2026-10: any heavy robot that moved counted, and Hive lived through the match).
    if (main.mass >= ram) {
      const k = role > 0.5 ? { pos: self.pos, vel: self.vel } : mine || { pos: self.pos, vel: self.vel };
      const rx = k.pos.x - main.pos.x;
      const ry = k.pos.y - main.pos.y;
      const dist = Math.hypot(rx, ry);
      const closing = ((main.vel.x - k.vel.x) * rx + (main.vel.y - k.vel.y) * ry) / Math.max(1, dist);
      const size = state.ext ? state.ext.hx : 40;
      if ((closing > 12 && dist < 1200) || dist - size < 150) state.ramUntil = time + ramFor;
    }
    state.ram = time < state.ramUntil;
    state.last = { x: main.pos.x, y: main.pos.y };
    state.seen = time;
    state.stale = 0;
    state.sx = undefined;
    if (state.step === 1 || (time - state.scanAt > rescan + 0.13 * slot && (role > 0.5 ? state.ram : main.distance < reach + 150))) study(main);
  } else state.step = 0;
  // 0 the radar sees the main robot, 1 hidden but seen or hit in the last `fresh` s, 2 searching, 3 on the way.
  state.mode = main ? 0 : state.seen !== undefined && time - state.seen < fresh ? 1 : state.stale > wait ? 2 : 3;
  const spot = state.last || { x: state.home.x + state.facing * 800, y: 75 };

  if (role > 0.5) keepFlight(main);
  else if (time < 3.5) {
    // The first seconds: hold where it woke, a little up, until the keep under the column is out of the way.
    fly(state.home.x, state.home.y + 4, vmax, false, 0);
  } else if (state.ngun === 0 && (main || list.length > 0)) {
    // No guns left: what is left is 150 kg of panel. Fly through the nearest enemy, or the main robot.
    const t = list.length > 0 ? list[0] : main;
    const dx = t.pos.x - self.pos.x;
    fly(t.pos.x + sign(dx) * 30, t.pos.y, chase, true, 0.45);
  } else {
    let wx;
    let wy;
    let top = vmax;
    if (state.mode === 2) {
      // Search: the panels line up one over the other and walk out over the ground and back, sights sweeping ahead.
      const lo = arena ? -EDGE + 70 : state.home.x - roam;
      const hi = arena ? EDGE - 70 : state.home.x + roam;
      if (state.sx === undefined) {
        state.sx = self.pos.x;
        if (state.sdir === 0) state.sdir = state.facing;
      }
      state.sx += state.sdir * pace * dt;
      if (state.sx > hi) state.sdir = -1;
      else if (state.sx < lo) state.sdir = 1;
      wx = state.sx;
      wy = floor + slot * gap;
    } else {
      const r = main ? ring : near;
      const step = gap / r;
      // One side of it: the batteries face one way.
      let a0 = -0.5 * (count - 1) * step;
      if (spot.y + r * Math.sin(a0) < floor) a0 = Math.asin(clamp((floor - spot.y) / r, -1, 1));
      let a = a0 + slot * step;
      let rr = r;
      if (a > 1.3) {
        rr = r + 26 * Math.ceil((a - 1.3) / step);
        a = 1.3;
      }
      wy = Math.max(floor, spot.y + rr * Math.sin(a));
      wx = spot.x - state.facing * rr * Math.cos(a);
      if (main) {
        // Keep up with a fast one (a ram outruns a panel at its cruising speed), and off the strips its fixed guns blast.
        top = clamp(Math.abs(main.vel.x) + 25, vmax, chase);
        wx = safe(main, wx, wy, 12);
        wy += state.lift2;
      }
      // In place with nothing seen: the wait before a search runs.
      if (!main && Math.abs(wx - self.pos.x) + Math.abs(wy - self.pos.y) < 40) state.stale += dt;
    }
    if (guard && mine && !state.ram) {
      // The last `guards` panels stay by the keep, one over the other on the enemy's side of it.
      fly(mine.pos.x + state.facing * 45, mine.pos.y + 20 + 34 * (count - 1 - slot), 45, false, 0.3);
    } else fly(wx, wy, top, top > vmax, 0.5, main ? main.vel.x : 0);
  }

  for (const e of state.turrets) runTurret(e, main, list, spot);
  if (debug > 0.5 && state.ticks % 120 === 0 && (role > 0.5 || slot === 3)) log(role > 0.5 ? 'keep' : 'panel', time.toFixed(0), 'at', self.pos.x.toFixed(0), self.pos.y.toFixed(0), 'main', main ? main.pos.x.toFixed(0) + ',' + main.pos.y.toFixed(0) : 'hidden', 'run', state.run, 'pass', state.pass, 'guns', state.guns.length, 'mov', state.movers.length, 'fixed', state.fixed.length, 'ext', state.ext ? [state.ext.hx, state.ext.top, state.ext.bot].map((v) => v.toFixed(0)).join('/') : '-', 'shift', state.shift, 'e', self.energy.stored.toFixed(0));
}
