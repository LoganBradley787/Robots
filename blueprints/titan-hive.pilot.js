// titan-hive pilot (titans tournament): one script flies the mother ship, runs its dart bays, and aims its turrets.
// No keys. Everything it knows comes from `contacts` (sides, never team numbers or a fixed direction), so it works
// as authored and deployed flipped.
// - Flight: holds `cruise` m up and `standoff` m to its own side of the heaviest enemy with a core (the main one),
//   leaning by throttling one wing more than the other (the flying silo's hover, with the body worked out every
//   `refresh` ticks instead of every tick: the ship has hundreds of parts). Over something heavy on the ground and
//   close it goes up to `high`; when something heavy closes fast in the air it goes over or under it (`low`, `high`).
//   It stays inside the arena (titans v2, 2026-10: read from the global `arena`, `edgeRoom` m inside its edge and
//   under its ceiling); with no arena (the open sandbox) within `roam` m of where it started.
// - Sandbox (titans v2): with no arena there is no match to plan its energy to. It keeps `reserve` s of hover back,
//   lands and sits with its propellers off when nothing has been seen for `restAfter` s or it is under that reserve,
//   and takes off again for a new enemy. After a win it goes after the next enemy with a live core.
// - What it fights with (titans v2): darts while it has bays and energy; with none, it closes to its turrets' reach;
//   with no turrets either it rams anything lighter than itself.
// - Hiding (round 2): two small bays on the middle block build jammer pods; the pilot lights them in turn, so the
//   core sits in a jammer bubble all match and no sensor sees the ship. Its own radars are at the far ends of the
//   hull, outside the bubble.
// - Bays: every fabricator bay with a tag starting `bay`. A finished dart is sent the main enemy's place, speed and
//   id and let go at once, at most one per `gap` s; every `spreadEvery`th goes to the nearest other enemy instead.
// - The main enemy (titan-darts, 2026-10, Logan): picked from what the radars report, by the situation, never by id:
//   the heaviest enemy with a live core of `followMass` kg or more (a titan over its darts and drones), kept while it
//   is seen unless one twice as heavy shows up, and given up the moment it dies. A robot that dies stays in the radar's
//   view as debris (no live core), so its death is seen: nothing more goes to its spot. One that vanished alive (into
//   a jammer's bubble or smoke, most likely) has its last place kept `memory` s, and darts go there; then it is
//   forgotten. Only while it has never seen an enemy at all does it send darts to the mirror of its own start (a titan
//   hidden from the first second is about there); after that, with nothing seen or remembered, it holds its darts.
//   A bay with a dart in it builds nothing, so the pilot holds its darts while the energy left is under what the
//   propellers need to hold the ship up to the end of the match (`match` s, `keep` times the hover's draw; in an arena
//   only): since armor plates weigh 20 kg the ship hovers on more power, and a full match of darts would leave it little.
// - Turrets: parts tagged `turN.rot` (rotator) and `turN.gun`. Each takes the nearest enemy it can swing to within
//   `track` m, leads it, and blasts within `reach` m while its sight shows nothing of ours in the way. It never
//   scans: a scan of a titan costs too much.

