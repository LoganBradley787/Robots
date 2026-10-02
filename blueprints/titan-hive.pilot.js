// titan-hive pilot (titans tournament): one script flies the mother ship, runs its dart bays, and aims its turrets.
// No keys. Everything it knows comes from `contacts` (sides, never team numbers or a fixed direction), so it works
// as authored and deployed flipped.
// - Flight: holds `cruise` m up and `standoff` m to its own side of the heaviest enemy with a core (the main one),
//   leaning by throttling one wing more than the other (the flying silo's hover, with the body worked out every
//   `refresh` ticks instead of every tick: the ship has hundreds of parts). Over something heavy on the ground and
//   close it goes up to `high`; when something heavy closes fast in the air it goes over or under it (`low`, `high`).
//   It stays inside the arena (x within `edge`, its core under 250 m).
// - Hiding (round 2): two small bays on the middle block build jammer pods; the pilot lights them in turn, so the
//   core sits in a jammer bubble all match and no sensor sees the ship. Its own radars are at the far ends of the
//   hull, outside the bubble.
// - Bays: every fabricator bay with a tag starting `bay`. A finished dart is sent the main enemy's place, speed and
//   id and let go at once, at most one per `gap` s; every `spreadEvery`th goes to the nearest other enemy instead.
//   With nothing seen it sends darts to the last place the main enemy was, else to the mirror of its own start.
// - Turrets: parts tagged `turN.rot` (rotator) and `turN.gun`. Each takes the nearest enemy it can swing to within
//   `track` m, leads it, and blasts within `reach` m while its sight shows nothing of ours in the way. It never
//   scans: a scan of a titan costs too much.

const cruise = param('cruise', 222, { min: 20, max: 240 }); // m, the height it holds
const high = param('high', 238, { min: 20, max: 245 }); // m, the height it takes over a ground enemy or to go over a ram
const low = param('low', 45, { min: 10, max: 200 }); // m, the height it takes to go under a ram
const standoff = param('standoff', 900, { min: 50, max: 1000 }); // m to the side of the main enemy
const groundEdge = param('groundEdge', 500, { min: 100, max: 990 }); // m from the middle it keeps to against a ground enemy
const under = param('under', 0, { min: 0, max: 1000 }); // m sideways: a heavy ground enemy this close sends it up to `high`
const edge = param('edge', 880, { min: 100, max: 990 }); // m from the middle it never passes
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
const spreadEvery = param('spreadEvery', 4, { min: 1, max: 100 }); // every this many darts, one goes to the nearest other enemy
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter enemies get no dart
const retreat = param('retreat', 100, { min: 0, max: 600 }); // m back from its start it waits with no enemy seen
const overlap = param('overlap', 2.4, { min: 0.5, max: 5 }); // s between one jammer bay's pod lighting and the other's
const burn = param('burn', 5.1, { min: 1, max: 10 }); // s after lighting a pod its bay is told to let go (a pod jams 5 s)
const followMass = param('followMass', 30, { min: 0, max: 100000 }); // kg: it takes its place beside nothing lighter (darts, small drones)
const heavyMass = param('heavyMass', 200, { min: 1, max: 100000 }); // kg: an enemy this heavy is flown around
const ramSpeed = param('ramSpeed', 14, { min: 1, max: 100 }); // m/s: a heavy flier closing faster than this is a ram
const reach = param('reach', 265, { min: 1, max: 300 }); // m: turrets blast within this
const track = param('track', 420, { min: 1, max: 1000 }); // m: turrets point at things within this
const shell = param('shell', 300, { min: 1, max: 5000 }); // m/s, a shell's speed
const gain = param('gain', 6, { min: 0.1, max: 50 }); // turret turn rate per radian off the aim
const size = param('size', 1.2, { min: 0.1, max: 10 }); // m off the aim point that still counts as on target
const clearPath = param('clearPath', 6, { min: 0, max: 50 }); // m: a friend this close to a turret's line holds its fire

