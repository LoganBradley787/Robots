// Juggernaut pilot: the one script of the sled. It drives along the ground on two booster banks, fires the roof,
// shelf and deck guns in groups, and aims the two beam turrets on the ends of the gun deck. Enemies are picked by
// `side` only, and left and right come from where its own guns are, so it works flipped.
//
// The main enemy (titans v2, 2026-10): picked from what the radar reports, never by robot id: the heaviest enemy with
// a live core of `minMass` kg or more, kept unless one twice as heavy shows up, forgotten when it is seen as debris.
// One that vanished alive (jammed, hidden) stays the main enemy: the beams keep burning where it was last seen, and
// gun sights that read its id bring the sled back under it. After a win it goes after the next enemy that shows up.
//
// What it does with the main enemy:
// - With an arena edge (`arena`, a duel): on the ground it rams it and keeps pushing, nose first, until it is past
//   the edge. In the air and light, or low, it drives its mast through it, toward the edge. In the air, heavy and
//   high, it parks under it and lets the guns and beams work.
// - Without an edge (the sandbox) pushing wins nothing, so it does not chase things across the world: it closes in,
//   stops with the nose (or the tail) against a ground enemy, or parks under a flier, and lets the beams end its core.
// - Siege (titans v2): whenever it pushes hard and does not move (a roped base), it backs off and runs at it once. If
//   that does not move it either, it stays with its nose against it and burns down to its core with the beams. (It
//   used to retire to the far corner for good, and those fights were draws.) With no beam left on that side it does
//   retire, to the far corner or `standBack` m off: beside a fortress its darts tunnel to the core in about 20 s, and a
//   run at something roped only breaks its own nose.
// - Not seen (hidden, jammed): with an edge it patrols the whole arena, corner to corner. Without one it patrols
//   `roam` m either side of where it last saw an enemy, and after `rest` s with nothing seen it stops to save energy
//   (a radar sees 1000 m). Gun sights are not sensors: when one reads the main enemy overhead, it parks the deck
//   under it and fires there.
//
// The beams: each turret (a rotator carrying a laser, `rotF`/`laserF` facing the nose, `rotB`/`laserB` the tail)
// points at the main enemy's core (contacts report the core's own position) and burns only while its sight says the
// first thing on the line is an enemy within reach, or a wreck hanging just in front of the target. A beam burns
// armor in full, so a core under 20 plates is about 10 s of beam. It never burns its own robot, a friend, or air.
//
// The ram's speed: a hit changes each body's speed by closing * (the other's mass) / (both masses), and plates near
// the contact break when their own body's change passes 24 m/s. So it never closes faster than keeps its own change
// under `ownDv`.

