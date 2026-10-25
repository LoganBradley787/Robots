// Brain of titan-woodpecker: picks what the darts fly at, casts the anchors, lets the rack go in waves, then lets each
// bay's dart go as it is built, and lets flares go to draw what comes at the keep. It runs on the main core, deep in
// the keep, all match.
// - Target (titan-darts, 2026-10, Logan): picked from what the radar reports, never by id: the heaviest robot on the
//   other side with a live core, kept while it is seen unless one twice as heavy shows up. Its point is its core
//   (`contacts[].pos`), so every dart lands on the same spot, one after another, each blast digging where the last
//   one stopped. The darts keep following it by radio after they leave.
// - A target that dies stays in the radar's view as debris (no live core), so it is forgotten at once and nothing more
//   goes to its spot. One that vanished alive (into a jammer's bubble or smoke, most likely) has its last place kept
//   `memory` s, and darts fly there and arm near it; then it is forgotten, unless it stood still (titans v2: a roped
//   base in its bubble is kept as long as it is not seen dead). Only while it has never seen an enemy at all, and only
//   inside an arena, do darts go to the point across the arena from where this titan started. Otherwise the darts wait.
// - Titans v2 (2026-10), finding what hides: a launcher hidden in a bubble is guessed from where the light robots it
//   lets go are first seen; with nothing heavy in view and nothing remembered, the heaviest light enemy that is not
//   flying like a dart is the target; a hidden main enemy much heavier than anything in view stays the target.
// - Titans v2, the way in: probes along a fan of lines into the target's core (`scan` with `from`, `cover`) find the
//   thinnest one; darts sent at a still, armored target come in along it.
// - Titans v2, flares: something closing fast on the keep gets a flare let go at the end of the base on its side; so
//   does the keep losing parts with nothing seen coming (guns).
// - Order: the rack's darts go nearest the enemy first, one every `gap` ticks, in waves of `wave` (titans v2), so no
//   dart flies over one that is about to leave, and one flare cannot take the whole rack.
// - Anchors: grapples in the floor, cast at the ground once the base rests. Each rope holds the base where it stands
//   against a push toward the arena's edge. One that lost its rope is cast again.
// - Burners (titans round 5, 2026-10): six on the rack beside the keep go first, once the target is seen and the
//   probes have found the way in, then each burner bay's as it is built. A burner is told what a dart is, plus the way
//   in (for a target with lasers, the thinnest on our side), its slot, and where the target's lasers and (8 or less)
//   guns are from its core. The heaviest enemy ever seen is remembered until seen dead (90 s at most): hidden while
//   something much lighter is in view, the burners are sent at its last place and hunt it from there.
// - Titans round 6 (2026-10): armor plates take a quarter of a beam now, so the burners are also told where the
//   target's fab bays are (no armor, a quarter of a second of beam each, and what makes its darts and pods), and
//   whether it is hard (`hardCover` health or more on its thinnest line to the core).
const gap = param('gap', 2, { min: 1, max: 60 }); // ticks between two darts leaving the rack
const wave = param('wave', 8, { min: 1, max: 200 }); // rack darts in one wave
const waveGap = param('waveGap', 150, { min: 1, max: 6000 }); // ticks between two waves of the rack (longer than a flare burns)
const bayGap = param('bayGap', 4, { min: 1, max: 120 }); // ticks between two bays letting go
const minMass = param('minMass', 30, { min: 0, max: 100000 }); // kg: lighter robots (darts, pods) are never the target
const hideMass = param('hideMass', 2, { min: 1, max: 1000 }); // a hidden main enemy this many times heavier than anything in view stays the target
const smallMass = param('smallMass', 3, { min: 0, max: 100000 }); // kg: with nothing heavier, enemies down to this are the target
const smallSpeed = param('smallSpeed', 45, { min: 1, max: 1000 }); // m/s: a light one faster than this is a dart, never the target
const rescan = param('rescan', 180, { min: 30, max: 6000 }); // ticks between two looks at the target's size
const huge = param('huge', 600, { min: 10, max: 100000 }); // parts: a robot bigger than this is never scanned whole, only its extremes
const memory = param('memory', 15, { min: 0, max: 240 }); // s a target that vanished alive is remembered and darts fly to its last place
const lostAt = param('lostAt', 900, { min: 50, max: 2000 }); // m: one that vanished further off went out of the radar's reach and is forgotten
const anchors = param('anchors', 0, { min: 0, max: 200 }); // how many anchors the floor holds (the generator sets it)
const anchorAt = param('anchorAt', 40, { min: 2, max: 600 }); // tick of the first cast
const ghostKeep = param('ghostKeep', 5, { min: 3, max: 60 }); // first sightings of light enemies kept for the hidden launcher's guess
const ghostAge = param('ghostAge', 15, { min: 1, max: 600 }); // s a first sighting counts
const ghostBack = param('ghostBack', 0.4, { min: 0, max: 5 }); // s each is carried back along its path
const ghostNear = param('ghostNear', 150, { min: 0, max: 1000 }); // m: first sightings nearer than this say nothing
const ghostOver = param('ghostOver', 15, { min: 0, max: 100 }); // m above the guess the darts fly up through
const debug = param('debug', 0, { min: 0, max: 1 }); // 1 logs the probes, the hidden launcher guess, and the flares
const ghostLow = param('ghostLow', 50, { min: 0, max: 250 }); // m: a guess lower than this is a ground robot, hit from above
const stillSpeed = param('stillSpeed', 1.5, { min: 0, max: 50 }); // m/s: a target that vanished slower than this is kept at its last place
const useApp = param('useApp', 1, { min: 0, max: 1 }); // 1: the darts come in along the thinnest line the probes found
const appCover = param('appCover', 1000, { min: 0, max: 100000 }); // health in front of the core on the thinnest line, at least, for the darts to take the way in
const appSpeed = param('appSpeed', 3, { min: 0, max: 100 }); // m/s: a target faster than this is hit straight
const flareLate = param('flareLate', 2, { min: 0.2, max: 6 }); // s: a flare goes when something will pass the keep within this (a high flare has drifted out from the column by then)
const flareSoon = param('flareSoon', 0.35, { min: 0, max: 3 }); // s: and not sooner than this (already here: too late)
const flareMiss = param('flareMiss', 30, { min: 1, max: 200 }); // m from the main core: a pass this close counts
const flareClose = param('flareClose', 25, { min: 0, max: 500 }); // m/s it must close at, at least (a robot pushing slowly is no dart)
const flareGap = param('flareGap', 0.6, { min: 0.1, max: 10 }); // s between two flares at least
const flareHurt = param('flareHurt', 1.5, { min: 0, max: 30 }); // s after the keep last lost a part that a flare is kept burning
const hurtEvery = param('hurtEvery', 30, { min: 1, max: 600 }); // ticks between two counts of the keep's parts
const keepHalf = param('keepHalf', 10, { min: 1, max: 100 }); // m to either side of the main core that count as the keep
const keepTall = param('keepTall', 13, { min: 1, max: 100 }); // m up or down from the main core that count as the keep
const flareBurn = param('flareBurn', 2, { min: 0.1, max: 10 }); // s a flare burns: one burning covers what arrives before it is out
const recast = param('recast', 120, { min: 10, max: 6000 }); // ticks between two tries for an anchor with no rope
const burnGap = param('burnGap', 6, { min: 1, max: 600 }); // ticks between two burners leaving the rack
const safeUp = param('safeUp', 1.35, { min: 0, max: 3.2 }); // rad: the way in to a target with lasers is no steeper than this, on our side
const mainKeep = param('mainKeep', 90, { min: 0, max: 6000 }); // s a hidden main enemy is still sent burners after it was last seen
const gunMax = param('gunMax', 8, { min: 0, max: 100 }); // a target with more guns than this has them left alone by the burners (a fortress's few turrets are worth a burner's first second; a flier's dozen cost it the kill)
const gunEvery = param('gunEvery', 300, { min: 30, max: 6000 }); // ticks between two looks at the target's guns
const burnWait = param('burnWait', 90, { min: 0, max: 6000 }); // ticks the burners wait for the probes' way in, at most
const hardCover = param('hardCover', 1800, { min: 0, max: 1000000 }); // health on the thinnest line to its core that makes a target hard
const bayMax = param('bayMax', 24, { min: 0, max: 60 }); // the target's fab bays listed for the burners, at most

