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
// - Quiet ghosts (r5, 2026-10): a ghost sent `hushFar` m or more has its pod lit as it leaves the bay. Hive, Bastion
//   and Woodpecker find a launcher hidden in a bubble by where its darts are first seen; lit there, a ghost is first
//   seen 300 to 400 m out, on its way to them, and their darts go to that empty spot instead of the hull.
// - Hidden enemies (r5, 2026-10): the other way round, where an enemy's new darts are first seen tells where it
//   hides. With nothing in sight, volleys go there (or to a still big one's own last place near it), and the hull
//   holds its standoff from there.
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
const roam = param('roam', 900, { min: 100, max: 100000 }); // m: in an open sandbox it keeps within this of where it started, either way (r5: backing off from a ram that kept coming, it was pushed off the end of the ground)
const ceiling = arena ? Math.min(roof, arena.y - roofIn) : roof;
const tiltRate = (param('tiltRate', 2, { min: 0.1, max: 30 }) * Math.PI) / 180; // degrees a second the lean may change
const tilt = (param('tilt', 6, { min: 0, max: 20 }) * Math.PI) / 180; // degrees it leans its lift to move sideways (titans v2, 2026-10)
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
const guardAt = param('guardAt', 450, { min: 0, max: 1000 }); // m: an enemy ship this close gets the waves the main enemy cannot
const minGuard = param('minGuard', 30, { min: 0, max: 100000 }); // kg: lighter ones (darts) never do
const cutBelow = param('cutBelow', 35, { min: 0, max: 200 }); // m under its height where it cuts what reaches up from below
const hunt = param('hunt', 60, { min: 0, max: 600 }); // s the heaviest enemy is remembered out of sight
const huntAt = param('huntAt', 700, { min: 100, max: 1000 }); // m from its last place the hull closes to (inside radar reach)
const hideAt = param('hideAt', 1050, { min: 100, max: 2000 }); // m from the last place of a big one that hid nearby
const still = param('still', 2, { min: 0, max: 100 }); // m/s: a big one that hid moving slower than this is still there (blind volleys at it)
const huntFar = param('huntFar', 940, { min: 0, max: 2000 }); // m: the big one seen last further than this went out of reach and is hunted; nearer, it hid
const awake = param('awake', 20, { min: 1, max: 600 }); // s: in an open sandbox it keeps its cloak up this long after it last saw an enemy
const lostAt = param('lostAt', 900, { min: 50, max: 2000 }); // m: one that vanished further off went out of the radars' reach and is forgotten
const hush = param('hush', 1, { min: 0, max: 1 }); // 1: a ghost's pod is lit as it is let go (its first sighting gave the hull away)
const viaOut = param('viaOut', 45, { min: 0, max: 500 }); // m past the end of the hull a ghost sent at something under it goes first
const viaUp = param('viaUp', 25, { min: 0, max: 200 }); // m over the core's height there
const hushFar = param('hushFar', 450, { min: 0, max: 2000 }); // m: only for a point this far (the pod blinds the ghost's own seeker and radio for its 5 s)
const clueSpeed = param('clueSpeed', 10, { min: 0, max: 500 }); // m/s: a new light enemy slower than this tells nothing of its launcher
const clueNear = param('clueNear', 160, { min: 0, max: 1000 }); // m: one first seen nearer the hull came out of a bubble by it
const clueFar = param('clueFar', 950, { min: 100, max: 2000 }); // m: one first seen further off may only have come into the radars' reach
const clueBack = param('clueBack', 0.3, { min: 0, max: 5 }); // s back along its path to where it came from
const clueAge = param('clueAge', 12, { min: 1, max: 120 }); // s a first sighting counts
const clueKeep = param('clueKeep', 6, { min: 1, max: 50 }); // first sightings kept
const debug = param('debug', 0, { min: 0, max: 1 });

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
  // How far the hull reaches along the bow from the core, both ways (r5: a ghost sent at something under it goes out
  // past the nearer end).
  let lo = 0;
  let hi = 0;
  const d = state.dir || 1;
  for (const p of parts) {
    const f = (p.pos.x - self.pos.x) * d;
    if (f < lo) lo = f;
    if (f > hi) hi = f;
  }
  state.foreMin = lo;
  state.foreMax = hi;
  for (let k = 0; k < strips; k++) if (cap[k] > 0) arm[k] /= cap[k];
  state.cap = cap;
  state.arm = arm;
  state.ff = ff;
  state.fr = fr;
  if (ff > 0 || fr > 0) state.dir = bow - stern >= 0 ? 1 : -1;
}

