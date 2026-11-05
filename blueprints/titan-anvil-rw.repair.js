// Repair of titan-anvil-rw: what it gives up and what it makes, in what order. The engine only takes orders (`scrap`,
// `build`, `heal`): every decision is here, and the pilot flies on whatever is left. It wakes twice a second. Param
// `repair` 0 turns it all off.
//
// A brick that rams: a hard hit breaks what is near the contact, about 6 m deep, so what it loses is one face at a time.
// What it makes, most wanted first:
// 1. The keep: anything lost round the core goes back at once, hit or not.
// 2. Its boosters, the group that lost most first. Each of the six (lift halves `la` `lb`, push sides `pa` `pb`, ends
//    `ra` `rb`) is one side of a pair: the pilot flies on what each can give, and one side short turns it (the pilot's
//    Hurt). A group under `hurtAt` of what it had comes back even while hit.
// 3. Its lasers and what brings them out (piston, rotator, the lid's decouplers).
// 4. Its faces: plates, frames and batteries that close a hole (two or more neighbors standing) first, then the rest.
// 5. Its guns, then reactors and radar.
// Fighting on what is left (Logan, 2026-11-05: "make armor on the side that I want to ram on, right as I'm about to
// ram, or systematically place armor only where I think enemies are", "a couple guns in strategic locations"): the
// nearest enemy core within `frontR` is its front. Plates facing it come back first (a part comes back at 1 percent,
// so what makes a plate armor is the heal after it). Lean (the plates it lost weigh more than its lift has room for,
// or cost more than it has and can sell), it makes no plate or gun facing away from the front (`backAt`), and its
// guns that point at the front come back ahead of its faces. An enemy core within `ramR`: it heals the plates that
// face it to full, most square to it first, ahead of all but the keep and a hurt group, selling for it.
// A region (`region` cells square) that lost a part in the last `quiet` s is left alone, the keep and a hurt group apart:
// what it makes in the middle of a ram dies with the next hit.
// What it cannot pay for it sells for, keeping a `float` in the tank: jammers first (never made again), then batteries,
// a hole at a time: one with three sides or more filled, whose every neighbor keeps two sides or more, down to
// `minDense` (for the keep, or a hurt group, `minDenseHard`), then push boosters, a pair at a time (one a side), down to
// `pushKeep` of each side. Never a battery that ties anything else in (built next to anything but batteries), a lift or
// end booster, or a plate, and never what would cut it in two (`spare`).
//
// Grounded, it sheds weight (Logan, 2026-11-05: on the ground it is useless, so it gets up by any means). Its lift rows
// at full throttle for `climbAt` s without climbing, or too few lift boosters left to hold its weight at all: it sells
// what it can best do without until its lift holds `liftMargin` times its weight (once started, it goes on to that
// even once it rises: it rose at 1.08 and was down again 20 s later), and while it still cannot climb, more. A section
// swung off the hull first (on a body turned away from the core's), lowest first; then its plates, the bottom rows
// first; then the rest of the hull, the bottom first; then push boosters, a pair at a time, down to `shedPush` of each
// side. Never the core and what is round it (`keepR`), a reactor, a laser or what brings it out, or a lift or end
// booster, nor what holds the core and the lasers to the reactors (`tiesCore`, `tiesLaser` paths that share no part,
// through no jammer or booster). What it sells is no loss: a scrap gives back all a part is worth, and
// what it shed is built again once it is up and calm, as long as its lift still holds `liftMargin` times its weight
// with it. While it sheds it builds nothing but lift boosters, the keep, and its way to its lift (below).
// Last resort (Logan, 2026-11-05, down to its keep, four reactors and ten lift boosters on the ground: "look at all
// those plates on the bottom. We could definitely sell some of those"): grounded, with nothing else sold for `bareAt`
// s, it sells the keep's plates, the outermost first and the bottom first, never the ring of `keepRing` round the core;
// none of those left, its reactors, the furthest from the core first, keeping enough to run the lift it needs (a
// reactor gives 1200 W, a lift booster at full draws 60). A keep plate it sold comes back as a shed part does, once it
// is up, not at once as the keep does.
// Grounded, it also builds its way to its lift: the lost parts that lead to a lost lift booster, the nearest first (in
// Logan's replay its lift boosters sat three batteries apart, the batteries gone, and none it had lost touched it: it
// sat 3 minutes with 38 in the tank it could spend on nothing). Not past `bridgeMax` cells, and never a jammer (the
// pilot lit each one it made, every 5 s). What it makes to fly (lift boosters, and the way to them) it heals to full,
// the weakest first, with what is over the float: in the air before anything else past the keep, on the ground with
// half its jobs. Made at 1 percent, two bumps in that replay took 27 lift boosters and 53 batteries it had just made,
// with 190 in the tank.