function setup() {
  state.mirrorX = -self.pos.x;
  state.grips = [];
  state.bays = [];
  state.flares = [];
  state.burners = [];
  state.guns = [];
  state.gunsFor = -1;
  state.gunsAt = -100000;
  state.cbays = [];
  state.slot = 0;
  for (const p of parts) {
    if (p.type === 'decoupler') {
      const tag = p.tags.find((t) => /^g\d+$/.test(t));
      if (tag) state.grips.push({ n: Number(tag.slice(1)), x: p.pos.x });
      const ub = p.tags.find((t) => /^ug\d+$/.test(t));
      if (ub) state.burners.push({ n: Number(ub.slice(2)), x: p.pos.x });
    } else if (p.type === 'flare') {
      const tag = p.tags.find((t) => /^f\d+$/.test(t));
      if (tag) state.flares.push({ n: Number(tag.slice(1)), x: p.pos.x, y: p.pos.y });
    } else if (p.type === 'fabbay') {
      const tag = p.tags.find((t) => /^b\d+x$/.test(t));
      if (tag) state.bays.push(tag);
      const ct = p.tags.find((t) => /^c\d+x$/.test(t));
      if (ct) state.cbays.push(ct);
    }
  }
  // Nearest the enemy first.
  const toward = state.mirrorX;
  state.grips.sort((a, b) => Math.abs(a.x - toward) - Math.abs(b.x - toward) || a.n - b.n);
  state.burners.sort((a, b) => Math.abs(a.x - toward) - Math.abs(b.x - toward) || a.n - b.n);
  state.bnext = 0;
  state.lastBurn = -1000;
  state.next = 0;
  state.lastFire = -1000;
  state.lastBay = -1000;
  state.tid = -1;
  state.box = { l: 40, r: 40, d: 20, u: 20 };
  state.boxAt = -100000;
  state.last = null; // the target: { x, y, vx, vy, at, d }, its last place while seen, kept a while once it vanishes
  state.everSeen = false; // whether any enemy that could be the target was ever seen
  state.shots = 0;
  // The highest flares go first: one let go up high falls for a second or two and drifts out from the base before the
  // dart it draws arrives, so the blast is not at the column (lowest first, the blasts broke the grips and the column
  // fell away with most of its flares unused).
  state.flares.sort((a, b) => b.y - a.y || a.n - b.n);
  state.flareAt = -1000;
  state.keepParts = Infinity;
  state.hurtAt = -1000;
  state.probe = null;
  state.known = {}; // ids of light enemy robots already seen
  state.launches = []; // their first sightings
  state.app = null; // the way in: { ax, ay, cover, tid }
  state.scanFrame = -1;
  state.scans = 0;
}