/**
 * Throttles for the lift strips (titans v2, 2026-10): strip k runs at clamp(u + b * arm[k], 0, 1), a lean along the
 * hull, with u and b set so the strips give the lift (N) and the turning (`torque`, N m about the center of mass)
 * asked. Solved straight out (two sums, two unknowns), then again with every strip that ran past empty or full held
 * there, a few times at most. Level comes first: when both cannot be had (strips shot away), the lift asked is cut
 * until the turning can still be had, so it sinks level instead of rolling. (Found by halving before: about a hundred
 * passes over the strips a tick, a third of the hull's script time.)
 */
function share(lift, torque) {
  const cap = state.cap;
  const arm = state.arm;
  const n = cap.length;
  const out = [];
  const slack = 0.05 * Math.abs(torque) + 2000;
  for (let tries = 0; tries < 4; tries++) {
    const held = []; // -1 free, 0 empty, 1 full
    for (let k = 0; k < n; k++) held.push(cap[k] > 0 ? -1 : 0);
    let u = 0;
    let b = 0;
    for (let pass = 0; pass < 5; pass++) {
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let l = lift;
      let t = torque;
      for (let k = 0; k < n; k++) {
        if (held[k] === 1) {
          l -= cap[k];
          t -= cap[k] * arm[k];
        } else if (held[k] < 0) {
          s0 += cap[k];
          s1 += cap[k] * arm[k];
          s2 += cap[k] * arm[k] * arm[k];
        }
      }
      const det = s0 * s2 - s1 * s1;
      if (!(det > 1e-6 * s0 * s2)) {
        // One strip left (or all at one place): it can only lift.
        b = 0;
        u = s0 > 0 ? l / s0 : 0;
        break;
      }
      u = (l * s2 - t * s1) / det;
      b = (s0 * t - s1 * l) / det;
      let moved = false;
      for (let k = 0; k < n; k++) {
        if (held[k] >= 0) continue;
        const r = u + b * arm[k];
        if (r < 0 || r > 1) {
          held[k] = r < 0 ? 0 : 1;
          moved = true;
        }
      }
      if (!moved) break;
    }
    let got = 0;
    for (let k = 0; k < n; k++) {
      out[k] = held[k] < 0 ? clamp(u + b * arm[k], 0, 1) : held[k];
      got += cap[k] * out[k] * arm[k];
    }
    if (Math.abs(got - torque) <= slack) break;
    lift *= 0.75;
  }
  return out;
}

function setup() {
  state.x0 = self.pos.x;
  state.lo = arena ? -edge : self.pos.x - roam; // where it may fly its core, along x
  state.hi = arena ? edge : self.pos.x + roam;
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
  state.ids = {}; // light enemies seen, by contact id: when first seen
  state.clues = []; // where new light enemies came from: { x, y, at }
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
    if (c.mass < minMass) {
      clue(c);
      continue;
    }
    if (mem && c.id === mem.id) kept = c;
    if (!heaviest || c.mass > heaviest.mass) heaviest = c;
  }
  const main = kept && !(heaviest && heaviest.mass > 2 * kept.mass) ? kept : heaviest;
  // The big one (titans v2, 2026-10): the heaviest enemy seen, remembered `hunt` s after it went out of sight (out of
  // radar reach, most likely). With nothing else in sight the hull closes in on its last place until the radars find
  // it again, instead of waiting where it started. Forgotten when seen dead. (Keeping its place by the big one while
  // fighting a lighter one in sight lost Mirage its wins over Shatter: it stayed back from the king.)
  const big = state.big;
  if (heaviest && (!big || heaviest.id === big.id || heaviest.mass >= big.mass)) {
    state.big = { id: heaviest.id, x: heaviest.pos.x, y: heaviest.pos.y, mass: heaviest.mass, at: time, d: heaviest.distance, vx: heaviest.vel.x, vy: heaviest.vel.y };
  } else if (big && (bigGone || time - big.at > hunt)) state.big = null;
  if (main) {
    state.last = { id: main.id, x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, at: time, d: main.distance };
    state.everSeen = true;
  } else if (mem && (gone || time - mem.at > memory || mem.d > lostAt)) {
    state.last = null;
  }
  return main;
}

/**
 * A light enemy seen for the first time, moving: where it came from (back along its path) is about where its launcher
 * is, which may be hiding in a jammer's bubble (r5, 2026-10: Hive and Bastion hid all match and Mirage never fired at
 * them). Not one first seen close by (it came out of a bubble near the hull) or far out (it only came into reach).
 */
