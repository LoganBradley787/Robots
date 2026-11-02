// Repair of titan-mirage-rw: what it gives up and what it makes, in what order. The engine only takes orders (`scrap`,
// `build`, `heal`): every decision is here, and the helm flies on whatever is left. It wakes twice a second, and ends
// each look with `sleep`, so a quiet hull pays nothing for it. Param `repair` 0 turns it all off.
//
// A look makes a list of wants, most wanted first, and works down it with the jobs it has free:
// 1. The keep: anything lost round the core goes back at once, under fire or not. A blast is halved by every part in
//    the way, whatever its health, so a part at 1 percent is as good as a whole one until it dies. What ends a Mirage
//    is one volley through the keep with the core at full health.
// 2. Staying up: lift held level, not lift on paper. About to fall, propellers on the side that is short.
// 3. The link: the columns of the hull with the fewest rows still joined. Cut near the keep, it loses all it would pay with.
// 4. Reactors, the cells round them first.
// 5. Bays: heals those standing, nearest the core first, and makes lost ones, with a route of parts to reach one that
//    hangs in the air, if that route is worth it. Bays are what fires, and ghosts stop at them short of the keep.
// 6. More lift, when it could do better.
// 7. The eyes and the side boosters, and what the helm needs to hold its place.
// What it cannot pay for it sells for, and it keeps a `float` in the tank ahead of need, from `sell()`: for a want, the
// batteries in the stern block first, then batteries that hold nothing up, then bottom row propellers while it has lift
// to spare, then the hull's far end a column at a time while it stays up, then plates and bays far from the core. It
// stops where `sell()` says.
//
// The stern block is half its weight and has half the lift it needs, so the hull is a seesaw: a column off the bow moves
// its weight aft, and cut at 120 it sinks though it has 1.7 times its weight in propellers (Logan's replays, 2026-11-02).
// Every kilo off the stern is lift it can use, and lets it shrink further.
//
// Under fire, what it makes dies: a region of the hull that lost a part in the last `quiet` seconds is left alone,
// the keep and an emergency apart. What it scrapped itself is not fire: `state.sold` keeps it apart from what was shot.

const repairOn = param('repair', 1, { min: 0, max: 1 }); // 0: it never scraps, builds or heals
const every = param('every', 30, { min: 1, max: 30 }); // ticks between looks
const keepR = param('keepR', 8, { min: 1, max: 30 }); // cells round the core that make the keep
const safe = param('safe', 1.15, { min: 1, max: 3 }); // times its weight in lift held level: under this, propellers come before all but the keep
const wanted = param('wanted', 1.3, { min: 1, max: 3 }); // times its weight: under this it makes propellers once the region is calm
const sellTo = param('sellTo', 1.4, { min: 1, max: 3 }); // times its weight: it sells no propeller under this
const neck = param('neck', 2, { min: 1, max: 8 }); // rows joined across a column at or under which it is a link in danger (whole, 4)
const quiet = param('quiet', 6, { min: 0, max: 30 }); // s since a region of the hull lost a part before it counts as calm
const region = param('region', 12, { min: 1, max: 60 }); // cells along the hull to a region
const bayQuiet = param('bayQuiet', 8, { min: 0, max: 60 }); // s a bay's region must be calm: a volley comes about every 11 s, and a bay takes 30 to make
const bayDense = param('bayDense', 70, { min: 0, max: 300 }); // dense batteries it keeps against the keep: bays do not get these
const spar = param('spar', 20, { min: 0, max: 170 }); // cells from the core where the spar is kept longest
const bayMend = param('bayMend', 0.8, { min: 0, max: 1 }); // share of health under which a standing bay is healed: bays are what fires, and what stops ghosts short of the keep
const plateAt = param('plateAt', 0.75, { min: 0, max: 1 }); // share of health under which a plate of the keep is healed: a whole plate stops many blasts, one at 1 percent stops one
const routeMax = param('routeMax', 12, { min: 0, max: 200 }); // juice it pays on a route to reach a bay
const minDense = param('minDense', 40, { min: 0, max: 300 }); // dense batteries it keeps
const minBays = param('minBays', 6, { min: 0, max: 20 }); // bays it never sells under while it can hold itself up
const bayHeal = param('bayHeal', 0.3, { min: 0.01, max: 1 }); // share of health it heals a made bay to in a calm region
const float = param('float', 30, { min: 0, max: 300 }); // juice it keeps in the tank ahead of need, sold while calm: the first second of a hit is paid for
const lift1 = param('lift1', 120, { min: 1, max: 1000 }); // N, a propeller
const lift2 = param('lift2', 400, { min: 1, max: 4000 }); // N, a lift booster
const trimTo = param('trimTo', 1.05, { min: 1, max: 3 }); // times its weight held level: it sells no far column that would leave it under this
const trimMin = param('trimMin', 40, { min: 0, max: 170 }); // cells from the core it never trims under