/**
 * The target: the one it had while still seen (unless one twice as heavy shows up), else the heaviest enemy with a
 * live core of `minMass` or more (nearest first, so a tie goes to the nearer). Forgets the remembered one when it is
 * seen dead, `memory` s after it vanished, or at once when it vanished out at the radar's edge.
 */
function pick() {
  let best = null;
  let kept = null;
  let gone = false;
  let small = null; // the heaviest light enemy that is not flying like a dart (a gunship, a pod)
  let keptSmall = null;
  const m = state.main;
  for (const c of contacts) {
    if (c.id === state.tid && (c.side !== 'enemy' || !c.core)) gone = true;
    if (m && c.id === m.id && (c.side !== 'enemy' || !c.core)) state.main = null;
    if (c.side !== 'enemy' || !c.core) continue;
    // The main enemy for the burners (titans round 5): the heaviest enemy with a live core ever seen, kept, with its
    // last place and speed, until it is seen dead or one heavier shows up, however long it hides.
    if (c.mass >= minMass && (!state.main || c.id === state.main.id || c.mass > state.main.mass)) state.main = { id: c.id, x: c.pos.x, y: c.pos.y, vx: c.vel.x, vy: c.vel.y, mass: c.mass, at: time };
    if (c.mass < minMass) {
      if (!state.known[c.id]) launched(c);
      if (c.mass >= smallMass && Math.hypot(c.vel.x, c.vel.y) < smallSpeed) {
        if (c.id === state.tid) keptSmall = c;
        if (!small || c.mass > small.mass) small = c;
      }
      continue;
    }
    if (c.id === state.tid) kept = c;
    if (!best || c.mass > best.mass) best = c;
  }
  let t = kept && !(best && best.mass > 2 * kept.mass) ? kept : best;
  const s = state.last;
  // The main enemy went into hiding (titans v2, 2026-10): while it is remembered and is much heavier than anything in
  // view, the darts keep going at its last place, not at the small fry around it (a split titan's king sat hidden in
  // a corner while every dart went at its gunships).
  if (!kept && t && s && !gone && !s.small && s.mass > hideMass * t.mass && (time - s.at < memory || Math.hypot(s.vx, s.vy) < stillSpeed)) t = null;
  if (t) state.everSeen = true;
  // One that stood still when last seen (a roped base in its bubble, titans v2, 2026-10) is kept as long as it is not
  // seen dead: it is most likely still there.
  const still = s && Math.hypot(s.vx, s.vy) < stillSpeed;
  if (!t && s && (gone || (time - s.at > memory && !still) || s.d > lostAt)) state.last = null;
  // Nothing heavy left in view and nothing remembered (titans v2, 2026-10): the light ones are the enemy now. A split
  // titan's last gunships kept a woodpecker idle for the last 160 s of a match. Not while light robots keep being let
  // go from somewhere hidden: then the launcher is the enemy (the darts went at a hidden trickster's darts instead).
  if (!t && (!state.last || state.last.small)) {
    if (!ghost()) return keptSmall || small;
    state.last = null;
  }
  return t;
}