const cruiseAt = param('cruise', 222, { min: 20, max: 1000 }); // m, the height it holds (under the arena's ceiling less `cruiseRoom`)
const highAt = param('high', 238, { min: 20, max: 1000 }); // m, the height it takes over a ground enemy or to go over a ram (under the ceiling less `highRoom`)
const cruiseRoom = param('cruiseRoom', 28, { min: 0, max: 200 }); // m under the arena's ceiling it cruises at most
const highRoom = param('highRoom', 12, { min: 0, max: 200 }); // m under the ceiling it climbs at most
const low = param('low', 45, { min: 10, max: 200 }); // m, the height it takes to go under a ram
const standoff = param('standoff', 900, { min: 50, max: 1000 }); // m to the side of the main enemy
const groundShare = param('groundShare', 0.5, { min: 0.1, max: 1 }); // share of the arena's half width it keeps to against a ground enemy
const under = param('under', 0, { min: 0, max: 1000 }); // m sideways: a heavy ground enemy this close sends it up to `high`
const edgeRoom = param('edgeRoom', 120, { min: 0, max: 900 }); // m inside the arena's edge it never passes
const roam = param('roam', 1500, { min: 100, max: 100000 }); // m from where it started it keeps to with no arena (the open sandbox)
const maxSpeed = param('maxSpeed', 22, { min: 1, max: 60 }); // m/s sideways
const climb = param('climb', 10, { min: 1, max: 40 }); // m/s up or down
const lean = (param('lean', 30, { min: 0, max: 60 }) * Math.PI) / 180; // degrees it leans to fly sideways
const hardLean = (param('hardLean', 60, { min: 0, max: 80 }) * Math.PI) / 180; // degrees it leans when carried out past its place
const lift = param('lift', 120, { min: 10, max: 2000 }); // N, one propeller's full push
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its power it plans its braking on
const refresh = param('refresh', 120, { min: 1, max: 600 }); // ticks between working out the body again
const gap = param('gap', 0.15, { min: 0, max: 10 }); // s between two bays letting go
const level = (param('level', 33, { min: 1, max: 90 }) * Math.PI) / 180; // lets darts go only within this many degrees of level
const still = param('still', 12, { min: 0.1, max: 50 }); // m/s up or down: faster than this it holds its darts
const shake = param('shake', 1.5, { min: 0.1, max: 50 }); // m/s^2 sideways: speeding up or slowing harder than this it holds its darts
const spinHold = param('spinHold', 0.06, { min: 0.001, max: 5 }); // rad/s: turning faster than this it holds them too
const driftWait = param('driftWait', 3, { min: 0, max: 60 }); // s at most it holds them for those (held by speed, not its change, and with no cap, it held every dart 36 s while following a ram drone)
const spreadEvery = param('spreadEvery', 4, { min: 1, max: 100 }); // every this many darts, one goes to the nearest other enemy
const match = param('match', 240, { min: 0, max: 100000 }); // s, how long it must stay up in an arena (a match's length)
const keep = param('keep', 1.2, { min: 0, max: 10 }); // in an arena, darts are held under this many times the energy the hover needs to the end
const reserveS = param('reserve', 60, { min: 0, max: 3600 }); // s of hover kept back with no arena: enough to come down and go up again
const restAfter = param('restAfter', 20, { min: 1, max: 600 }); // s with no enemy seen or remembered before it lands to save energy
const floorShare = param('floorShare', 0.15, { min: 0, max: 1 }); // share of the reserve it keeps sitting (sensors and turrets)
const gunRange = param('gunRange', 0.85, { min: 0.1, max: 1 }); // share of `reach` it closes to when its turrets are all it has left
const holdMargin = param('holdMargin', 1.2, { min: 0.5, max: 2 }); // it leans no further than leaves this many times its weight in lift
const srcBack = param('srcBack', 0.3, { min: 0, max: 5 }); // s back along a new light enemy's path to where it came from
const srcMemory = param('srcMemory', 20, { min: 0, max: 300 }); // s that place is worth darts with nothing else seen
const threatRange = param('threatRange', 320, { min: 0, max: 1000 }); // m: enemies with a core this close are darted first
const kiteRange = param('kiteRange', 330, { min: 0, max: 1000 }); // m: enemies with a core this close make it run
const kiteSpeed = param('kiteSpeed', 55, { min: 1, max: 100 }); // m/s it runs at
const turnRoom = param('turnRoom', 150, { min: 0, max: 900 }); // m short of its edge it turns back
const runHold = param('runHold', 4, { min: 0, max: 60 }); // s it keeps running once nothing is close
const groundY = param('groundY', 35, { min: 0, max: 200 }); // m: an enemy core under this is on the ground
const touchReach = param('touchReach', 320, { min: 0, max: 1000 }); // m: a heavy enemy this close is scanned for what presses on it
const touchDist = param('touchDist', 90, { min: 0, max: 500 }); // m from its core: a part this close is the turrets' first target
const touchEvery = param('touchEvery', 0.5, { min: 0.05, max: 10 }); // s between those scans
const cutUnder = param('cutUnder', 28, { min: 0, max: 100 }); // m under its core it cuts a mast that presses on it (the belly is 9 m down; the belly turrets swing no closer than 76 degrees to level)
const srcSpeed = param('srcSpeed', 10, { min: 0, max: 200 }); // m/s: a new light enemy slower than this tells nothing of a launcher
const restHeight = param('restHeight', 9, { min: 1, max: 50 }); // m from its core down to the ground when it sits (the belly turrets are under it)
const propDraw = param('propDraw', 10, { min: 0, max: 1000 }); // J/s, one propeller at full push
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter enemies get no dart
const retreat = param('retreat', 100, { min: 0, max: 600 }); // m back from its start it waits with no enemy seen
const overlap = param('overlap', 2.4, { min: 0.5, max: 5 }); // s between one jammer bay's pod lighting and the other's
const burn = param('burn', 5.1, { min: 1, max: 10 }); // s after lighting a pod its bay is told to let go (a pod jams 5 s)
const followMass = param('followMass', 30, { min: 0, max: 100000 }); // kg: the main enemy is never lighter (darts, small drones)
const memory = param('memory', 15, { min: 0, max: 120 }); // s a main enemy that vanished alive is remembered and darts go to its last place
const lostAt = param('lostAt', 900, { min: 50, max: 2000 }); // m: one that vanished further off went out of the radars' reach and is forgotten
const heavyMass = param('heavyMass', 200, { min: 1, max: 100000 }); // kg: an enemy this heavy is flown around
const ramSpeed = param('ramSpeed', 14, { min: 1, max: 100 }); // m/s: a heavy flier closing faster than this is a ram
const reach = param('reach', 265, { min: 1, max: 300 }); // m: turrets blast within this
const track = param('track', 420, { min: 1, max: 1000 }); // m: turrets point at things within this
const shell = param('shell', 300, { min: 1, max: 5000 }); // m/s, a shell's speed
const gain = param('gain', 6, { min: 0.1, max: 50 }); // turret turn rate per radian off the aim
const size = param('size', 1.2, { min: 0.1, max: 10 }); // m off the aim point that still counts as on target
const clearPath = param('clearPath', 6, { min: 0, max: 50 }); // m: a friend this close to a turret's line holds its fire