const repairOn = param('repair', 1, { min: 0, max: 1 }); // 0: it never scraps, builds or heals
const every = param('every', 30, { min: 1, max: 30 }); // ticks between looks
const keepR = param('keepR', 6, { min: 1, max: 30 }); // cells round the core that make the keep
const quiet = param('quiet', 3, { min: 0, max: 30 }); // s since a region lost a part before it counts as calm
const region = param('region', 10, { min: 1, max: 80 }); // cells to a side of a region
const hurtAt = param('hurtAt', 0.7, { min: 0, max: 1 }); // share of a booster group under which its boosters come back even under fire
const minDense = param('minDense', 400, { min: 0, max: 1000 }); // dense batteries it keeps (it has 803): its energy for the rams (600 left it nothing to sell for its last 999 parts lost)
const minDenseHard = param('minDenseHard', 250, { min: 0, max: 1000 }); // and for the keep or a hurt group
const pushKeep = param('pushKeep', 0.8, { min: 0, max: 1 }); // share of each push side (154) it keeps when the batteries are down to their floor
const float = param('float', 15, { min: 0, max: 300 }); // juice it keeps in the tank ahead of need
const plateAt = param('plateAt', 0.5, { min: 0, max: 1 }); // share of health under which a plate is healed with what is over the float
const climbAt = param('climbAt', 2, { min: 0.5, max: 20 }); // s at full lift without climbing before it sheds weight
const liftMargin = param('liftMargin', 1.2, { min: 1, max: 3 }); // its lift over its weight: it sheds down to this, and builds nothing that takes it under (it has 1.31)
const shedPush = param('shedPush', 0.33, { min: 0, max: 1 }); // share of each push side it keeps when shedding
const stillAt = param('stillAt', 3, { min: 0, max: 30 }); // m/s under which one lift half at full is righting itself, not leaning to fly
const frontR = param('frontR', 600, { min: 0, max: 2000 }); // m: the nearest enemy core within this is its front
const ramR = param('ramR', 150, { min: 0, max: 2000 }); // m: an enemy core this near, it hardens the plates that face it
const frontAt = param('frontAt', 0.5, { min: -1, max: 1 }); // how square to the front a plate faces to be hardened
const backAt = param('backAt', -0.2, { min: -1, max: 1 }); // lean, a plate or gun facing the front less than this is not made
const bareAt = param('bareAt', 6, { min: 0, max: 60 }); // s grounded with nothing else sold before it sells its keep's plates, then reactors
const keepRing = param('keepRing', 1, { min: 0, max: 6 }); // cells round the core whose plates it never sells, even then
const bridgeMax = param('bridgeMax', 12, { min: 0, max: 60 }); // cells it builds through, grounded, to reach a lost lift booster
const tiesCore = param('tiesCore', 8, { min: 1, max: 30 }); // paths sharing no part that shedding leaves from the keep to the reactors
const tiesLaser = param('tiesLaser', 3, { min: 1, max: 10 }); // and from each laser's mount

const GROUPS = ['la', 'lb', 'pa', 'pb', 'ra', 'rb'];

// A part's cell, read off its id once: a look reads it for thousands of parts.
const CELLS = new Map();
const cellOf = (id) => {
  let c = CELLS.get(id);
  if (c === undefined) {
    const m = id.match(/@(-?\d+),(-?\d+)/);
    c = { x: Number(m[1]), y: Number(m[2]) };
    CELLS.set(id, c);
  }
  return c;
};
const key = (x, y) => x * 4096 + y;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Every cell a part fills: a reactor is 3 by 3 from its own cell (built unturned in this robot).
const cellsOfPart = (p) => {
  const c = cellOf(p.id);
  if (p.type !== 'reactor') return [c];
  const out = [];
  for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) out.push({ x: c.x + dx, y: c.y + dy });
  return out;
};
const groupOf = (p) => (p.type === 'booster' && p.tags.length > 0 && GROUPS.includes(p.tags[0]) ? p.tags[0] : null);
const isLift = (p) => p.type === 'booster' && (p.tags[0] === 'la' || p.tags[0] === 'lb');
// What it never sheds to get up: what it is for, and what makes it fly.
const NEVER_SHED = new Set(['core', 'reactor', 'laser', 'piston', 'rotator', 'decoupler', 'booster']);
// A booster pushes 400 N at full throttle (booster.json).
const BOOST_N = 400;
// A booster at full throttle draws 60 W (booster.json); a reactor gives 1200 (reactor.json).
const BOOST_W = 60;
const REACTOR_W = 1200;
// Each type's mass, from the parts it starts with: what a lost part would weigh again, built.
const MASS = {};

// What it may sell, worked out once at setup (a sort over every battery each look cost more than it was worth):
// - Batteries built with batteries on all four sides, the middle of the block (about 210 it may sell). One that touches
//   anything else ties that in, and is never sold. Sold furthest from the core first, it ate the ties first and left its
//   core, lasers and reactors held to the hull by one battery (Logan, 2026-11-03); selling every battery that tied no
//   reactor, laser or core in (about 330), its whole block broke away from the walls and boosters.
// - Its push boosters as pairs, one a side, the furthest first, so the two sides stay even.
let SELL = [];
let PAIRS = [];

function setup() {
  const core = parts.find((p) => p.type === 'core');
  state.c = cellOf(core.id);
  state.sold = {}; // what it gave up: not fire
  state.due = {}; // what a scrap under way will bring
  state.heat = {}; // region: when it last lost a part there
  state.seen = {}; // what was lost at the last look
  state.blocked = {}; // part: when its cell was last found blocked
  state.last = '';
  state.shed = {}; // what it sold to get off the ground: built again once it is up
  state.strainAt = -1; // since when its lift rows have been at full throttle without climbing
  state.shedding = false; // shedding until its lift holds `liftMargin` times its weight
  state.held = {}; // part: when `spare` last turned it down for shedding (it holds the hull together)
  state.bareSince = -1; // since when shedding has found nothing else to sell
  state.bridge = {}; // what it built, grounded, to reach its lift: never shed
  state.fresh = {}; // lift boosters and bridge parts it made, until they are healed to full
  for (const p of parts) MASS[p.type] = p.mass;
  // The middle of the hull and its half sizes: what a cell faces is read off where it is in the brick.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of parts) {
    for (const c of cellsOfPart(p)) {
      x0 = Math.min(x0, c.x);
      x1 = Math.max(x1, c.x);
      y0 = Math.min(y0, c.y);
      y1 = Math.max(y1, c.y);
    }
  }
  state.mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, hw: Math.max(1, (x1 - x0) / 2), hh: Math.max(1, (y1 - y0) / 2) };
  state.front = null;
  state.lean = false;
  // What each booster group had to start with: the share it keeps is of this, not of what it has after selling.
  state.had = {};
  for (const k of GROUPS) state.had[k] = 0;
  for (const p of parts) if (groupOf(p)) state.had[groupOf(p)]++;
  // And what it had lost before this script ran (none at a spawn): the script swapped in mid fight.
  for (const p of lost() ?? []) if (groupOf(p)) state.had[groupOf(p)]++;
  const far = (p) => fromCore(cellOf(p.id).x, cellOf(p.id).y);
  const byFar = (list) => list.filter((p) => far(p) > keepR).sort((a, b) => far(b) - far(a)).map((p) => p.id);
  const battery = new Set(parts.filter((p) => p.type === 'densebattery').map((p) => key(cellOf(p.id).x, cellOf(p.id).y)));
  SELL = parts
    .filter((p) => p.type === 'densebattery' && far(p) > keepR)
    .filter((p) => SIDES.every(([dx, dy]) => battery.has(key(cellOf(p.id).x + dx, cellOf(p.id).y + dy))))
    .map((p) => p.id);
  const pa = byFar(parts.filter((p) => groupOf(p) === 'pa'));
  const pb = byFar(parts.filter((p) => groupOf(p) === 'pb'));
  PAIRS = pa.slice(0, pb.length).map((id, i) => [id, pb[i]]);
}