/**
 * Where hidden launches come from (titans v2, 2026-10): a light enemy robot (a dart, a drone) seen for the first time
 * shows where something let it go, since the radar sees the whole field. A launcher hidden in a jammer's bubble is
 * never in `contacts`, but what it lets go is, as soon as it leaves the bubble. The last `ghostKeep` first sightings,
 * each carried back along its path by `ghostBack` s, give the guess: their middle, sideways and in height.
 */
function launched(c) {
  state.known[c.id] = 1;
  if (c.distance < ghostNear) return; // let go right beside us: no news of a far launcher
  const g = state.launches;
  g.push({ x: c.pos.x - c.vel.x * ghostBack, y: c.pos.y - c.vel.y * ghostBack, at: time });
  if (g.length > ghostKeep) g.shift();
}

/** The guessed hidden launcher: the middle (median) of the recent first sightings, or null. */
function ghost() {
  const g = state.launches.filter((p) => time - p.at < ghostAge);
  if (g.length < 3) return null;
  const xs = g.map((p) => p.x).sort((a, b) => a - b);
  const ys = g.map((p) => p.y).sort((a, b) => a - b);
  const m = g.length >> 1;
  return { x: xs[m], y: ys[m], spread: Math.max(20, (xs[xs.length - 1] - xs[0]) / 2) };
}

/**
 * A huge robot's (more than `huge` parts) leftmost, rightmost, lowest, and highest parts: the parts nearest points far
 * off each way, four scans of one part instead of thousands of parts handed over. Null when it is not seen.
 */
function extremes(t) {
  const out = [];
  for (const [dx, dy] of [[-1e6, 0], [1e6, 0], [0, -1e6], [0, 1e6]]) {
    const one = look(t.id, { near: { x: t.pos.x + dx, y: t.pos.y + dy }, most: 1 });
    if (!one) return null;
    for (const p of one) out.push(p);
  }
  return out;
}

// `scan`, counted: at most 4 a tick between the box and the probes.
function look(id, opts) {
  if (state.scanFrame !== frame) {
    state.scanFrame = frame;
    state.scans = 0;
  }
  if (state.scans >= 4) return null;
  state.scans++;
  return opts ? scan(id, opts) : scan(id);
}

/**
 * Whether the target carries lasers (titans round 5, 2026-10), looked up once a target: a beam burns a light flier
 * coming at it within its reach in a fraction of a second (a sled's point defense took every burner as it closed), so
 * the burners creep in on one that has them.
 */
function lasers(t) {
  if (state.beamsFor !== t.id) {
    const ps = look(t.id, { of: ['laser'] });
    if (!ps) return;
    state.beamsFor = t.id;
    state.beamN = ps.length;
    // Where they are from its core (titans round 5): the burners burn the ones they can see first.
    state.lz = ps.slice(0, 4).map((p) => [Math.round(p.pos.x - t.pos.x), Math.round(p.pos.y - t.pos.y)]);
    if (debug) log('lasers', t.id, ps.length);
  }
  // Its guns too (titans round 5), where they are from its core, if there are few enough to burn one by one: a
  // fortress's turrets shoot a burner hovering 200 m off (their shells fly 300 m), and a gun is 25 health, a tenth of
  // a second of beam. Looked at again every `gunEvery` ticks (they break, turrets turn).
  // Its fab bays too (titans round 6, 2026-10): a bay is 150 health and no armor, a quarter of a second of beam, and
  // it is what makes the darts and jammer pods. Listed for the burners, who share them out by slot.
  if (state.baysFor !== t.id || frame - state.baysAt >= gunEvery) {
    const bs = look(t.id, { of: ['fabbay'] });
    if (!bs) return;
    state.baysFor = t.id;
    state.baysAt = frame;
    state.tbays = bs.slice(0, bayMax).map((p) => [Math.round(p.pos.x - t.pos.x), Math.round(p.pos.y - t.pos.y)]);
  }
  if (state.gunsFor === t.id && frame - state.gunsAt < gunEvery) return;
  if (state.gunsFor === t.id) state.beamsFor = -1; // the lasers are looked at again next tick (turrets turn)
  const gs = look(t.id, { of: ['gun'] });
  if (!gs) return;
  state.gunsFor = t.id;
  state.gunsAt = frame;
  state.guns = gs.length > 0 && gs.length <= gunMax ? gs.map((p) => [Math.round(p.pos.x - t.pos.x), Math.round(p.pos.y - t.pos.y)]) : [];
}