const debug = param('debug', 0, { min: 0, max: 2 }); // 1 logs why darts go or wait every 2 s, 2 the hover's numbers once a second too
const along = (param('along', 76, { min: 10, max: 90 }) * Math.PI) / 180; // degrees off its built aim a turret may still blast
const g = 9.81;
const SWING = Math.PI / 2;
const RATE = 2;

/** What the ship's own parts are, found again when the part list changes: { props, bays, turrets, body numbers }. */
let C = null;

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function recache() {
  const c = Math.cos(self.angle);
  const s = Math.sin(self.angle);
  const props = [];
  const bays = [];
  const jbays = [];
  const pods = [];
  const byName = {};
  let mass = 0;
  let mu = 0;
  let mv = 0;
  let m2 = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const rx = p.pos.x - self.pos.x;
    const ry = p.pos.y - self.pos.y;
    const u = rx * c + ry * s;
    const v = -rx * s + ry * c;
    mass += p.mass;
    mu += p.mass * u;
    mv += p.mass * v;
    m2 += p.mass * (u * u + v * v + 1 / 6);
    const type = p.type;
    if (type === 'propeller') {
      const right = p.tags.indexOf('rprop') >= 0;
      if (right || p.tags.indexOf('lprop') >= 0) props.push({ i, p, u, right });
    } else if (type === 'fabbay') {
      for (const t of p.tags) {
        if (t.length !== 4) continue;
        if (t.indexOf('bay') === 0) bays.push({ i, p, tag: t });
        else if (t.indexOf('jam') === 0) jbays.push({ i, p, tag: t });
      }
    } else if (type === 'jammer') {
      pods.push(p);
    } else if (type === 'gun' || type === 'rotator') {
      for (const t of p.tags) {
        if (t.indexOf('tur') !== 0 || t.indexOf('.') < 0) continue;
        const name = t.slice(0, t.indexOf('.'));
        const e = byName[name] || (byName[name] = { name, st: (C && C.st[name]) || { id: 0, want: undefined, firing: false } });
        if (type === 'gun') {
          e.gun = p;
          e.gi = i;
        } else {
          e.rot = p;
          e.ri = i;
        }
      }
    }
  }
  const cu = mass > 0 ? mu / mass : 0;
  const cv = mass > 0 ? mv / mass : 0;
  const inertia = Math.max(1, m2 - mass * (cu * cu + cv * cv));
  let sum = 0;
  let split = 0;
  let right = 0;
  let left = 0;
  for (const e of props) {
    const u = e.u - cu;
    sum += u;
    split += e.right ? u : -u;
    if (u > 0) right += u;
    else left -= u;
  }
  const turrets = [];
  const st = {};
  for (const name in byName) {
    const e = byName[name];
    st[name] = e.st;
    if (e.gun && e.rot) turrets.push(e);
  }
  C = { n: parts.length, props, bays, jbays, pods, turrets, st, inertia, sum, split, right, left, at: frame };
}

/** True when the part list is no longer the one the cache was made from (a part lost, a dart built or let go). */
function stale() {
  if (!C || C.n !== parts.length || frame - C.at >= refresh) return true;
  for (const b of C.bays) if (parts[b.i] !== b.p) return true;
  for (const b of C.jbays) if (parts[b.i] !== b.p) return true;
  for (const t of C.turrets) if (parts[t.gi] !== t.gun || parts[t.ri] !== t.rot) return true;
  const ps = C.props;
  if (ps.length > 0 && (parts[ps[0].i] !== ps[0].p || parts[ps[ps.length - 1].i] !== ps[ps.length - 1].p)) return true;
  return false;
}

function setup() {
  state.home = { x: self.pos.x, y: self.pos.y };
  state.side = self.pos.x <= 0 ? -1 : 1; // which side of the arena it started on
  state.trim = 0;
  state.lastRel = -Infinity;
  state.slowAt = 0; // when it last flew steadily enough to let darts go
  state.pvx = 0; // last tick's sideways speed, and the sideways speeding up from it, smoothed
  state.ax = 0;
  state.sent = 0;
  state.mem = null; // the main enemy: { id, x, y, vx, vy, at, d }, its last place while seen, kept a while once it vanishes
  state.everSeen = false; // whether any enemy that could be the main one was ever seen
  state.dodge = 0;
  state.jam = {}; // jammer bay tag -> { lit: when its pod was lit (-1: none), wait: no sooner than this }
  state.lit = -Infinity;
  state.dodgeAt = -Infinity;
  state.busyAt = 0; // when it last had an enemy seen or remembered
  state.sitting = false; // landed with its propellers off (no arena only)
  state.runDir = 0; // kiting: 1 right, -1 left, 0 not
  state.runAt = -Infinity;
  state.touchScan = -Infinity; // the frame of the last scan for what presses on it
  state.touch = null; // the nearest part of a heavy enemy pressing on it: { x, y, d, at, id }
  state.ids = {}; // light enemies seen, by id: when first seen
  state.src = null; // where the last new light enemy came from: { x, y, at }
  recache();
}