const regionOf = (x, y) => `${Math.floor(x / region)},${Math.floor(y / region)}`;
const calm = (x, y) => time - (state.heat[regionOf(x, y)] ?? -1000) > quiet;
const fromCore = (x, y) => Math.max(Math.abs(x - state.c.x), Math.abs(y - state.c.y));

function say(text) {
  if (text === state.last) return;
  state.last = text;
  log(text);
}

/**
 * Its front: the nearest enemy core it sees within `frontR`, as `{ x, y, d }`, a unit direction in its own frame (the
 * grid's, y up) and the meters to it. null with none.
 */
function frontNow() {
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.pos.x === null || c.pos.y === null) continue;
    if (c.distance > frontR) return null;
    const dx = c.pos.x - self.pos.x;
    const dy = c.pos.y - self.pos.y;
    const co = Math.cos(self.angle);
    const si = Math.sin(self.angle);
    const bx = dx * co + dy * si;
    const by = -dx * si + dy * co;
    const n = Math.hypot(bx, by);
    if (n < 1e-6) return null;
    return { x: bx / n, y: by / n, d: c.distance };
  }
  return null;
}

/** How square a cell faces the front, -1 to 1: where it is in the brick, as a share of its half sizes, toward it. */
function facing(x, y, f) {
  const m = state.mid;
  const ux = (x - m.x) / m.hw;
  const uy = (y - m.y) / m.hh;
  const n = Math.hypot(ux, uy);
  return n < 1e-6 ? 0 : (ux * f.x + uy * f.y) / n;
}

/** How square a gun built at `rot` points at the front: its barrel is north unturned (gun.json, `acts`). */
const aims = (rot, f) => -Math.sin((rot * Math.PI) / 180) * f.x + Math.cos((rot * Math.PI) / 180) * f.y;

/** The face a direction in its own frame is: what it says. */
const faceName = (f) => (Math.abs(f.x) >= Math.abs(f.y) ? (f.x < 0 ? 'left' : 'right') : f.y < 0 ? 'bottom' : 'top');

/**
 * Each booster group: how many it has now, and had to start with. Counted as what it has plus what it lost, a group
 * shrank with every booster sold, and selling down to 90 percent of that went on until one side of a pair had 144 to
 * the other's 188 and it rolled over.
 */
function groups() {
  const g = {};
  for (const k of GROUPS) g[k] = { now: 0, had: Math.max(1, state.had[k]) };
  for (const p of parts) {
    const k = groupOf(p);
    if (k) g[k].now++;
  }
  return g;
}

/** Cells with a part in them now (each part's own cell). */
function cells() {
  const at = new Set();
  for (const p of parts) {
    const c = cellOf(p.id);
    at.add(key(c.x, c.y));
  }
  return at;
}

/** What the look wants, most wanted first: `{ id, cost, why, hard }`. */
function wants(gone, g, at, front, lean, grounded) {
  const list = [];
  const open = new Set();
  const add = (p, why, hard) => {
    if (open.has(p.id) || time - (state.blocked[p.id] ?? -1000) < 10) return;
    open.add(p.id);
    list.push({ id: p.id, cost: p.create, why, hard, lift: p.type === 'booster' && (p.tags[0] === 'la' || p.tags[0] === 'lb'), kg: MASS[p.type] ?? p.juice });
  };
  const reach = gone.filter((p) => p.touching);
  // 1: the keep, nearest the core first.
  for (const p of reach.filter((q) => fromCore(q.x, q.y) <= keepR && !state.shed[q.id] && q.type !== 'jammer').sort((a, b) => fromCore(a.x, a.y) - fromCore(b.x, b.y))) add(p, 'keep', true);
  // 2: boosters, the group that lost the largest share first.
  const share = (k) => (g[k].had > 0 ? g[k].now / g[k].had : 1);
  const order = GROUPS.filter((k) => share(k) < 1).sort((a, b) => share(a) - share(b));
  for (const k of order) {
    const hurt = share(k) < hurtAt;
    for (const p of reach.filter((q) => q.type === 'booster' && q.tags[0] === k && (hurt || calm(q.x, q.y)))) add(p, hurt ? 'hurt' : 'boosters', hurt);
  }
  // Grounded: the way to its lift, each lost part by how many lost cells lie between it and a lost lift booster.
  if (grounded && bridgeMax > 0) {
    const lostAt = new Map();
    for (const p of gone) if (p.type !== 'reactor' && p.type !== 'jammer') lostAt.set(key(p.x, p.y), p);
    // The half with the smaller share of its lift first: one half built back alone (6 of 132 to 63) it could not
    // climb at 2.25 times its weight, the pilot holding the strong half back to stay level.
    const half = (k) => {
      const dist = new Map();
      let queue = [];
      for (const p of gone) {
        if (p.type === 'booster' && p.tags[0] === k) {
          dist.set(key(p.x, p.y), 0);
          queue.push(p);
        }
      }
      for (let d = 1; d <= bridgeMax && queue.length > 0; d++) {
        const next = [];
        for (const p of queue) {
          for (const [dx, dy] of SIDES) {
            const c = key(p.x + dx, p.y + dy);
            const q = lostAt.get(c);
            if (q === undefined || dist.has(c)) continue;
            dist.set(c, d);
            next.push(q);
          }
        }
        queue = next;
      }
      const way = reach.filter((q) => !isLift(q) && dist.has(key(q.x, q.y)));
      way.sort((a, b) => dist.get(key(a.x, a.y)) - dist.get(key(b.x, b.y)) || a.create - b.create);
      return way;
    };
    for (const k of ['la', 'lb'].sort((a, b) => share(a) - share(b))) for (const p of half(k)) add(p, 'bridge', false);
  }
  // 3: the lasers and what brings them out.
  for (const p of reach.filter((q) => ['laser', 'piston', 'rotator', 'decoupler'].includes(q.type) && calm(q.x, q.y))) add(p, 'lasers', false);
  // Its guns, those pointing at the front first; lean, only those that point its way, and ahead of the faces.
  const guns = reach.filter((q) => q.type === 'gun' && calm(q.x, q.y) && !(lean && front && aims(q.rot, front) < backAt));
  if (front) guns.sort((a, b) => aims(b.rot, front) - aims(a.rot, front));
  if (lean) for (const p of guns) add(p, 'gun', false);
  // 4: the faces: what closes a hole first, and a plate facing the front ahead of one that does not; lean, no plate
  // facing away from it.
  const around = (p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].reduce((n, [dx, dy]) => n + (at.has(key(p.x + dx, p.y + dy)) ? 1 : 0), 0);
  const faces = reach.filter((q) => ['armorplate', 'frame', 'densebattery'].includes(q.type) && calm(q.x, q.y));
  const plate = (p) => (front && p.type === 'armorplate' ? facing(p.x, p.y, front) : 0);
  const score = (p) => around(p) + 2 * plate(p);
  faces.sort((a, b) => score(b) - score(a));
  for (const p of faces) if (!(lean && front && p.type === 'armorplate' && plate(p) < backAt)) add(p, 'face', false);
  // 5: the rest.
  // Not jammers: they are the first thing it sells.
  for (const p of guns) add(p, 'gun', false);
  for (const type of ['reactor', 'radar']) for (const p of reach.filter((q) => q.type === type && calm(q.x, q.y))) add(p, type, false);
  return list;
}

