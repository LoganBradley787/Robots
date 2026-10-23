// titan-anvil pilot: a flying brick of armor that only rams.
// A hard hit hurts what is near the contact (about 6 m deep), so the brick aims the contact at where the enemy's
// main core is: it scans the enemy's main robot, works out how deep its core sits behind each face, and comes in on
// the thinnest one. From the side it flies through the core's row; from below it climbs into the core's column with
// its roof (gravity stops the climb, so that is safe at the arena's edge); from above it lines up over the core and
// cuts its lift, dropping onto it. A robot known only from gun sights (it hides from radar) is taken from below,
// across its whole length.
// - The main enemy (titan-darts, 2026-10, Logan): picked from what the radar reports, never by id: the heaviest enemy
//   with a live core of `mainMass` kg or more (nearest first on a tie), kept unless one twice as heavy shows up. One
//   seen as debris (no live core) is done with: the brick lands, and takes off again for the next enemy with a live
//   core it sees. One that vanished alive stays the main enemy (inside an arena; in the open sandbox only for
//   `forget` s), and gun sights that read its id keep touching it. Until a main enemy is known, sights count unless
//   they read a robot seen lighter than `mainMass`.
// - Ways in (titans v2, 2026-10): each ram is one try along one way in (its left face, its right face, from below,
//   from above). A try that ends without a hit that broke parts off counts against that way, and after `tries` such
//   in a row the brick picks the next best way, so a target that keeps slipping one approach meets another. While it
//   closes it leads the target's height to the moment of contact (a target that dives is followed down at up to free
//   fall: the lift is cut), and it leans into a long speed change (up to `tilt` degrees) so the lift rows push it
//   along too, levelling out before the hit.
// - Rams (titans v3, 2026-10, Logan: "it should be trying to go Mach 20"): from the side it closes as fast as it can
//   get (`vmax`, at most what breaks more, `sat`), backs off after each hit (or `breakOff` s pressed and going
//   nowhere) as far as its measured speeding up needs for that speed (at most `maxRun`, less for a target moving
//   away, none for one coming at it), and leans into the run-up. A way in too slow to break what it hits (from below
//   or above, on an armored brick) is left for last.
// - Rolling (titans v3, 2026-10, Logan: decisive mirror matches): a brick on its back or side cannot right itself
//   (measured: its lift then points down or along the ground and only slides it; its push boosters give about a
//   third of the turn needed), so a side hit is aimed from both faces' shapes to spin the target and not itself
//   (pickHeight). Turned over, it still drives its push boosters the right way and never lifts itself out.
// Something much heavier is not rammed: the brick waits high behind its tail.
// It never turns round: boosters on each side push it left or right, the lift rows hold its height and its lean.
// Guns on every face blast what their sights show. Everything goes by `side` and by where its own parts are, so it
// works flipped.
// - The edge (titans v2, 2026-10): every limit on where it goes comes from the global `arena` (`{ x, y }`, or null in
//   the open sandbox, where it goes wherever its target goes). Time planning (`match`) only applies with an arena.

const mainMass = param('mainMass', 30, { min: 0, max: 100000 }); // kg: the main enemy is never lighter (darts, pods)
const vmax = param('vmax', 130, { min: 10, max: 150 }); // fastest ram, m/s of closing speed (it tops out near 125 leaning, 88 level)
const lineUp = param('lineUp', 60, { min: 10, max: 90 }); // m/s at most while lining up under or over a target, or hurrying to search
const sat = param('sat', 60, { min: 10, max: 150 }); // m/s of speed change in the target past which a harder hit breaks hardly more
const maxRun = param('maxRun', 800, { min: 40, max: 2000 }); // m of run-up at most, before a still target (less the faster it goes)
const breakOff = param('breakOff', 0.8, { min: 0.2, max: 10 }); // s pressed into it, going nowhere, before it backs off
const heavy = param('heavy', 1.3, { min: 0.1, max: 5 }); // an enemy over this share of its own mass is not rammed
const roofGap = param('roofGap', 25, { min: 5, max: 200 }); // m the core keeps under the arena's ceiling
const reserve = param('reserve', 0.05, { min: 0, max: 0.5 }); // share of energy kept for landing
const edgeGap = param('edgeGap', 50, { min: 20, max: 500 }); // m the core keeps inside the arena's side edges
const hideHeight = param('hideHeight', 200, { min: 50, max: 230 }); // m: where it waits out an enemy too heavy to ram
const lapSpeed = param('lapSpeed', 30, { min: 5, max: 80 }); // m/s it flies end to end while waiting (a brick that sits still is worn down)
const lapEnd = param('lapEnd', 700, { min: 100, max: 900 }); // m from the middle (or from where it started, with no arena) where a lap turns
const shove = param('shove', 5000, { min: 0, max: 100000 }); // kg: a ground enemy heavier than this with a deep core is not worth bumping
const jamEvery = param('jamEvery', 4.7, { min: 1, max: 5 }); // s between jammer pods while it waits hidden (a pod jams 5 s)
const match = param('match', 240, { min: 10, max: 10000 }); // s a match lasts (only with an arena): pushing a heavy enemy stops while the energy left still covers hovering to the end
const hold = param('hold', 60, { min: 0, max: 10000 }); // s of hovering it keeps in hand against a heavy enemy in the open sandbox (no match end)
const tall = param('tall', 60, { min: 10, max: 250 }); // m: a heavy enemy standing this far over its core is pushed over by its top
const touch = param('touch', 12, { min: 1, max: 40 }); // m/s it closes on that top at
const thin = param('thin', 5, { min: 0, max: 20 }); // m: a heavy enemy's core this near a side face is rammed there anyway
const breach = param('breach', 78, { min: 10, max: 90 }); // m/s for that ram (it costs the face that hits)
const pushGap = param('pushGap', 40, { min: 5, max: 500 }); // m inside the arena's edge its core may go while shoving
const local = param('local', 1, { min: 0, max: 1 }); // 1: a crash only hurts near the contact (round 2), so `breach` rams are worth it
const sweepSpeed = param('sweepSpeed', 40, { min: 5, max: 60 }); // m/s while searching with the gun sights
const sweepHeight = param('sweepHeight', 110, { min: 30, max: 200 }); // m: from here the roof and floor guns' sights cover ground to ceiling
const sweepHigh = param('sweepHigh', 185, { min: 30, max: 220 }); // m: the first pass, where the roof guns reach the ceiling
const uppercut = param('uppercut', 32, { min: 5, max: 45 }); // m/s at most when ramming straight up
const drop = param('drop', 75, { min: 20, max: 150 }); // m it sinks under a target before climbing into it
const perch = param('perch', 40, { min: 10, max: 150 }); // m over a target's top it lines up before dropping onto it
const fall = param('fall', 60, { min: 5, max: 90 }); // m/s at most when dropping onto something (it still brakes for the ground)
const tries = param('tries', 2, { min: 1, max: 10 }); // tries in a row that break nothing before it changes its way in
const tryTime = param('tryTime', 20, { min: 5, max: 120 }); // s a try may take before it counts as one that failed
const hitParts = param('hitParts', 4, { min: 1, max: 100 }); // parts the enemy must lose in a try for it to count as a hit
const tipSpin = param('tipSpin', 0.2, { min: 0.05, max: 2 }); // rad/s: the most spin a hit may give it (it rights about 0.5 rad of spin at 0.2)
const giveUp = param('giveUp', 6, { min: 2, max: 100 }); // tries in a row that break nothing on a ground enemy before it regroups
const regroup = param('regroup', 20, { min: 0, max: 120 }); // s it waits high, out of reach of ground guns, before trying again
const stuckTime = param('stuckTime', 3, { min: 1, max: 30 }); // s going nowhere before it climbs out and backs off
const tilt = param('tilt', 25, { min: 0, max: 40 }); // degrees it leans at most to speed up or slow down
const forget = param('forget', 30, { min: 1, max: 10000 }); // s a main enemy that vanished alive is kept, with no arena
const pingKeep = param('pingKeep', 15, { min: 1, max: 60 }); // s it keeps going for the place gun sights last touched the enemy
const lead = param('lead', 0.4, { min: 0, max: 1 }); // share of the climb or dive of a target flying at it that it leads
const spinAim = param('spinAim', 1, { min: 0, max: 1 }); // 1: picks the height of a side hit from both faces' shapes (see pickHeight)
const say = param('say', 1, { min: 0, max: 1 }); // 1 logs each change of plan