const debug = param('debug', 0, { min: 0, max: 1 }); // 1 logs the hover's numbers once a second
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
  state.sent = 0;
  state.last = null; // the main enemy's last known place
  state.dodge = 0;
  state.jam = {}; // jammer bay tag -> { lit: when its pod was lit (-1: none), wait: no sooner than this }
  state.lit = -Infinity;
  state.dodgeAt = -Infinity;
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

  const want = clamp(0.05 * (self.vel.x - wantVx), -leanMax, leanMax);
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
  if (debug > 0.5 && frame % 60 === 0) log('y ' + self.pos.y.toFixed(0) + ' x ' + self.pos.x.toFixed(0) + ' wantY ' + wantY.toFixed(0) + ' wantVx ' + wantVx.toFixed(1) + ' thr ' + throttle.toFixed(2) + ' base ' + base.toFixed(2) + ' diff ' + diff.toFixed(2) + ' props ' + n + ' mass ' + self.mass.toFixed(0) + ' up ' + up.toFixed(0));
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
  let main = null;
  const foes = [];
  const friends = [];
  for (const c of contacts) {
    if (c.side === 'enemy') {
      if (!c.core) continue;
      // The other titan's main robot has id 1 or 2 (round 2, known to all); failing that, the heaviest.
      if (c.id <= 2) main = c;
      else if (!main || (main.id > 2 && c.mass > main.mass)) main = c;
      if (c.distance <= track && foes.length < 12) foes.push(c);
    } else if (c.side === 'friend' && c.distance < 170 && friends.length < 10) friends.push(c);
  }
  if (main) state.last = { x: main.pos.x, y: main.pos.y };

  // Where to be.
  let wantY = cruise;
  let wantX = state.home.x + state.side * retreat;
  if (main && main.mass >= followMass) {
    const dx = main.pos.x - self.pos.x;
    const dy = main.pos.y - self.pos.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const mySide = Math.abs(dx) > 5 ? -Math.sign(dx) : state.side;
    // A ground enemy can drive under it, and a stream of shells pushes: it keeps further from the edges then, so
    // there is room before the push carries it out.
    const limit = main.pos.y < 35 ? groundEdge : edge;
    wantX = clamp(main.pos.x + mySide * standoff, -limit, limit);
    if (main.mass >= heavyMass) {
      const closing = -(dx * (main.vel.x - self.vel.x) + dy * (main.vel.y - self.vel.y)) / dist;
      if (main.pos.y < 35) {
        if (Math.abs(dx) < under) wantY = high;
      } else if (closing > ramSpeed && dist < 650) {
        if (!state.dodge) state.dodge = main.pos.y + main.vel.y * Math.min(dist / closing, 6) >= self.pos.y ? -1 : 1;
        state.dodgeAt = time;
      }
    }
  }
  if (state.dodge && time - state.dodgeAt > 2.5) state.dodge = 0;
  if (state.dodge) wantY = state.dodge > 0 ? high : low;
  wantX = clamp(wantX, -edge, edge);
  // Carried outward past its place (a stream of shells pushes, a ram shoves): lean much harder to get back. While it
  // is pushed up it needs little lift, so only a steep lean gives it sideways push.
  const carried = Math.abs(self.pos.x) > Math.abs(wantX) + 25 && self.pos.x * self.vel.x > 0;
  fly(wantY, clamp(0.3 * (wantX - self.pos.x), -maxSpeed, maxSpeed), carried ? hardLean : lean);

  // Bays: let a finished dart go at the main enemy (or the place it should be).
  // Not while climbing or sinking: a dart levels off right over the bays, and a rising ship would fly up into it.
  if (time - state.lastRel >= gap && Math.abs(self.angle) < level && Math.abs(self.vel.y) < still) {
    // The bay nearest the target goes first, so a dart never turns across one let go just before it.
    const toRight = (main ? main.pos.x : state.last ? state.last.x : -state.home.x) >= self.pos.x;
    const order = C.bays.slice().sort((p, q) => (toRight ? q.p.pos.x - p.p.pos.x : p.p.pos.x - q.p.pos.x));
    for (const b of order) {
      if (!(b.p.out.ready > 0)) continue;
      let msg;
      const clear = 30 + 8 * (state.sent % 5); // m straight up before it turns: neighbors turn at different heights
      let t = main;
      if (state.sent % spreadEvery === spreadEvery - 1) {
        for (const c of foes) {
          if (c !== main && c.mass >= minMass) {
            t = c;
            break;
          }
        }
      }
      if (t && t.mass >= minMass) msg = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc: 0, clear, lvx: self.vel.x, lvy: self.vel.y };
      else if (state.last) msg = { x: state.last.x, y: state.last.y, vx: 0, vy: 0, arc: 0, clear, lvx: self.vel.x, lvy: self.vel.y };
      else msg = { x: -state.home.x, y: [5, 80, 150][state.sent % 3], vx: 0, vy: 0, arc: 0, clear, lvx: self.vel.x, lvy: self.vel.y };
      send(b.tag + b.p.out.built, msg);
      set(b.tag, 'release', 1);
      state.lastRel = time;
      state.sent++;
      break;
    }
  }

  // Turrets.
  for (const t of C.turrets) aimTurret(t, foes, friends);
}
