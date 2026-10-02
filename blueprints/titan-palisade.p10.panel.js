// titan-palisade: one script flies a module and runs its turrets. A gun panel (role 0) and the keep (role 1, the main
// core) run the same code: titan-palisade.keep.js is the one to edit, and the generator
// (tournaments/gen/titan-palisade.mjs) copies it to every panel's file.
// - Flight is level: propellers hold the height and the tilt (the side groups `pa` and `pb` throttled apart, `pd`
//   pushing down on the keep), thrusters `ta` (toward the t1 guns' side) and `tb` (away) move it sideways. Left, right
//   and front are worked out from where the parts are, so it flies the same flipped.
// - The enemy's main robot is the one robot of the other side with id 1 or 2 (the two titans spawn first). While the
//   radar sees it, the panels hold a ring around it, `ring` meters off, panel `slot` at its own angle (low slots low);
//   Every few seconds a panel scans it: where its guns are, and
//   how far it reaches from its core. A ground robot with a tall mast gets the mast cut first (the cheapest band). Hidden (a jammer, smoke), they close to `near` meters of where it was last
//   seen (at first: the mirror of their own start) and blast that place for `fresh` seconds; with nothing there they
//   search: one over the other, walking to the enemy's end with the batteries sweeping. Every gun blasts whenever its
//   own sight reads an enemy, and a sight that reads the main robot (sightId 1 or 2) gives its place.
// - Batteries take the main robot when it is in reach: its guns first, one after another (25 health each, and they
//   are what hurts), then its core. Else the nearest enemy they can swing to. The keep's guns take the nearest.
//   Aim leads the target and allows for the drop.
// - The last `guards` panels stay by the keep (the friend with id 1 or 2) and blast whatever comes near it.
// - The keep fires every link on the first ticks, then waits at its own end of the arena, high up. From a heavy main
//   robot (a ram) it runs: away along the arena, and near the end, or with the ram close, it steps over or under it
//   (whichever has room) and runs the other way.
const role = param('role', 0, { min: 0, max: 1 });
const slot = param('slot', 0, { min: 0, max: 100 });
const count = param('count', 12, { min: 1, max: 100 });
const ring = param('ring', 200, { min: 20, max: 290 }); // m from the enemy's main core while it is seen
const near = param('near', 110, { min: 20, max: 290 }); // m from the place it was last seen while it is hidden
const gap = param('gap', 24, { min: 5, max: 100 }); // m between neighbors along the ring
const floor = param('floor', 50, { min: 5, max: 200 }); // m: no slot is lower
const reach = param('reach', 285, { min: 1, max: 300 }); // m: a shell lives 1 s
const vmax = param('vmax', 32, { min: 1, max: 80 }); // m/s sideways
const keepY = param('keepY', 215, { min: 10, max: 240 }); // m: where the keep waits (it loses above 250)
const edge = param('edge', 860, { min: 0, max: 990 }); // m from the middle: as far as the keep runs from a ram (it loses past 1000)
const park = param('park', 800, { min: 0, max: 990 }); // m from the middle: where the keep waits with no ram about
const keepSpeed = param('keepSpeed', 75, { min: 1, max: 100 }); // m/s, the keep's fastest
const ram = param('ram', 1500, { min: 0, max: 1000000 }); // kg: a main robot this heavy is run from, and ringed on both sides
const clearance = param('clearance', 40, { min: 5, max: 150 }); // m the keep wants between itself and a ram's top or bottom
const tall = param('tall', 70, { min: 10, max: 1000 }); // m: a ground robot reaching this far over its core has a mast to cut
const cutMax = param('cutMax', 15000, { min: 0, max: 1000000 }); // the most a band may cost to be cut (health times 4 for frames, 10 for plates)
const rescan = param('rescan', 3, { min: 0.5, max: 60 }); // s between scans of the main robot
const fresh = param('fresh', 8, { min: 0, max: 100 }); // s a sighting of the hidden main robot is trusted
const wait = param('wait', 5, { min: 0, max: 100 }); // s in place with nothing seen before a search
const pace = param('pace', 12, { min: 1, max: 40 }); // m/s of a search
const debug = param('debug', 0, { min: 0, max: 1 });
const guards = param('guards', 2, { min: 0, max: 100 }); // panels that stay by the keep while no ram is about
const guard = role < 0.5 && slot >= count - guards;
const HALF = Math.PI / 2;
const SHELL = 300;
const G = 9.81;

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
  let npd = 0;
  let ax = 0;
  let na = 0;
  let nta = 0;
  let ntb = 0;
  const byName = {};
  const turrets = [];
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    inertia += p.mass * (dx * dx + dy * dy);
    const bx = dx * ca + dy * sa;
    if (p.type === 'propeller') {
      if (p.tags.includes('pd')) {
        npd++;
        continue;
      }
      nprop++;
      s1 += bx;
      s2 += Math.abs(bx);
      if (p.tags.includes('pa')) {
        ax += bx;
        na++;
      }
    } else if (p.type === 'thruster') {
      if (p.tags.includes('ta')) nta++;
      else if (p.tags.includes('tb')) ntb++;
    } else if (p.type === 'gun' || p.type === 'rotator') {
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
  state.npd = npd;
  state.sa = na > 0 && ax < 0 ? -1 : 1;
  state.nta = nta;
  state.ntb = ntb;
  state.turrets = turrets;
}

