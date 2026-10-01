// titan-palisade: one script flies a module and runs its turrets. A gun panel (role 0) and the keep (role 1, the main
// core) run the same code: titan-palisade.keep.js is the one to edit, and the generator
// (tournaments/gen/titan-palisade.mjs) copies it to every panel's file.
// - Flight is level: propellers hold the height and the tilt (the side groups `pa` and `pb` throttled apart), thrusters
//   `ta` (toward the guns' side) and `tb` (away) move it sideways. Left, right and front are worked out from where the
//   parts are, so it flies the same flipped.
// - The enemy's main robot is the one robot of the other side with id 1 or 2 (the two titans spawn first). While the
//   radar sees it, the panels hold a ring around it, `ring` meters off, panel `slot` at its own angle (low slots low).
//   Hidden (a jammer, smoke), they close to `near` meters of where it was last seen (at first: the mirror of their own
//   start) and blast that place for `fresh` seconds; with nothing there they search: one over the other, walking to the
//   enemy's end with the batteries sweeping. Every gun blasts whenever its own sight reads an enemy, and a sight that
//   reads the main robot (sightId 1 or 2) gives its place.
// - Batteries (turrets t1 to t3) take the main robot when it is in reach, else the nearest enemy they can swing to.
//   The single guns, and every turret on the keep, take the nearest. Aim leads the target and allows for the drop.
// - The keep fires every link on the first ticks, then runs to its own end of the arena and waits there, high up.
const role = param('role', 0, { min: 0, max: 1 });
const slot = param('slot', 0, { min: 0, max: 100 });
const count = param('count', 12, { min: 1, max: 100 });
const ring = param('ring', 200, { min: 20, max: 290 }); // m from the enemy's main core while it is seen
const near = param('near', 110, { min: 20, max: 290 }); // m from the place it was last seen while it is hidden
const gap = param('gap', 24, { min: 5, max: 100 }); // m between neighbors along the ring
const floor = param('floor', 50, { min: 5, max: 200 }); // m: no slot is lower
const reach = param('reach', 285, { min: 1, max: 300 }); // m: a shell lives 1 s
const vmax = param('vmax', 32, { min: 1, max: 80 }); // m/s sideways
const keepY = param('keepY', 225, { min: 10, max: 240 }); // m: where the keep waits (it loses above 250)
const edge = param('edge', 962, { min: 0, max: 990 }); // m from the middle: where the keep waits (it loses past 1000)
const keepSpeed = param('keepSpeed', 60, { min: 1, max: 100 }); // m/s, the keep's run to its end
const debug = param('debug', 0, { min: 0, max: 1 }); // 1: panel 3 logs what it sees every 3 s
const fresh = param('fresh', 8, { min: 0, max: 100 }); // s a sighting of the hidden main robot is trusted
const wait = param('wait', 5, { min: 0, max: 100 }); // s in place with nothing seen before a search
const pace = param('pace', 12, { min: 1, max: 40 }); // m/s of a search
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
          e = byName[name] = { name, rot: null, guns: [], want: undefined, battery: role < 0.5 && name !== 't4' };
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
  index();
  if (state.facing === undefined) state.facing = self.pos.x < 0 ? 1 : -1;
}

/** Level flight toward (wx, wy). */
function fly(wx, wy, top) {
  const m = state.m;
  const th = self.angle;
  const lift = 120 * state.nprop;
  const ey = clamp(wy - self.pos.y, -12, 12);
  let u = lift > 0 ? (m * (G + 2.25 * ey - 3 * self.vel.y)) / (lift * Math.max(0.5, Math.cos(th))) : 0;
  u = clamp(u, 0.05, 0.92);
  const tq = 120 * state.s2;
  let d = tq > 0 ? (state.inertia * (-6.25 * th - 5 * self.angVel)) / tq - (u * state.s1) / state.s2 : 0;
  d = clamp(d, -0.7, 0.7) * state.sa;
  set('pa', 'throttle', clamp(u + d, 0, 1));
  set('pb', 'throttle', clamp(u - d, 0, 1));
  const ex = wx - self.pos.x;
  const wantV = sign(ex) * Math.min(top, Math.sqrt(3 * Math.abs(ex)), 2 * Math.abs(ex));
  const f = m * 2 * (wantV - self.vel.x) * state.facing;
  set('ta', 'throttle', state.nta > 0 ? clamp(f / (160 * state.nta), 0, 1) : 0);
  set('tb', 'throttle', state.ntb > 0 ? clamp(-f / (160 * state.ntb), 0, 1) : 0);
}