const cellOf = (id) => {
  const m = id.match(/@(-?\d+),(-?\d+)/);
  return { x: Number(m[1]), y: Number(m[2]) };
};
const key = (x, y) => x * 4096 + y;
/** One of the lift strips (`l0` to `l7`): not a copy a bay holds. */
const lifter = (p) => (p.type === 'propeller' || p.type === 'booster') && p.tags.length > 0 && /^l\d$/.test(p.tags[0]);

function setup() {
  const core = parts.find((p) => p.type === 'core');
  state.core = core.id;
  state.c = cellOf(core.id);
  let sum = 0;
  for (const p of parts) sum += cellOf(p.id).x - state.c.x;
  state.dir = sum >= 0 ? 1 : -1; // the way the bow lies from the core, in cells
  state.sold = {}; // what it gave up
  state.bayMade = {}; // bays it made: they are not for sale while it can hold itself up
  state.baySold = false; // it has sold a bay: it makes no more
  state.trimmed = {}; // what went off the far end
  state.heat = {}; // region: when it last lost a part there
  state.seen = {}; // what was lost at the last look
  state.last = '';
  state.due = {}; // what a scrap under way will bring
}

/** Cells from the core toward the bow. */
const fore = (x) => (x - state.c.x) * state.dir;
const regionOf = (x) => Math.floor(fore(x) / region);
const calm = (x) => time - (state.heat[regionOf(x)] ?? -1000) > quiet;

function say(text) {
  if (text === state.last) return;
  state.last = text;
  log(text);
}

/**
 * Lift it can hold level, as times its weight, and which end is short: 1 the bow, -1 the stern, 0 neither. Every strip
 * at full leaves a turn one way; cutting the strips furthest out that way undoes it for the least lift lost.
 */
function liftNow(without) {
  let m = 0;
  let mx = 0;
  let off = 0;
  for (const p of parts) {
    if (without && without.has(p.id)) {
      off += p.mass;
      continue;
    }
    m += p.mass;
    mx += p.mass * p.pos.x;
  }
  const cx = mx / m;
  const cap = {};
  const arm = {};
  for (const p of parts) {
    if (!lifter(p) || (without && without.has(p.id))) continue;
    const f = p.type === 'propeller' ? lift1 : lift2;
    const k = p.tags[0];
    cap[k] = (cap[k] ?? 0) + f;
    arm[k] = (arm[k] ?? 0) + f * (p.pos.x - cx) * state.dir;
  }
  const strips = Object.keys(cap).map((k) => ({ cap: cap[k], arm: arm[k] / cap[k] }));
  let held = 0;
  let turn = 0;
  for (const k of strips) {
    held += k.cap;
    turn += k.cap * k.arm;
  }
  const way = sign(turn);
  strips.sort((a, b) => way * (b.arm - a.arm));
  let left = Math.abs(turn);
  for (const k of strips) {
    const each = way * k.arm;
    if (left <= 0 || each <= 0) break;
    const cut = Math.min(k.cap, left / each);
    held -= cut;
    left -= cut * each;
  }
  return { times: held / ((self.mass - off) * 9.81), short: -way, cx };
}