function setup() {
  state.home = { x: self.pos.x, y: self.pos.y };
  state.last = undefined;
  state.seen = undefined;
  state.stale = 0;
  state.sx = undefined;
  state.mode = 3;
  state.ticks = 0;
  state.guns = [];
  state.ext = undefined;
  state.scanAt = -100;
  state.gunsLeft = -1;
  state.same = 0;
  state.run = 0;
  state.pass = 0;
  state.ram = false;
  index();
  if (state.facing === undefined) state.facing = self.pos.x < 0 ? 1 : -1;
}

/** Level flight toward (wx, wy), at most `top` m/s sideways; `agile` lets it climb and drop as hard as it can. */
function fly(wx, wy, top, agile) {
  const brake = agile ? 8 : 3; // the stop it plans on, twice its braking in m/s^2
  const m = state.m;
  const th = self.angle;
  const lift = 120 * state.nprop;
  const lim = agile ? 60 : 12;
  const ey = clamp(wy - self.pos.y, -lim, lim);
  const ay = agile ? clamp(3 * ey - 3.5 * self.vel.y, -40, 40) : 2.25 * ey - 3 * self.vel.y;
  const need = m * (G + ay);
  let u = lift > 0 ? need / (lift * Math.max(0.5, Math.cos(th))) : 0;
  if (state.npd > 0) set('pd', 'throttle', need < 0 ? clamp(-need / (120 * state.npd), 0, 1) : 0);
  u = clamp(u, 0.05, 0.92);
  const tq = 120 * state.s2;
  let d = tq > 0 ? (state.inertia * (-6.25 * th - 5 * self.angVel)) / tq - (u * state.s1) / state.s2 : 0;
  d = clamp(d, -0.7, 0.7) * state.sa;
  set('pa', 'throttle', clamp(u + d, 0, 1));
  set('pb', 'throttle', clamp(u - d, 0, 1));
  const ex = wx - self.pos.x;
  const wantV = sign(ex) * Math.min(top, Math.sqrt(brake * Math.abs(ex)), 2 * Math.abs(ex));
  const f = m * 2 * (wantV - self.vel.x) * state.facing;
  set('ta', 'throttle', state.nta > 0 ? clamp(f / (160 * state.nta), 0, 1) : 0);
  set('tb', 'throttle', state.ntb > 0 ? clamp(-f / (160 * state.ntb), 0, 1) : 0);
}