/**
 * What it gives up for `short` juice, best first, for `think` to pick from (`spare` keeps what would not cut it in two):
 * enough to cover it twice over, so what `spare` turns down still leaves enough. A push booster comes with the one it
 * is paired with (`pair`): the two go together or not at all.
 */
function offers(short, hard) {
  const out = [];
  const live = new Set();
  // Cells filled now, less what is already sold (it is still there until its scrap lands).
  const at = new Set();
  let dense = -(hard ? minDenseHard : minDense);
  const side = { pa: 0, pb: 0 };
  for (const p of parts) {
    if (state.sold[p.id]) continue;
    for (const c0 of cellsOfPart(p)) at.add(key(c0.x, c0.y));
    if (p.type === 'jammer') {
      const c = cellOf(p.id);
      if (fromCore(c.x, c.y) > keepR && out.length < 200) out.push({ id: p.id, gives: 2 });
    } else if (p.type === 'densebattery') {
      dense++;
      live.add(p.id);
    } else if (p.type === 'booster' && (p.tags[0] === 'pa' || p.tags[0] === 'pb')) {
      side[p.tags[0]]++;
      live.add(p.id);
    }
  }
  const most = Math.min(200, out.length + Math.ceil((2 * short) / 1.2) + 8);
  // Never its lift or end boosters: the lift rows hold 1.3 times its weight, and a tenth of them sold took what it can
  // brake a fall by from 1 m/s² to nothing. Never its plates: they are the brick (sold for a hurt group, 169 went off
  // its faces, and Anvil-r broke it to 60 parts).
  // A battery goes only with three sides or more filled, and only if each of its neighbors keeps two sides or more: the
  // holes spread out like a sieve and never join into a cut.
  const sides = (x, y) => SIDES.reduce((n, [dx, dy]) => n + (at.has(key(x + dx, y + dy)) ? 1 : 0), 0);
  let sold = 0;
  for (const id of SELL) {
    if (dense <= 0 || out.length >= most) break;
    if (!live.has(id)) continue;
    const c = cellOf(id);
    if (sides(c.x, c.y) < 3) continue;
    if (SIDES.some(([dx, dy]) => at.has(key(c.x + dx, c.y + dy)) && sides(c.x + dx, c.y + dy) - 1 < 2)) continue;
    out.push({ id, gives: 3 });
    at.delete(key(c.x, c.y));
    dense--;
    sold++;
  }
  if (sold > 0) return out;
  // Batteries down to their floor: push boosters, a pair at a time. Sold from one side only, a tenth of them, and it ran
  // out of the arena chasing Anvil-r to the edge; a pair keeps the sides even, and `pushKeep` keeps it able to stop.
  let pairs = Math.min(side.pa - Math.ceil(pushKeep * state.had.pa), side.pb - Math.ceil(pushKeep * state.had.pb));
  for (const [a, b] of PAIRS) {
    if (pairs <= 0 || out.length + 2 > most) break;
    if (!live.has(a) || !live.has(b)) continue;
    out.push({ id: a, gives: 1.5, pair: b });
    out.push({ id: b, gives: 1.5, pair: a });
    pairs--;
  }
  return out;
}

/** The weight (kg) its lift boosters hold up at full throttle. */
function liftKg() {
  let n = 0;
  for (const p of parts) if (isLift(p)) n++;
  return (n * BOOST_N) / 9.81;
}