function measure(t) {
  if (frame - state.boxAt < rescan) return;
  if (t.parts > huge && frame === state.scanFrame && state.scans > 0) return; // the four extremes need four scans
  const ps = t.parts > huge ? extremes(t) : look(t.id);
  if (!ps || ps.length === 0) return;
  state.boxAt = frame;
  let l = 0;
  let r = 0;
  let d = 0;
  let u = 0;
  for (const p of ps) {
    const ex = p.pos.x - t.pos.x;
    const ey = p.pos.y - t.pos.y;
    if (-ex > l) l = -ex;
    if (ex > r) r = ex;
    if (-ey > d) d = -ey;
    if (ey > u) u = ey;
  }
  state.box = { l, r, d, u };
}

/**
 * The way in (titans v2, 2026-10): every `rescan` ticks it looks along a fan of lines into the target's main core, from
 * our side round over the top (and from under it, for a robot high in the air), and asks the radar how much health
 * stands in front of the core on each (`scan` with `from`: `cover`). The darts come in along the thinnest line. A
 * wide base is thinnest from above, a brick may be thinnest at a corner, and as darts dig a hole the hole is the
 * thinnest line, so the next darts go down it. Two looks a tick, so the box's four scans always fit.
 */
function probe(t) {
  const pr = state.probe;
  if (!pr || pr.tid !== t.id) {
    state.probe = { tid: t.id, at: frame, i: 0, list: probeList(t), best: null, bestScore: Infinity, covers: [], safe: null, safeCover: Infinity };
    return;
  }
  if (pr.i >= pr.list.length) {
    if (frame - pr.at >= rescan) state.probe = { tid: t.id, at: frame, i: 0, list: probeList(t), best: null, bestScore: Infinity, covers: [], safe: null, safeCover: Infinity };
    return;
  }
  for (let k = 0; k < 2 && pr.i < pr.list.length; k++) {
    const e = pr.list[pr.i++];
    const b = state.box;
    const out = Math.max(b.l, b.r, b.d, b.u) + 25;
    const toUs = self.pos.x < t.pos.x ? -1 : 1;
    const ax = toUs * Math.cos(e);
    const ay = Math.sin(e);
    const from = { x: t.pos.x + ax * out, y: t.pos.y + ay * out };
    if (from.y < 2) continue;
    const one = look(t.id, { near: { x: t.pos.x, y: t.pos.y }, most: 1, from, wide: 0.6 });
    if (!one || one.length === 0) continue;
    // Health in the way, and a little for a line far from the darts' easy one (down from 45 degrees on our side).
    const score = one[0].cover + 25 * Math.abs(e - Math.PI / 4);
    if (debug) pr.covers.push(Math.round((e * 180) / Math.PI) + ':' + Math.round(one[0].cover));
    if (score < pr.bestScore) {
      pr.bestScore = score;
      pr.best = { ax, ay, cover: one[0].cover };
    }
    // The thinnest on our side and not steep (titans round 5): a target with lasers is burnt from there, where its
    // turrets facing us aim at the base and those facing away cannot swing round.
    if (e <= safeUp && one[0].cover < pr.safeCover) {
      pr.safeCover = one[0].cover;
      pr.safe = { ax, ay, cover: one[0].cover };
    }
  }
  if (pr.i >= pr.list.length && pr.best) {
    state.app = { ...pr.best, tid: t.id, safe: pr.safe };
    if (debug) log('probe', t.id, 'way in', Math.round((Math.atan2(pr.best.ay, pr.best.ax) * 180) / Math.PI), 'cover', Math.round(pr.best.cover), 'all', pr.covers.join(' '));
  }
}

// The lines to look along: angles up from level on our side, over the top, and under a robot high in the air.
function probeList(t) {
  const out = [];
  for (let d = 10; d <= 130; d += 20) out.push((d * Math.PI) / 180);
  if (t.pos.y - state.box.d > 25) out.push((-25 * Math.PI) / 180, (-50 * Math.PI) / 180);
  return out;
}

