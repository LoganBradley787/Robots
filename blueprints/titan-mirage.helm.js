// Helm of titan-mirage: the one script on the hull (cloak, flight, and letting ghosts go).
// - Cloak: one jammer pod of the stern block is lit every `period` s, so the main core is always inside a bubble and
//   no sensor outside it sees the hull. The radars stand at the bow, outside the bubble, so the hull still sees.
// - Flight: propellers and lift boosters in strips along the hull (l0 at the stern to l7 at the bow) hold the height
//   and keep the hull level, each strip throttled on its own (titans v2, 2026-10; a stern and a bow group before); the
//   boosters on the ends (pf toward the bow, pr toward the stern) hold its place `standoff` m from what it tracks.
//   Left and right are worked out from where the parts are, so it flies the same deployed flipped.
// - Ghosts: when enough bays hold a finished ghost, all of them are handed the same point and speed and let go on one
//   tick. The point is the main enemy, and its id goes with it: a ghost follows that robot by what its radio and
//   seeker report (the radio by the bow radars shares what they see).
// - The main enemy (titan-darts, 2026-10, Logan): picked from what the radars report, never by id: the heaviest enemy
//   with a live core of `minMass` kg or more, kept while it is seen unless one twice as heavy shows up, and given up
//   the moment it dies. A robot that dies stays in the radars' view as debris (no live core), so nothing more goes to
//   its spot. One that vanished alive (into a jammer's bubble or smoke, most likely) has its last place kept `memory` s,
//   and a salvo may go there; then it is forgotten. Only while it has never seen an enemy at all does a salvo go to
//   the mirror of the hull's own start (a titan hidden from the first second stays about there).
const pods = param('pods', 55, { min: 1, max: 500 });
const strips = param('strips', 8, { min: 1, max: 32 }); // lift strips along the hull, tags l0 (stern) to l<strips - 1> (bow)
const bays = param('bays', 20, { min: 1, max: 64 });
const period = param('period', 4.5, { min: 1, max: 5 }); // s between pods (a pod jams 5 s)
const height = param('height', 200, { min: 5, max: 240 }); // m the core flies at
const roof = param('roof', 215, { min: 5, max: 10000 }); // m the core never asks to fly above (in an arena also `roofIn` under its ceiling: a ram from below lifts it)
const heavy = param('heavy', 1000, { min: 0, max: 100000 }); // kg: an enemy this heavy may be a ram (300 until titans v2: Palisade's gun panels, 120 to 400 kg, made it duck under them to the ground)
const danger = param('danger', 380, { min: 0, max: 1000 }); // m: a heavy enemy this close is stepped over or under
const step = param('step', 110, { min: 0, max: 250 }); // m of height kept from it
const standoff = param('standoff', 880, { min: 100, max: 1500 }); // m kept from the tracked robot (inside radar reach, outside a search around its own start)
const cornered = param('cornered', 250, { min: 0, max: 1000 }); // m: held closer than this against the edge, it takes the other side
const backoff = param('backoff', 250, { min: 0, max: 600 }); // m it backs away from its start with nothing tracked
const edgeIn = param('edgeIn', 350, { min: 0, max: 900 }); // m: it never flies its core nearer the arena's side edge than this (well inside: shells push, and a wreck that drifts over the edge has lost)
const roofIn = param('roofIn', 35, { min: 5, max: 200 }); // m: and never asks to fly nearer the arena's ceiling than this
// The arena (titans v2, 2026-10): its edges come from the global `arena` (null in an open sandbox: no edge, no ceiling).
const edge = arena ? Math.max(50, arena.x - edgeIn) : Infinity;
const ceiling = arena ? Math.min(roof, arena.y - roofIn) : roof;
const tilt = (param('tilt', 10, { min: 0, max: 20 }) * Math.PI) / 180; // degrees it leans its lift to move sideways (titans v2, 2026-10)
const cruise = param('cruise', 24, { min: 1, max: 60 }); // m/s sideways at most
const reach = param('reach', 960, { min: 50, max: 1000 }); // m: a salvo only at something this close
const salvo = param('salvo', 20, { min: 1, max: 64 }); // ready bays that make a salvo
const wait = param('wait', 6, { min: 0, max: 60 }); // s after the first ghost is ready before a short salvo goes anyway
const blindGap = param('blindGap', 45, { min: 1, max: 120 }); // s between salvos at a place it cannot see
const groundY = param('groundY', 4, { min: 0, max: 200 }); // m: the height it aims at with nothing ever seen
const close = param('close', 320, { min: 0, max: 1000 }); // m: at something this close, every finished ghost goes at once
const level = (param('level', 25, { min: 1, max: 90 }) * Math.PI) / 180; // lets go only this level
const minMass = param('minMass', 40, { min: 0, max: 100000 }); // kg: lighter robots are never the main target
const memory = param('memory', 15, { min: 0, max: 120 }); // s a main enemy that vanished alive is remembered and a salvo may go to its last place
const wave = param('wave', 4, { min: 1, max: 64 }); // ghosts let go together in one wave of a volley
const waveGap = param('waveGap', 0.4, { min: 0, max: 5 }); // s between waves
const guardAt = param('guardAt', 450, { min: 0, max: 1000 }); // m: an enemy ship this close gets every other wave
const minGuard = param('minGuard', 30, { min: 0, max: 100000 }); // kg: lighter ones (darts) never do
const cutBelow = param('cutBelow', 35, { min: 0, max: 200 }); // m under its height where it cuts what reaches up from below
const hunt = param('hunt', 60, { min: 0, max: 600 }); // s the heaviest enemy is remembered out of sight
const huntAt = param('huntAt', 700, { min: 100, max: 1000 }); // m from its last place the hull closes to (inside radar reach)
const awake = param('awake', 20, { min: 1, max: 600 }); // s: in an open sandbox it keeps its cloak up this long after it last saw an enemy
const lostAt = param('lostAt', 900, { min: 50, max: 2000 }); // m: one that vanished further off went out of the radars' reach and is forgotten

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
  const cap = []; // lift strips: push at full throttle, N
  const arm = []; // and where that push is along x from the center of mass, m
  for (let k = 0; k < strips; k++) {
    cap.push(0);
    arm.push(0);
  }
  let ff = 0;
  let fr = 0;
  let bow = 0;
  let stern = 0;
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    inertia += p.mass * (dx * dx + dy * dy);
    const lifter = p.type === 'propeller' ? 120 : p.type === 'booster' ? 400 : 0;
    if (lifter > 0 && p.tags.length > 0 && p.tags[0].charAt(0) === 'l') {
      const k = Number(p.tags[0].slice(1));
      if (k >= 0 && k < strips) {
        cap[k] += lifter;
        arm[k] += lifter * dx;
      }
    } else if (p.type === 'booster') {
      if (p.tags.indexOf('pf') >= 0) {
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
  for (let k = 0; k < strips; k++) if (cap[k] > 0) arm[k] /= cap[k];
  state.cap = cap;
  state.arm = arm;
  state.ff = ff;
  state.fr = fr;
  if (ff > 0 || fr > 0) state.dir = bow - stern >= 0 ? 1 : -1;
}

/**
 * Throttles for the lift strips (titans v2, 2026-10): strip k runs at clamp(u + b * arm[k], 0, 1), a lean along the
 * hull, with b set for the turning asked (`torque`, N m about the center of mass) and u for the lift (N). Level comes
 * first: when both cannot be had (strips shot away), u is lowered until the lean can still level the hull, so it sinks
 * level instead of rolling. Each is found by halving (lift and turning only grow with u and b).
 */
function share(lift, torque) {
  const cap = state.cap;
  const arm = state.arm;
  const n = cap.length;
  const sums = (u, b) => {
    let l = 0;
    let t = 0;
    for (let k = 0; k < n; k++) {
      let r = u + b * arm[k];
      if (r <= 0) continue;
      if (r > 1) r = 1;
      l += cap[k] * r;
      t += cap[k] * r * arm[k];
    }
    return [l, t];
  };
  const lean = (u) => {
    let lo = -0.2;
    let hi = 0.2;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (sums(u, mid)[1] < torque) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  let u = 0.5;
  let b = 0;
  for (let pass = 0; pass < 2; pass++) {
    b = lean(u);
    let lo = -1;
    let hi = 2;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (sums(mid, b)[0] < lift) lo = mid;
      else hi = mid;
    }
    u = (lo + hi) / 2;
  }
  b = lean(u);
  // Level first: the turning still missing means u is too high (the low end is out of push) or too low.
  const slack = 0.05 * Math.abs(torque) + 2000;
  for (let i = 0; i < 8 && Math.abs(sums(u, b)[1] - torque) > slack; i++) {
    u *= 0.75;
    b = lean(u);
  }
  const out = [];
  for (let k = 0; k < n; k++) out.push(clamp(u + b * arm[k], 0, 1));
  return out;
}

function setup() {
  state.x0 = self.pos.x;
  state.dir = self.pos.x <= 0 ? 1 : -1; // the way the bow points along x
  state.last = null; // the main enemy: { id, x, y, vx, vy, at, d }, its last place while seen, kept a while once it vanishes
  state.everSeen = false; // whether any enemy that could be the main one was ever seen
  state.big = null; // the heaviest enemy seen: { id, x, y, mass, at }
  state.firstReady = -1;
  state.lastSalvo = -100;
  state.dodge = 0;
  state.dodgeAt = -100;
  state.lastWave = -100; // when the last wave went
  state.waves = 0; // waves let go so far
  state.reachAt = -1000; // when it last looked for a part reaching up (frame)
  state.reachId = -1;
  state.reach = null; // that part, from its robot's core
  state.tip = 0; // the angle it leans to
  state.side = 0; // which side of the tracked robot it keeps to (-1 left, 1 right)
  state.pod = 0; // the next jammer pod to light
  state.podAt = 0; // when it may
  state.seen = -1000; // when it last saw an enemy
  measure();
}

/**
 * The robot to go after: the one it had while still seen (unless one twice as heavy shows up), else the heaviest
 * enemy with a live core of `minMass` or more (nearest first, so a tie goes to the nearer). Forgets the remembered one
 * when it is seen dead, `memory` s after it vanished, or at once when it vanished out at the radars' edge.
 */
function target() {
  const mem = state.last;
  let heaviest = null;
  let kept = null;
  let gone = false;
  let bigGone = false;
  for (const c of contacts) {
    if (mem && c.id === mem.id && (c.side !== 'enemy' || !c.core)) gone = true;
    if (state.big && c.id === state.big.id && (c.side !== 'enemy' || !c.core)) bigGone = true;
    if (c.side !== 'enemy' || !c.core) continue;
    state.seen = time;
    if (c.mass < minMass) continue;
    if (mem && c.id === mem.id) kept = c;
    if (!heaviest || c.mass > heaviest.mass) heaviest = c;
  }
  const main = kept && !(heaviest && heaviest.mass > 2 * kept.mass) ? kept : heaviest;
  // The big one (titans v2, 2026-10): the heaviest enemy seen, remembered `hunt` s after it went out of sight (out of
  // radar reach, most likely, while its gun ships come in). The hull keeps its place by it, not by the gun ship it
  // fights now, so it closes in until the radars find it again. Forgotten when seen dead.
  const big = state.big;
  if (heaviest && (!big || heaviest.id === big.id || heaviest.mass >= big.mass)) {
    state.big = { id: heaviest.id, x: heaviest.pos.x, y: heaviest.pos.y, mass: heaviest.mass, at: time };
  } else if (big && (bigGone || time - big.at > hunt)) state.big = null;
  if (main) {
    state.last = { id: main.id, x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, at: time, d: main.distance };
    state.everSeen = true;
  } else if (mem && (gone || time - mem.at > memory || mem.d > lostAt)) {
    state.last = null;
  }
  return main;
}

function tick() {
  if (frame % 30 === 0) measure();

  // what it goes after, and where that was last
  const t = target();

  // The cloak: in a match, a pod every `period` s from the start, as before. In an open sandbox (no arena) only while
  // an enemy was seen in the last `awake` s, so its pods are not spent on an empty world (titans v2, 2026-10).
  if (state.pod < pods && time >= state.podAt && (arena || time - state.seen < awake)) {
    set('j' + state.pod, 'ignite', 1);
    state.pod++;
    state.podAt = time + period;
  }

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
  high = clamp(high, 25, ceiling);
  // place: standoff from the tracked robot, on the side it is on unless only the other side has the room
  let want = state.x0 - state.dir * backoff;
  const b = state.big;
  const away = b && (!t || (t.id !== b.id && t.mass * 2 < b.mass)) && time - b.at > 1;
  if (away) {
    // The big one is out of sight: close in to `huntAt` m of where it was last.
    if (state.side === 0) state.side = sign(self.pos.x - b.x) || -state.dir;
    want = b.x + state.side * huntAt;
  } else if (t) {
    if (state.side === 0) state.side = self.pos.x === t.pos.x ? -state.dir : sign(self.pos.x - t.pos.x);
    const held = Math.abs(clamp(t.pos.x + state.side * standoff, -edge, edge) - t.pos.x);
    const other = Math.abs(clamp(t.pos.x - state.side * standoff, -edge, edge) - t.pos.x);
    if (held < cornered && other > held + 200) state.side = -state.side;
    want = t.pos.x + state.side * standoff;
    // On its own side it never comes nearer the middle than where it started (that is where everyone looks first).
    if (arena && state.side === -state.dir) want = state.side * Math.max(state.side * want, state.side * state.x0);
  }
  want = clamp(want, -edge, edge);
  // No faster than it can still stop in the room left. Its boosters are small for its weight, so it also leans its
  // lift the way it must go, up to `tilt` (titans v2, 2026-10): shells and rams that shoved it out of the arena before
  // are now pushed back against with a good part of its lift.
  const lean = Math.tan(tilt);
  const stop = (0.6 * Math.min(state.ff, state.fr) + 0.3 * state.m * 9.81 * lean) / Math.max(state.m, 1);
  const room = Math.abs(want - self.pos.x);
  const vWant = sign(want - self.pos.x) * Math.min(cruise, Math.sqrt(2 * stop * room), 0.25 * room);
  const axWorld = clamp(1.5 * (vWant - self.vel.x), -4, 4);
  const ax = axWorld * state.dir; // along the bow
  const pf = clamp((ax * state.m) / Math.max(state.ff, 1e-9), 0, 1);
  const pr = clamp((-ax * state.m) / Math.max(state.fr, 1e-9), 0, 1);
  set('pf', 'throttle', pf);
  set('pr', 'throttle', pr);
  // What the boosters leave of it, from the lift: tipping by angle a pushes sideways by g tan(a) (counterclockwise is +).
  const rest = axWorld - (state.dir * (pf * state.ff - pr * state.fr)) / Math.max(state.m, 1);
  // Small errors are the boosters' (a 170 m hull swings slowly: leaning for every meter rocked it), and the lean
  // follows what is asked over about a second.
  const lack = Math.abs(rest) > 0.4 ? rest - 0.4 * sign(rest) : 0;
  state.tip += (clamp(-Math.atan2(lack, 9.81), -tilt, tilt) - state.tip) * 0.03;
  const tip = state.tip;

  // height and level (with the lean asked above)
  const vyWant = clamp(1.0 * (high - self.pos.y), -Math.min(22, Math.sqrt(2 * 6 * Math.max(0, self.pos.y - 15))), 22);
  // Over the arena's ceiling by more than `roofIn` / 2 (pushed up by something below): no lift at all.
  const az = arena && self.pos.y > ceiling + roofIn / 2 ? -9.81 : clamp(2.5 * (vyWant - self.vel.y), -8, 10);
  const lift = (state.m * (9.81 + az)) / Math.max(0.8, Math.cos(self.angle));
  const w = 1.3;
  const torque = state.inertia * (-(w * w) * (self.angle - tip) - 2 * w * self.angVel);
  const th = share(lift, torque);
  for (let k = 0; k < strips; k++) if (state.cap[k] > 0) set('l' + k, 'throttle', th[k]);


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
  // A volley goes in waves (titans v2, 2026-10): let go all on one tick, twenty ghosts met their target as one pack,
  // and the first one to go off broke the rest as duds. A wave is `wave` ghosts from bays spread along the hull, the
  // next `waveGap` s later, so each wave arrives well clear of the last one's blast. Once a volley has started, its
  // waves follow without waiting for more bays to finish.
  const going = time - state.lastWave < waveGap * 2.5;
  if (going && time - state.lastWave < waveGap) return;
  const hot = t && t.distance < close;
  if (!going && !hot && ready < Math.min(salvo, alive) && time - state.firstReady < wait) return;
  let aim = null;
  if (t) {
    // Not at something close under the deck: a ghost would dive through its own hull.
    const fore = (t.pos.x - self.pos.x) * state.dir; // m along the hull from the core toward the bow
    const under = t.pos.y < self.pos.y - 4 && fore > -40 && fore < 215;
    if (t.distance <= reach && !under) aim = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id };
    // What threatens the hull most comes first: the part of a heavy enemy below that reaches up to its height (a
    // mast that would shove it) gets every wave until it is cut; else every other wave goes at the nearest gun ship
    // come close (it is what wears the hull down).
    const r = reaching(t);
    const g = r || state.waves % 2 === 0 ? null : guard();
    if (r) aim = r;
    else if (g) aim = { x: g.pos.x, y: g.pos.y, vx: g.vel.x, vy: g.vel.y, id: g.id };
  } else if (going || time - state.lastSalvo >= blindGap) {
    // Nothing tracked: the place it vanished (kept `memory` s, carried on by its speed for a moment), else, with
    // nothing ever seen, the mirror of the start. Seen once and gone: no salvo.
    const l = state.last;
    if (l) {
      const age = Math.min(time - l.at, 2);
      aim = { x: l.x + l.vx * age, y: Math.max(1, l.y + l.vy * age), vx: 0, vy: 0, id: l.id };
    } else if (!state.everSeen) aim = { x: -state.x0, y: groundY, vx: 0, vy: 0 };
    if (aim && Math.hypot(aim.x - self.pos.x, aim.y - self.pos.y) > reach + 200) aim = null;
  }
  if (!aim) return;
  // This wave: up to `wave` ready bays, as far apart along the hull as the ready ones allow (every `bays / wave`th).
  const stride = Math.max(1, Math.floor(bays / wave));
  let sent = 0;
  for (let k = 0; k < stride && sent < wave; k++) {
    for (let i = (state.waves + k) % stride; i < bays && sent < wave; i += stride) {
      const tag = 'g' + String.fromCharCode(97 + i);
      if (!(get(tag, 'ready') > 0)) continue;
      send(tag + get(tag, 'built'), aim);
      set(tag, 'release', 1);
      sent++;
    }
  }
  state.waves++;
  state.lastWave = time;
  if (!going) state.lastSalvo = time;
  state.firstReady = -1;
}