/**
 * Stuck at full lift: whether it sheds weight this look. On the ground (its lowest part within 2.5 m of it, at y 0),
 * going neither up nor down (under 0.5 m/s), for `climbAt` s, with both its lift halves at 0.9 throttle or more, or
 * one of them (righting itself) while it is all but still (under `stillAt` m/s); or too few lift boosters to hold its
 * weight. Going down at full lift is braking, a landing as often as not (the first try shed 5 t on its way down to
 * charge); held still at full lift in the air it is hovering on what its reactors give, or pushing on an enemy (it
 * shed and built back 700 kg over and over). One half at full while it goes along is the pilot leaning to fly low:
 * at 1.2 times its weight it skimmed the ground at 20 m/s under an enemy, read as stuck, and shed and built back 500 kg
 * twice in 20 s (2026-11-05).
 */
function stuck(lift) {
  const sum = { la: 0, lb: 0 };
  const n = { la: 0, lb: 0 };
  for (const p of parts) {
    if (!isLift(p)) continue;
    sum[p.tags[0]] += p.in.throttle || 0;
    n[p.tags[0]]++;
  }
  const a = n.la > 0 ? sum.la / n.la : 0;
  const b = n.lb > 0 ? sum.lb / n.lb : 0;
  const still = Math.hypot(self.vel.x, self.vel.y) < stillAt;
  const full = Math.min(a, b) >= 0.9 || (Math.max(a, b) >= 0.9 && still);
  state.throttle = `${a.toFixed(2)} ${b.toFixed(2)}`;
  let low = Infinity;
  for (const p of parts) low = Math.min(low, p.pos.y);
  if (full && Math.abs(self.vel.y) < 0.5 && low < 2.5) {
    if (state.strainAt < 0) state.strainAt = time;
  } else state.strainAt = -1;
  return lift < self.mass || (state.strainAt >= 0 && time - state.strainAt >= climbAt);
}

/** Angle between two body angles, -pi to pi. */
const turned = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

// What can hold it together: parts that bear on every face. Not a jammer (lit, it burns away: the pilot lit the last one
// its core hung by, and the core fell off the hull, Logan 2026-11-05), nor a booster (its reactors' heat burns them).
const TIE = new Set(['armorplate', 'frame', 'densebattery', 'reactor', 'core']);

/**
 * The parts on up to `k` paths from any part in `from` to a reactor that share no part: what holds `from` to the hull.
 * Shed bottom first with only `spare` to keep it in one piece, it dug out the hull round its core and left the core hung
 * by one jammer (Logan, 2026-11-05). `gone`: parts being scrapped. Returns `{ ids, n }`, `n` the paths it found.
 */
function ties(from, k, gone) {
  const live = parts.filter((p) => TIE.has(p.type) && p.on === '' && !gone.has(p.id));
  const n = live.length;
  const at = new Map();
  live.forEach((p, i) => {
    for (const c of cellsOfPart(p)) at.set(key(c.x, c.y), i);
  });
  // A flow of 1 a part: part i is two nodes, in (2i) and out (2i + 1); S and T the ends. Edge e's reverse is e ^ 1.
  const S = 2 * n;
  const T = 2 * n + 1;
  const first = new Array(2 * n + 2).fill(-1);
  const to = [];
  const cap = [];
  const next = [];
  const edge = (a, b, c) => {
    to.push(b, a);
    cap.push(c, 0);
    next.push(first[a], first[b]);
    first[a] = to.length - 2;
    first[b] = to.length - 1;
  };
  const inner = []; // each part's in-to-out edge
  for (let i = 0; i < n; i++) {
    const p = live[i];
    const src = from.has(p.id);
    const end = p.type === 'reactor';
    inner.push(to.length);
    edge(2 * i, 2 * i + 1, src || end ? k : 1);
    if (src) edge(S, 2 * i, k);
    if (end) edge(2 * i + 1, T, k);
    const near = new Set();
    for (const c of cellsOfPart(p)) {
      for (const [dx, dy] of SIDES) {
        const j = at.get(key(c.x + dx, c.y + dy));
        if (j === undefined || j === i || near.has(j)) continue;
        near.add(j);
        edge(2 * i + 1, 2 * j, 1);
      }
    }
  }
  let found = 0;
  const by = new Array(2 * n + 2);
  while (found < k) {
    by.fill(-1);
    by[S] = -2;
    const queue = [S];
    for (let h = 0; h < queue.length && by[T] === -1; h++) {
      const u = queue[h];
      for (let e = first[u]; e !== -1; e = next[e]) {
        if (cap[e] > 0 && by[to[e]] === -1) {
          by[to[e]] = e;
          queue.push(to[e]);
        }
      }
    }
    if (by[T] === -1) break;
    for (let v = T; v !== S; v = to[by[v] ^ 1]) {
      cap[by[v]]--;
      cap[by[v] ^ 1]++;
    }
    found++;
  }
  const ids = new Set();
  for (let i = 0; i < n; i++) if (!from.has(live[i].id) && live[i].type !== 'reactor' && cap[inner[i]] === 0) ids.add(live[i].id);
  return { ids, n: found };
}

/**
 * What shedding never sells, as it holds the core and the lasers to the hull: `tiesCore` paths from the keep to the
 * reactors, and `tiesLaser` from what each laser's piston is built on, none of them through a jammer or a booster.
 * Returns `{ hold, core, lasers }`: the parts, and the paths it found for the core and for the worst-held laser.
 */
function backbone(gone) {
  const keep = new Set();
  const mounts = [];
  const byCell = new Map();
  for (const p of parts) if (TIE.has(p.type) && p.on === '' && !gone.has(p.id)) byCell.set(key(cellOf(p.id).x, cellOf(p.id).y), p.id);
  for (const p of parts) {
    const c = cellOf(p.id);
    if (byCell.get(key(c.x, c.y)) === p.id && fromCore(c.x, c.y) <= keepR) keep.add(p.id);
    if (p.type === 'piston') {
      const m = new Set();
      for (const [dx, dy] of SIDES) {
        const id = byCell.get(key(c.x + dx, c.y + dy));
        if (id !== undefined) m.add(id);
      }
      if (m.size > 0) mounts.push(m);
    }
  }
  const core = ties(keep, tiesCore, gone);
  const hold = new Set(core.ids);
  let lasers = tiesLaser;
  for (const m of mounts) {
    for (const id of m) hold.add(id);
    const t = ties(m, tiesLaser, gone);
    for (const id of t.ids) hold.add(id);
    lasers = Math.min(lasers, t.n);
  }
  return { hold, core: core.n, lasers };
}