const top = param('top', 55, { min: 5, max: 90 }); // fastest it drives at something, m/s
const ownDv = param('ownDv', 22, { min: 5, max: 40 }); // the most speed change it takes in a ram, m/s
const minMass = param('minMass', 30, { min: 0, max: 100000 }); // kg: the main enemy is never lighter (darts, pods)
const swatMass = param('swatMass', 1500, { min: 0, max: 100000 }); // heavier than this and above the deck, it is not swept
const front = param('front', 49.5); // core to the nose's face, m (the generator sets these nine)
const back = param('back', 50.5);
const roof = param('roof', 24.5); // core up to the roof guns' muzzles
const deckTop = param('deckTop', 104.5); // core up to the deck guns' muzzles
const reach = param('reach', 248.5); // core up to the spar's top
const deck = param('deck', 39.5, { min: -500, max: 500 }); // core to the gun deck's middle, along the hull
const mast = param('mast', 36.5, { min: -500, max: 500 }); // core to the mast, along the hull
const ramTop = param('ramTop', 30, { min: 5, max: 90 }); // how fast it rams what blocks it, m/s
const bins = param('bins', 30); // gun groups, tags bin0, bin1, ...
const margin = param('margin', 45, { min: 5, max: 500 }); // m inside the arena's edge it keeps its core
const blind = param('blind', 12, { min: 0, max: 100 }); // holding under a hidden robot, guns this near that place fire unseen, m
const chase = param('chase', 58, { min: 5, max: 90 }); // fastest it follows something overhead, m/s
const patrolTop = param('patrolTop', 38, { min: 1, max: 80 }); // how fast it patrols, m/s
const wait = param('wait', 6, { min: 0, max: 60 }); // s parked with no sight of it before it patrols again
const stall = param('stall', 2.5, { min: 0.5, max: 60 }); // s pushing without moving before it backs off for another run
const tiltMax = param('tiltMax', 10, { min: 1, max: 90 }); // degrees: tilted more than this (riding up on something), it stops pushing
const low = param('low', 0.1, { min: 0, max: 1 }); // under this share of its energy it stops driving
const huge = param('huge', 600, { min: 10, max: 100000 }); // parts: a robot bigger than this is never scanned whole, only its extremes
const gap = param('gap', 30, { min: 0, max: 200 }); // m between its nose (or tail) and a ground enemy it besieges (clear of what it launches from its edge)
const weaveAmp = param('weaveAmp', 25, { min: 0, max: 200 }); // m either way it drifts while parked under something
const weavePeriod = param('weavePeriod', 14, { min: 2, max: 120 }); // s for one drift there and back
const standBack = param('standBack', 700, { min: 100, max: 2000 }); // m it keeps from a ground enemy it cannot move nor burn, with no arena edge
const roam = param('roam', 300, { min: 0, max: 2000 }); // m either side of the last sighting it patrols with no arena edge
const rest = param('rest', 60, { min: 0, max: 3600 }); // s with nothing seen before it stops to save energy (no arena edge)
const forget = param('forget', 90, { min: 5, max: 3600 }); // s unseen before a main enemy that vanished alive is let go
const memory = param('memory', 10, { min: 0, max: 60 }); // s the beams keep burning where the main enemy was last seen
const beamReach = param('beamReach', 295, { min: 10, max: 300 }); // m: the laser's range (the laser part's is 300)
const margin2 = (param('swingMargin', 2, { min: 0, max: 30 }) * Math.PI) / 180; // degrees short of a rotator's full range a turret turns
const gain = param('gain', 8, { min: 0.1, max: 50 }); // turret turn rate per radian off the aim
const guard = param('guard', 220, { min: 0, max: 300 }); // m: light things coming at it within this are burnt first
const incoming = param('incoming', 15, { min: 0, max: 200 }); // m/s: closing at least this fast counts as coming at it
const repick = param('repick', 0.5, { min: 0.1, max: 10 }); // s between choosing which part of the main enemy a beam burns
// A rotator's reach either way and fastest turn (the rotator and heavyrotator parts).
const ROT = { rotator: { range: Math.PI / 2, rate: 2 }, heavyrotator: { range: 2.0944, rate: 1 } };
// What a beam goes for first: what launches darts or carries a blast (burning one still on its robot sets it off
// there), then the main core (ending it ends the fight), each over the health to burn through to it, its own and that
// of everything in front of it on the line. A fortress's bays sit in open wells and cost a few hundred; its core under
// 20 plates costs 5000, so the bays go first and the darts stop coming.
const WORTH = { fabbay: 5, heavywarhead: 6, warhead: 4, charge: 4, laser: 6, cannon: 6, lance: 4, core: 2 };
const MAIN_CORE = 40;
const PICK = Object.keys(WORTH);
const reserve = param('reserve', 0.03, { min: 0, max: 1 }); // share of energy the beams never burn into (driving stops at `low`, so the beams get the last of it)
const SIGHT_ENEMY = 3;
const SIGHT_NONE = 4;

let guns = []; // guns[b]: the live gun parts of group b
let turrets = []; // { rot, laser } still whole