/** What a dart is told: the target `t` (this tick's pick), else its remembered place, else (never seen) the far side. */
function message(t) {
  state.shots++;
  if (t) {
    measure(t);
    const b = state.box;
    // Wider than tall: thin from above, so the darts come down on it.
    const top = b.l + b.r > 1.5 * (b.d + b.u) ? 1 : 0;
    const msg = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, l: b.l, r: b.r, d: b.d, u: b.u, top, mass: t.mass, beams: state.beamsFor === t.id ? state.beamN : 0 };
    const a = state.app;
    // Only for a robot worth going around (armor on every line) that keeps still: a small or moving one is hit
    // straight, and the bend only made darts miss it (a gun drone lasted 56 s, not 11).
    if (useApp > 0.5 && a && a.tid === t.id && a.cover >= appCover && Math.hypot(t.vel.x, t.vel.y) < appSpeed) {
      msg.ax = a.ax;
      msg.ay = a.ay;
    }
    return msg;
  }
  const s = state.last;
  if (s && Math.hypot(s.vx, s.vy) < stillSpeed && s.id === state.tid) {
    // Hidden but standing still: its last place, its size, and the way in, as if seen; the darts follow it by its id
    // the moment the radio or their own seeker sees it again.
    const b = state.box;
    const msg = { x: s.x, y: s.y, vx: 0, vy: 0, id: s.id, l: b.l, r: b.r, d: b.d, u: b.u, top: b.l + b.r > 1.5 * (b.d + b.u) ? 1 : 0, mass: s.mass };
    const a = state.app;
    if (useApp > 0.5 && a && a.tid === s.id && a.cover >= appCover) {
      msg.ax = a.ax;
      msg.ay = a.ay;
    }
    return msg;
  }
  if (s) {
    const age = Math.min(time - s.at, 4);
    return { x: s.x + s.vx * age, y: Math.max(1, s.y + s.vy * age), vx: 0, vy: 0, id: -1, l: 60, r: 60, d: 40, u: 40, blind: 1 };
  }
  // Seen once and gone: nothing to fly at. In the open (no arena, titans v2, 2026-10) there is no far side to guess
  // at: the darts wait until something is seen, however long that takes.
  // A launcher hidden in a bubble (titans v2, 2026-10): the darts go at the middle of where its launches show up,
  // from under it and up through that point (`sweep`): a wide robot is hit somewhere along its width whatever its
  // height, as long as the point is not below it, so the point is set `ghostOver` m above the guess.
  const gh = ghost();
  if (gh) {
    if (debug) log('ghost', Math.round(gh.x), Math.round(gh.y), 'spread', Math.round(gh.spread), 'from', state.launches.length);
    const w = gh.spread + 30;
    // Low (a ground robot): from above, down onto the guess.
    if (gh.y < ghostLow) return { x: gh.x, y: Math.max(1, gh.y - 5), vx: 0, vy: 0, id: -1, l: w, r: w, d: 10, u: 40, blind: 1, sweep: 1, ax: 0, ay: 1 };
    return { x: gh.x, y: Math.max(3, gh.y + ghostOver), vx: 0, vy: 0, id: -1, l: w, r: w, d: 60, u: 30, blind: 1, sweep: 1, ax: 0, ay: -1 };
  }
  if (state.everSeen || !arena) return null;
  // Never seen: the point across the arena, low for every second dart (a ground titan), the rest at stepped heights.
  const y = state.shots % 2 === 0 ? 3 : 8 + ((state.shots * 29) % 145);
  return { x: state.mirrorX, y, vx: 0, vy: 0, id: -1, l: 80, r: 80, d: 10, u: 10, blind: 1 };
}

/**
 * Flares (titans v2, 2026-10): something closing fast that will pass within `flareMiss` m of the main core between
 * `flareSoon` and `flareLate` s from now (a dart, a ram) gets a flare let go burning at the end of the base on its
 * side, about 80 m from the keep. Every sensor that sees the flare takes it for this titan for 2 s, so a dart that
 * steers by its seeker or a radio goes off at the flare, not on the keep. Rules by sensor: whatever steers by contacts
 * is fooled, whatever it is.
 */
// How many parts the keep still has, counted every `hurtEvery` ticks; a drop marks the time it was hurt.
function hurt() {
  if (frame % hurtEvery !== 0) return;
  const sx = self.pos.x;
  const sy = self.pos.y;
  let n = 0;
  for (const p of parts) if (Math.abs(p.pos.x - sx) < keepHalf && Math.abs(p.pos.y - sy) < keepTall) n++;
  if (n < state.keepParts && state.keepParts !== Infinity) state.hurtAt = time;
  state.keepParts = n;
}