/**
 * Sells weight to get up: `want` kg, best first (see the top). Each look sells what its free jobs allow; `spare` keeps
 * it in one piece, so a section swung off the hull goes from its far end in.
 */
function shed(want, free, busy, gone) {
  const back = backbone(gone);
  const list = [];
  for (const p of parts) {
    if (NEVER_SHED.has(p.type) || state.sold[p.id] || state.bridge[p.id] || busy.has(p.id) || back.hold.has(p.id) || time - (state.held[p.id] ?? -1000) < 5) continue;
    const c = cellOf(p.id);
    if (fromCore(c.x, c.y) <= keepR) continue;
    // A body turned more than 6 degrees from the hull's: a section that swung away (what is on a laser's joint is that
    // joint's load, and goes with the rest of the hull).
    const off = p.on === '' && Math.abs(turned(p.angle, self.angle)) > 0.1;
    list.push({ p, tier: off ? 0 : p.type === 'armorplate' ? 1 : 2, low: off ? p.pos.y : c.y });
  }
  list.sort((a, b) => a.tier - b.tier || a.low - b.low || b.p.mass - a.p.mass);
  const head = [];
  // Push boosters last, a pair at a time (one a side, or it turns), down to `shedPush` of each side.
  const live = new Map();
  const side = { pa: 0, pb: 0 };
  for (const p of parts) {
    if (p.tags[0] === 'pa' || p.tags[0] === 'pb') {
      if (p.type === 'booster') side[p.tags[0]]++;
      if (!busy.has(p.id)) live.set(p.id, p);
    }
  }
  let room = Math.min(side.pa - Math.ceil(shedPush * state.had.pa), side.pb - Math.ceil(shedPush * state.had.pb));
  const pairs = [];
  for (const [a, b] of PAIRS) {
    if (room <= 0 || pairs.length >= free) break;
    if (!live.has(a) || !live.has(b)) continue;
    pairs.push([a, b]);
    room--;
  }
  // `spare` looks at 200 a call, and turns down most of what is left once the loose plates are gone (the walls hold it
  // together): 112 asked, 3 allowed, and it hung at 1.12 times its weight. What it turned down is not asked again for
  // 5 s, so the next look reaches further down the list.
  for (const s of list) {
    if (head.length + 2 * pairs.length >= 200) break;
    head.push(s);
  }
  const may = new Set(spare(head.map((s) => s.p.id).concat(pairs.flat())) ?? []);
  for (const s of head) if (!may.has(s.p.id)) state.held[s.p.id] = time;
  let kg = 0;
  let n = 0;
  for (const s of head) {
    if (free <= 0 || kg >= want) break;
    if (!may.has(s.p.id)) continue;
    const done = scrap(s.p.id);
    if (done.ok) {
      state.shed[s.p.id] = true;
      kg += s.p.mass;
      free--;
      n++;
    } else if (done.why === 'too many orders this tick') break;
  }
  for (const [a, b] of pairs) {
    if (free < 2 || kg >= want) break;
    if (!may.has(a) || !may.has(b)) continue;
    const one = scrap(a);
    if (!one.ok) {
      if (one.why === 'too many orders this tick') break;
      continue;
    }
    const two = scrap(b);
    if (!two.ok) {
      stopJob(a);
      if (two.why === 'too many orders this tick') break;
      continue;
    }
    for (const id of [a, b]) {
      state.shed[id] = true;
      kg += live.get(id).mass;
      free--;
      n++;
    }
  }
  if (n > 0) log(`shed ${n} (${kg.toFixed(0)} kg) to get up: mass ${self.mass.toFixed(0)}, lift ${(liftKg() / self.mass).toFixed(2)}, climbing ${self.vel.y.toFixed(1)} m/s, core held ${back.core} ways, lasers ${back.lasers}`);
  // Nothing else sold for `bareAt` s, and nothing of it still being sold: the last resort.
  if (n > 0 || gone.size > 0) state.bareSince = -1;
  else if (state.bareSince < 0) state.bareSince = time;
  if (n === 0 && state.bareSince >= 0 && time - state.bareSince >= bareAt && free > 0) free = lastResort(want, free, busy);
  return free;
}

/**
 * Grounded with nothing else to sell: the keep's plates, the outermost first and the bottom first, never within
 * `keepRing` of the core; none of those left, a reactor, the furthest first, keeping enough reactors to run the lift
 * boosters it needs to hold `liftMargin` times what it would weigh without it.
 */