/** Where the hull is live, cell by cell, and how many rows are joined across each column. */
function hull() {
  const at = new Set();
  const props = new Set();
  const dense = [];
  let end = 0;
  for (const p of parts) {
    if (p.tags.length > 0 && /^g.\d/.test(p.tags[0])) continue;
    const c = cellOf(p.id);
    at.add(key(c.x, c.y));
    if (fore(c.x) > end) end = fore(c.x);
    if (p.type === 'propeller') props.add(key(c.x, c.y));
    if (p.type === 'densebattery') dense.push(p);
  }
  let worst = Infinity;
  const necks = [];
  const lo = Math.min(state.c.x, state.c.x + state.dir * 165);
  const hi = Math.max(state.c.x, state.c.x + state.dir * 165);
  for (let x = lo; x < hi; x++) {
    // The decks and the spar each count, the three rows of propellers as one: they burn through in a shell or two.
    let n = 0;
    let lifts = 0;
    for (let y = 1; y <= 7; y++) {
      if (!at.has(key(x, y)) || !at.has(key(x + 1, y))) continue;
      if (props.has(key(x, y)) || props.has(key(x + 1, y))) lifts = 1;
      else n++;
    }
    n += lifts;
    if (fore(x) <= 8) continue;
    if (n < worst) worst = n;
    if (n <= neck) necks.push({ x, n });
  }
  necks.sort((a, b) => a.n - b.n || fore(a.x) - fore(b.x));
  return { at, props, dense, worst, necks, end };
}

/**
 * A part that holds nothing up: outside the keep, with no more than one neighbor it is bolted to, or a battery with
 * nothing on it. A propeller has no top face, so one under a part does not count.
 */
function holdsNothing(p, h) {
  const c = cellOf(p.id);
  if (Math.abs(c.x - state.c.x) <= keepR + 4) return false;
  const under = h.at.has(key(c.x, c.y - 1)) && !h.props.has(key(c.x, c.y - 1));
  const up = h.at.has(key(c.x, c.y + 1));
  if (p.type === 'densebattery' && !up && !under) return true;
  return (under ? 1 : 0) + (up ? 1 : 0) + (h.at.has(key(c.x - 1, c.y)) ? 1 : 0) + (h.at.has(key(c.x + 1, c.y)) ? 1 : 0) <= 1;
}

/**
 * What it gives up for `need` juice, best first, as far as it may. Batteries that hold nothing up, then frames left on
 * nothing. Then propellers in the bottom row, off the end with lift to spare: the row sits on
 * the deck, so nothing hangs from one. Plates and bays only for the keep or the air (`hard`). If it cannot hold itself
 * up, every last bay, and then the batteries in the hull.
 */