// Limits from the arena (titans v2, 2026-10): none in the open sandbox.
const edge = arena ? arena.x - edgeGap : Infinity; // the core stays within this of the middle, m
const pushEdge = arena ? arena.x - pushGap : Infinity; // how far out its core may go while shoving
const ceiling = arena ? arena.y - roofGap : Infinity; // the core never goes above this

let guns = null;
let pods = []; // jammer pods not yet used
let gunParts = -1;
let pings = []; // one entry per tick a sight touched the enemy's main robot: its reach that tick
const WAYS = ['S', 'L', 'R', 'B', 'T']; // either side face (whichever it meets), its left face (going right), its right face, from below, from above

function setup() {
  let m = 0;
  let sx = 0;
  let sy = 0;
  let minY = 1e9;
  let maxY = -1e9;
  let minX = 1e9;
  let maxX = -1e9;
  for (const p of parts) {
    if (p.pos.x < minX) minX = p.pos.x;
    if (p.pos.x > maxX) maxX = p.pos.x;
    if (p.pos.y < minY) minY = p.pos.y;
    if (p.pos.y > maxY) maxY = p.pos.y;
    m += p.mass;
    sx += p.mass * p.pos.x;
    sy += p.mass * p.pos.y;
  }
  const cx = sx / m;
  const cy = sy / m;
  let inertia = 0;
  let arms = 0;
  let laX = 0;
  let pushes = 0;
  let paX = 0;
  let pushY = 0;
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    inertia += p.mass * (dx * dx + dy * dy);
    if (p.type !== 'booster') continue;
    const t = p.tags;
    if (t.indexOf('la') >= 0) {
      arms += Math.abs(dx);
      laX += dx;
    } else if (t.indexOf('lb') >= 0) arms += Math.abs(dx);
    else if (t.indexOf('pa') >= 0) {
      pushes++;
      paX += dx;
      pushY += dy;
    } else if (t.indexOf('pb') >= 0) {
      pushes++;
      pushY += dy;
    }
  }
  state.inertia = inertia;
  state.leanTorque = Math.max(arms * 400, 1); // N m per unit of throttle difference between the two lift halves
  state.laLeft = laX < 0; // the `la` lift half sits left of the middle (it does not when flipped)
  state.paDir = paX < 0 ? 1 : -1; // the `pa` boosters sit on the left and push right (the other way when flipped)
  state.pushArm = pushes > 0 ? pushY / pushes : 0; // how far the push line is above the center of mass
  state.bottom = self.pos.y - minY + 0.5; // the core's height over the lowest part's underside
  state.top = maxY - self.pos.y + 0.5; // and under the highest part's top
  state.halfWidth = (maxX - minX) / 2 + 0.5;
  state.home = { x: self.pos.x, y: self.pos.y };
  state.liftForce = 1;
  state.pushRight = 1;
  state.pushLeft = 1;
  state.mainId = -1;
  state.mainMass = 0;
  state.mainSeen = -100; // when the main enemy was last on the radar
  state.light = {}; // ids of enemy robots seen lighter than `mainMass`
  state.last = null;
  state.shape = null;
  state.shapeAt = -100;
  state.dir = 0;
  state.up = false;
  state.upAt = 0;
  state.upCount = 0;
  state.down = false;
  state.downAt = 0;
  state.stallAt = 0;
  state.backing = false;
  state.hitAt = -100;
  state.mine = null; // its own faces (faces), remade each second
  state.mineAt = -100;
  state.evade = false;
  state.jamAt = -100;
  state.hideSide = 0;
  state.leg = 0;
  state.push = 0;
  state.won = false;
  state.plan = '';
  state.way = ''; // the way in of the try under way ('' for none)
  state.wayAt = 0;
  state.wayParts = 0; // the enemy's parts when the try started
  state.wayHit = false; // it touched the enemy hard during the try
  state.fails = { S: 0, L: 0, R: 0, B: 0, T: 0 };
  state.prevVx = 0;
  state.prevVy = 0;
  state.tvx = 0; // the target's speed a tick ago, for its acceleration
  state.tvy = 0;
  state.tay = 0;
  state.lostAt = -100; // when it last had a target
  state.partCount = parts.length;
  state.hurtAt = -1000; // when it last lost a part
  state.misses = 0; // tries in a row, any way, that broke nothing
  state.regroupUntil = -100;
  state.stillAt = 0; // since when it has been still (or the last time it moved)
  state.unstick = -100; // until when it climbs out of where it got stuck
}

function plan(name) {
  if (state.plan === name) return;
  state.plan = name;
  if (say > 0.5) log(name, 'x', self.pos.x.toFixed(0), 'y', self.pos.y.toFixed(0));
}