function clue(c) {
  if (state.ids[c.id] !== undefined) return;
  state.ids[c.id] = time;
  if (c.vel.x * c.vel.x + c.vel.y * c.vel.y < clueSpeed * clueSpeed || c.distance < clueNear || c.distance > clueFar) return;
  state.clues.push({ x: c.pos.x - c.vel.x * clueBack, y: Math.max(1, c.pos.y - c.vel.y * clueBack), at: time });
  if (state.clues.length > clueKeep) state.clues.shift();
}

/** The middle of the fresh clues, or null. */
function clueAt() {
  let n = 0;
  let x = 0;
  let y = 0;
  for (const k of state.clues) {
    if (time - k.at > clueAge) continue;
    n++;
    x += k.x;
    y += k.y;
  }
  return n > 0 ? { x: x / n, y: y / n, n } : null;
}

function tick() {
  if (frame % 30 === 0) measure();
  if (frame % 600 === 0) for (const id in state.ids) if (time - state.ids[id] > 120) delete state.ids[id];

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
  const away = b && !t && time - b.at > 1;
  const hid = t ? null : clueAt();
  if (debug > 0 && frame % 300 === 0) log('t ' + (t ? t.id + ' ' + t.distance.toFixed(0) : '-') + ' last ' + (state.last ? state.last.id : '-') + ' big ' + (b ? b.id + '@' + b.x.toFixed(0) + ',' + b.y.toFixed(0) + ' age ' + (time - b.at).toFixed(0) : '-') + ' clue ' + (hid ? hid.n + '@' + hid.x.toFixed(0) + ',' + hid.y.toFixed(0) : '-') + ' energy ' + (self.energy.stored / Math.max(1, self.energy.capacity)).toFixed(2) + ' y ' + self.pos.y.toFixed(0));
  const stillBig = b && !t && Math.hypot(b.vx, b.vy) < still && (!hid || Math.hypot(b.x - hid.x, b.y - hid.y) < 200);
  if (hid && !stillBig) {
    // Hidden, but its darts tell where it is: hold the standoff from there, inside the radars' reach of its next ones.
    // (Not from a still one that hid there: that is held off `hideAt` as before, out of reach of guns it cannot see.)
    if (state.side === 0) state.side = sign(self.pos.x - hid.x) || -state.dir;
    want = hid.x + state.side * standoff;
  } else if (away) {
    // The big one is out of sight. Gone out of the radars' reach (seen last further than `huntFar`): close in to
    // `huntAt` m of where it was last until the radars find it again. Vanished nearer (into a jammer's bubble or
    // smoke): hold `hideAt` from where it was last, out of reach of guns it cannot see. (Closing in on one that only
    // hid let Bastion's guns shoot the hull down from 600 m, then end its core on the ground: 6 losses of 6, where v1
    // backed off to 1050 m and drew; at 880 m it was still shot down.)
    if (state.side === 0) state.side = sign(self.pos.x - b.x) || -state.dir;
    // A still one is never hunted (r5, 2026-10: Bastion seen once 1060 m off, its bubble lit again, and the hull closed
    // to 700 m of it and was shot down in 54 s): it did not go out of reach, it is where it was.
    want = b.x + state.side * (b.d > huntFar && !stillBig ? huntAt : hideAt);
  } else if (t) {
    if (state.side === 0) state.side = self.pos.x === t.pos.x ? -state.dir : sign(self.pos.x - t.pos.x);
    const held = Math.abs(clamp(t.pos.x + state.side * standoff, state.lo, state.hi) - t.pos.x);
    const other = Math.abs(clamp(t.pos.x - state.side * standoff, state.lo, state.hi) - t.pos.x);
    if (held < cornered && other > held + 200) state.side = -state.side;
    want = t.pos.x + state.side * standoff;
    // On its own side it never comes nearer the middle than where it started (that is where everyone looks first).
    // Unless that leaves it out of a volley's reach (r5, 2026-10: Hive held 1050 m off and nothing went for 50 s).
    if (arena && state.side === -state.dir) {
      const held = state.side * Math.max(state.side * want, state.side * state.x0);
      if (Math.abs(held - t.pos.x) < reach - 60) want = held;
    }
  }
  want = clamp(want, state.lo, state.hi);
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
  // It never leans while it is sinking or low (the lift is for holding it up first), and the lean changes by at most
  // `tiltRate` a second: leaning hard one way and the other while it dodged, it lost its height and came down.
  const lack = Math.abs(rest) > 0.4 ? rest - 0.4 * sign(rest) : 0;
  const sinking = self.vel.y < -2 || self.pos.y < high - 25;
  const goal = sinking ? 0 : clamp(-Math.atan2(lack, 9.81), -tilt, tilt);
  state.tip += clamp(goal - state.tip, -tiltRate * dt, tiltRate * dt);
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
  if (debug > 0 && frame % 300 === 0) log('bays alive ' + alive + ' ready ' + ready + ' angle ' + (self.angle * 57.3).toFixed(0));
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
    // Except a heavy one pushing up from under it (r5, 2026-10: Anvil sat under the hull for 50 s and carried it
    // across the arena while nothing went for it): the ghosts go out past the nearer end of the hull first.
    const ram = under && t.mass >= heavy && t.distance < danger;
    if (t.distance <= reach && (!under || ram)) aim = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id };
    if (aim && ram) {
      const out = fore - state.foreMin < state.foreMax - fore ? state.foreMin - viaOut : state.foreMax + viaOut;
      aim.via = { x: self.pos.x + state.dir * out, y: self.pos.y + viaUp };
    }
    // What threatens the hull most comes first: the part of a heavy enemy below that reaches up to its height (a
    // mast that would shove it) gets every wave until it is cut. With the main enemy out of a ghost's way (out of
    // reach, or under the deck), the nearest gun ship come close gets the wave instead of none. (Every other wave at
    // gun ships whatever the main enemy did no good against Palisade's panels and spared Shatter's king.)
    const r = reaching(t);
    const g = r || aim ? null : guard();
    if (r) aim = r;
    else if (g) aim = { x: g.pos.x, y: g.pos.y, vx: g.vel.x, vy: g.vel.y, id: g.id };
  } else if (stillBig && Math.hypot(state.big.x - self.pos.x, state.big.y - self.pos.y) <= reach + 200) {
    // A big one that hid standing still is still where it was seen (a fort under its own bubble does not move):
    // every volley goes there, not one every `blindGap` s (r5: bays stood full for 40 s while Bastion's darts came).
    const b = state.big;
    aim = { x: b.x, y: b.y, vx: 0, vy: 0, id: b.id };
  } else if (hid && Math.hypot(hid.x - self.pos.x, hid.y - self.pos.y) <= reach + 200) {
    // Hidden, where its darts came from: volleys there as at one in sight (a ghost's seeker sees through a bubble
    // within 150 m, and it follows the heaviest live enemy it finds near its point).
    // A big one that hid standing still near there is still where it was seen: its own place is the surer one.
    const b = state.big;
    if (b && Math.hypot(b.vx, b.vy) < still && Math.hypot(b.x - hid.x, b.y - hid.y) < 200) aim = { x: b.x, y: b.y, vx: 0, vy: 0, id: b.id };
    else aim = { x: hid.x, y: hid.y, vx: 0, vy: 0 };
  } else if (going || time - state.lastSalvo >= blindGap) {
    // Nothing tracked: the place it vanished (kept `memory` s, carried on by its speed for a moment), else the place
    // the big one hid if it stood still there (a fort under its own bubble does not move; titans v2, 2026-10: Bastion
    // hid from the first seconds and got one volley in four minutes), else, with nothing ever seen, the mirror of the
    // start. Seen once and gone off moving: no salvo.
    const l = state.last;
    const b = state.big;
    if (l) {
      const age = Math.min(time - l.at, 2);
      aim = { x: l.x + l.vx * age, y: Math.max(1, l.y + l.vy * age), vx: 0, vy: 0, id: l.id };
    } else if (b && b.d <= huntFar && Math.hypot(b.vx, b.vy) < still) aim = { x: b.x, y: b.y, vx: 0, vy: 0, id: b.id };
    else if (!state.everSeen) aim = { x: -state.x0, y: groundY, vx: 0, vy: 0 };
    if (aim && Math.hypot(aim.x - self.pos.x, aim.y - self.pos.y) > reach + 200) aim = null;
  }
  if (!aim) return;
  // This wave: up to `wave` ready bays, as far apart along the hull as the ready ones allow (every `bays / wave`th).
  const stride = Math.max(1, Math.floor(bays / wave));
  const quiet = hush > 0 && Math.hypot(aim.x - self.pos.x, aim.y - self.pos.y) > hushFar;
  let sent = 0;
  for (let k = 0; k < stride && sent < wave; k++) {
    for (let i = (state.waves + k) % stride; i < bays && sent < wave; i += stride) {
      const tag = 'g' + String.fromCharCode(97 + i);
      if (!(get(tag, 'ready') > 0)) continue;
      send(tag + get(tag, 'built'), aim);
      if (quiet) set(tag + get(tag, 'built'), 'ignite', 1);
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