function survey() {
  guns = [];
  for (let b = 0; b < bins; b++) guns.push([]);
  let nf = 0, nr = 0;
  let rotF = null, rotB = null, lasF = null, lasB = null;
  for (const p of parts) {
    const t0 = p.tags[0];
    if (p.type === 'booster') {
      if (t0 === 'fwd') nf++;
      else if (t0 === 'rev') nr++;
      continue;
    }
    if (p.type === 'rotator' || p.type === 'heavyrotator') {
      if (t0 === 'rotF') rotF = p;
      else if (t0 === 'rotB') rotB = p;
      continue;
    }
    if (p.type === 'laser') {
      if (t0 === 'laserF') lasF = p;
      else if (t0 === 'laserB') lasB = p;
      continue;
    }
    if (p.type !== 'gun') continue;
    for (const t of p.tags) {
      if (t.length > 3 && t.charCodeAt(0) === 98 && t.charCodeAt(1) === 105 && t.charCodeAt(2) === 110) {
        const b = Number(t.slice(3));
        if (b >= 0 && b < bins) guns[b].push(p);
        break;
      }
    }
  }
  turrets = [];
  if (rotF && lasF) turrets.push({ rot: rotF, laser: lasF, rotTag: 'rotF', laserTag: 'laserF', key: 'F' });
  if (rotB && lasB) turrets.push({ rot: rotB, laser: lasB, rotTag: 'rotB', laserTag: 'laserB', key: 'B' });
  state.nf = nf; // boosters left in each bank
  state.nr = nr;
  // Which way the nose points: the highest group left sits toward the nose, the lowest toward the tail.
  let lo = -1, hi = -1;
  for (let b = 0; b < bins; b++) {
    if (!guns[b].length) continue;
    if (lo < 0) lo = b;
    hi = b;
  }
  if (lo >= 0 && hi > lo) state.dir = guns[hi][0].pos.x > guns[lo][0].pos.x ? 1 : -1;
}

/**
 * A huge robot's (more than `huge` parts) leftmost, rightmost, lowest, and highest parts: the parts nearest points far
 * off each way, four scans of one part instead of thousands of parts handed over. Null when it is not seen.
 */
function extremes(t) {
  const out = [];
  for (const [dx, dy] of [[-1e6, 0], [1e6, 0], [0, -1e6], [0, 1e6]]) {
    const one = scan(t.id, { near: { x: t.pos.x + dx, y: t.pos.y + dy }, most: 1 });
    if (!one) return null;
    for (const p of one) out.push(p);
  }
  return out;
}

function setup() {
  state.dir = self.pos.x > 0 ? -1 : 1; // until the guns say: the nose faces the middle
  state.side = self.pos.x > 0 ? -1 : 1; // the other side's half
  state.restY = self.pos.y; // the core's height with the wheels on the ground
  // The arena's edge, read once (it never changes in a run); none in the sandbox (titans v2: was a typed-in 955).
  state.edge = arena ? Math.max(100, arena.x - margin) : Infinity;
  state.home = self.pos.x; // where it patrols around with no edge, until it has seen an enemy
  state.tid = -1;
  state.tmass = 0;
  state.last = null; // { x, y, vx, vy, t } where the main enemy's core was last seen
  state.scanAt = -1000;
  state.ext = { lx: -2, hx: 2, ly: -1, hy: 1 };
  state.pressed = 0;
  state.ram = 0; // 0 driving, 1 backing off from what blocks it, 2 running at it
  state.ramX = 0;
  state.ramDir = 1;
  state.ramSince = 0;
  state.fails = 0; // runs in a row that ended blocked at the same place
  state.failX = 1e9;
  state.siege = -1; // the id of a ground enemy it could not move, held against and burnt down
  state.lastRun = -1000;
  state.nf = 1;
  state.nr = 1;
  state.leg = 0;
  state.holdX = null;
  state.holdSeen = -1000;
  state.idleSince = 0;
  state.beam = {};
  state.lowBeam = false;
  state.said = '';
  survey();
}

function say(what) {
  if (state.ram !== 0 && what !== 'back off' && what !== 'run at it') return;
  if (state.said === what) return;
  state.said = what;
  log(what);
}