/** Height and sideways speed: the hover. `wantY` m, `wantVx` m/s. */
function fly(wantY, wantVx, leanMax) {
  const n = C.props.length;
  const up = n * lift * Math.max(0.3, Math.cos(self.angle));
  const rise = Math.max(0.5, up / self.mass - g);
  const err = wantY - self.pos.y;
  const stop = err > 0 ? g : rise;
  const climbing = Math.sign(err) * Math.min(Math.sqrt(2 * margin * stop * Math.abs(err)), 3 * Math.abs(err), climb);
  const upward = clamp(5 * (climbing - self.vel.y), -g, rise);
  const throttle = clamp((self.mass * (g + upward)) / Math.max(up, 1e-9), 0, 1);

  // Never leaned past what still holds it up (titans v2, 2026-10): at 60 degrees its propellers lift half their push,
  // under its weight, so a hard lean against a push made it sink, under a ground enemy's mast, which swept it out.
  const holdUp = Math.acos(clamp((holdMargin * self.mass * g) / Math.max(n * lift, 1e-9), 0, 1));
  const tilt = Math.min(leanMax, holdUp);
  const want = clamp(0.05 * (self.vel.x - wantVx), -tilt, tilt);
  const off = want - self.angle;
  state.trim = clamp(state.trim + 0.05 * off * dt, -0.2, 0.2);
  const ccw = lift * C.right;
  const cw = lift * C.left;
  const stopping = off >= 0 ? cw : ccw;
  const spinUp = (margin * stopping) / C.inertia;
  const spin = Math.sign(off) * Math.min(Math.sqrt(2 * spinUp * Math.abs(off)), 4 * Math.abs(off));
  const torque = clamp((C.inertia * (spin - self.angVel)) / (6 * dt), -cw, ccw);
  let base = throttle;
  let diff = 0;
  for (let i = 0; i < 4; i++) {
    diff = (C.split !== 0 ? (torque - lift * base * C.sum) / (lift * C.split) : 0) + state.trim;
    const d = Math.abs(diff);
    base = d >= 0.5 ? 0.5 : clamp(throttle, d, 1 - d);
  }
  if (debug > 1.5 && frame % 60 === 0) log('y ' + self.pos.y.toFixed(0) + ' x ' + self.pos.x.toFixed(0) + ' wantY ' + wantY.toFixed(0) + ' wantVx ' + wantVx.toFixed(1) + ' thr ' + throttle.toFixed(2) + ' base ' + base.toFixed(2) + ' diff ' + diff.toFixed(2) + ' props ' + n + ' mass ' + self.mass.toFixed(0) + ' up ' + up.toFixed(0));
  set('lprop', 'throttle', clamp(base - diff, 0, 1));
  set('rprop', 'throttle', clamp(base + diff, 0, 1));
}

/** Where to point from (fx, fy) to hit `c`: its place after the shell's flight, raised by the shell's fall. */
function lead(c, fx, fy) {
  const rx = c.pos.x - fx;
  const ry = c.pos.y - fy;
  const vx = c.vel.x - self.vel.x;
  const vy = c.vel.y - self.vel.y;
  let t = Math.sqrt(rx * rx + ry * ry) / shell;
  let px = rx;
  let py = ry;
  for (let i = 0; i < 2; i++) {
    px = rx + vx * t;
    py = ry + vy * t;
    t = Math.sqrt(px * px + py * py) / shell;
  }
  return { angle: Math.atan2(py + 0.5 * g * t * t, px), distance: Math.sqrt(px * px + py * py) };
}

function aimTurret(t, foes, friends) {
  const st = t.st;
  const aim = t.gun.out.aim;
  const turned = t.rot.out.angle;
  const rest = aim - turned * SWING;
  const fx = t.gun.pos.x + 0.5 * Math.cos(aim);
  const fy = t.gun.pos.y + 0.5 * Math.sin(aim);
  let best = null;
  let bestD = Infinity;
  for (const c of foes) {
    const l = lead(c, fx, fy);
    if (Math.abs(wrap(l.angle - rest)) > SWING) continue;
    const d = l.distance - (c.id === st.id ? 10 : 0);
    if (d < bestD) {
      best = l;
      bestD = d;
      st.next = c.id;
    }
  }
  const gunTag = t.name + '.gun';
  const rotTag = t.name + '.rot';
  if (!best) {
    st.id = 0;
    st.want = undefined;
    st.firing = false;
    set(gunTag, 'fire', 0);
    set(rotTag, 'turn', clamp(-3 * turned, -1, 1));
    return;
  }
  if (st.next !== st.id) {
    st.id = st.next;
    st.want = undefined;
  }
  const want = best.angle;
  const moving = st.want === undefined ? 0 : wrap(want - st.want) / dt;
  st.want = want;
  const err = wrap(want - aim);
  set(rotTag, 'turn', clamp(moving / RATE + (gain * err) / RATE, -1, 1));
  const within = Math.max(0.012, Math.atan2(size, best.distance)) * (st.firing ? 2 : 1);
  let blocked = false;
  const side = t.gun.out.sightSide;
  if ((side === 1 || side === 2 || side === 5) && t.gun.out.sight < best.distance) blocked = true;
  if (!blocked) {
    const ux = Math.cos(want);
    const uy = Math.sin(want);
    for (const f of friends) {
      const rx = f.center.x - fx;
      const ry = f.center.y - fy;
      const along = rx * ux + ry * uy;
      if (along > 0 && along < best.distance && Math.abs(rx * uy - ry * ux) < clearPath) {
        blocked = true;
        break;
      }
    }
  }
  // Never along the hull: the next turret sits on that line, a little outside the sight's straight look.
  st.firing = Math.abs(err) < within && !blocked && best.distance <= reach && Math.abs(wrap(aim - rest)) < along;
  // Its own sight on an enemy part within reach (titans v2): it blasts whatever it aims at, seen or hidden (a sight is
  // not a sensor: a robot in a jammer's bubble still fills it).
  if (!st.firing && side === 3 && t.gun.out.sight <= reach && Math.abs(wrap(aim - rest)) < along) st.firing = true;
  set(gunTag, 'fire', st.firing ? 1 : 0);
}

