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
// A region (`region` cells square) that lost a part in the last `quiet` s is left alone, the keep and a hurt group apart:
// what it makes in the middle of a ram dies with the next hit.
// What it cannot pay for it sells for, keeping a `float` in the tank: jammers first (never made again), then batteries,
// a hole at a time: one with three sides or more filled, whose every neighbor keeps two sides or more, down to
// `minDense` (for the keep, or a hurt group, `minDenseHard`), then push boosters, a pair at a time (one a side), down to
// `pushKeep` of each side. Never a battery that ties anything else in (built next to anything but batteries), a lift or
// end booster, or a plate, and never what would cut it in two (`spare`).

const repairOn = param('repair', 1, { min: 0, max: 1 }); // 0: it never scraps, builds or heals
const every = param('every', 30, { min: 1, max: 30 }); // ticks between looks
const keepR = param('keepR', 6, { min: 1, max: 30 }); // cells round the core that make the keep
const quiet = param('quiet', 3, { min: 0, max: 30 }); // s since a region lost a part before it counts as calm
const region = param('region', 10, { min: 1, max: 80 }); // cells to a side of a region
const hurtAt = param('hurtAt', 0.7, { min: 0, max: 1 }); // share of a booster group under which its boosters come back even under fire
const minDense = param('minDense', 400, { min: 0, max: 1000 }); // dense batteries it keeps (it has 803): its energy for the rams (600 left it nothing to sell for its last 999 parts lost)
const minDenseHard = param('minDenseHard', 250, { min: 0, max: 1000 }); // and for the keep or a hurt group
const pushKeep = param('pushKeep', 0.8, { min: 0, max: 1 }); // share of each push side (175) it keeps when the batteries are down to their floor
const float = param('float', 15, { min: 0, max: 300 }); // juice it keeps in the tank ahead of need
const plateAt = param('plateAt', 0.5, { min: 0, max: 1 }); // share of health under which a plate is healed with what is over the float

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
  // What each booster group had to start with: the share it keeps is of this, not of what it has after selling.
  state.had = {};
  for (const k of GROUPS) state.had[k] = 0;
  for (const p of parts) if (groupOf(p)) state.had[groupOf(p)]++;
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
function wants(gone, g, at) {
  const list = [];
  const open = new Set();
  const add = (p, why, hard) => {
    if (open.has(p.id) || time - (state.blocked[p.id] ?? -1000) < 10) return;
    open.add(p.id);
    list.push({ id: p.id, cost: p.create, why, hard });
  };
  const reach = gone.filter((p) => p.touching);
  // 1: the keep, nearest the core first.
  for (const p of reach.filter((q) => fromCore(q.x, q.y) <= keepR).sort((a, b) => fromCore(a.x, a.y) - fromCore(b.x, b.y))) add(p, 'keep', true);
  // 2: boosters, the group that lost the largest share first.
  const share = (k) => (g[k].had > 0 ? g[k].now / g[k].had : 1);
  const order = GROUPS.filter((k) => share(k) < 1).sort((a, b) => share(a) - share(b));
  for (const k of order) {
    const hurt = share(k) < hurtAt;
    for (const p of reach.filter((q) => q.type === 'booster' && q.tags[0] === k && (hurt || calm(q.x, q.y)))) add(p, hurt ? 'hurt' : 'boosters', hurt);
  }
  // 3: the lasers and what brings them out.
  for (const p of reach.filter((q) => ['laser', 'piston', 'rotator', 'decoupler'].includes(q.type) && calm(q.x, q.y))) add(p, 'lasers', false);
  // 4: the faces: what closes a hole first.
  const around = (p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].reduce((n, [dx, dy]) => n + (at.has(key(p.x + dx, p.y + dy)) ? 1 : 0), 0);
  const faces = reach.filter((q) => ['armorplate', 'frame', 'densebattery'].includes(q.type) && calm(q.x, q.y));
  faces.sort((a, b) => around(b) - around(a));
  for (const p of faces) add(p, 'face', false);
  // 5: the rest.
  // Not jammers: they are the first thing it sells.
  for (const type of ['gun', 'reactor', 'radar']) for (const p of reach.filter((q) => q.type === type && calm(q.x, q.y))) add(p, type, false);
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
      if (fromCore(c.x, c.y) > keepR && out.length < 200) out.push({ id: p.id, gives: 1.6 });
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
    out.push({ id, gives: 2.4 });
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
    out.push({ id: a, gives: 1.2, pair: b });
    out.push({ id: b, gives: 1.2, pair: a });
    pairs--;
  }
  return out;
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
  const wish = wants(gone, g, cells()).filter((w) => !busy.has(w.id));
  const made = {};
  let need = 0;
  let hard = false;
  let why = '';
  for (const w of wish) {
    if (free > 0 && money >= w.cost) {
      const done = build(w.id);
      if (done.ok) {
        money -= w.cost;
        free--;
        made[w.why] = (made[w.why] ?? 0) + 1;
      } else if (done.why === 'blocked') state.blocked[w.id] = time;
      continue;
    }
    if (money < w.cost) {
      need += w.cost;
      hard = hard || w.hard;
      if (why === '') why = w.why;
      if (need > 60) break;
    }
  }
  const short = need + float - money;
  if (short > 0 && free > 0) {
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
    for (const p of (own({ of: 'armorplate' }) ?? []).filter((q) => q.health < plateAt * q.maxHealth && !busy.has(q.id)).sort((a, b) => a.health - b.health)) {
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