function lastResort(want, free, busy) {
  // Keep plates that `spare` turned down a moment ago still count as there: none left is none at all, not none askable.
  const plates = parts
    .filter((p) => p.type === 'armorplate' && !state.sold[p.id] && !busy.has(p.id))
    .filter((p) => {
      const c = cellOf(p.id);
      return fromCore(c.x, c.y) <= keepR && fromCore(c.x, c.y) > keepRing;
    })
    .sort((a, b) => fromCore(cellOf(b.id).x, cellOf(b.id).y) - fromCore(cellOf(a.id).x, cellOf(a.id).y) || cellOf(a.id).y - cellOf(b.id).y);
  let list = plates.filter((p) => time - (state.held[p.id] ?? -1000) >= 5);
  let what = 'keep plates';
  if (plates.length === 0) {
    const reactors = parts.filter((p) => p.type === 'reactor' && !state.sold[p.id] && !busy.has(p.id));
    // What it needs: lift boosters for `liftMargin` times its weight less one reactor, and the reactors to run them.
    const need = Math.ceil((((self.mass - (MASS.reactor ?? 100)) * 9.81 * liftMargin) / BOOST_N) * BOOST_W / REACTOR_W);
    if (reactors.length - 1 < Math.max(1, need)) return free;
    list = reactors.filter((p) => time - (state.held[p.id] ?? -1000) >= 5).sort((a, b) => fromCore(cellOf(b.id).x, cellOf(b.id).y) - fromCore(cellOf(a.id).x, cellOf(a.id).y)).slice(0, 1);
    what = 'a reactor';
  }
  if (list.length === 0) return free;
  const head = list.slice(0, 200);
  const may = new Set(spare(head.map((p) => p.id)) ?? []);
  for (const p of head) if (!may.has(p.id)) state.held[p.id] = time;
  let kg = 0;
  let n = 0;
  for (const p of head) {
    if (free <= 0 || kg >= want) break;
    if (!may.has(p.id)) continue;
    const done = scrap(p.id);
    if (done.ok) {
      state.shed[p.id] = true;
      kg += p.mass;
      free--;
      n++;
    } else if (done.why === 'too many orders this tick') break;
  }
  if (n > 0) log(`last resort: sold ${n} ${what} (${kg.toFixed(0)} kg) to get up: mass ${self.mass.toFixed(0)}, lift ${(liftKg() / self.mass).toFixed(2)}`);
  return free;
}