/** Scans the main robot: where its guns sit from its core, and how far it reaches from its core each way. */
function study(main) {
  state.scanAt = time;
  const list = scan(main.id);
  if (!list) return;
  const guns = [];
  let hx = 0;
  let topY = 0;
  let botY = 0;
  const cx = main.pos.x;
  const cy = main.pos.y;
  for (const p of list) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    if (dx > hx) hx = dx;
    else if (-dx > hx) hx = -dx;
    if (dy > topY) topY = dy;
    else if (dy < botY) botY = dy;
    if (p.type === 'gun' && guns.length < 200) guns.push({ dx, dy });
  }
  state.ext = { hx, top: topY, bot: botY };
  if (topY > tall && cy + botY < 8) {
    // A tall mast on a ground robot sweeps the whole sky: cut it. The 6 m band that takes the fewest shells to
    // clear, between 30 m up and 20 m under its top, is what the batteries blast until the top comes off.
    const cost = [];
    for (const p of list) {
      const dy = p.pos.y - cy;
      if (dy < 30 || dy > topY - 20) continue;
      const b = Math.floor(dy / 6);
      cost[b] = (cost[b] || 0) + p.health * (p.type === 'armorplate' ? 10 : p.type === 'frame' ? 4 : 1);
    }
    let best = -1;
    for (let b = 5; b < cost.length; b++) if (cost[b] > 0 && (best < 0 || cost[b] < cost[best])) best = b;
    // Only a band worth cutting (a spar of frames; a mast of plates would take all match): else its guns.
    if (best >= 0 && cost[best] < cutMax) {
      guns.length = 0;
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
  // Guns that never go down are behind something: after three scans with none lost, go for the core.
  state.same = guns.length === state.gunsLeft ? state.same + 1 : 0;
  state.gunsLeft = guns.length;
  state.guns = state.same >= 3 ? [] : guns;
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
    const n = state.guns.length;
    if (n > 0) {
      const k = e.n * 7 + slot * 3 + Math.floor(time / 1.2);
      for (let i = 0; i < 3 && !found; i++) {
        const g = state.guns[(k + i * 5) % n];
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
      if (o.sightId <= 2 && !main) {
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

/** The keep's flight. */
function keepFlight(main) {
  const end = state.home.x !== 0 ? sign(state.home.x) : -state.facing;
  if (time < 3) {
    // First clear of the column of panels it was bolted under: back and down.
    fly(state.home.x + end * 150, state.home.y - 30, keepSpeed, true);
    return;
  }
  if (!main || !state.ram) {
    // Nothing that rams: wait toward its own end, high up, with room behind it (a bump past x 1000 is a loss).
    state.run = 0;
    fly(end * park, keepY, keepSpeed, true);
    return;
  }
  // A ram. Run from it along the arena; near the end, or with it close, step over or under it and run back.
  const ext = state.ext || { hx: 40, top: 25, bot: -25 };
  const side = self.pos.x >= main.pos.x ? 1 : -1; // which side of it the keep is on
  const open = Math.abs(self.pos.x - main.pos.x) - ext.hx; // m of air between them, sideways
  if (state.run === 0) state.run = side;
  const topY = main.pos.y + ext.top;
  const botY = main.pos.y + ext.bot;
  const over = topY + clearance;
  const under = botY - clearance;
  const canOver = over < 238;
  const canUnder = under > 14;
  if (state.pass === 0) {
    const cornered = self.pos.x * state.run > edge - 220;
    if (state.run !== side) state.run = side; // it got past: the other way is now away
    else if (botY < 8 && !canOver) state.pass = 0; // no way past a mast: run, and let the batteries cut it
    else if ((cornered && open < 520) || open < 150) {
      // Take the way with more room; over a robot on the ground, always over.
      state.pass = canOver && (!canUnder || 238 - over >= under - 14) ? 1 : -1;
    }
  }
  let wy;
  let wx = state.run * edge;
  if (state.pass !== 0) {
    wy = state.pass > 0 ? Math.min(240, over + 8) : Math.max(12, under - 8);
    const clear = state.pass > 0 ? self.pos.y > over - 12 : self.pos.y < under + 12;
    // Once clear of its height, cross to its other side; until then keep running.
    if (clear) wx = -state.run * edge;
    if (side !== state.run && open > 30) {
      // Across: that side is now away.
      state.run = side;
      state.pass = 0;
    }
  } else {
    // Running: stay well off its height, on the side with more room; over a ground robot always high (a mast that
    // reaches the ceiling is lighter up there than its hull is down here).
    if (botY < 8) wy = canOver ? Math.min(236, over + 30) : 228;
    else wy = canOver && (238 - over >= under - 14 || !canUnder) ? Math.min(236, over + 30) : Math.max(14, under - 30);
  }
  fly(wx, clamp(wy, 12, 240), keepSpeed, true);
}

function tick() {
  state.ticks++;
  if (role > 0.5 && state.ticks <= 3) set('decoupler', 'fire', 1);
  if (parts.length !== state.n) index();
  // What the radar shows: the main robot, and the nearest few in reach.
  let main = null;
  let mine = null;
  const list = [];
  for (const c of contacts) {
    if (c.side === 'friend' && c.id <= 2) mine = c;
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id <= 2) main = c;
    if (c.distance < 300 && list.length < 8) list.push(c);
  }
  if (main) {
    // A ram is a heavy main robot that moves; one that sits still (a fortress) is not run from.
    if (!state.ram && main.mass >= ram && Math.hypot(main.vel.x, main.vel.y) > 10) state.ram = true;
    state.last = { x: main.pos.x, y: main.pos.y };
    state.seen = time;
    state.stale = 0;
    state.sx = undefined;
    if (time - state.scanAt > rescan + 0.13 * slot && (role > 0.5 ? state.ram : main.distance < reach + 150)) study(main);
  }
  // 0 the radar sees the main robot, 1 hidden but seen or hit in the last `fresh` s, 2 searching, 3 on the way.
  state.mode = main ? 0 : state.seen !== undefined && time - state.seen < fresh ? 1 : state.stale > wait ? 2 : 3;
  const spot = state.last || { x: -state.home.x, y: 75 };

  if (role > 0.5) keepFlight(main);
  else {
    let wx;
    let wy;
    if (state.mode === 2) {
      // Search: the panels line up one over the other and walk toward the enemy's end, sights sweeping ahead.
      // At the end they start again from their own half.
      if (state.sx === undefined) state.sx = self.pos.x;
      state.sx += state.facing * pace * dt;
      if (state.sx * state.facing > 930) state.sx = -state.facing * 200;
      wx = state.sx;
      wy = floor + slot * gap;
    } else {
      const r = main ? ring : near;
      const step = gap / r;
      // Around a ram: both sides (even slots this side, odd slots the far side), and never under its top.
      const both = false; // two-sided rings need guns on both faces; the panels have them on one
      const rank = both ? Math.floor(slot / 2) : slot;
      const ranks = both ? Math.ceil(count / 2) : count;
      const far = both && slot % 2 === 1 ? -1 : 1;
      let low = floor;
      const grounded = both && state.ext && spot.y + state.ext.bot < 6;
      // Over a ground robot's top, unless it has a mast (nothing gets over that: the batteries cut it instead).
      if (grounded && state.ext.top <= tall) low = Math.max(floor, spot.y + state.ext.top + 25);
      let a0 = -0.5 * (ranks - 1) * step;
      if (spot.y + r * Math.sin(a0) < low) a0 = Math.asin(clamp((low - spot.y) / r, -1, 1));
      let a = a0 + rank * step;
      if (both && state.ext && !grounded) {
        // A flying ram: out of the line it flies along, ranks by turns over and under its height.
        const out = Math.asin(clamp((Math.max(state.ext.top, -state.ext.bot) + 30) / r, 0, 0.9));
        const k = Math.floor(rank / 2);
        a = rank % 2 === 0 ? out + k * step : -(out + k * step);
        if (spot.y + r * Math.sin(a) < floor) a = out + (k + Math.ceil(ranks / 2)) * step;
      }
      let rr = r;
      if (a > 1.3) {
        rr = r + 26 * Math.ceil((a - 1.3) / step);
        a = 1.3;
      }
      wx = spot.x - far * state.facing * rr * Math.cos(a);
      wy = Math.max(low, spot.y + rr * Math.sin(a));
      // In place with nothing seen: the wait before a search runs.
      if (!main && Math.abs(wx - self.pos.x) + Math.abs(wy - self.pos.y) < 40) state.stale += dt;
    }
    // The first seconds: hold where it woke, a little up, until the keep under the column is out of the way.
    if (time < 3.5) fly(state.home.x, state.home.y + 4, vmax, false);
    else if (guard && mine && !state.ram) {
      // The last `guards` panels stay by the keep, one over the other on the enemy's side of it.
      fly(mine.pos.x + state.facing * 45, mine.pos.y + 14 - 34 * (count - 1 - slot), 45, false);
    } else fly(wx, wy, vmax, false);
  }

  for (const e of state.turrets) runTurret(e, main, list, spot);
  if (debug > 0.5 && state.ticks % 120 === 0 && (role > 0.5 || slot === 3)) log(role > 0.5 ? 'keep' : 'panel', time.toFixed(0), 'at', self.pos.x.toFixed(0), self.pos.y.toFixed(0), 'main', main ? main.pos.x.toFixed(0) + ',' + main.pos.y.toFixed(0) : 'hidden', 'run', state.run, 'pass', state.pass, 'guns', state.guns.length);
}