function sell(need, h, l, hard, real) {
  const out = [];
  let got = 0;
  const take = (id, gives) => {
    out.push({ id, gives });
    got += gives;
  };
  // Every battery gone breaks the spar there, and a cut near the keep loses all it would pay with: the spar nearest the
  // keep goes last. Past that, from the end that keeps it level: 85 sold off the bow moved its weight 10 m aft, and it
  // fell with 360 propellers.
  const rank = (p) => {
    const f = fore(cellOf(p.id).x);
    return (f < spar ? 1000 : 0) - l.short * f;
  };
  let left = h.dense.length - minDense;
  // The stern block first, for a want, furthest from the core first. Not the rows level with the core: those are all
  // that joins it to the hull.
  if (real) {
    const fromCore = (p) => Math.max(Math.abs(cellOf(p.id).x - state.c.x), Math.abs(cellOf(p.id).y - state.c.y));
    const stern = h.dense.filter((p) => fromCore(p) <= keepR - 3 && Math.abs(cellOf(p.id).y - state.c.y) > 1 && !state.sold[p.id]).sort((a, b) => fromCore(b) - fromCore(a));
    for (const p of stern) {
      if (got >= need || left <= 0) break;
      take(p.id, 2.4);
      left--;
    }
  }
  const dense = h.dense.filter((p) => holdsNothing(p, h) && !state.sold[p.id]).sort((a, b) => rank(a) - rank(b));
  for (const p of dense) {
    if (got >= need || left <= 0) break;
    take(p.id, 2.4);
    left--;
  }
  // Frames left standing on nothing, once the batteries under them are gone.
  if (got < need) {
    for (const p of parts) {
      if (got >= need) break;
      if (p.type === 'frame' && cellOf(p.id).y === 6 && holdsNothing(p, h) && !state.sold[p.id]) take(p.id, 0.8);
    }
  }
  if (got < need && l.times > sellTo) {
    const spare = Math.ceil(((l.times - sellTo) * self.mass * 9.81) / lift1);
    const row = parts.filter((p) => p.type === 'propeller' && lifter(p) && cellOf(p.id).y === 2 && !state.sold[p.id]);
    row.sort((a, b) => (l.short * (b.pos.x - l.cx) - l.short * (a.pos.x - l.cx)) * state.dir);
    for (const p of row.slice(0, spare)) {
      if (got >= need) break;
      take(p.id, 0.8);
    }
  }
  if (got < need && hard) {
    const plates = parts.filter((p) => p.type === 'armorplate' && !state.sold[p.id]);
    plates.sort((a, b) => Math.abs(cellOf(b.id).x - state.c.x) + Math.abs(cellOf(b.id).y - state.c.y) - Math.abs(cellOf(a.id).x - state.c.x) - Math.abs(cellOf(a.id).y - state.c.y));
    for (const p of plates) {
      if (got >= need || Math.abs(cellOf(p.id).x - state.c.x) <= 3) break;
      take(p.id, 4);
    }
  }
  if (got < need && real) {
    for (const s of trim(need - got, h, hard)) take(s.id, s.gives);
  }
  if (got < need && hard) {
    // On the ground a bay does it no good: under its own weight it sells down to none, and bays it made itself too. Up, a
    // bay it just paid 50 for and sold for 40 is a loss.
    const falling = l.times < 1;
    const bays = parts.filter((p) => p.type === 'fabbay').sort((a, b) => fore(cellOf(b.id).x) - fore(cellOf(a.id).x));
    const forSale = bays.filter((p) => falling || !state.bayMade[p.id]);
    for (const p of forSale.slice(0, Math.max(0, bays.length - (falling ? 0 : minBays)))) {
      if (got >= need) break;
      take(p.id, 80);
    }
    // Last, under its own weight: the batteries that hold the hull together, from the far ends. A hull in two pieces is
    // better than a hull on the ground.
    if (got < need && falling) {
      const rest = h.dense.filter((p) => fore(cellOf(p.id).x) > keepR && !state.sold[p.id] && !out.some((o) => o.id === p.id)).sort((a, b) => fore(cellOf(b.id).x) - fore(cellOf(a.id).x));
      for (const p of rest) {
        if (got >= need) break;
        take(p.id, 2.4);
      }
    }
  }
  return out;
}

/** What selling a part brings at full health, near enough: `own` has the real figure, for too much to ask here. */
const worth = (p) => (p.type === 'densebattery' ? 2.4 : p.type === 'armorplate' ? 4 : p.type === 'fabbay' ? 80 : p.type === 'radar' ? 4 : 0.8);

/**
 * The far end of the hull, a column at a time, for as long as it would still hold itself up with `trimTo` to spare. It
 * waits for a column to go before it starts the next: pulled from under what is left of one, the rest falls off unpaid.
 * A bay in the way goes first, for a want it cannot do without, if it has bays to spare; if not it stops there.
 */