function think() {
  const gone = (lost() ?? []).filter((p) => !state.sold[p.id]);
  const seen = {};
  for (const p of gone) {
    seen[p.id] = true;
    if (!state.seen[p.id]) state.heat[regionOf(p.x, p.y)] = time;
  }
  state.seen = seen;
  const work = jobs();
  let money = tank();
  for (const j of work.jobs) if (j.kind === 'scrap') money += state.due[j.part] ?? 0;
  const busy = new Set(work.jobs.map((j) => j.part));
  let free = work.free;
  const g = groups();
  // Grounded: shed down to `liftMargin`, counting what is being shed already; still stuck past that, 3 percent a look.
  const lift = liftKg();
  const stuckNow = stuck(lift);
  let going = 0;
  for (const j of work.jobs) if (j.kind === 'scrap' && state.shed[j.part]) going += MASS[(parts.find((p) => p.id === j.part) ?? {}).type] ?? 0;
  const over = self.mass - going - lift / liftMargin; // kg to shed to get to `liftMargin`
  if (stuckNow && !state.shedding) log(`can't get up: lift ${(lift / self.mass).toFixed(2)} of its weight, climbing ${self.vel.y.toFixed(1)} m/s, going ${self.vel.x.toFixed(1)}, lift halves at ${state.throttle}`);
  state.shedding = (state.shedding || stuckNow) && (over > 0 || stuckNow);
  const grounded = state.shedding;
  if (grounded && free > 0) {
    const want = stuckNow ? Math.max(over, 0.03 * self.mass - going) : over;
    if (want > 0) free = shed(want, free, busy, new Set(work.jobs.filter((j) => j.kind === 'scrap').map((j) => j.part)));
  }
  // What it builds must leave its lift at `liftMargin` (a lift booster adds lift); shedding, only lift and the keep.
  let room = lift / liftMargin - self.mass;
  // Its front, and whether it is lean: the plates it lost weigh more than its lift has room for, or its faces and guns
  // cost more than it has and can sell (a battery over its floor gives 3).
  const front = frontNow();
  let plateKg = 0;
  let faceCost = 0;
  for (const p of gone) {
    if (!p.touching) continue;
    if (p.type === 'armorplate') plateKg += MASS.armorplate ?? 20;
    if (['armorplate', 'frame', 'densebattery', 'gun'].includes(p.type)) faceCost += p.create;
  }
  let dense = 0;
  for (const p of parts) if (p.type === 'densebattery' && !state.sold[p.id]) dense++;
  const lean = (plateKg > 0 && plateKg > room) || (faceCost > 0 && faceCost > money + 3 * Math.max(0, dense - minDense));
  if (lean !== state.lean) log(lean ? `lean: what it lost weighs ${plateKg.toFixed(0)} kg in plates to ${Math.max(0, room).toFixed(0)} of room, costs ${faceCost.toFixed(0)}: armor and guns only toward the enemy` : 'not lean: it makes every face again');
  state.lean = lean;
  if (front && (!state.front || faceName(front) !== faceName(state.front))) log(`front: its ${faceName(front)} face, ${front.d.toFixed(0)} m`);
  state.front = front;
  const wish = wants(gone, g, cells(), front, lean, grounded).filter((w) => !busy.has(w.id) && (!grounded || w.lift || w.why === 'keep' || w.why === 'bridge'));
  const made = {};
  let need = 0;
  let hard = false;
  let why = '';
  const make = (list) => {
    for (const w of list) {
      if (!w.lift && w.why !== 'keep' && w.why !== 'bridge' && w.kg > room) continue;
      if (free > 0 && money >= w.cost) {
        const done = build(w.id);
        if (done.ok) {
          delete state.shed[w.id];
          if (w.why === 'bridge') state.bridge[w.id] = true;
          if (w.lift || w.why === 'bridge') state.fresh[w.id] = true;
          money -= w.cost;
          room += w.lift ? BOOST_N / 9.81 / liftMargin - w.kg : -w.kg;
          free--;
          made[w.why] = (made[w.why] ?? 0) + 1;
        } else if (done.why === 'blocked') state.blocked[w.id] = time;
        continue;
      }
      if (money < w.cost) {
        need += w.cost;
        hard = hard || w.hard;
        if (why === '') why = w.why;
        if (need > 60) return;
      }
    }
  };
  make(wish.filter((w) => w.hard));
  // About to ram: the plates facing the front healed to full, most square to it first, with what is over the float;
  // what it cannot pay for yet it sells for.
  let ownPlates = null;
  const plates = () => {
    if (ownPlates === null) ownPlates = own({ of: 'armorplate' }) ?? [];
    return ownPlates;
  };
  if (front && front.d < ramR && !grounded && need <= 60) {
    const face = plates()
      .filter((q) => q.health < q.maxHealth && !busy.has(q.id))
      .map((q) => ({ q, f: facing(cellOf(q.id).x, cellOf(q.id).y, front) }))
      .filter((h) => h.f >= frontAt)
      .sort((a, b) => b.f - a.f || a.q.health - b.q.health);
    let n = 0;
    for (const { q } of face) {
      if (need > 60) break;
      const pay = Math.min(q.heal, Math.max(0, money - float));
      if (free > 0 && pay > 0.05) {
        const share = q.health / q.maxHealth;
        if (heal(q.id, share + ((1 - share) * pay) / Math.max(q.heal, 1e-6)).ok) {
          money -= pay;
          free--;
          n++;
          busy.add(q.id);
        }
      }
      if (q.heal - pay > 0.05) {
        need += q.heal - pay;
        if (why === '') why = 'hardening';
      }
    }
    if (n > 0) say(`hardening its ${faceName(front)} face: an enemy ${front.d.toFixed(0)} m off`);
  }
  // What it made to fly, healed: the weakest first, with what is over the float. Gone or whole, it is crossed off.
  const healFresh = (most) => {
    const ids = Object.keys(state.fresh).slice(0, 400);
    if (ids.length === 0 || free <= 0 || most <= 0 || money <= float) return;
    const mine = own({ of: ids }) ?? [];
    const alive = new Set(mine.map((q) => q.id));
    for (const id of ids) if (!alive.has(id) && !busy.has(id)) delete state.fresh[id];
    const weak = mine.filter((q) => !busy.has(q.id) && q.health < q.maxHealth).sort((a, b) => a.health / a.maxHealth - b.health / b.maxHealth);
    for (const q of mine) if (q.health >= q.maxHealth) delete state.fresh[q.id];
    let n = 0;
    for (const q of weak) {
      if (free <= 0 || n >= most || money - float < 0.05) break;
      const pay = Math.min(q.heal, money - float);
      const share = q.health / q.maxHealth;
      if (heal(q.id, share + ((1 - share) * pay) / Math.max(q.heal, 1e-6)).ok) {
        money -= pay;
        free--;
        n++;
        busy.add(q.id);
      }
    }
    if (n > 0) made.healed = (made.healed ?? 0) + n;
  };
  // A robot has a job for each 100 parts it has: stripped to 200, making its way up took every one of them, and it
  // healed nothing. In the air healing comes first; on the ground it gets half.
  healFresh(grounded ? Math.ceil(free / 2) : free);
  make(wish.filter((w) => !w.hard));
  healFresh(free);
  const short = need + float - money;
  if (grounded) {
    // Shedding: it sells only for weight, above.
  } else if (short > 0 && free > 0) {
    const offer = offers(short, hard);
    const may = new Set(spare(offer.map((s) => s.id)) ?? []);
    let got = 0;
    let n = 0;
    for (const s of offer) {
      if (free <= 0 || got >= short) break;
      if (!may.has(s.id) || busy.has(s.id) || state.sold[s.id]) continue;
      if (s.pair !== undefined) {
        // A pair: both, or neither.
        if (free < 2 || !may.has(s.pair) || busy.has(s.pair) || state.sold[s.pair]) continue;
        const one = scrap(s.id);
        if (!one.ok) {
          if (one.why === 'too many orders this tick') break;
          continue;
        }
        const two = scrap(s.pair);
        if (!two.ok) {
          // The first goes back: one side sold alone turns it (14 sold off one side to 12 off the other, 2026-11-03).
          stopJob(s.id);
          if (two.why === 'too many orders this tick') break;
          continue;
        }
        for (const id of [s.id, s.pair]) {
          state.sold[id] = true;
          state.due[id] = s.gives;
          got += s.gives;
          free--;
          n++;
        }
        continue;
      }
      const done = scrap(s.id);
      if (done.ok) {
        state.sold[s.id] = true;
        state.due[s.id] = s.gives;
        got += s.gives;
        free--;
        n++;
      } else if (done.why === 'too many orders this tick') break;
    }
    if (n > 0) log(`sell ${n} for ${why || 'the float'}: need ${need.toFixed(1)}, have ${money.toFixed(1)}`);
  } else if (need === 0 && free > 0 && money > float) {
    // Plates worn thin, the most worn first, with what is over the float.
    let spareMoney = money - float;
    const worn = plates().filter((q) => q.health < plateAt * q.maxHealth && !busy.has(q.id));
    const toward = (q) => (front ? facing(cellOf(q.id).x, cellOf(q.id).y, front) : 0);
    for (const p of worn.filter((q) => !(lean && front && toward(q) < backAt)).sort((a, b) => toward(b) - toward(a) || a.health - b.health)) {
      if (free <= 0 || spareMoney < 0.05) break;
      const pay = Math.min(p.heal, spareMoney);
      const share = p.health / p.maxHealth;
      if (heal(p.id, share + ((1 - share) * pay) / Math.max(p.heal, 1e-6)).ok) {
        spareMoney -= pay;
        free--;
      }
    }
  }
  const list = Object.keys(made).map((k) => `${k} ${made[k]}`).join(', ');
  if (list !== '') say(`made ${list}: ${GROUPS.map((k) => `${k} ${g[k].now}/${g[k].had}`).join(' ')}, tank ${money.toFixed(1)}, ${gone.length} lost`);
}

function tick() {
  // Its first look waits for a tick of the beat its builds land on (every 30 ticks) away from the landing, so a look and
  // a landing never fall on the same tick. Which tick is its own draw (`random` is seeded per robot): two of it in one
  // world, spawned together, looked on the same tick and doubled the cost of that tick.
  if (!state.onBeat) {
    state.onBeat = true;
    const at = 3 + Math.floor(random() * 25);
    const wait = (at - (Math.round(time * 60) % 30) + 30) % 30;
    if (wait > 1) {
      sleep(wait - 1);
      return;
    }
  }
  if (repairOn >= 1) think();
  sleep(every - 1);
}