/**
 * Meters to add to where it parks under something: it never sits still there. Darts aim where a robot will be from
 * how it moves when they leave; a sled parked under a carrier for 45 s had its core tunneled to by them (titans v2).
 */
function weave() {
  return weaveAmp * Math.sin((2 * Math.PI * time) / weavePeriod);
}

/** True when the radar sees robot `id` and it is lighter than `minMass`. */
function light(id) {
  for (const c of contacts) if (c.id === id) return c.mass < minMass;
  return false;
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Speed toward a spot `err` m away that it can still stop at, at most `cap`. */
function toward(err, a, cap) {
  return sign(err) * Math.min(cap, Math.sqrt(2 * 0.6 * a * Math.abs(err)));
}

/**
 * Where on the main enemy a beam burns: every `repick` s (one turret a tick, and only with a scan to spare) the part
 * worth most per health burnt, scanned from the barrel with the health in front of each part; kept as an offset from
 * the enemy's core, so between picks it follows the enemy. `at` is the core, led a tick.
 */
function pickPoint(st, at, from) {
  if (at.id !== st.id) {
    st.id = at.id;
    st.off = null;
    st.picked = -1e9;
  }
  if (!at.ghost && time - st.picked >= repick && state.pickFrame !== frame && state.scanFrame !== frame) {
    state.pickFrame = frame;
    st.picked = time;
    const list = scan(at.id, { of: PICK, from, wide: 0.6, most: 40 });
    st.off = null;
    if (list && list.length > 1) {
      let core = null;
      let dc = 1e9;
      for (const p of list) {
        if (p.type !== 'core') continue;
        const d = Math.hypot(p.pos.x - at.x, p.pos.y - at.y);
        if (d < dc) {
          dc = d;
          core = p;
        }
      }
      if (!core || dc >= 2) {
        // Its main core was not among the nearest: ask for the part at the core's place on its own.
        const one = scan(at.id, { near: { x: at.x, y: at.y }, most: 1, from, wide: 0.6 });
        if (one && one.length && one[0].type === 'core') {
          core = one[0];
          dc = 0;
          list.push(core);
        }
      }
      let best = null;
      let bs = 0;
      for (const p of list) {
        const w = p === core && dc < 2 ? MAIN_CORE : WORTH[p.type] || 1;
        const sc = w / (Math.max(1, p.health) + (p.cover || 0));
        if (sc > bs) {
          bs = sc;
          best = p;
        }
      }
      if (best) st.off = { x: best.pos.x - at.x, y: best.pos.y - at.y, type: best.type };
    }
  }
  return st.off ? { x: at.x + st.off.x, y: at.y + st.off.y, id: at.id } : at;
}

/**
 * Points one turret at `at` (a point, or null for none) and burns when the line is right. A turret turns `swing`
 * either way from how it was built; a point outside that is left alone (the other turret may have it).
 */
function aimTurret(t, at, charged) {
  const laser = t.laser;
  const aim = laser.out.aim;
  const turned = t.rot.out.angle; // -1 to 1 of its range
  const spec = ROT[t.rot.type] || ROT.rotator;
  const swing = spec.range - margin2;
  const rate = spec.rate;
  const restAim = aim - turned * spec.range;
  const st = state.beam[t.key] || (state.beam[t.key] = { want: null, picked: -1e9, off: null, id: -1 });
  const from = { x: laser.pos.x + 0.5 * Math.cos(aim), y: laser.pos.y + 0.5 * Math.sin(aim) };
  // Point defense first: something light coming at us fast (a dart, a drone bomb) within `guard` m that this turret
  // can swing to, soonest to arrive first. A fortress's first volley took the front turret before it got in range.
  let threat = null;
  let soonest = 1e9;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass >= minMass || c.distance > guard) continue;
    const rx = c.pos.x - from.x;
    const ry = c.pos.y - from.y;
    const d = Math.max(0.5, Math.hypot(rx, ry));
    const rvx = c.vel.x - self.vel.x;
    const rvy = c.vel.y - self.vel.y;
    const closing = -(rx * rvx + ry * rvy) / d;
    if (closing < incoming || Math.abs(wrap(Math.atan2(ry, rx) - restAim)) > swing) continue;
    if (d / closing < soonest) {
      soonest = d / closing;
      threat = { x: c.pos.x + rvx * dt, y: c.pos.y + rvy * dt, id: -1 };
    }
  }
  if (threat) at = threat;
  else if (at && at.id >= 0) at = pickPoint(st, at, from);
  let fire = 0;
  if (!at) {
    st.want = null;
    set(t.rotTag, 'turn', clamp(-3 * turned, -1, 1));
  } else {
    let dx = at.x - from.x;
    let dy = at.y - from.y;
    let want = Math.atan2(dy, dx);
    let off = wrap(want - restAim);
    if (Math.abs(off) > swing) {
      // The main enemy is on the other turret's side: take the nearest enemy this one can swing to (a dart, a drone).
      for (const c of contacts) {
        if (c.side !== 'enemy' || !c.core || c.distance > beamReach + 100) continue;
        const ex = c.pos.x - from.x;
        const ey = c.pos.y - from.y;
        const a2 = Math.atan2(ey, ex);
        if (Math.abs(wrap(a2 - restAim)) > swing || Math.hypot(ex, ey) > beamReach) continue;
        dx = ex;
        dy = ey;
        want = a2;
        off = wrap(want - restAim);
        break;
      }
    }
    const dist = Math.hypot(dx, dy);
    const inside = Math.abs(off) <= swing;
    if (!inside) want = restAim + sign(off) * swing;
    // The aim point moves: turn at its rate, plus a push toward it, less its own robot's spin.
    const moving = st.want === null ? 0 : wrap(want - st.want) / dt;
    st.want = want;
    const err = wrap(want - aim);
    set(t.rotTag, 'turn', clamp((moving - self.angVel + gain * err) / rate, -1, 1));
    const side = laser.out.sightSide;
    const sight = laser.out.sight;
    // Whatever enemy is first on the line (a dart, a panel in front of the core) burns too, and so does a wreck short of
    // the target (parts burnt off a fortress lie in the tunnel; only allowing ones near the target left the beam off
    // most of the time). Not one right at the barrel: that may be a piece of its own.
    const wreck = side === SIGHT_NONE && sight > 8 && sight < dist + 2;
    if (charged && inside && dist <= beamReach + 5 && Math.abs(err) < 0.05 && (side === SIGHT_ENEMY || wreck)) fire = 1;
  }
  set(t.laserTag, 'fire', fire);
  return fire;
}