function trim(need, h, hard) {
  const out = [];
  const gone = new Set();
  let got = 0;
  const hullParts = parts.filter((p) => !(p.tags.length > 0 && /^g.\d/.test(p.tags[0])) && fore(cellOf(p.id).x) > trimMin);
  if (hullParts.some((p) => state.sold[p.id] && state.trimmed[p.id])) return out;
  for (let column = h.end; column > trimMin && got < need; column--) {
    const here = hullParts.filter((p) => fore(cellOf(p.id).x) === column && !state.sold[p.id]);
    if (here.length === 0) continue;
    const bays = parts.filter((p) => p.type === 'fabbay');
    const bay = bays.find((p) => Math.abs(fore(cellOf(p.id).x) - column) <= 3);
    if (bay) {
      gone.add(bay.id);
      if (hard && !state.bayMade[bay.id] && bays.length > minBays && liftNow(gone).times >= trimTo) {
        out.push({ id: bay.id, gives: 80 });
        state.trimmed[bay.id] = true;
      }
      break;
    }
    for (const p of here) gone.add(p.id);
    if (liftNow(gone).times < trimTo) break;
    for (const p of here) {
      out.push({ id: p.id, gives: worth(p) });
      got += worth(p);
      state.trimmed[p.id] = true;
    }
    break;
  }
  return out;
}

/** The parts to make to reach `target` from the living robot, nearest the robot first, or null. */
function route(target, gone) {
  if (target.touching) return [target];
  const cells = new Map();
  for (const p of gone) if (p.type === 'frame' || p.type === 'densebattery') cells.set(key(p.x, p.y), p);
  const start = target.type === 'fabbay' ? [[target.x - 1, target.y - 1], [target.x, target.y - 1], [target.x + 1, target.y - 1]] : [[target.x - 1, target.y], [target.x + 1, target.y], [target.x, target.y - 1], [target.x, target.y + 1]];
  const from = new Map();
  const queue = [];
  for (const [x, y] of start) {
    const p = cells.get(key(x, y));
    if (p && !from.has(p)) {
      from.set(p, null);
      queue.push(p);
    }
  }
  for (let i = 0; i < queue.length && i < 200; i++) {
    const p = queue[i];
    if (p.touching) {
      const path = [];
      for (let q = p; q; q = from.get(q)) path.push(q);
      path.push(target);
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = cells.get(key(p.x + dx, p.y + dy));
      if (n && !from.has(n)) {
        from.set(n, p);
        queue.push(n);
      }
    }
  }
  return null;
}

