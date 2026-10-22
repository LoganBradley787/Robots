// titan-shatter king (made by tournaments/gen/titan-shatter.mjs): the main core's script.
// Tick 0: fires every roof decoupler (tag split), so each gunship under it becomes its own robot and wakes.
// Then it lets its darts go in two waves, each told where the main enemy is, and keeps out of that enemy's sight.
// The main enemy (titan-darts, 2026-10, Logan): picked from what it sees and hears, never by id: the heaviest enemy
// with a live core of `mainMass` kg or more, kept while it is seen unless one twice as heavy shows up, and forgotten
// the moment it dies (it stays in view as debris, with no live core), `memory` s after it vanished, or at once when
// it vanished out at the radar's edge. A wave goes only at a main enemy seen within `memory` s; with none, it waits.
// Titans v2 (2026-10):
// - Out of reach, not only hidden: radars see 1000 m, radios carry 1500 m. The king keeps `far` m from where the main
//   enemy was last seen (never from the middle of anything: the open sandbox has none), so no radar of it reaches the
//   king, while its radio still hears what the gunships round the enemy see. Out there it needs no bubble, sees and
//   hears all the time, and keeps its pods.
// - Its pods are lit (one after another) only while something could see it: an enemy with a live core seen within
//   `far` m, or the main enemy last seen that close (a hidden enemy's radars may stand outside its bubble), or, in a
//   match, before anything was seen at all.
// - Hidden in its own bubble it is blind and deaf past 150 m. When darts wait for a target, or what it knows is older
//   than `refresh` s, it lets the bubble lapse `lookFor` s (covering a tick the gunships look on) to hear them, and
//   then moves its hiding place, since anything that saw it then knows where it was.
// - A heavy enemy coming (a ram) is still flown away from, inside the match's bounds (the global `arena`).
// - After a win it stays where it is and keeps its darts for the next enemy with a live core.
const waveGap = param('waveGap', 40, { min: 1, max: 240 }); // s before the second wave of darts
const pods = param('pods', 52, { min: 0, max: 200 }); // jammer pods it carries (tags jam0, jam1, ...)
const darts = param('darts', 16, { min: 0, max: 64 }); // darts on its deck (cores d0.., grips g0..)
const roam = param('roam', 25, { min: 1, max: 240 }); // s between moves to a new hiding place while hidden
const ram = param('ram', 1500, { min: 0, max: 100000 }); // kg: an enemy this heavy is a ram to get out of the way of
const threat = param('threat', 550, { min: 0, max: 1000 }); // m: a ram this close makes it move
const mainMass = param('mainMass', 30, { min: 0, max: 100000 }); // kg: the main enemy is never lighter (darts, pods)
const heavyMass = param('heavyMass', 300, { min: 0, max: 100000 }); // kg: a robot this heavy is a main enemy before any lighter one
const fallback = param('fallback', 8, { min: 0, max: 120 }); // s with no heavy one before a lighter one will do
const fallbackMatch = param('fallbackMatch', 45, { min: 0, max: 240 }); // the same in a match
const slow = param('slow', 25, { min: 0, max: 200 }); // m/s: a lighter one must be slower than this
const fast = param('fast', 90, { min: 10, max: 1000 }); // m/s: a robot this fast is a dart, never the main enemy
const bigParts = param('bigParts', 300, { min: 1, max: 100000 }); // parts: a robot this big gets darts diving from above
const arcSpacing = param('arcSpacing', 0.6, { min: 0, max: 5 }); // s between darts diving down one shaft (they met over the top)
const flee = param('flee', 300, { min: 0, max: 1000 }); // m: any robot of mainMass or more this close is flown away from
const coast = param('coast', 5, { min: 0, max: 60 }); // s an unseen main enemy is taken to keep its speed
const spacing = param('spacing', 0.2, { min: 0, max: 5 }); // s at least between two darts let go
const memory = param('memory', 15, { min: 0, max: 120 }); // s a main enemy that vanished alive is remembered and darts may go to its last place
const lostAt = param('lostAt', 900, { min: 50, max: 2000 }); // m: one that vanished further off went out of the radar's reach and is forgotten
const lookFor = param('lookFor', 0.2, { min: 0.02, max: 2 }); // s its bubble lapses to listen
const far = param('far', 1200, { min: 0, max: 1500 }); // m it keeps from the main enemy (radars reach 1000 m; a long robot's radar may stand 150 m from its core)
const refresh = param('refresh', 20, { min: 1, max: 240 }); // s: hidden, it listens when what it knows is older than this
const seeker = param('seeker', 400, { min: 0, max: 1500 }); // m: a light enemy (a dart) this close may see it
const top = param('top', 236, { min: 20, max: 1000 }); // m it flies at with no arena (in a match: 57 to 60 under the ceiling: rams and blasts lifted it over from 14 and from 28)
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
  state.t0 = time;
  state.sgn = self.pos.x < 0 ? -1 : 1;
  // Nothing seen yet: in a match the other side began at the mirror of its start. In the open sandbox, no guess.
  state.guess = arena ? { x: -self.pos.x, y: 30 } : null;
  state.root = null; // the main enemy: { id, x, y, vx, vy, at, d }, its last place while seen, kept a while once it vanishes
  state.foe = null; // the main enemy's last place, kept until it is seen dead (where to keep away from)
  state.everSeen = false;
  state.heavyAt = 0; // when a heavy enemy was last seen
  state.quick = {}; // ids of robots seen faster than `fast` (darts)
  state.looking = false;
  state.hold = { x: self.pos.x, y: self.pos.y };
  state.jit = random(); // where in its band of hiding places it sits, picked again when it may have been seen
  state.moved = time;
  state.heard = -100; // when it last saw or heard anything (out of its bubble)
  // Each wave takes pairs spread evenly over the deck, so it stays balanced; within a wave the darts nearest the other
  // side go first, and the ones behind climb higher before they turn (their clearDist), so their paths do not cross.
  state.order = [15, 14, 9, 8, 7, 6, 1, 0, 13, 12, 11, 10, 5, 4, 3, 2];
  state.next = 0;
  state.lastDart = -100;
  state.firstWave = 0; // when the first dart went (s from the start)
  state.jam = 0;
  state.jamUntil = -1;
  state.evade = -100;
}

