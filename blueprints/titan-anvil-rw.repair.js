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
// What it cannot pay for it sells for, keeping a `float` in the tank: jammers first (never made again), then batteries
// that hold nothing up, then (for the keep, or a hurt group) more batteries, the furthest first. Never a booster or a
// plate, and never what would cut it in two (`spare`).

const repairOn = param('repair', 1, { min: 0, max: 1 }); // 0: it never scraps, builds or heals
const every = param('every', 30, { min: 1, max: 30 }); // ticks between looks
const keepR = param('keepR', 6, { min: 1, max: 30 }); // cells round the core that make the keep
const quiet = param('quiet', 3, { min: 0, max: 30 }); // s since a region lost a part before it counts as calm
const region = param('region', 10, { min: 1, max: 80 }); // cells to a side of a region
const hurtAt = param('hurtAt', 0.7, { min: 0, max: 1 }); // share of a booster group under which its boosters come back even under fire
const minDense = param('minDense', 380, { min: 0, max: 1000 }); // dense batteries it keeps (it has 450): its energy for the rams
const minDenseHard = param('minDenseHard', 300, { min: 0, max: 1000 }); // and for the keep or a hurt group
const float = param('float', 15, { min: 0, max: 300 }); // juice it keeps in the tank ahead of need
const plateAt = param('plateAt', 0.5, { min: 0, max: 1 }); // share of health under which a plate is healed with what is over the float

const GROUPS = ['la', 'lb', 'pa', 'pb', 'ra', 'rb'];

const cellOf = (id) => {
  const m = id.match(/@(-?\d+),(-?\d+)/);
  return { x: Number(m[1]), y: Number(m[2]) };
};
const key = (x, y) => x * 4096 + y;
const groupOf = (p) => (p.type === 'booster' && p.tags.length > 0 && GROUPS.includes(p.tags[0]) ? p.tags[0] : null);

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

/** What it gives up for `need` juice, best first (all it would, for `think` to pick from). */
function offers(g, hard) {
  const out = [];
  const take = (p, gives) => out.push({ id: p.id, gives });
  const at = cells();
  const mine = parts.filter((p) => !state.sold[p.id] && fromCore(cellOf(p.id).x, cellOf(p.id).y) > keepR);
  for (const p of mine) if (p.type === 'jammer') take(p, 1.6);
  // Batteries that hold nothing up: no more than one neighbor.
  let dense = parts.filter((p) => p.type === 'densebattery').length - minDense;
  const lone = (p) => {
    const c = cellOf(p.id);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].reduce((n, [dx, dy]) => n + (at.has(key(c.x + dx, c.y + dy)) ? 1 : 0), 0) <= 1;
  };
  for (const p of mine) {
    if (dense <= 0) break;
    if (p.type === 'densebattery' && lone(p)) {
      take(p, 2.4);
      dense--;
    }
  }
  // Never its boosters: the lift rows hold 1.3 times its weight, and a tenth of them sold took what it can brake a fall
  // by from 1 m/s² to nothing; a tenth of the push boosters sold, it ran out of the arena chasing Anvil-r to the edge.
  // For the keep or a hurt group: more batteries, down to `minDenseHard`, the furthest from the core first. Never its
  // plates: they are the brick (sold for a hurt group, 169 went off its faces, and Anvil-r broke it to 60 parts).
  if (hard) {
    let more = parts.filter((p) => p.type === 'densebattery' && !state.sold[p.id]).length - minDenseHard;
    const deep = mine.filter((p) => p.type === 'densebattery' && !lone(p));
    deep.sort((a, b) => fromCore(cellOf(b.id).x, cellOf(b.id).y) - fromCore(cellOf(a.id).x, cellOf(a.id).y));
    for (const p of deep) {
      if (more <= 0) break;
      take(p, 2.4);
      more--;
    }
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
    const offer = offers(g, hard).slice(0, 200);
    const may = new Set(spare(offer.map((s) => s.id)) ?? []);
    let got = 0;
    let n = 0;
    for (const s of offer) {
      if (free <= 0 || got >= short) break;
      if (!may.has(s.id) || busy.has(s.id)) continue;
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
  if (repairOn >= 1) think();
  sleep(every - 1);
}