function tick() {
  if (frame % 20 === 0) survey();
  const me = self.pos;
  const vx = self.vel.x;
  const M = self.mass;
  const dir = state.dir;
  const edgeX = state.edge;
  const open = edgeX === Infinity; // no arena edge: the sandbox
  // What each bank gives now, with some held back for drag: boosters are counted, so a chewed bank is known.
  const aR = Math.max((0.8 * 400 * (dir > 0 ? state.nf : state.nr)) / Math.max(M, 1), 0.05); // toward +x
  const aL = Math.max((0.8 * 400 * (dir > 0 ? state.nr : state.nf)) / Math.max(M, 1), 0.05); // toward -x
  const a = Math.min(aR, aL);

  // The main enemy: the heaviest enemy with a live core, kept unless one twice as heavy shows up; let go when it is
  // seen as debris, or after `forget` s unseen.
  let cur = null;
  let best = null;
  for (const c of contacts) {
    if (c.id === state.tid && (c.side !== 'enemy' || !c.core)) {
      state.tid = -1; // a wreck now: done with it
      state.last = null;
      continue;
    }
    if (c.side !== 'enemy' || !c.core || c.mass < minMass) continue;
    if (c.id === state.tid) cur = c;
    if (!best || c.mass > best.mass) best = c;
  }
  let T = cur && !(best.mass >= 2 * cur.mass) ? cur : best;
  if (state.tid >= 0 && !T && state.last && time - state.last.t > forget) {
    state.tid = -1;
    state.last = null;
  }
  if (T) {
    if (T.id !== state.tid || frame - state.scanAt >= 30) {
      state.scanFrame = frame; // the beams leave their pick for another tick
      const s = T.parts > huge ? extremes(T) : scan(T.id);
      if (s && s.length) {
        let lx = 1e9, hx = -1e9, ly = 1e9, hy = -1e9;
        for (const p of s) {
          const x = p.pos.x, y = p.pos.y;
          if (x < lx) lx = x;
          if (x > hx) hx = x;
          if (y < ly) ly = y;
          if (y > hy) hy = y;
        }
        state.ext = { lx: lx - T.pos.x - 0.5, hx: hx - T.pos.x + 0.5, ly: ly - T.pos.y - 0.5, hy: hy - T.pos.y + 0.5 };
      } else if (T.id !== state.tid) state.ext = { lx: -2, hx: 2, ly: -1, hy: 1 };
      state.scanAt = frame;
      if (T.id !== state.tid) {
        state.fails = 0;
        state.failX = 1e9;
        if (state.siege !== T.id) state.siege = -1;
        log('main enemy: robot ' + T.id + ', ' + Math.round(T.mass) + ' kg');
      }
      state.tid = T.id;
    }
    state.tmass = T.mass;
    state.last = { x: T.pos.x, y: T.pos.y, vx: T.vel.x, vy: T.vel.y, t: time };
    state.home = T.pos.x;
    state.holdX = null;
    state.idleSince = time;
  } else if (state.tid >= 0 && state.last && time - state.last.t < (state.last.y < self.pos.y + roof ? forget : memory)) {
    // Lost from sight (a jammer bubble, smoke): keep going for where it was, as if still seen; for something on the
    // ground (it does not go far) until it is forgotten, for a flier only a few seconds.
    T = { id: state.tid, pos: { x: state.last.x, y: state.last.y }, vel: { x: 0, y: 0 }, mass: state.tmass, ghost: true };
  }

  const nose = me.x + dir * front;
  const tail = me.x - dir * back;
  const myL = Math.min(nose, tail);
  const myR = Math.max(nose, tail);
  const mid = (myL + myR) / 2;
  const roofY = me.y + roof;

  let vdes = 0;
  let overhead = null; // [left, right] in world x of what the guns should reach, already led
  let held = null; // the x it holds under with nothing seen
  let besiege = false;
  if (T) {
    const e = state.ext;
    const tl = T.pos.x + e.lx;
    const tr = T.pos.x + e.hx;
    const tlo = T.pos.y + e.ly;
    const tmid = (tl + tr) / 2;
    const tvx = T.vel.x;
    const m = Math.max(T.mass, 1);
    const vc = Math.min(top, (ownDv * (M + m)) / m);
    const ground = tlo < roofY - 2;
    if (ground && (open || state.siege === T.id)) {
      // Siege: stop with the nose (or the tail) against it and let the beams burn down to its core. Nothing is won by
      // pushing it with no edge, and something roped does not move.
      const s = tmid >= mid ? 1 : -1; // which way it is
      // Only with a beam that can reach that side: standing still beside a fortress lets its darts tunnel down to the
      // core in about 20 s, so with no beam there it stands back far off, out of their way, as the sled always did.
      let beam = false;
      for (const t of turrets) if ((t.key === 'F' ? dir : -dir) === s) beam = true;
      if (beam) {
        besiege = true;
        const goal = s > 0 ? tl - gap - (s === dir ? front : back) : tr + gap + (s === dir ? front : back);
        vdes = Math.abs(goal - me.x) < 1 ? tvx : tvx + toward(goal - me.x, a, ramTop);
        say('besiege robot ' + T.id);
      } else {
        const far = open ? T.pos.x - s * standBack : -s * edgeX;
        vdes = toward(far - me.x, a, patrolTop);
        say('stand back from robot ' + T.id);
      }
    } else if (ground) {
      // Level with the hull: ram it and push it out of the arena.
      const s = tmid >= mid ? 1 : -1;
      vdes = tvx + s * vc;
      say('push robot ' + T.id);
    } else if (!open && tlo < me.y + reach - 1 && (m <= swatMass || tlo < me.y + deckTop)) {
      // In the air and within the mast's height: drive the mast through it, and on, toward the edge.
      const s = tmid >= me.x + dir * mast ? 1 : -1;
      vdes = tvx + s * vc;
      say('sweep robot ' + T.id);
    } else {
      // Too high and heavy to sweep, or no edge to sweep it to: sit under its middle and let the guns and beams work.
      const err = tmid + weave() - mid;
      vdes = clamp(tvx + toward(err, a, top), -chase, chase);
      say('under robot ' + T.id);
    }
    if (tlo > roofY - 3 && tlo - roofY < 290) {
      const lead = (tvx - vx) * (Math.max(tlo - roofY, 0) / 300);
      overhead = [tl - 1 + lead, tr + 1 + lead];
    }
  } else {
    // Nothing seen: hold under what a gun sight reads; otherwise patrol (corner to corner with an edge, around the
    // last sighting without one), and with no edge rest after a while to save energy.
    const deckX = me.x + dir * deck;
    // A sight counts when it reads the main enemy, or, with none known yet, anything not seen by radar as lighter than
    // `minMass` (a trickster's darts and pods kept it holding under them, far from the robot that sent them).
    let seenAt = null;
    for (let b = bins - 1; b >= 0 && seenAt === null; b--) {
      const g = guns[b];
      if (!g) continue;
      for (const p of g) {
        if (p.out.sightSide !== 3) continue;
        const id = p.out.sightId;
        if (state.tid >= 0 ? id !== state.tid : light(id)) continue;
        seenAt = p.pos.x;
        // Where the sight ends is a part of that robot: the beams burn there.
        state.holdPt = { x: p.pos.x, y: p.pos.y + p.out.sight + 1, t: time };
        break;
      }
    }
    if (seenAt !== null) {
      if (state.holdX === null || Math.abs(seenAt - state.holdX) > 6) state.holdX = seenAt;
      state.holdSeen = time;
      state.idleSince = time;
    }
    let err;
    if (state.holdX !== null) {
      err = clamp(state.holdX - dir * deck + weave(), -edgeX, edgeX) - me.x;
      held = state.holdX;
      const quiet = time - state.holdSeen;
      if ((Math.abs(err) < 8 + weaveAmp && quiet > wait) || quiet > 45) state.holdX = null;
      say('hold under x ' + Math.round(held));
    } else if (open && time - state.idleSince > rest) {
      err = 0;
      say('rest');
    } else {
      const lo = open ? state.home - roam : state.side * edgeX;
      const hi = open ? state.home + roam : -state.side * edgeX;
      const goal = state.leg === 0 ? lo : hi;
      err = goal - me.x;
      if (Math.abs(err) < 15) state.leg = 1 - state.leg;
      say('patrol leg ' + state.leg);
    }
    vdes = toward(err, a, patrolTop);
    if (Math.abs(err) < 1) vdes = 0;
  }

  // Blocked (pushing hard and not moving: a roped wreck, something heavy): back off and run at it once; if that does
  // not move it either, besiege it. A crash breaks what is near the contact, so a run chews further in.
  if (state.ram === 1) {
    vdes = -state.ramDir * top;
    if (Math.abs(me.x - state.ramX) >= (ramTop * ramTop) / (2 * a) + 20 || time - state.ramSince > 14) state.ram = 2;
    say('back off');
  } else if (state.ram === 2) {
    vdes = state.ramDir * ramTop;
    if ((me.x - state.ramX) * state.ramDir > -8) state.ram = 0;
    say('run at it');
  }

  // Stay inside the arena: never faster toward an edge than the bank that brakes that way can stop it from.
  vdes = Math.min(vdes, Math.sqrt(2 * 0.6 * aL * Math.max(0, edgeX - me.x)));
  vdes = Math.max(vdes, -Math.sqrt(2 * 0.6 * aR * Math.max(0, edgeX + me.x)));
  if (self.energy.stored < low * self.energy.capacity) vdes = 0;

  if (state.ram === 0 && !besiege) {
    if (Math.abs(vdes) > 5 && Math.abs(vx) < 1.5) state.pressed += dt;
    else state.pressed = 0;
    if (state.pressed > stall) {
      state.pressed = 0;
      state.ramDir = sign(vdes);
      if (Math.abs(me.x - state.failX) < 40) state.fails += 1;
      else state.fails = 1;
      state.failX = me.x;
      // A beam does more to something that will not move than a run does (a run breaks its own nose too), so a ground
      // enemy that stops a push is besieged at once; anything else gets one run.
      if (T && T.pos.y < roofY && (turrets.length > 0 || state.fails >= 2)) {
        state.siege = T.id;
        log('cannot move robot ' + T.id + ': besiege it');
      } else {
        state.ram = 1;
        state.ramX = me.x;
        state.ramSince = time;
      }
    }
  }

  const err = vdes - vx;
  // Tilted or off the ground, a bank's push lifts it: coast until it is level again.
  const level = Math.abs(self.angle) < (tiltMax * Math.PI) / 180 && me.y < state.restY + 6;
  const u = !level || Math.abs(err) < 0.25 ? 0 : clamp(err / 1.5, -1, 1);
  const right = dir > 0 ? 'fwd' : 'rev'; // the bank that pushes toward +x
  const left = dir > 0 ? 'rev' : 'fwd';
  set(right, 'throttle', Math.max(u, 0));
  set(left, 'throttle', Math.max(-u, 0));

  // Beams: at the main enemy's core, where it is or (for `memory` s) where it was last seen, led a tick.
  const cap = self.energy.capacity;
  const share = cap > 0 ? self.energy.stored / cap : 0;
  const charged = state.lowBeam ? share > reserve + 0.02 : share > reserve;
  if (charged === state.lowBeam) log(charged ? 'beams back on' : 'beams low on energy: holding fire');
  state.lowBeam = !charged;
  let at = T ? { x: T.pos.x + (T.vel.x - vx) * dt, y: T.pos.y + (T.vel.y - self.vel.y) * dt, id: T.id, ghost: !!T.ghost } : null;
  if (!at && state.holdPt && time - state.holdPt.t < 1) at = { x: state.holdPt.x, y: state.holdPt.y, id: -1 };
  let burning = 0;
  for (const t of turrets) burning += aimTurret(t, at, charged);
  if (burning > 0 && time - (state.burnSaid || -1e9) > 10) {
    state.burnSaid = time;
    const f = state.beam.F || state.beam.B;
    log('beams on robot ' + state.tid + (f && f.off ? ' (' + f.off.type + ')' : ''));
  }

  // Guns, a group at a time: on when one of its sights reads an enemy, when the target is over it, or when it
  // holds under a hidden robot and the group is near that place.
  for (let b = 0; b < bins; b++) {
    const g = guns[b];
    if (!g || !g.length) continue;
    let fire = 0;
    for (const p of g) {
      if (p.out.sightSide === 3) {
        fire = 1;
        break;
      }
    }
    if (!fire && overhead) {
      const xa = g[0].pos.x;
      const xb = g[g.length - 1].pos.x;
      if (Math.max(xa, xb) >= overhead[0] && Math.min(xa, xb) <= overhead[1]) fire = 1;
    }
    if (!fire && held !== null && Math.abs(g[0].pos.x - held) <= blind) fire = 1;
    set('bin' + b, 'fire', fire);
  }
}