/**
 * Where to cut a heavy enemy below that reaches up to the hull (titans v2, 2026-10): its part nearest a point `cutBelow`
 * m under the hull's height, over it, if it has one there (a ground titan's mast). Juggernaut's mast pushed Mirage out
 * of the arena from under it, and no lean holds 20 t; cut lower down, what is left no longer reaches. Found with one
 * small scan every second; the ghost follows the robot and goes for that point on it (`ox`, `oy` from its core).
 */
function reaching(t) {
  if (t.mass < heavy || t.pos.y > self.pos.y - 60) return null;
  if (frame - state.reachAt >= 60 || state.reachId !== t.id) {
    state.reachAt = frame;
    state.reachId = t.id;
    state.reach = null;
    const at = { x: t.pos.x, y: self.pos.y - cutBelow };
    const p = scan(t.id, { near: at, most: 1 });
    if (p && p.length > 0 && p[0].pos.y > self.pos.y - cutBelow - 15) state.reach = { x: p[0].pos.x - t.pos.x, y: p[0].pos.y - t.pos.y };
  }
  const r = state.reach;
  if (!r) return null;
  const x = t.pos.x + r.x;
  const y = t.pos.y + r.y;
  // Not under the deck (a ghost would dive through its own hull).
  const fore = (x - self.pos.x) * state.dir;
  if (fore > -60 && fore < 235) return null;
  return { x, y, vx: t.vel.x, vy: t.vel.y, id: t.id, ox: r.x, oy: r.y };
}

/**
 * The nearest enemy ship with a live core of `minGuard` kg or more within `guard` m that is not the main enemy (a gun
 * panel or gun ship come close): by what the radars report, whatever robot it belongs to.
 */
function guard() {
  const main = state.last ? state.last.id : -1;
  for (const c of contacts) {
    if (c.distance > guardAt) break;
    if (c.side !== 'enemy' || !c.core || c.mass < minGuard || c.id === main) continue;
    const fore = (c.pos.x - self.pos.x) * state.dir;
    if (c.pos.y < self.pos.y - 4 && fore > -40 && fore < 215) continue;
    return c;
  }
  return null;
}