function flares() {
  hurt();
  if (state.flares.length === 0 || time - state.flareAt < flareGap) return;
  // The flare still burning covers whatever arrives before it burns out (`flareBurn` s), less a margin. A new one goes
  // only for something arriving after that, and as late as still works (`flareLate`), so each flare covers up to 2 s.
  const covered = state.flareAt + flareBurn - flareSoon - time;
  const sx = self.pos.x;
  const sy = self.pos.y;
  let side = 0;
  let steep = true; // coming down from above (either end's flare draws it off the keep), not in from one side
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    const rx = c.pos.x - sx;
    const ry = c.pos.y - sy;
    const vx = c.vel.x;
    const vy = c.vel.y;
    const v2 = vx * vx + vy * vy;
    if (v2 < flareClose * flareClose) continue;
    const t = -(rx * vx + ry * vy) / v2; // s to its closest pass
    if (t < flareSoon || t > flareLate || t < covered) continue;
    if (Math.hypot(rx + vx * t, ry + vy * t) > flareMiss) continue;
    if (-(rx * vx + ry * vy) / (Math.hypot(rx, ry) || 1) < flareClose) continue; // not closing fast enough
    side = rx < 0 ? -1 : 1;
    steep = Math.abs(ry) > Math.abs(rx);
    break;
  }
  // Under fire with nothing seen coming (guns, a blast that got through): the keep lost parts in the last look. Then a
  // flare is kept burning on the side of the main enemy, so whatever aims by its sensors aims at the end of the base.
  if (side === 0 && time - state.hurtAt < flareHurt && covered <= 0) {
    const s = state.last;
    side = s && s.x < sx ? -1 : 1;
    steep = false; // guns aim at the flare: one beyond the keep would draw their shells through it
  }
  if (side === 0) return;
  // The held flare on that side, highest first. The other end's only for something coming down from above: one
  // coming in from the side flew through the keep on its way to a flare beyond it.
  let pickF = null;
  for (const f of state.flares) {
    if (f.used || !(get('fg' + f.n, 'armed') > 0)) continue;
    const mine = (f.x - sx) * side > 0;
    if (mine) {
      pickF = f;
      break;
    }
    if (!pickF && steep) pickF = f;
  }
  if (!pickF) return;
  pickF.used = true;
  if (debug) log('flare', pickF.n, 'side', side);
  set('f' + pickF.n, 'ignite', 1);
  set('fg' + pickF.n, 'fire', 1);
  state.flareAt = time;
}

/**
 * The burners (titans round 5, 2026-10): each one goes once the target is seen and the probes have found the way in
 * (or after `burnWait` ticks), `burnGap` ticks apart, told the target as a dart is, the way in whatever its cover
 * (a beam from any side burns a straight tunnel), and its slot beside the others. Never at a blind guess: a burner
 * is too dear to spend on an empty spot.
 */
function burn(t) {
  if (state.bnext < state.burners.length && frame - state.lastBurn >= burnGap) {
    const msg = burnerMsg(t);
    if (msg) {
      const b = state.burners[state.bnext++];
      state.lastBurn = frame;
      if (get('ug' + b.n, 'armed') > 0) {
        send('u' + b.n, msg);
        set('ug' + b.n, 'fire', 1);
      }
    }
  }
  // The burner bays (titans round 5): each lets its burner go as soon as it is built and there is a target.
  for (const tag of state.cbays) {
    if (!(get(tag, 'ready') > 0)) continue;
    const msg = burnerMsg(t);
    if (!msg) return;
    send(tag + get(tag, 'built'), msg);
    set(tag, 'release', 1);
    return;
  }
}

/** What a burner is told: the dart's message with the way in and its slot, or null (nothing sure to burn yet). */
function burnerMsg(t) {
  if (!t && !state.main && !(state.last && state.last.id === state.tid && Math.hypot(state.last.vx, state.last.vy) < stillSpeed)) return null;
  const id = t ? t.id : state.last ? state.last.id : -1;
  if (!(state.app && state.app.tid === id) && frame < burnWait && t) return null;
  // The main enemy hiding while something much lighter is the target (a split titan's king off in its bubble while
  // its gunships fly about): the burners go at the main one's last place and hunt it from there.
  const m = state.main;
  if (m && time - m.at < mainKeep && (t ? t.id !== m.id && m.mass > 2 * t.mass : !(state.last && state.last.id === m.id))) {
    state.shots++;
    return { x: m.x, y: m.y, vx: m.vx, vy: m.vy, id: m.id, l: 30, r: 30, d: 30, u: 30, top: 0, mass: m.mass, beams: 0, slot: state.slot++ % 9 };
  }
  const msg = message(t);
  if (!msg || msg.blind) {
    if (msg) state.shots--;
    return null;
  }
  const a = state.app;
  const w = a && a.tid === id ? (msg.beams > 0 ? a.safe : a) : null;
  if (w) {
    msg.ax = w.ax;
    msg.ay = w.ay;
  } else {
    delete msg.ax;
    delete msg.ay;
  }
  msg.slot = state.slot++ % 9;
  msg.share = Math.max(1, state.burners.length);
  if (state.gunsFor === id && state.guns.length > 0) msg.guns = state.guns;
  if (state.baysFor === id && state.tbays && state.tbays.length > 0) msg.bays = state.tbays;
  // A hard target (titans round 6): even its thinnest line to the core has `hardCover` health or more on it (eight
  // plates, some 13 s of one beam). Its burners take its bays first, stand stacked along one line, and give its
  // lasers longer; a softer one is burnt straight to its core, as in round 5.
  if (a && a.tid === id && a.cover >= hardCover) msg.hard = 1;
  if (state.beamsFor === id && state.lz && state.lz.length > 0) msg.lz = state.lz;
  return msg;
}