/**
 * Jammer pods: a bay's held pod is lit where it sits (by its id: a held copy has no tag of ours), one bay at a time
 * `overlap` s apart, so a bubble always covers the core. A spent pod leaves its bay thinking it still holds one, so
 * `burn` s after lighting the bay is told to let go, and it builds the next.
 */
function jam() {
  for (const b of C.jbays) {
    const j = state.jam[b.tag] || (state.jam[b.tag] = { lit: -1, wait: 0 });
    if (time < j.wait || !(b.p.out.ready > 0)) continue;
    if (j.lit < 0) {
      if (time - state.lit < overlap) continue;
      let any = false;
      for (const p of C.pods) {
        if (Math.abs(p.pos.x - b.p.pos.x) < 1.5 && Math.abs(p.pos.y - b.p.pos.y) < 2.5) {
          set(p.id, 'ignite', 1);
          any = true;
        }
      }
      if (any) {
        j.lit = time;
        state.lit = time;
      }
    } else if (time - j.lit > burn) {
      set(b.tag, 'release', 1);
      j.lit = -1;
      j.wait = time + 0.3;
    }
  }
}

function tick() {
  if (stale()) recache();
  jam();

  // One pass over what the radars see: the main enemy, what the turrets may take, and friends near their lines.
  let heaviest = null;
  let kept = null;
  let gone = false; // the remembered main enemy is in view as debris: it died
  const mem = state.mem;
  const foes = [];
  const friends = [];
  for (const c of contacts) {
    if (mem && c.id === mem.id && (c.side !== 'enemy' || !c.core)) gone = true;
    if (c.side === 'enemy') {
      if (!c.core) continue;
      if (c.mass >= followMass) {
        if (mem && c.id === mem.id) kept = c;
        if (!heaviest || c.mass > heaviest.mass) heaviest = c; // nearest first, so a tie goes to the nearer
      } else if (state.ids[c.id] === undefined && c.vel.x * c.vel.x + c.vel.y * c.vel.y > srcSpeed * srcSpeed) {
        // A light enemy seen for the first time (titans v2, 2026-10): just let go, or just out of a jammer's bubble
        // (30 m), so where it came from is close by. A robot that hides its core in bubbles is found by its darts.
        // Only a moving one: pieces of a broken robot lying about are not darts on their way.
        state.ids[c.id] = time;
        state.src = { x: c.pos.x - c.vel.x * srcBack, y: Math.max(1, c.pos.y - c.vel.y * srcBack), at: time };
      }
      if (c.distance <= track && foes.length < 12) foes.push(c);
    } else if (c.side === 'friend' && c.distance < 170 && friends.length < 10) friends.push(c);
  }
  const main = kept && !(heaviest && heaviest.mass > 2 * kept.mass) ? kept : heaviest;
  if (main && (!mem || mem.id !== main.id)) log('main enemy: robot ' + main.id + ', ' + main.mass.toFixed(0) + ' kg, ' + main.distance.toFixed(0) + ' m off');
  if (main) {
    state.mem = { id: main.id, x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, at: time, d: main.distance };
    state.everSeen = true;
  } else if (mem && (gone || time - mem.at > memory || mem.d > lostAt)) {
    state.mem = null;
  }
  const last = state.mem;
  if (frame % 600 === 0) for (const id in state.ids) if (time - state.ids[id] > 120) delete state.ids[id];
  // Where enemy darts come from, while nothing heavier is seen or remembered: their launcher is about there.
  const src = !main && !last && state.src && time - state.src.at < srcMemory ? state.src : null;

  // The ground it keeps to (titans v2, 2026-10): inside the arena's edge and under its ceiling when there is one (the
  // global `arena`), else `roam` m either side of where it started, so in the open sandbox it never runs off for good.
  const midX = arena ? 0 : state.home.x;
  const half = arena ? Math.max(50, arena.x - edgeRoom) : roam;
  const groundHalf = arena ? Math.max(50, arena.x * groundShare) : roam;
  const ceil = arena ? arena.y : Infinity;
  const cruise = Math.min(cruiseAt, ceil - cruiseRoom);
  const high = Math.min(highAt, ceil - highRoom);

  // Energy (titans v2). Its weight over a propeller's push is how many run at full, each drawing `propDraw`.
  // - In an arena a match has an end: darts are held while what is left is under what the hover needs to the end
  //   (`match` s, `keep` times the hover's draw), as before.
  // - With no arena there is no end to plan to. What a flier must never do is run dry in the air, so it keeps
  //   `reserve` s of hover back: enough to come down and go up again for the next enemy. Over that, energy is for
  //   darts. Under it, and with nothing to fight for `restAfter` s, it lands and sits with its propellers off, which
  //   costs nothing; it takes off again when an enemy shows up, if it has the reserve. Sitting, it lets darts go down
  //   to `floorShare` of the reserve (the radars and turrets still need some), since sitting costs no lift.
  const hoverDraw = ((self.mass * g) / lift) * propDraw;
  const stored = self.energy.stored;
  const reserve = reserveS * hoverDraw;
  if (main || last || src) state.busyAt = time;
  const wantRest = !arena && (time - state.busyAt > restAfter || stored < reserve);
  if (!wantRest) state.sitting = false;
  let spare;
  if (arena) spare = stored >= keep * hoverDraw * Math.max(0, match - self.age);
  else spare = stored >= (state.sitting ? floorShare * reserve : reserve);
  if (!spare && !state.saving) log('low on energy: holding the darts' + (arena ? ' to stay up' : ''));
  state.saving = !spare;

  // What it still fights with (titans v2): darts while it has bays and energy for them, else its turrets, which reach
  // only `reach` m, so it closes to `gunRange` of that. With neither it rams what is lighter than itself and keeps
  // its distance from the rest.
  const darts = C.bays.length > 0 && spare;
  const guns = C.turrets.length > 0;

  // Where to be.
  let wantY = cruise;
  // With nothing to fight it waits `retreat` m back from its start, until it has seen an enemy. After that (a win,
  // or one that went quiet) it waits over the middle of the arena (titans v2, 2026-10): radars reach 1000 m, so from
  // there they see the whole arena, and a new enemy anywhere in it is found.
  let wantX = arena && state.everSeen ? midX : state.home.x + state.side * retreat;
  let ram = false;
  if (main && main.mass >= followMass) {
    const dx = main.pos.x - self.pos.x;
    const dy = main.pos.y - self.pos.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const mySide = Math.abs(dx) > 5 ? -Math.sign(dx) : state.side;
    // A ground enemy can drive under it, and a stream of shells pushes: it keeps further from the edges then, so
    // there is room before the push carries it out.
    const limit = main.pos.y < groundY ? groundHalf : half;
    let off = standoff;
    if (!darts && guns) off = gunRange * reach;
    // Ramming only what is lighter, and only when it is alone: through a ring of guns it would only be taken apart.
    let others = 0;
    for (const c of foes) if (c !== main && c.mass >= followMass && c.distance <= kiteRange) others++;
    ram = !darts && !guns && main.mass < self.mass && others === 0;
    wantX = ram ? main.pos.x : clamp(main.pos.x + mySide * off, midX - limit, midX + limit);
    if (ram) wantY = Math.max(main.pos.y, (state.ground || 0) + restHeight + 3); // level with it, never into the ground
    else if (main.mass >= heavyMass) {
      // Its own speed at us, not ours at it (titans v2): kiting at 50 m/s past something, it is not being rammed.
      const closing = -(dx * main.vel.x + dy * main.vel.y) / dist;
      if (main.pos.y < groundY) {
        if (Math.abs(dx) < under) wantY = high;
      } else if (closing > ramSpeed && dist < 650) {
        if (!state.dodge) state.dodge = main.pos.y + main.vel.y * Math.min(dist / closing, 6) >= self.pos.y ? -1 : 1;
        state.dodgeAt = time;
      }
    }
  }
  if (state.dodge && time - state.dodgeAt > 2.5) state.dodge = 0;
  if (state.dodge && !ram) wantY = state.dodge > 0 ? high : low;
  // Kiting (titans v2, 2026-10): with enemies that have a core and some weight within `kiteRange` m (their guns reach
  // about 290 m), it does not hold its place and wait to be taken apart: it runs along the ground it keeps to, at up to
  // `kiteSpeed` m/s (its push over drag allows about 90 m/s at its steepest lean; gun panels fly 32 m/s), away from
  // them, and turns back past them `turnRoom` m short of the edge. Darts still go while it runs. Measured against the
  // gun wall: it lived to 165 s, not 66, but turning back through the ring of panels cost it every bay in 5 s.
  let speedCap = maxSpeed;
  let near = 0;
  let nearX = 0;
  if (!ram) {
    for (const c of foes) {
      // Fliers only: a ground robot cannot be passed over (a mast may reach the ceiling), so running to the edge from one
      // ends pinned there. Over one it holds its height instead.
      if (c.mass < followMass || c.distance > kiteRange || c.pos.y < groundY) continue;
      near++;
      nearX += c.pos.x;
    }
  }
  if (near > 0) {
    const lo = midX - half;
    const hi = midX + half;
    let dir = state.runDir || (self.pos.x >= nearX / near ? 1 : -1);
    if (dir > 0 && hi - self.pos.x < turnRoom) dir = -1;
    else if (dir < 0 && self.pos.x - lo < turnRoom) dir = 1;
    if (dir !== state.runDir) log('kiting ' + (dir > 0 ? 'right' : 'left') + ' from ' + near + ' close enemies');
    state.runDir = dir;
    state.runAt = time;
    wantX = dir > 0 ? hi : lo;
    speedCap = kiteSpeed;
  } else if (state.runDir && time - state.runAt > runHold) state.runDir = 0;
  else if (state.runDir) {
    wantX = state.runDir > 0 ? midX + half : midX - half;
    speedCap = kiteSpeed;
  }
  if (!main && src) wantX = src.x + (Math.abs(src.x - self.pos.x) > 5 ? -Math.sign(src.x - self.pos.x) : state.side) * standoff;
  wantX = clamp(wantX, midX - half, midX + half);
  if (wantRest) {
    // Down to the ground: where the belly turrets' sights meet it (pointing down at rest), else y 0.
    let ground = state.ground === undefined ? 0 : state.ground;
    for (const t of C.turrets) {
      const o = t.gun.out;
      if (o.sightSide === 5 && Math.sin(o.aim) < -0.9) ground = t.gun.pos.y - o.sight;
    }
    state.ground = ground;
    wantX = self.pos.x;
    wantY = ground + restHeight - 1;
    if (self.pos.y - ground < restHeight + 1.5 && Math.abs(self.vel.y) < 1) {
      if (!state.sitting) log('sitting down to save energy');
      state.sitting = true;
    }
  }
  if (state.sitting) {
    set('lprop', 'throttle', 0);
    set('rprop', 'throttle', 0);
  } else {
    // Carried outward past its place (a stream of shells pushes, a ram shoves): lean much harder to get back. While it
    // is pushed up it needs little lift, so only a steep lean gives it sideways push.
    const carried = Math.abs(self.pos.x - midX) > Math.abs(wantX - midX) + 25 && (self.pos.x - midX) * self.vel.x > 0;
    fly(wantY, clamp(0.3 * (wantX - self.pos.x), -speedCap, speedCap), carried || speedCap > maxSpeed ? hardLean : lean);
  }

  // Bays: let a finished dart go at the main enemy (or the place it should be).
  // Not while climbing or sinking: a dart levels off right over the bays, and a rising ship would fly up into it.
  // Not while sliding sideways either (titan-darts, 2026-10): a dart starts with the ship's speed, across the line it
  // climbs out on, and drifts into the bay walls and the darts let go beside it. But for `driftWait` s at most.
  // Titans v2 (2026-10): what matters is not the speed but its change. A dart leaves with the ship's speed, so on a ship
  // flying steadily at 50 m/s it rises straight out of its bay; on one speeding up, slowing or turning the walls move
  // into it (the hollow is as wide as the dart). So it holds while the ship speeds up or slows by more than `shake`
  // m/s^2 sideways or turns faster than `spinHold`, still for `driftWait` s at most.
  // Not while short of energy (above).
  state.ax += 0.2 * ((self.vel.x - state.pvx) / dt - state.ax);
  state.pvx = self.vel.x;
  if (Math.abs(state.ax) < shake && Math.abs(self.angVel) < spinHold) state.slowAt = time;
  const held = time - state.slowAt; // 0 while steady
  const steady = Math.abs(self.vel.y) < still && (held < 0.5 * dt || held > driftWait);
  // Somewhere to send it: the main enemy, its last place for a while after it vanished, or (nothing ever seen) the
  // mirror of its own start (only in an arena: its middle is x 0; titans v2). With none of those it holds its darts.
  const someplace = main || last || src || (arena && !state.everSeen);
  if (debug > 0.5 && frame % 120 === 0) log('darts: spare ' + spare + ' place ' + !!someplace + ' tilt ' + (self.angle * 57.3).toFixed(0) + ' vx ' + self.vel.x.toFixed(1) + ' vy ' + self.vel.y.toFixed(1) + ' steady ' + steady + ' bays ' + C.bays.length + ' energy ' + (stored / 1000).toFixed(0) + 'k' + (main ? ' main ' + main.id + ' at ' + main.pos.x.toFixed(0) + ',' + main.pos.y.toFixed(0) : '') + (src ? ' darts from ' + src.x.toFixed(0) + ',' + src.y.toFixed(0) : ''));
  if (spare && someplace && time - state.lastRel >= gap && Math.abs(self.angle) < level && steady) {
    // The bay nearest the target goes first, so a dart never turns across one let go just before it.
    const toRight = (main ? main.pos.x : last ? last.x : src ? src.x : -state.home.x) >= self.pos.x;
    const order = C.bays.slice().sort((p, q) => (toRight ? q.p.pos.x - p.p.pos.x : p.p.pos.x - q.p.pos.x));
    for (const b of order) {
      if (!(b.p.out.ready > 0)) continue;
      let msg;
      const clear = 30 + 8 * (state.sent % 5); // m straight up before it turns: neighbors turn at different heights
      let t = main;
      // Close threats first (titans v2, 2026-10): robots with a core and some weight within `threatRange` m are the ones
      // whose guns reach it (a ring of gun panels while their keep waits far off). The nearest few take turns; every
      // `spreadEvery`th dart still goes to the main enemy.
      let threats = 0;
      for (const c of foes) if (c !== main && c.mass >= followMass && c.distance <= threatRange && threats < 3) threats++;
      if (threats > 0 && (!main || state.sent % spreadEvery !== spreadEvery - 1)) {
        let k = state.sent % threats;
        for (const c of foes) {
          if (c === main || c.mass < followMass || c.distance > threatRange) continue;
          if (k-- === 0) {
            t = c;
            break;
          }
        }
      } else if (state.sent % spreadEvery === spreadEvery - 1) {
        for (const c of foes) {
          if (c !== main && c.mass >= minMass) {
            t = c;
            break;
          }
        }
      }
      if (t && t.mass >= minMass) msg = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc: 0, clear, lvx: self.vel.x, lvy: self.vel.y };
      else if (last) {
        // Where it was last seen, carried on by its speed for a moment (a mover is not where it vanished for long).
        const age = Math.min(time - last.at, 2);
        msg = { x: last.x + last.vx * age, y: Math.max(1, last.y + last.vy * age), vx: 0, vy: 0, arc: 0, clear, lvx: self.vel.x, lvy: self.vel.y };
      } else if (src) msg = { x: src.x, y: src.y, vx: 0, vy: 0, arc: 0, clear, lvx: self.vel.x, lvy: self.vel.y };
      else msg = { x: -state.home.x, y: [5, 80, 150][state.sent % 3], vx: 0, vy: 0, arc: 0, clear, lvx: self.vel.x, lvy: self.vel.y };
      send(b.tag + b.p.out.built, msg);
      set(b.tag, 'release', 1);
      state.lastRel = time;
      state.sent++;
      break;
    }
  }

  // Turrets.
  // What is pressing on it (titans v2, 2026-10): a heavy enemy close by is scanned for its few parts nearest the
  // ship's core every `touchEvery` s, and the nearest becomes the turrets' nearest target: a ground sled's mast poking
  // up through the hull pushed the ship out of the arena while the turrets aimed at its core on the ground.
  if (main && main.mass >= heavyMass && main.distance < touchReach && frame - state.touchScan >= touchEvery / dt) {
    state.touchScan = frame;
    const was = state.touch;
    state.touch = null;
    const ps = scan(main.id, { near: { x: self.pos.x, y: self.pos.y }, most: 3 });
    if (ps) {
      for (const p of ps) {
        const d = Math.hypot(p.pos.x - self.pos.x, p.pos.y - self.pos.y);
        if (d < touchDist && (!state.touch || d < state.touch.d)) state.touch = { x: p.pos.x, y: p.pos.y, d, at: time, id: main.id };
      }
    }
    // Pressed by something that reaches up past the belly (a mast): aim at it just under the belly instead, where
    // cutting it across lets everything above fall away, not level with the core, where there is only more of it.
    if (state.touch && was && Math.abs(state.touch.x - was.x) < 15) {
      const cut = scan(main.id, { near: { x: state.touch.x, y: self.pos.y - cutUnder }, most: 1 });
      if (cut && cut.length > 0 && Math.abs(cut[0].pos.x - state.touch.x) < 10 && cut[0].pos.y < self.pos.y - cutUnder + 8) {
        state.touch.x = cut[0].pos.x;
        state.touch.y = cut[0].pos.y;
        state.touch.d = Math.hypot(cut[0].pos.x - self.pos.x, cut[0].pos.y - self.pos.y);
      }
    }
  }
  const touch = state.touch && main && state.touch.id === main.id && time - state.touch.at < 2 * touchEvery ? state.touch : null;
  if (touch) {
    const age = time - touch.at;
    foes.unshift({ id: -1, pos: { x: touch.x + main.vel.x * age, y: touch.y + main.vel.y * age }, vel: main.vel, mass: main.mass, distance: touch.d });
  }
  for (const t of C.turrets) aimTurret(t, foes, friends);
  if (debug > 0.5 && frame % 120 === 60) {
    let firing = 0;
    for (const t of C.turrets) if (t.st.firing) firing++;
    log('turrets ' + C.turrets.length + ' firing ' + firing + (touch ? ' pressed at ' + (touch.x - self.pos.x).toFixed(0) + ',' + (touch.y - self.pos.y).toFixed(0) : '') + ' main ' + (main ? (main.pos.x - self.pos.x).toFixed(0) + ',' + (main.pos.y - self.pos.y).toFixed(0) : '-'));
  }
}