/** What the look wants, most wanted first: `{ id, cost, why, hard }`. */
function wants(gone, h, l) {
  const list = [];
  const open = new Set();
  const add = (p, why, hard) => {
    if (open.has(p.id)) return;
    open.add(p.id);
    list.push({ id: p.id, cost: p.create, why, hard });
  };
  const close = (p) => Math.max(Math.abs(p.x - state.c.x), Math.abs(p.y - state.c.y));
  const reach = gone.filter((p) => p.touching);
  // 1: the keep, nearest the core first, cheapest first, under fire or not.
  const keep = reach.filter((p) => close(p) <= keepR && p.type !== 'reactor').sort((a, b) => close(a) - close(b) || a.create - b.create);
  for (const p of keep) add(p, 'keep', true);
  // 2: the air, when it would fall. On the short side, the deck first if a propeller has nothing to stand on.
  const props = reach.filter((p) => p.type === 'propeller' || (p.type === 'booster' && p.tags.length > 0 && p.tags[0] === 'l0'));
  const side = (p) => -l.short * fore(p.x);
  props.sort((a, b) => side(a) - side(b));
  const emergency = l.times < safe;
  const short = (to) => Math.ceil(((to - l.times) * self.mass * 9.81) / lift1) + 8;
  if (emergency) {
    for (const p of props.slice(0, Math.max(short(safe), 16))) add(p, 'lift', true);
    for (const p of reach.filter((q) => q.type === 'frame' && q.y === 1).slice(0, 8)) add(p, 'deck', true);
  }
  // 3: the link: the columns with the fewest rows joined, what is nearest the core first: a cut there loses it the most.
  // Past where the hull ends now is no link at all, and with lift to spare it is not worth going back for.
  for (const n of h.necks.filter((q) => l.times < wanted || fore(q.x) < h.end).slice(0, 12)) {
    const near = reach.filter((p) => Math.abs(p.x - n.x) <= 1 && p.y >= 1 && p.y <= 7 && p.type !== 'propeller');
    for (const p of near.sort((a, b) => a.create - b.create)) add(p, 'link', true);
  }
  // 4: reactors, what stands round one first.
  for (const p of gone.filter((q) => q.type === 'reactor')) {
    const round = reach.filter((q) => q.id !== p.id && q.x >= p.x - 2 && q.x <= p.x + 4 && q.y >= p.y - 2 && q.y <= p.y + 4);
    for (const q of round) add(q, 'round reactor', false);
    if (p.touching && round.length === 0) add(p, 'reactor', false);
  }
  // 5: bays, the nearest first, in calm regions, if the way there is worth it.
  const bays = gone.filter((p) => p.type === 'fabbay' && time - (state.heat[regionOf(p.x)] ?? -1000) > bayQuiet).sort((a, b) => fore(a.x) - fore(b.x));
  // Once it has sold a bay, the only money for one is the next bay: it sold 80s to pay 50s, six in a row, and walked its
  // bays down the hull.
  for (const p of h.dense.length > bayDense && !state.baySold ? bays : []) {
    const path = route(p, gone);
    if (!path) continue;
    const bill = path.reduce((n, q) => n + q.create, 0) - p.create;
    if (bill > routeMax) continue;
    add(path[0], path.length > 1 ? 'way to bay' : 'bay', false);
    break;
  }
  // 6: the air again, when it could do better, in calm regions.
  if (l.times < wanted) for (const p of props.filter((q) => calm(q.x)).slice(0, short(wanted))) add(p, 'lift', false);
  // 7: eyes, the radio, and what moves it.
  for (const p of reach) if (calm(p.x) && (p.type === 'radar' || p.type === 'radio' || p.type === 'booster')) add(p, 'eyes', false);
  return list;
}

/** Heals what it may with what the tank holds over the wants. */
function mend(free, spare, h) {
  let left = free;
  const list = own({ near: self.pos, most: 80 }) ?? [];
  const hurt = list.filter((p) => p.health < 0.95 * p.maxHealth && !h.busy.has(p.id)).sort((a, b) => b.maxHealth / Math.max(1, b.juice) - a.maxHealth / Math.max(1, a.juice));
  let money = spare;
  for (const p of hurt) {
    if (left <= 0 || money < 0.05) break;
    // Only what it has over the float: a heal left to itself runs the tank dry.
    const pay = Math.min(p.heal, money);
    const share = p.health / p.maxHealth;
    if (heal(p.id, share + ((1 - share) * pay) / Math.max(p.heal, 1e-6)).ok) {
      left--;
      money -= pay;
    }
  }
  if (left > 0 && money > 2) {
    const bays = own({ of: 'fabbay' }) ?? [];
    for (const p of bays.filter((q) => q.health < bayHeal * q.maxHealth && calm(cellOf(q.id).x) && !h.busy.has(q.id))) {
      if (left <= 0) break;
      if (heal(p.id, bayHeal).ok) left--;
    }
  }
}