// Guns: blast whatever enemy is on the sight, and note where the enemy's main robot was touched by one.
function runGuns() {
  if (guns === null || gunParts !== parts.length) {
    // Parts were lost (or this is the first tick): find the guns again and count the boosters still working.
    guns = [];
    pods = [];
    gunParts = parts.length;
    let lifts = 0;
    let pa = 0;
    let pb = 0;
    for (const p of parts) {
      if (p.type === 'gun') guns.push(p);
      else if (p.type === 'jammer') {
        if (!(p.out.jamming > 0.5)) pods.push(p);
      } else if (p.type === 'booster') {
        const t = p.tags;
        if (t.indexOf('pa') >= 0) pa++;
        else if (t.indexOf('pb') >= 0) pb++;
        else lifts++;
      }
    }
    state.liftForce = Math.max(lifts * 400, 1);
    state.pushRight = Math.max((state.paDir > 0 ? pa : pb) * 400, 1); // push toward +x
    state.pushLeft = Math.max((state.paDir > 0 ? pb : pa) * 400, 1); // push toward -x
  }
  let lo = 1e9;
  let hi = -1e9;
  let ylo = 1e9;
  for (const p of guns) {
    if (p.out.sightSide === 3) {
      set(p.id, 'fire', 1);
      const id = p.out.sightId;
      if (state.mainId >= 0 ? id === state.mainId : !state.light[id]) {
        const d = p.out.sight;
        const px = p.pos.x + Math.cos(p.out.aim) * d;
        const py = p.pos.y + Math.sin(p.out.aim) * d;
        if (px < lo) lo = px;
        if (px > hi) hi = px;
        if (py < ylo) ylo = py;
      }
    } else if (p.in.fire > 0.5) set(p.id, 'fire', 0);
  }
  if (hi >= lo) {
    pings.push({ lo, hi, ylo, t: time });
    if (pings.length > 300) pings.shift();
  }
}

// How deep the enemy's main core sits behind each of its faces, from a scan: the parts on its row give left and
// right, the parts on its column give below and above.
function measure(main) {
  const seen = scan(main.id);
  if (!seen) return;
  const cx = main.pos.x;
  const cy = main.pos.y;
  let L = cx;
  let R = cx;
  let B = cy;
  let T = cy;
  let low = 1e9;
  let high = -1e9;
  let hullLo = 1e9;
  let hullHi = -1e9;
  let topX = cx;
  let armor = 0;
  for (const p of seen) {
    if (p.type === 'armorplate') armor++;
    const x = p.pos.x;
    const y = p.pos.y;
    if (y < low) low = y;
    if (y > high) {
      high = y;
      topX = x;
    }
    if (x < hullLo) hullLo = x;
    if (x > hullHi) hullHi = x;
    if (Math.abs(y - cy) < 1.6) {
      if (x < L) L = x;
      if (x > R) R = x;
    }
    if (Math.abs(x - cx) < 1.6) {
      if (y < B) B = y;
      if (y > T) T = y;
    }
  }
  const f = faces(seen, cx, cy);
  state.shape = { L: cx - L, R: R - cx, B: cy - B, T: T - cy, low: low - cy, high: high - cy, hullLo: hullLo - cx, hullHi: hullHi - cx, topX: topX - cx, ground: low < 3, armored: armor > 0.08 * seen.length, faceL: f.L, faceR: f.R };
  state.shapeAt = time;
}

// How far a body reaches out to each side, row by row: 1 m rows of world height from its core, `FACE` either way.
const FACE = 40;
function faces(list, cx, cy) {
  const L = [];
  const R = [];
  for (let i = 0; i <= 2 * FACE; i++) {
    L.push(-1e9);
    R.push(-1e9);
  }
  for (const p of list) {
    const i = Math.round(p.pos.y - cy) + FACE;
    if (i < 0 || i > 2 * FACE) continue;
    const dx = p.pos.x - cx;
    if (dx > R[i]) R[i] = dx;
    if (-dx > L[i]) L[i] = -dx;
  }
  return { L, R };
}

// Where a level side hit lands with its core `d` m over the target's: the rows where the two faces reach furthest
// toward each other (within 2 m of the most, weighted by how far), as a height from the target's core.
function contactAt(mine, its, d) {
  let best = -1e9;
  for (let v = -FACE; v <= FACE; v++) {
    const u = v - d;
    if (u < -FACE || u > FACE) continue;
    const s = mine[u + FACE] + its[v + FACE];
    if (s > best) best = s;
  }
  if (best < -1e8) return null;
  let w = 0;
  let sv = 0;
  for (let v = -FACE; v <= FACE; v++) {
    const u = v - d;
    if (u < -FACE || u > FACE) continue;
    const s = mine[u + FACE] + its[v + FACE];
    if (s > best - 2) {
      w += s - (best - 2);
      sv += (s - (best - 2)) * v;
    }
  }
  return sv / w;
}

// The height to meet a target from the side at (titans v3, 2026-10, Logan: decisive mirror matches). A side hit
// spins each body by the push times how far the contact is above or below its center of mass, and a brick rolled
// onto its back cannot right itself (its lift then points down, its push boosters along the ground; measured). Two
// flat faces always meet halfway between the two cores, so the spin is shared; a face worn uneven by earlier hits
// is not flat. So it tries each height within 24 m of the target's core and takes the one whose contact is far
// from the target's center and near its own: the target spins, it does not. `armMe` sets how fast it may hit.
function pickHeight(shape, toRight) {
  const mine = toRight ? state.mine.R : state.mine.L;
  const its = toRight ? shape.faceL : shape.faceR;
  let pick = null;
  for (let d = -24; d <= 24; d++) {
    const c = contactAt(mine, its, d);
    if (c === null) continue;
    const armIt = Math.abs(c);
    const armMe = Math.abs(c - d);
    const score = Math.min(armIt, 12) - 3 * armMe - 0.05 * Math.abs(d);
    if (!pick || score > pick.score) pick = { d, armIt, armMe, score };
  }
  return pick;
}

// A try along a way in ends: it counts against that way unless it broke enough off the enemy.
function endTry(main) {
  if (state.way === '') return;
  const lost = main && state.wayParts >= 0 ? state.wayParts - main.parts : 0;
  if (state.wayHit && lost >= hitParts) {
    state.fails[state.way] = 0;
    state.misses = 0;
  } else {
    state.fails[state.way]++;
    state.misses++;
  }
  if (say > 0.5) log('try', state.way, lost >= hitParts && state.wayHit ? 'hit' : 'missed', 'lost', lost, 'fails', state.fails[state.way]);
  state.way = '';
}