// Cast every anchor that holds no rope: its `fire` goes to 0 on one tick and to 1 on the next (a cast needs a rise).
function castAnchors() {
  if (anchors < 1 || frame < anchorAt) return;
  const beat = (frame - anchorAt) % recast;
  if (beat > 1) return;
  for (let i = 1; i <= anchors; i++) {
    const tag = 'an' + i;
    if (get(tag, 'hooked') > 0.5) continue;
    set(tag, 'fire', beat);
  }
}

function tick() {
  castAnchors();
  flares();
  if (state.grips.length === 0 && state.bays.length === 0 && state.burners.length === 0 && state.cbays.length === 0) return;
  // The target, looked for every tick so its last place and its death are known when a dart goes.
  const t = pick();
  if (t) {
    if (t.id !== state.tid) {
      state.tid = t.id;
      state.boxAt = -100000; // another robot: measure it again
    }
    state.last = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, at: time, d: t.distance, id: t.id, small: t.mass < minMass, mass: t.mass };
  }
  if (t) measure(t);
  if (t) lasers(t);
  if (debug && frame % 300 === 0) {
    let ready = 0;
    for (const tag of state.bays) if (get(tag, 'ready') > 0) ready++;
    log('status t', t ? t.id + ' ' + Math.round(t.mass) : '-', 'last', state.last ? state.last.id : '-', 'bays', parts.filter((p) => p.type === 'fabbay').length, 'built', state.bays.map((b) => get(b, 'built')).join(','), 'ready', ready, 'energy', Math.round(self.energy.stored), 'enemies', contacts.filter((c) => c.side === 'enemy' && c.core).map((c) => Math.round(c.mass) + '@' + Math.round(Math.hypot(c.vel.x, c.vel.y))).join(','));
  }
  fire(t);
  // Probes only for a target that keeps still: the way in is used for no other, and each probe looks over the whole
  // robot (a titan of thousands of parts).
  // Titans round 5: also for a moving one while burners are still to go, since a burner stations itself on the way in.
  if (t && useApp > 0.5 && (Math.hypot(t.vel.x, t.vel.y) < appSpeed || state.bnext < state.burners.length)) probe(t);
}

// The burners, the rack and the bays.
function fire(t) {
  burn(t);
  // The rack.
  // In waves (titans v2, 2026-10): `wave` darts, then `waveGap` ticks of rest. The whole rack in one stream arrived
  // within 2 s, so a single flare (it burns 2 s) took every dart of it; waves further apart than a flare burns make a
  // robot spend a flare on each, and the waves after its last flare get through.
  const rest = state.next > 0 && state.next % wave === 0 ? waveGap : gap;
  if (state.next < state.grips.length && frame - state.lastFire >= rest && frame >= 2) {
    const grip = state.grips[state.next++];
    state.lastFire = frame;
    if (get('g' + grip.n, 'armed') > 0) {
      const msg = message(t);
      if (!msg) {
        // Nothing to fly at: this one stays on the rack, and the stream goes on when there is.
        state.next--;
        state.shots--;
      } else {
        send('d' + grip.n, msg);
        set('g' + grip.n, 'fire', 1);
      }
    }
  }
  // The bays.
  if (frame - state.lastBay < bayGap) return;
  for (const tag of state.bays) {
    if (!(get(tag, 'ready') > 0)) continue;
    const msg = message(t);
    if (!msg) {
      state.shots--;
      return;
    }
    send(tag + get(tag, 'built'), msg);
    set(tag, 'release', 1);
    state.lastBay = frame;
    return;
  }
}