function think() {
  const gone = (lost() ?? []).filter((p) => !state.sold[p.id] && p.tags[0]?.charAt(0) !== 'j');
  const seen = {};
  for (const p of gone) {
    seen[p.id] = true;
    if (state.seen[p.id]) continue;
    state.heat[regionOf(p.x)] = time;
  }
  state.seen = seen;
  const work = jobs();
  // What is being scrapped is money already: counted as nothing, it sold 32 batteries for a bay that wanted 21.
  let hold = tank();
  for (const j of work.jobs) if (j.kind === 'scrap') hold += state.due[j.part] ?? 0;
  const h = hull();
  h.busy = new Set(work.jobs.map((j) => j.part));
  const l = liftNow();
  let free = work.free;
  const wish = wants(gone, h, l).filter((w) => !h.busy.has(w.id));
  // The plates of the keep, once what is lost there is back.
  const plates = [];
  if (!wish.some((w) => w.why === 'keep')) {
    for (const p of own({ of: 'armorplate' }) ?? []) if (p.health < plateAt * p.maxHealth && !h.busy.has(p.id)) plates.push(p);
    plates.sort((a, b) => a.health - b.health);
  }
  // Bays still standing, nearest the core first: a bay kept is cheaper than a bay made, and it never stops firing.
  const mend2 = [];
  if (bayMend > 0 && !wish.some((w) => w.why === 'keep') && h.dense.length > bayDense) {
    for (const p of own({ of: 'fabbay' }) ?? []) if (p.health < bayMend * p.maxHealth && !h.busy.has(p.id)) mend2.push(p);
    mend2.sort((a, b) => fore(cellOf(a.id).x) - fore(cellOf(b.id).x));
  }
  // What it can pay for now it makes; what it cannot, it sells for, and the sale is kept for that want.
  let money = hold;
  const made = {};
  let need = 0;
  let hard = false;
  let why = '';
  for (const w of wish) {
    if (free > 0 && money >= w.cost) {
      if (build(w.id).ok) {
        money -= w.cost;
        free--;
        made[w.why] = (made[w.why] ?? 0) + 1;
        if (w.id.startsWith('fabbay')) state.bayMade[w.id] = true;
      }
      continue;
    }
    if (money < w.cost) {
      need += w.cost;
      hard = hard || w.hard;
      if (why === '') why = w.why;
      if (need > 60) break;
    }
  }
  for (const p of plates) {
    if (free <= 0 || money < 0.05) break;
    const pay = Math.min(p.heal, money);
    const share = p.health / p.maxHealth;
    if (heal(p.id, share + ((1 - share) * pay) / Math.max(p.heal, 1e-6)).ok) {
      money -= pay;
      free--;
    }
  }
  for (const p of mend2) {
    const pay = Math.min(p.heal, 25);
    if (free <= 0) break;
    if (money < pay) {
      need += pay;
      if (why === '') why = 'mending bays';
      if (need > 60) break;
      continue;
    }
    const share = p.health / p.maxHealth;
    if (heal(p.id, share + ((1 - share) * pay) / Math.max(p.heal, 1e-6)).ok) {
      money -= pay;
      free--;
    }
  }
  const short = need + float - money;
  if (short > 0 && free > 0) {
    let n = 0;
    for (const s of sell(short, h, l, hard, need > 0)) {
      if (free <= 0) break;
      if (scrap(s.id).ok) {
        state.sold[s.id] = true;
        state.due[s.id] = s.gives;
        if (s.id.startsWith('fabbay')) state.baySold = true;
        free--;
        n++;
      }
    }
    if (n > 0) log(`sell ${n} for ${why || 'the float'}: need ${need.toFixed(1)}, have ${money.toFixed(1)}`);
  } else if (need === 0 && free > 0 && money > float) {
    mend(free, money - float, h);
  }
  const list = Object.keys(made).map((k) => `${k} ${made[k]}`).join(', ');
  if (list !== '') say(`made ${list}: lift ${l.times.toFixed(2)}, link ${h.worst}${h.necks.length > 0 ? ` at ${fore(h.necks[0].x)}` : ''}, tank ${money.toFixed(1)}, ${gone.length} lost`);
}

function tick() {
  if (repairOn >= 1) think();
  sleep(every - 1);
}