function tick() {
  const m = self.mass;
  const x = self.pos.x;
  const y = self.pos.y;
  const vx = self.vel.x;
  const vy = self.vel.y;
  // A hit: its own speed jumped this tick (a touch of the ground does not count, it stays well above it then).
  const jolt = Math.hypot(vx - state.prevVx, vy - state.prevVy);
  state.prevVx = vx;
  state.prevVy = vy;
  if (parts.length < state.partCount) state.hurtAt = time;
  state.partCount = parts.length;

  // The main enemy: the one it had (unless one twice as heavy shows up), else the heaviest enemy with a live core of
  // `mainMass` or more (contacts come nearest first, so a tie goes to the nearer). One that vanished alive (a jammer's
  // bubble hides a shatter king for the whole match) stays the main enemy, since the pieces and darts around it
  // would pull the brick off it; seen as debris, it is won and forgotten, and the next enemy with a live core it sees
  // (one placed later in the sandbox) brings it back up.
  let heaviest = null;
  let kept = null;
  for (const c of contacts) {
    if (c.id === state.mainId) {
      if (c.side === 'enemy' && c.core) kept = c;
      else if (!c.core) {
        state.won = true;
        state.mainId = -1;
        state.way = '';
      }
    }
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.mass < mainMass) state.light[c.id] = true;
    else if (!heaviest || c.mass > heaviest.mass) heaviest = c;
  }
  // With no arena there is no match to wait out: a main enemy gone from the radar that long is let go.
  if (!arena && state.mainId >= 0 && !kept && time - state.mainSeen > forget) state.mainId = -1;
  const main = state.mainId < 0 || (heaviest && heaviest.mass > 2 * state.mainMass) ? heaviest : kept;
  if (main) {
    if (main.id !== state.mainId) {
      state.way = '';
      state.fails = { S: 0, L: 0, R: 0, B: 0, T: 0 };
      state.shapeAt = -100;
      state.evade = false; // a new main enemy is judged afresh
    }
    state.mainId = main.id;
    state.mainMass = main.mass;
    state.mainSeen = time;
    if (state.won) {
      state.won = false;
      state.evade = false;
      if (say > 0.5) log('a new enemy: taking off', main.id);
    }
  }
  runGuns();
  if (main && time - state.shapeAt > 2) measure(main);
  if (time - state.mineAt > 1) {
    state.mine = faces(parts, self.pos.x, self.pos.y);
    state.mineAt = time;
  }
  while (pings.length > 0 && time - pings[0].t > pingKeep) pings.shift();

  const charge = self.energy.capacity > 0 ? self.energy.stored / self.energy.capacity : 1;
  const hoverPower = ((m * 9.81) / 400) * 60; // J/s the lift boosters draw holding its weight
  const floor = state.bottom + 0.3;
  const push = Math.min(state.pushRight, state.pushLeft);
  const brake = Math.max(1, (0.85 * state.liftForce) / m - 9.81); // m/s² the lift rows can slow a fall by
  let wantVx = 0;
  let wantH = sweepHeight;
  let ramVy = null; // a wanted climb rate when ramming (up, down, or leading a target's height)
  let land = false;
  let calm = false; // level, whatever the speed change: a hit is near
  let limit = edge; // how far from the middle the core may go this tick

  // What is known of the enemy's main robot: seen by radar (its core's place), or only touched by gun sights.
  let target = null;
  if (main) {
    // Its vertical acceleration, smoothed: a target that starts a dive is led down at once.
    const ay = clamp((main.vel.y - state.tvy) / Math.max(dt, 0.001), -15, 15);
    state.tay = state.tay * 0.8 + ay * 0.2;
    state.tvx = main.vel.x;
    state.tvy = main.vel.y;
    state.last = { x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, ay: state.tay, m: main.mass, parts: main.parts, t: time };
    target = state.last;
  } else if (state.last && time - state.last.t < 2) {
    const age = time - state.last.t;
    target = { x: state.last.x + state.last.vx * age, y: Math.max(1, state.last.y + state.last.vy * age), vx: state.last.vx, vy: state.last.vy, ay: 0, m: state.last.m };
  }
  if (target || pings.length > 0) state.lostAt = time;
  const shape = main && state.shape && time - state.shapeAt < 6 ? state.shape : null;
  if (state.way !== '' && state.wayParts < 0 && main) state.wayParts = main.parts;
  if (state.way !== '' && jolt > 2 && target && Math.abs(target.x - x) < state.halfWidth + 120) state.wayHit = true;

  // Speeding up (measured, titans v3, 2026-10): air drag is 0.0025 N s²/m² per cell, so with F newtons on it the
  // brick tops out at sqrt(F / k), and goes from still to v in -(m / 2k) ln(1 - k v² / F) meters. Level, on the push
  // boosters alone, it reached 40 m/s in about 180 m and tops out near 88; leaning 25 degrees (the lift rows push
  // too), 60 m/s in 210 m, 80 in 400, 100 in 760, topping out near 125.
  const k = 0.0025 * parts.length;
  const weight = m * 9.81;
  const leanPush = Math.min(weight * Math.tan((tilt * Math.PI) / 180), Math.sqrt(Math.max(0, (0.9 * state.liftForce) ** 2 - weight * weight)));
  const runForce = push + leanPush;
  const vTop = Math.sqrt(runForce / k);
  const runFor = (v) => {
    const q = (k * v * v) / runForce;
    return q >= 0.98 ? 1e9 : (-m / (2 * k)) * Math.log(1 - q);
  };
  // The fastest side hit on `t` that leaves a spin of `tipSpin` (see fromSide).
  const tipSpeed = (t) => {
    const tTop = t.y + (shape ? shape.high : 5);
    const tLow = t.y + (shape ? shape.low : -5);
    const yAt = clamp(t.y, floor, ceiling);
    const contactY = (Math.max(yAt - state.bottom, tLow) + Math.min(yAt + state.top, tTop)) / 2;
    const tm = Math.max(t.m, 1);
    return (tipSpin * state.inertia) / (Math.max(1, Math.abs(contactY - yAt)) * ((m * tm) / (m + tm)));
  };
  // Climbing into something from below: sink `drop` under its underside while lining up, then climb at full speed
  // until the climb stalls (the hit, or the ceiling), and start over.
  const fromBelow = (atX, underside, tvx, tvy) => {
    const start = Math.max(floor, underside - state.top - drop);
    // It lines up where the target will be when the climb reaches it (it climbs at about `uppercut`).
    const lead = state.up ? 0 : clamp((underside - y) / uppercut, 0, 4);
    const aimX = clamp(atX + tvx * lead, -edge, edge);
    wantVx = tvx + clamp(0.8 * (aimX - x), -lineUp, lineUp);
    if (!state.up) {
      wantH = start;
      if (Math.abs(aimX - x) < 8 && y - start < 8) {
        state.up = true;
        state.upAt = time;
      }
    } else {
      calm = true;
      ramVy = tvy + uppercut;
      const age = time - state.upAt;
      if ((age > 2 && vy < 4) || age > 14) {
        state.up = false;
        state.upCount++;
        return true; // the try is over
      }
    }
    return false;
  };
  // Dropping onto something from above (titans v2, 2026-10, Logan: "shut off its thrusters and drop like a rock"):
  // line up `perch` over its top, leading where it goes, then cut the lift and fall onto it. The fall is held only to
  // what the lift rows can still stop before the ground.
  const fromAbove = (atX, top, tvx, tvy) => {
    const start = Math.min(ceiling, top + state.bottom + perch);
    const tFall = Math.sqrt((2 * Math.max(0, y - state.bottom - top)) / 9.81);
    const aimX = clamp(atX + tvx * tFall, -edge, edge);
    wantVx = tvx + clamp(0.8 * (aimX - x), -lineUp, lineUp);
    if (!state.down) {
      wantH = start;
      if (Math.abs(aimX - x) < 10 && y > start - 15) {
        state.down = true;
        state.downAt = time;
      }
    } else {
      calm = true;
      ramVy = tvy - fall;
      const age = time - state.downAt;
      if ((age > 1.5 && vy > -2) || y + state.top < top - 5 || age > 10) {
        state.down = false;
        return true;
      }
    }
    return false;
  };
  // Flying through a point from the side. `prefer` (1 or -1, 0 for either) is the way it must be going when it hits:
  // going the other way it passes over the top (`over`, a core height) and comes back. Its height leads the
  // target's to the moment of contact, at up to free fall.
  // Ramming speed (titans v3, 2026-10, Logan: "it should be trying to go Mach 20"): as fast as it gets. Measured: a
  // still anvil rammed at 40 or 60 m/s loses only the guns on its face (each body changes speed by half the closing
  // speed, and armor shrugs off 24 m/s), at 80 about 210 parts, at 100 about 250 (a slab the whole 6 m reach deep). A
  // crash costs both sides the same share of the speed change for the same mass, so no closing speed is worse for it
  // than a slower one: the only limit is `sat`, the target's speed change past which a hit breaks hardly more.
  const fromSide = (t, prefer, over, fast) => {
    const dx = t.x - x;
    // A hit far above or below its center of mass spins the brick (a hit low on a ground base rolled it onto its
    // back, for good: titans v2, 2026-10). The speed is held to what leaves a spin of `tipSpin` it can stop: the
    // contact is the middle of where the two overlap in height, the push is the speed times the pair's shared mass.
    // The overlap is reckoned at the height it is heading for (the target's core, as near as the ground and ceiling
    // allow), so a level hit on something in the air is never slowed, while a ground base lower than its middle is.
    const tm = Math.max(t.m, 1);
    // Against a radar-seen target in the air, the height and the spin come from both faces' shapes (pickHeight).
    // Two that both pick the height chase each other's pick to the ground or the ceiling (two anvils each wanting to
    // meet the other lower dove together, each wanting higher both rolled at the ceiling). So against a target flying
    // at it, only the one with more parts left picks; the one with fewer holds its height, and even ones meet level.
    const atMe = -t.vx * Math.sign(dx) > 10;
    const pickAll = spinAim > 0.5 && t === state.last && shape && !shape.ground && state.mine ? pickHeight(shape, dx > 0) : null;
    const rank = !pickAll || !atMe || t.parts === undefined ? 1 : Math.sign(parts.length - t.parts);
    const pick = rank > 0 ? pickAll : null;
    const tip = pick ? (tipSpin * state.inertia) / (Math.max(1, pick.armMe) * ((m * tm) / (m + tm))) : tipSpeed(t);
    const speed = Math.max(12, Math.min(fast || Math.min(vmax, (sat * (m + tm)) / m, 0.95 * vTop), tip));
    // The run-up: what its measured speeding up needs to reach that speed (leaning, against air drag), at most
    // `maxRun` before a still target and less the faster the target moves away from it, so one drifting away is
    // chased, not let go (titans v2, 2026-10: a 250 m run-up let a fleeing hive go for 20 s). Not while backing off
    // after a hit, for up to 15 s: a target going away then is mostly backing off itself (another rammer), and of two
    // anvils the one whose run-up was cut first chased the other to its edge, where every later hit was slow.
    const away = state.backing && time - state.hitAt < 15 ? 0 : Math.max(0, t.vx * Math.sign(dx));
    const runCap = clamp(maxRun - 25 * away, 80, maxRun);
    const runup = clamp(runFor(speed), 40, runCap);
    if (state.dir === 0) state.dir = dx >= 0 ? 1 : -1;
    const ahead = state.dir > 0 ? limit - x : x + limit; // room left before the arena's edge
    let passed = false;
    // The run-up counts from its face, not its core (titans v2, 2026-10: against a base 80 m wide it turned round
    // still touching it, and every bump was a slow one).
    const near = state.halfWidth + (shape ? Math.max(-shape.hullLo, shape.hullHi) : 0);
    // A target closing on it brings its own speed to the hit: no need to run from it, turn and meet it. Closing means
    // the gap shrinks (titans v3, 2026-10): one following it while it backs off faster is not, and turning on it threw
    // away the speed it had backing off (hits at 40 m/s).
    const coming = (vx - t.vx) * Math.sign(dx) > 15 && Math.abs(dx) > near + 60;
    if (dx * state.dir < 0 && (dx * state.dir < -(runup + near) || ahead < 30 || coming)) {
      state.dir = -state.dir; // past it (or backed off far enough): come again
      // A run-up after a hit is part of the same try, timed afresh from here; flying past it ends the try.
      if (state.backing) state.wayAt = time;
      else passed = true;
      state.backing = false;
    }
    // A hit: back off for the next run-up at once. Pressed against it and going nowhere for `breakOff` s: the same.
    // A bump shoves it much further than a steady push, and a brick that sits still is an easy mark.
    if (!state.backing && Math.abs(dx) < near + 20 && dx * state.dir > 0 && jolt > 4) {
      state.dir = -state.dir;
      state.backing = true;
      state.stallAt = time; // the try goes on: what the hit broke off is counted next tick
      state.hitAt = time;
    }
    if (!state.backing && Math.abs(dx) < state.halfWidth + 30 && Math.abs(vx - t.vx) < 2) {
      if (time - state.stallAt > breakOff) {
        state.dir = dx >= 0 ? -1 : 1;
        state.backing = true;
        state.stallAt = time;
        passed = true;
      }
    } else state.stallAt = time;
    const overTop = prefer !== 0 && state.dir !== prefer && over !== null && !state.backing;
    if (dx * state.dir < 0) {
      // Going away for the run-up: as fast as still stops it (on the push boosters alone) at the run-up's end, so it
      // turns round there and the whole run-up goes into speeding up toward the target.
      // Its speed is kept up with only for a target coming after it: one going away (backing off for its own
      // run-up) adds to the gap, and following it too let the pair drift to an arena's edge (titans v3, 2026-10:
      // backing off as fast as the gap needed, whichever of two anvils was slower made the other back off faster).
      const left = runup + near - Math.abs(dx);
      wantVx = (t.vx * Math.sign(dx) > 0 ? 0 : t.vx) + state.dir * clamp(Math.sqrt(2 * ((0.6 * push) / m) * Math.max(0, left)), 8, Math.max(lineUp, speed));
    } else wantVx = t.vx + state.dir * (overTop ? Math.min(speed, lineUp) : speed);
    if (overTop) wantH = over;
    // Off a ground base: clear of its roof. Else at its height, but high enough to lean into the run-up.
    else if (state.backing || dx * state.dir < 0) wantH = shape && shape.ground ? t.y + shape.high + state.bottom + 3 : Math.max(t.y, floor + 30);
    else {
      const closing = Math.max(5, (vx - t.vx) * Math.sign(dx));
      const reach = shape ? (dx > 0 ? -shape.hullLo : shape.hullHi) : 0;
      const tc = clamp((Math.abs(dx) - state.halfWidth - reach) / closing, 0, 4);
      const ay = Math.abs(t.ay || 0) > 1.5 ? clamp(t.ay, -6, 6) : 0; // only a clear dive or climb
      // A target flying at it is likely matching its height too: led fully, the two would chase each other's
      // climb up to the ceiling (titans v3, 2026-10: an anvil pair met there, and the hit rolled one over). So
      // such a target's climb is led only by `lead`, which lets the pair settle at one height.
      const g = atMe ? lead : 1;
      // One flying at it is met no lower than 30 m over its own floor and no higher than 30 m under the ceiling.
      const lo = atMe ? Math.min(floor + 30, ceiling) : floor;
      const hi = atMe ? Math.max(lo, ceiling - 30) : ceiling;
      if (rank < 0) ramVy = (clamp(y, lo, hi) - y) / Math.max(0.7, tc);
      else {
        const aimY = clamp(t.y + (pick ? pick.d : 0) + g * (t.vy * tc + 0.5 * ay * tc * tc), lo, hi);
        ramVy = g * (t.vy + ay * tc) + (aimY - y) / Math.max(0.7, tc);
      }
      if (tc < 2.5) calm = true;
    }
    return passed;
  };
  // Starts a try along `way` (or goes on with the one under way).
  const begin = (way) => {
    if (state.way === way) return;
    if (state.way !== '') endTry(main);
    state.way = way;
    state.wayAt = time;
    state.wayParts = main ? main.parts : -1; // -1: taken from the first sight of it
    state.wayHit = false;
    state.up = false;
    state.down = false;
  };

  const timeLeft = arena ? Math.max(0, match - self.age) : hold; // s of hovering it must keep in hand
  if (state.won && !target) {
    plan('done: landing, watching for the next enemy');
    land = true;
  } else if (charge < reserve) {
    plan('low energy: landing');
    land = true;
  } else if (state.evade || (target && target.m > heavy * m && self.energy.stored < timeLeft * hoverPower * 1.08)) {
    state.evade = true;
    // Nothing it can do to this enemy, so it only has to last: it hides in its own jammer bubbles (no sensor sees
    // it, its own radar included) and flies from end to end, high up, never sitting still.
    plan('waiting it out, hidden');
    if (time - state.jamAt > jamEvery && pods.length > 0) {
      const pod = pods.pop();
      set(pod.id, 'ignite', 1);
      state.jamAt = time;
    }
    const mid = arena ? 0 : state.home.x;
    const end = arena ? Math.min(lapEnd, edge - 50) : lapEnd;
    if (state.hideSide === 0) state.hideSide = x >= mid ? -1 : 1;
    if ((x - mid) * state.hideSide > end) state.hideSide = -state.hideSide;
    wantVx = state.hideSide * lapSpeed;
    wantH = hideHeight;
  } else if (target && target.m > heavy * m) {
    // Too heavy to ram head on: its own speed would hardly change. Three answers, from a scan of it.
    if (local > 0.5 && shape && Math.min(shape.L, shape.R) <= thin) {
      // Its core sits just behind a side face (it lies on its side): ram that face as fast as it can fly. The
      // brick's own face pays for it; the core deep inside does not.
      // Pressed against it and going nowhere (no room for a run-up near the arena's edge), it backs off and comes
      // again: each bump shoves the enemy on, and its core loses once it is past the edge.
      plan('heavy: ramming the face its core is behind');
      const prefer = shape.L < shape.R ? 1 : -1;
      let over = target.y + shape.high + state.bottom + 10;
      if (over > ceiling) over = null;
      limit = pushEdge;
      fromSide(target, prefer, over, breach);
    } else if (shape && shape.high > tall) {
      // It stands tall (a mast): a push on the top of it is a long lever against its weight, so fly into the top
      // and keep pushing until it goes over.
      // It comes up to the top gently (matching the enemy's own speed, `touch` m/s faster) so the meeting is no crash.
      plan('heavy: pushing its top over');
      const top = target.y + shape.high;
      const tx = target.x + shape.topX;
      fromSide({ x: tx, y: Math.min(top - 14, ceiling), vx: target.vx, vy: 0, ay: 0, m: 0 }, 0, null, Math.abs(tx - x) > 150 ? lineUp : touch);
    } else {
      // Nothing to take hold of.
      state.evade = true;
      wantH = hideHeight;
    }
  } else if (target) {
    // Seen by radar: pick the way in. Each way costs how deep the core sits behind that face, plus a penalty for
    // each try along it in a row that broke nothing; ways it cannot fly are left out.
    const under = shape ? target.y - shape.B : target.y;
    const topY = shape ? target.y + shape.T : target.y;
    const cornered = edge - Math.abs(target.x) < 100 && target.y > 60; // no room for a run-up from the side
    const air = shape ? !shape.ground : target.y > 30;
    const can = {
      S: true,
      L: true,
      R: true,
      B: air && under - state.top - 30 > floor,
      T: air && topY + state.bottom + perch < ceiling && topY - state.top > 25,
    };
    // A ground enemy whose core is too deep is bumped out over the nearer edge (with an arena), unless it is too heavy
    // for bumps to move it that far: then it is waited out, hidden. Grinding at such a base was tried (titans v2,
    // 2026-10): an anchored dart base does not move, a hit low enough to reach its core rolls the brick over, and its
    // darts find the brick the moment it stops hiding (it lost at 138 s instead of drawing).
    // One already near the edge is bumped over it whatever its depth (titans v2, 2026-10: a palisade's core piece
    // lay 6 m inside the line, out of reach of a brick held at `edge`, while the rest of it wore the brick down).
    let pushOut = 0;
    if (shape && shape.ground) {
      const deep = Math.min(shape.L, shape.R) > 6;
      const nearEdge = arena && edge - Math.abs(target.x) < 100;
      // Only one too low to hit level (titans v3, 2026-10): another anvil passing near the ground read as a base and
      // was waited out for the rest of the match. Under 40 m/s a side hit breaks no armor (measured).
      if (deep && target.m > shove && tipSpeed(target) < 40) state.evade = true;
      else if (arena && (deep || nearEdge)) pushOut = target.x >= 0 ? 1 : -1;
    }
    if (state.way !== '' && !can[state.way]) endTry(main);
    if (state.way !== '' && time - state.wayAt > tryTime) endTry(main);
    if (state.way !== '' && state.wayHit && main && state.wayParts - main.parts >= hitParts) {
      // It works: keep at it, counting a new try from here.
      state.fails[state.way] = 0;
      state.wayAt = time;
      state.wayParts = main.parts;
      state.wayHit = false;
    }
    // Nothing it tries breaks anything off a ground enemy (an anchored base with its core deep and low, where a fast
    // hit would roll the brick over): it climbs out of reach of its guns for a while, then starts over.
    if (state.misses >= giveUp && shape && shape.ground) {
      state.regroupUntil = time + regroup;
      state.misses = 0;
      state.way = '';
      for (const w of WAYS) state.fails[w] = 0;
    }
    if (time < state.regroupUntil) {
      plan('regrouping out of reach');
      wantVx = clamp(0.5 * (clamp(target.x - Math.sign(target.x - x || 1) * 250, -edge, edge) - x), -sweepSpeed, sweepSpeed);
      wantH = hideHeight;
    }
    let way = state.way;
    if (time < state.regroupUntil) way = '';
    else if (way === '' || state.fails[way] >= tries) {
      let best = '';
      let cost = 1e9;
      for (const w of WAYS) {
        if (!can[w]) continue;
        // Either side face counts as the deeper of the two (it may meet either).
        let depth = shape ? (w === 'S' ? Math.max(shape.L, shape.R) : shape[w]) : w === 'B' || w === 'T' ? 30 : 10;
        if (cornered && (w === 'B' || w === 'T')) depth -= 20;
        if (pushOut !== 0 && w !== 'B' && w !== 'T') depth = (w === 'L') === pushOut > 0 ? 0 : 100;
        // The face toward it needs no pass over the top first.
        const turn = (w === 'L' && target.x < x) || (w === 'R' && target.x > x) ? 4 : 0;
        // A way too slow to break what it hits (titans v3, 2026-10): the target changes speed by v m / (m + its mass),
        // and armor takes a one-hit loss only from about 32 m/s (measured: an anvil dropped on at 60 or climbed into
        // at 32 loses its guns and nothing more), anything else from about 20.
        const wv = w === 'B' ? uppercut : w === 'T' ? fall : Math.min(vmax, 0.95 * vTop, tipSpeed(target));
        const slow = (wv * m) / (m + Math.max(target.m, 1)) < (shape && shape.armored ? 32 : 20) ? 40 : 0;
        const c = depth + turn + slow + 15 * state.fails[w] + (w === state.way ? 5 : 0);
        if (c < cost) {
          cost = c;
          best = w;
        }
      }
      if (state.fails[best] >= tries) for (const w of WAYS) state.fails[w] = Math.max(0, state.fails[w] - 1); // all tried: forgive a little
      way = best;
    }
    if (way !== '') begin(way);
    if (way === '') {
      // regrouping (above)
    } else if (way === 'B') {
      plan('ramming from below');
      if (fromBelow(target.x, under, target.vx, target.vy)) endTry(main);
    } else if (way === 'T') {
      plan('dropping on it from above');
      if (fromAbove(target.x, topY, target.vx, target.vy)) endTry(main);
    } else {
      plan(way === 'L' ? 'ramming its left face' : way === 'R' ? 'ramming its right face' : 'ramming a side face');
      const prefer = way === 'L' ? 1 : way === 'R' ? -1 : 0;
      let over = null;
      if (shape) {
        over = target.y + shape.high + state.bottom + 10;
        if (over > ceiling) over = shape.ground ? null : target.y + shape.low - state.top - 10;
        if (over !== null && over < floor) over = null;
        // Only as far as puts its core over the line: its core sits that face's depth behind the face it hits.
        if (pushOut !== 0) limit = Math.min(arena.x - pushGap / 2, arena.x - (pushOut > 0 ? shape.L : shape.R) - state.halfWidth + 20);
      }
      if (fromSide(target, prefer, over) && state.dir !== prefer) endTry(main); // it flew on past (or backs off): that run is over
      else if (prefer !== 0 && (target.x - x) * prefer < 0 && Math.abs(target.x) > limit - 60 && target.x * prefer > 0) state.fails[way] = tries; // on its far side with no room to come round: another way
    }
  } else if (pings.length > 0) {
    // Hidden from radar, touched by gun sights. In the air: climb into it from below, at the middle of what the
    // sights touched, then toward each end in turn (its core is somewhere along it). On the ground: from the side.
    let lo = 1e9;
    let hi = -1e9;
    let ylo = 1e9;
    const fresh = pings[pings.length - 1].t > time - 3; // go by the last 3 s of touches when there are any
    for (const p of pings) {
      if (fresh ? time - p.t > 3 : time - p.t > 4 && pings.length > 30) continue;
      if (p.lo < lo) lo = p.lo;
      if (p.hi > hi) hi = p.hi;
      if (p.ylo < ylo) ylo = p.ylo;
    }
    const mass = state.last ? state.last.m : 0;
    if (ylo > 40 && ylo - state.top - 30 > floor) {
      plan('ramming a hidden one from below');
      const span = hi - lo;
      const step = Math.max(0, span / 2 - state.halfWidth * 0.5);
      const k = state.upCount % 3;
      fromBelow(clamp((lo + hi) / 2 + (k === 1 ? -step : k === 2 ? step : 0), -edge, edge), ylo, 0, 0);
    } else if (mass > heavy * m) {
      state.evade = true;
      wantH = hideHeight;
    } else {
      // On the ground and hidden: its core is likely deep, so bump it (out over the nearer edge, with an arena).
      plan('ramming a hidden one from the side');
      const mid = (lo + hi) / 2;
      if (arena) limit = pushEdge;
      fromSide({ x: mid, y: Math.max(ylo, floor), vx: 0, vy: 0, ay: 0, m: mass }, mid >= 0 ? 1 : -1, Math.min(ceiling, 60 + state.bottom));
    }
  } else if (!arena && (state.won || state.mainId < 0 || time - state.lostAt > forget) && time - state.hurtAt > forget) {
    // The open sandbox with nothing to go after: rest on the ground, guns watching, until something shows up. Losing
    // parts while it rests means something it cannot see is at it (an enemy hiding in jammer bubbles): it takes off
    // and searches.
    plan('resting, watching for an enemy');
    land = true;
  } else {
    // Nothing known (it hides from the radar): fly level at a height from where the roof and floor guns' sights
    // reach from the ground to the ceiling, and sweep the enemy's half to its edge, then the whole arena (with no
    // arena, `lapEnd` either way of where it last saw the enemy).
    // The first pass is high (a hiding core mostly waits high up at its own end) and fast until the enemy's start.
    plan('searching');
    state.up = false;
    state.down = false;
    const far = state.home.x < 0 ? 1 : -1;
    const mid = arena ? 0 : state.last ? state.last.x : state.home.x;
    const reach = arena ? edge - 10 : lapEnd + 300 * Math.floor(state.leg / 2); // with no arena each sweep reaches further
    const legs = [mid + far * reach, mid, mid + far * reach, mid - far * reach];
    const to = legs[state.leg % legs.length];
    if (Math.abs(to - x) < 10) state.leg++;
    const hurry = arena && state.leg === 0 && (x + state.home.x * 0.5) * far < 0; // not yet halfway to the enemy's start
    wantVx = clamp(0.5 * (to - x), -(hurry ? lineUp : sweepSpeed), hurry ? lineUp : sweepSpeed);
    wantH = state.leg === 0 ? sweepHigh : sweepHeight;
  }

  // Stuck (titans v2, 2026-10): wedged on or into the enemy (a ground base's empty dart pits held it 20 s), it is
  // going nowhere whatever it wants. Still for `stuckTime` s while not landing: climb out and back off for a while,
  // and the try it was on counts as failed.
  if (!land && Math.hypot(vx, vy) < 1.5) {
    if (time - state.stillAt > stuckTime) {
      state.unstick = time + 2.5;
      state.stillAt = time;
      if (state.way !== '') {
        state.fails[state.way] = tries - 1;
        endTry(main);
      }
      if (say > 0.5) log('stuck: climbing out', 'charge', charge.toFixed(2), 'angle', self.angle.toFixed(2), 'mass', m.toFixed(0), 'lifts', (state.liftForce / 400).toFixed(0));
    }
  } else state.stillAt = time;
  if (time < state.unstick) {
    ramVy = 15;
    wantVx = target ? (target.x > x ? -15 : 15) : 0;
    calm = true;
  }

  // Height: a wanted climb rate toward the height, never sinking faster than the lift rows can stop before the
  // ground. Ramming may sink at up to that (a free fall while far up: the lift is cut).
  if (land) {
    wantVx = 0;
    wantH = floor;
  }
  wantH = clamp(wantH, floor, ceiling);
  const room = Math.max(0, y - floor);
  const sink = Math.max(1, Math.sqrt(2 * brake * 0.8 * room));
  const rise = Math.sqrt(2 * 8 * Math.max(0, ceiling + 15 - y)); // gravity alone stops a climb before the arena's roof
  const wantVy = ramVy !== null && !land ? clamp(ramVy, -Math.min(fall, sink), Math.min(uppercut + 10, rise)) : clamp(1.0 * (wantH - y), -Math.min(16, sink), Math.min(12, rise));
  const ay = clamp(2.5 * (wantVy - vy), -9.81, 6);

  // Lean (titans v2, 2026-10, Logan: "tilt to accelerate faster"): when the wanted speed change is more than the
  // push boosters give, it leans the lift rows that way, up to `tilt` degrees, and levels out before a hit.
  // Leaning takes seconds (a 12 t brick turns slowly), so only big changes lean.
  if (land) wantVx = 0;
  // Never faster toward an arena's edge than it can stop before `limit` (no edge in the open sandbox).
  // Going right is stopped by the boosters that push left, and the other way round: count what is left of each.
  // Air drag helps (titans v3, 2026-10): with F on it, it stops from v in (m / 2k) ln(1 + k v² / F) meters, so in
  // `room` meters it can stop from sqrt(F / k (exp(2 k room / m) - 1)). Only 0.7 of the push is counted. Before the
  // lean, so it leans to brake, not on toward the edge (a brick backing off a chaser leaned out of the arena).
  const stopFrom = (f, room) => Math.sqrt((f / k) * (Math.exp(Math.min(30, (2 * k * Math.max(0, room)) / m)) - 1));
  if (limit < Infinity) wantVx = clamp(wantVx, -stopFrom(0.7 * state.pushRight, x + limit), stopFrom(0.7 * state.pushLeft, limit - x));
  const dvx = wantVx - vx;
  let lean = 0;
  // Never near the ground or the target: a leaning brick that scrapes something rolls over.
  const clear = y - floor > 25 && (!target || Math.abs(target.x - x) > state.halfWidth + 60);
  if (!land && !calm && clear && tilt > 0) {
    const pushA = (dvx > 0 ? state.pushRight : state.pushLeft) / m;
    const need = 0.25 * Math.abs(dvx) - pushA;
    if (need > 0) lean = -Math.sign(dvx) * Math.min((tilt * Math.PI) / 180, Math.atan(need / 9.81));
  }
  let lift = (m * (9.81 + ay)) / state.liftForce / Math.max(0.5, Math.cos(self.angle));
  if (land && room < 0.4 && Math.abs(vy) < 1) lift = 0; // sitting on the ground

  // Level (or the lean): a spring and damper on the tilt, through the difference between the two lift halves, plus
  // what cancels the push boosters' own turning.
  const w = 1.4;
  const torque = state.inertia * (-w * w * (self.angle - lean) - 2 * w * self.angVel) + state.pushArm * state.push;
  // The difference between the halves comes out of spare lift only, so leaning never costs height (a level-out
  // from a big tilt may take a little more). In a free fall it keeps just enough lift on one half to steer the tilt.
  // Tipping over (a spin from a hit, or a tilt well past the lean): all it has goes into righting, height or not.
  const tipping = Math.abs(self.angle) > Math.abs(lean) + 0.2 || Math.abs(self.angVel) > 0.12;
  const cap = tipping ? 0.5 : Math.abs(self.angle - lean) > 0.3 ? 0.35 : clamp(1 - lift, 0.12, 0.35);
  const diff = clamp(torque / state.leanTorque, -cap, cap);
  // Near the ceiling while still climbing, nothing is kept on: only a cut lift stops the climb in time (a kept half
  // let it coast through the arena's roof, titans v2, 2026-10).
  const keep = y > ceiling - 60 && vy > 0 ? 0 : Math.abs(diff);
  lift = clamp(lift, keep, 1 - Math.abs(diff));
  // On its side (a hit rolled it past 60 degrees) the lift rows push it along more than up: lying on the ground on
  // its side, a brick slid out of the arena on them at 84 m/s (titans v3, 2026-10). They are cut while that push
  // heads for the nearer edge and it is already going that way or near it.
  const sideways = -Math.sin(self.angle);
  if (arena && Math.abs(self.angle) > 1.05 && sideways * x > 0 && (vx * sideways > 5 || edge - Math.abs(x) < 300)) lift = 0;
  const leftLift = lift > 0 ? clamp(lift - diff, 0, 1) : 0;
  const rightLift = lift > 0 ? clamp(lift + diff, 0, 1) : 0;
  set('la', 'throttle', state.laLeft ? leftLift : rightLift);
  set('lb', 'throttle', state.laLeft ? rightLift : leftLift);


  // Sideways: the boosters on one side or the other.
  // Upside down they push the other way, and on its side up or down (titans v3, 2026-10: a brick on its back drove
  // itself out of the arena wanting to go the other way): turned over, the booster sides swap; on its side, none.
  const facing = Math.cos(self.angle);
  const u = clamp(0.6 * (wantVx - vx), -1, 1) * (facing > 0.3 ? 1 : facing < -0.3 ? -1 : 0);
  set('pa', 'throttle', clamp(u * state.paDir, 0, 1));
  set('pb', 'throttle', clamp(-u * state.paDir, 0, 1));
  state.push = u * (u > 0 ? state.pushRight : state.pushLeft);
}