/** Where to point from (hx, hy) to hit `c`: its place after the shell's flight, raised by the shell's fall. */
function lead(c, hx, hy, out) {
  const rx = c.pos.x - hx;
  const ry = c.pos.y - hy;
  const vx = c.vel.x - self.vel.x;
  const vy = c.vel.y - self.vel.y;
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
const fires = [];

function runTurret(e, main, list, spot) {
  const g0 = e.guns[0];
  if (!g0 || !e.rot) return;
  const aim = g0.out.aim;
  const rest = aim - e.rot.out.angle * HALF;
  const hx = e.rot.pos.x;
  const hy = e.rot.pos.y;
  let found = false;
  let live = false;
  if (e.battery && main && main.distance < reach + 40) {
    lead(main, hx, hy, sol);
    if (Math.abs(wrap(sol.angle - rest)) < 1.5) found = live = true;
  }
  if (!found) {
    for (const c of list) {
      lead(c, hx, hy, sol);
      if (sol.dist < reach && Math.abs(wrap(sol.angle - rest)) < 1.5) {
        found = live = true;
        break;
      }
    }
  }
  if (!found && main) {
    lead(main, hx, hy, sol);
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
    // Nothing to aim at: sweep, straight ahead on a search, else around the place it was last known to be.
    const a = state.mode === 2 ? rest + 0.8 * Math.sin(1.5 * time + 0.7 * slot) : Math.atan2(spot.y - hy, spot.x - hx) + 0.45 * Math.sin(1.1 * time + 0.7 * slot);
    want = rest + clamp(wrap(a - rest), -1.45, 1.45);
  }
  const err = wrap(want - aim);
  const moving = found && e.want !== undefined ? wrap(want - e.want) / dt : 0;
  e.want = found ? want : undefined;
  set(e.name + '.rot', 'turn', clamp((moving + 6 * err) / 2, -1, 1));
  const on = live && sol.dist < reach && Math.abs(err) < Math.max(0.012, 1.2 / sol.dist);
  // Each gun goes by its own sight: an enemy on the line is always blasted, a friend or its own robot never.
  let sum = 0;
  const guns = e.guns;
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
    }
    else if (on && !((side === 1 || side === 2 || side === 5) && o.sight < sol.dist)) fire = 1;
    fires[i] = fire;
    sum += fire;
  }
  if (sum === 0 || sum === guns.length) set(e.name + '.gun', 'fire', sum > 0 ? 1 : 0);
  else for (let i = 0; i < guns.length; i++) set(guns[i].id, 'fire', fires[i]);
}

function tick() {
  state.ticks++;
  if (role > 0.5 && state.ticks <= 3) set('decoupler', 'fire', 1);
  if (parts.length !== state.n) index();
  // What the radar shows: the main robot, and the nearest few in reach.
  let main = null;
  const list = [];
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id <= 2) main = c;
    if (c.distance < 300 && list.length < 8) list.push(c);
  }
  if (main) {
    state.last = { x: main.pos.x, y: main.pos.y };
    state.seen = time;
    state.stale = 0;
    state.sx = undefined;
  }
  // 0 the radar sees the main robot, 1 hidden but seen or hit in the last `fresh` s, 2 searching, 3 on the way.
  state.mode = main ? 0 : state.seen !== undefined && time - state.seen < fresh ? 1 : state.stale > wait ? 2 : 3;
  const spot = state.last || { x: -state.home.x, y: 75 };

  if (role > 0.5) {
    // The keep: straight back to its own end of the arena and high, as far from everything as the bounds allow
    // (a main core past x 1000 or above y 250 has lost, so it stops short of both).
    const end = state.home.x !== 0 ? sign(state.home.x) : -state.facing;
    fly(end * edge, keepY, keepSpeed);
  } else {
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
      let a0 = -0.5 * (count - 1) * step;
      if (spot.y + r * Math.sin(a0) < floor) a0 = Math.asin(clamp((floor - spot.y) / r, -1, 1));
      let a = a0 + slot * step;
      let rr = r;
      if (a > 1.3) {
        rr = r + 26 * Math.ceil((a - 1.3) / step);
        a = 1.3;
      }
      wx = spot.x - state.facing * rr * Math.cos(a);
      wy = Math.max(floor, spot.y + rr * Math.sin(a));
      // In place with nothing seen: the wait before a search runs.
      if (!main && Math.abs(wx - self.pos.x) + Math.abs(wy - self.pos.y) < 40) state.stale += dt;
    }
    fly(wx, wy, vmax);
  }

  for (const e of state.turrets) runTurret(e, main, list, spot);
  if (debug > 0.5 && slot === 3 && role < 0.5 && state.ticks % 180 === 0) log('t', time.toFixed(0), 'main', main ? main.distance.toFixed(0) + ' m ' + main.parts + ' parts at ' + main.pos.x.toFixed(0) + ',' + main.pos.y.toFixed(0) : 'hidden', 'spot', spot.x.toFixed(0), spot.y.toFixed(0), 'me', self.pos.x.toFixed(0), self.pos.y.toFixed(0), 'near', list.length);
}