function hasPod(k) {
  const tag = 'jam' + k;
  for (const p of parts) if (p.type === 'jammer' && p.tags.indexOf(tag) >= 0) return true;
  return false;
}

// Where to be: `far` m and a bit from the main enemy's last place, on the side it is on now, at its height. In a
// match, inside the bounds (it cannot always get that far: then it stays as far as it can and hides).
function hidePlace(f) {
  const edgeX = arena ? arena.x - 150 : Infinity;
  const y = arena ? arena.y - 60 + 3 * state.jit : top;
  let dir = Math.sign(self.pos.x - f.x) || state.sgn;
  const dy = Math.max(0, y - f.y);
  const reach = Math.sqrt(Math.max(0, far * far - dy * dy)); // sideways it must be from it at that height
  let x = f.x + dir * (reach + 60 + 200 * state.jit);
  if (Math.abs(x) > edgeX) {
    x = Math.sign(x) * (edgeX - 220 * state.jit);
    if (Math.sign(x - f.x) !== dir) x = f.x + dir * 50; // the enemy is at our edge: no room behind it
  }
  return { x: x, y: y };
}

function tick() {
  const t = time - state.t0;
  if (t < 0.1) set('split', 'fire', 1);
  const jammed = time < state.jamUntil;

  let near = Infinity;
  let big = null;
  let closest = null;
  let heaviest = null;
  let kept = null;
  let light = null;
  let gone = false;
  const mem = state.root;
  const keepId = mem ? mem.id : state.foe ? state.foe.id : -1;
  for (const c of contacts) {
    if (c.id === keepId && (c.side !== 'enemy' || !c.core)) gone = true;
    if (c.side !== 'enemy' || !c.core) continue;
    // What could see it: a robot of `mainMass` or more within `far` (radars reach 1000 m), a lighter one (a dart with
    // a seeker) only within `seeker` m.
    if ((c.mass >= mainMass ? c.distance : c.distance + far - seeker) < near) near = c.mass >= mainMass ? c.distance : c.distance + far - seeker;
    if (c.mass >= ram && c.distance < threat && !big) big = c;
    // Anything of `mainMass` or more this close (a gun panel that found it in its bubble) is flown away from too.
    if (c.mass >= mainMass && c.distance < flee && !closest && Math.hypot(c.vel.x, c.vel.y) <= fast) closest = c;
    // Never one seen fast (a titan's darts weigh over 30 kg too; one let go is slow for a moment, so once fast is
    // fast for good). A heavy one (`heavyMass`) comes before any lighter one.
    const v = Math.hypot(c.vel.x, c.vel.y);
    if (v > fast) state.quick[c.id] = 1;
    if (c.id === keepId && !state.quick[c.id]) kept = c; // kept however light it gets, and after a while unseen
    if (c.mass < mainMass || state.quick[c.id]) continue;
    if (c.mass >= heavyMass) {
      if (!heaviest || c.mass > heaviest.mass) heaviest = c;
    } else if (v < slow) {
      if (!light || c.mass > light.mass) light = c;
    }
  }
  if (!jammed && t > 0.05) state.heard = time;
  let main = kept && !(heaviest && heaviest.mass > 2 * kept.mass) ? kept : heaviest;
  if (main && main.mass >= heavyMass) state.heavyAt = time;
  // No heavy one for a while (longer in a match: a titan hidden from the first second is out there): a light, slow one.
  else if (!main && light && time - state.heavyAt > (arena ? fallbackMatch : fallback)) main = light;
  if (main) {
    state.root = { id: main.id, x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, at: time, d: main.distance, parts: main.parts || 0 };
    state.foe = { id: main.id, x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, at: time };
    state.foeParts = main.parts || 0;
    state.everSeen = true;
  } else if (mem && (gone || time - mem.at > memory || mem.d > lostAt)) {
    // Vanished alive, not at the radar's edge: it hides in a bubble, and may see the king while unseen itself.
    if (!gone && mem.d <= lostAt) state.foeHides = true;
    state.root = null;
  }
  if (gone && state.foe && state.foe.id === keepId) state.foe = null;
  if (gone && !main) state.heavyAt = -1e9; // it is dead: no reason to wait before going at a lighter one

  // Darts: one every 0.12 s within a wave, told the main enemy's place and id. A wave waits while it has no main enemy
  // to go at (titans v2: never blind at the mirror of the start any more; the darts flew past an enemy hidden from the
  // first second and fell. The gunships find it, and the king hears them). A dart told the id follows that robot by
  // what its radar and its radio report, however stale the place it was given.
  const half = darts / 2;
  state.looking = false;
  if (state.next < darts && state.next < state.order.length) {
    // The second wave comes `waveGap` s after the first went (titans v2), not after the start: held until a target was
    // found, both went together, and nothing was left for the enemy once it was down and grounded.
    const due = state.next < half ? 0.15 + 0.12 * state.next : Math.max(waveGap, state.firstWave + waveGap) + 0.12 * (state.next - half);
    // Never two darts closer than `spacing` s apart, however late a wave is (let go a tick apart, they collided).
    const gap = state.root && state.root.parts >= bigParts ? arcSpacing : spacing;
    if (t >= due && time - state.lastDart >= gap) {
      // With no fresh sighting, the main enemy's id and last place will do: the darts hear where it is by radio from
      // the gunships round it (titans v2; the king lapsed its bubble to look, was seen by it, and its darts found it).
      const fo2 = state.foe;
      const r = state.root || (fo2 ? { id: fo2.id, x: fo2.x, y: fo2.y, vx: 0, vy: 0, at: fo2.at, parts: state.foeParts || 0 } : null);
      if (r) {
        if (state.next === 0) state.firstWave = t;
        const k = state.order[state.next];
        // A big robot (`bigParts` parts or more) is dived on from above, every dart down the same shaft onto its core
        // (titans v2): darts from the side each blew a hole in a different face of a core buried six cells deep.
        const arc = r.parts >= bigParts ? 1 : 0;
        if (main) send('d' + k, { x: r.x, y: r.y, vx: r.vx, vy: r.vy, id: r.id, arc: arc });
        else if (r) {
          // Vanished alive: where it was last seen, carried on by its speed for a moment.
          const age = Math.min(time - r.at, 2);
          send('d' + k, { x: r.x + r.vx * age, y: Math.max(1, r.y + r.vy * age), vx: 0, vy: 0, id: r.id, arc: arc });
        }
        set('g' + k, 'fire', 1);
        state.next++;
        state.lastDart = time;
      } else state.looking = true;
    }
  }

  // Seen from where? An enemy in view within `far`, the main enemy's last place within `far`, or (in a match)
  // nothing seen yet: it hides.
  // Unseen, the main enemy is taken to carry on as it went for up to `coast` s (a ram coming while the king is blind
  // in its bubble).
  const fo = state.foe;
  const ca = fo ? Math.min(time - fo.at, coast) : 0;
  const f = fo ? { x: fo.x + fo.vx * ca, y: Math.max(0, fo.y + fo.vy * ca) } : state.everSeen ? null : state.guess;
  const fd = f ? Math.hypot(f.x - self.pos.x, f.y - self.pos.y) : Infinity;
  // A main enemy that hides is assumed to be able to see it from anywhere (its radars may stand outside its bubble,
  // and it moves unseen): then the king stays in its bubble (51 pods last 255 s).
  const exposed = near < far || fd < far || (state.foeHides && !!state.foe);
  // Listening: when the pod burns out the bubble lapses `lookFor` s, if darts wait or what it knows is stale, but only
  // while it knows of no main enemy (titans v2): lapsing within the enemy's radar reach let it be seen, and its darts
  // came 10 s later. Knowing one, it keeps hidden and goes by where it was last seen.
  const stale = time - state.heard > refresh;
  const listen = (state.looking || stale) && state.jamUntil > 0 && !state.foe;
  if (exposed && t > 1.2 && time >= (listen ? state.jamUntil + lookFor : state.jamUntil - 0.05)) {
    while (state.jam < pods && !hasPod(state.jam)) state.jam++;
    if (state.jam < pods) {
      // It was out of its bubble a moment (a lapse to listen, or just seen): anything there may know where it is.
      if (time > state.jamUntil + 0.05) state.jit = random();
      set('jam' + state.jam, 'ignite', 1);
      state.jam++;
      state.jamUntil = time + 5;
    }
  }

  // Hidden, it moves on to a new place in its band now and then.
  if (time - state.moved > roam) {
    state.moved = time;
    state.jit = random();
  }
  let place = f ? hidePlace(f) : state.hold;
  if (!f) state.hold = { x: state.hold.x, y: arena ? arena.y - 60 : Math.max(state.hold.y, 30) };
  // A ram coming (seen only when it is not hiding): off to the far side of it, and to the other end of the sky.
  if (!big && closest) big = closest;
  if (big) {
    state.evade = time;
    const away = self.pos.x >= big.pos.x ? 1 : -1;
    const edgeX = arena ? arena.x - 180 : Infinity;
    const hi = arena ? arena.y - 60 : top;
    state.dodge = { x: clamp(self.pos.x + away * 150, -edgeX, edgeX), y: big.pos.y > 120 ? 35 : hi };
  }
  if (time - state.evade < 8 && state.dodge) place = state.dodge;
  fly(place.x, Math.max(place.y, 20), 30, 0.35, time - state.evade < 8 ? 25 : 12);
}
