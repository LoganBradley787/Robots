// Brain of titan-woodpecker: picks what the darts fly at, casts the anchors, lets the rack go in one long stream, and
// then lets each bay's dart go as it is built. It runs on the main core, deep in the keep, all match.
// - Target (titan-darts, 2026-10, Logan): picked from what the radar reports, never by id: the heaviest robot on the
//   other side with a live core, kept while it is seen unless one twice as heavy shows up. Its point is its core
//   (`contacts[].pos`), so every dart lands on the same spot, one after another, each blast digging where the last
//   one stopped. The darts keep following it by radio after they leave.
// - A target that dies stays in the radar's view as debris (no live core), so it is forgotten at once and nothing more
//   goes to its spot. One that vanished alive (into a jammer's bubble or smoke, most likely) has its last place kept
//   `memory` s, and darts fly there and arm near it; then it is forgotten. Only while it has never seen an enemy at all
//   do darts go to the point across the arena from where this titan started (a titan hidden from the first second
//   starts about there), each at another height. Otherwise the darts wait for a target.
// - Order: the rack's darts go nearest the enemy first, one every `gap` ticks, so no dart flies over one that is about
//   to leave, and they arrive spaced out (a dart caught in the blast ahead of it would be wasted).
// - Anchors: grapples in the floor, cast at the ground once the base rests. Each rope holds the base where it stands
//   against a push toward the arena's edge. One that lost its rope is cast again.
const gap = param('gap', 2, { min: 1, max: 60 }); // ticks between two darts leaving the rack
const bayGap = param('bayGap', 4, { min: 1, max: 120 }); // ticks between two bays letting go
const minMass = param('minMass', 30, { min: 0, max: 100000 }); // kg: lighter robots (darts, pods) are never the target
const rescan = param('rescan', 180, { min: 30, max: 6000 }); // ticks between two looks at the target's size
const huge = param('huge', 600, { min: 10, max: 100000 }); // parts: a robot bigger than this is never scanned whole, only its extremes
const memory = param('memory', 15, { min: 0, max: 240 }); // s a target that vanished alive is remembered and darts fly to its last place
const lostAt = param('lostAt', 900, { min: 50, max: 2000 }); // m: one that vanished further off went out of the radar's reach and is forgotten
const anchors = param('anchors', 0, { min: 0, max: 200 }); // how many anchors the floor holds (the generator sets it)
const anchorAt = param('anchorAt', 40, { min: 2, max: 600 }); // tick of the first cast
const useApp = param('useApp', 1, { min: 0, max: 1 }); // 1: the darts come in along the thinnest line the probes found
const flareAhead = param('flareAhead', 2.2, { min: 0.2, max: 6 }); // s: a flare goes when something will pass the keep within this
const flareSoon = param('flareSoon', 0.35, { min: 0, max: 3 }); // s: and not sooner than this (already here: too late)
const flareMiss = param('flareMiss', 30, { min: 1, max: 200 }); // m from the main core: a pass this close counts
const flareClose = param('flareClose', 25, { min: 0, max: 500 }); // m/s it must close at, at least (a robot pushing slowly is no dart)
const flareGap = param('flareGap', 1.1, { min: 0.1, max: 10 }); // s between two flares (each burns 2)
const recast = param('recast', 120, { min: 10, max: 6000 }); // ticks between two tries for an anchor with no rope

function setup() {
  state.mirrorX = -self.pos.x;
  state.grips = [];
  state.bays = [];
  state.flares = [];
  for (const p of parts) {
    if (p.type === 'decoupler') {
      const tag = p.tags.find((t) => /^g\d+$/.test(t));
      if (tag) state.grips.push({ n: Number(tag.slice(1)), x: p.pos.x });
    } else if (p.type === 'flare') {
      const tag = p.tags.find((t) => /^f\d+$/.test(t));
      if (tag) state.flares.push({ n: Number(tag.slice(1)), x: p.pos.x, y: p.pos.y });
    } else if (p.type === 'fabbay') {
      const tag = p.tags.find((t) => /^b\d+x$/.test(t));
      if (tag) state.bays.push(tag);
    }
  }
  // Nearest the enemy first.
  const toward = state.mirrorX;
  state.grips.sort((a, b) => Math.abs(a.x - toward) - Math.abs(b.x - toward) || a.n - b.n);
  state.next = 0;
  state.lastFire = -1000;
  state.lastBay = -1000;
  state.tid = -1;
  state.box = { l: 40, r: 40, d: 20, u: 20 };
  state.boxAt = -100000;
  state.last = null; // the target: { x, y, vx, vy, at, d }, its last place while seen, kept a while once it vanishes
  state.everSeen = false; // whether any enemy that could be the target was ever seen
  state.shots = 0;
  // The lowest flares go first, so a flare let go does not fall past the ones still held.
  state.flares.sort((a, b) => a.y - b.y || a.n - b.n);
  state.flareAt = -1000;
  state.probe = null;
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
  for (const c of contacts) {
    if (c.id === state.tid && (c.side !== 'enemy' || !c.core)) gone = true;
    if (c.side !== 'enemy' || !c.core || c.mass < minMass) continue;
    if (c.id === state.tid) kept = c;
    if (!best || c.mass > best.mass) best = c;
  }
  const t = kept && !(best && best.mass > 2 * kept.mass) ? kept : best;
  if (t) state.everSeen = true;
  const s = state.last;
  if (!t && s && (gone || time - s.at > memory || s.d > lostAt)) state.last = null;
  return t;
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
    state.probe = { tid: t.id, at: frame, i: 0, list: probeList(t), best: null, bestScore: Infinity };
    return;
  }
  if (pr.i >= pr.list.length) {
    if (frame - pr.at >= rescan) state.probe = { tid: t.id, at: frame, i: 0, list: probeList(t), best: null, bestScore: Infinity };
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
    if (score < pr.bestScore) {
      pr.bestScore = score;
      pr.best = { ax, ay, cover: one[0].cover };
    }
  }
  if (pr.i >= pr.list.length && pr.best) state.app = { ...pr.best, tid: t.id };
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
    const msg = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, l: b.l, r: b.r, d: b.d, u: b.u, top };
    const a = state.app;
    if (useApp > 0.5 && a && a.tid === t.id) {
      msg.ax = a.ax;
      msg.ay = a.ay;
    }
    return msg;
  }
  const s = state.last;
  if (s) {
    const age = Math.min(time - s.at, 4);
    return { x: s.x + s.vx * age, y: Math.max(1, s.y + s.vy * age), vx: 0, vy: 0, id: -1, l: 60, r: 60, d: 40, u: 40, blind: 1 };
  }
  // Seen once and gone: nothing to fly at. In the open (no arena, titans v2, 2026-10) there is no far side to guess
  // at: the darts wait until something is seen, however long that takes.
  if (state.everSeen || !arena) return null;
  // Never seen: the point across the arena, low for every second dart (a ground titan), the rest at stepped heights.
  const y = state.shots % 2 === 0 ? 3 : 8 + ((state.shots * 29) % 145);
  return { x: state.mirrorX, y, vx: 0, vy: 0, id: -1, l: 80, r: 80, d: 10, u: 10, blind: 1 };
}

/**
 * Flares (titans v2, 2026-10): something closing fast that will pass within `flareMiss` m of the main core between
 * `flareSoon` and `flareAhead` s from now (a dart, a ram) gets a flare let go burning at the end of the base on its
 * side, about 80 m from the keep. Every sensor that sees the flare takes it for this titan for 2 s, so a dart that
 * steers by its seeker or a radio goes off at the flare, not on the keep. Rules by sensor: whatever steers by contacts
 * is fooled, whatever it is.
 */
function flares() {
  if (state.flares.length === 0 || time - state.flareAt < flareGap) return;
  const sx = self.pos.x;
  const sy = self.pos.y;
  let side = 0;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    const rx = c.pos.x - sx;
    const ry = c.pos.y - sy;
    const vx = c.vel.x;
    const vy = c.vel.y;
    const v2 = vx * vx + vy * vy;
    if (v2 < flareClose * flareClose) continue;
    const t = -(rx * vx + ry * vy) / v2; // s to its closest pass
    if (t < flareSoon || t > flareAhead) continue;
    if (Math.hypot(rx + vx * t, ry + vy * t) > flareMiss) continue;
    if (-(rx * vx + ry * vy) / (Math.hypot(rx, ry) || 1) < flareClose) continue; // not closing fast enough
    side = rx < 0 ? -1 : 1;
    break;
  }
  if (side === 0) return;
  // The held flare on that side (the other side's when that one is spent), lowest first.
  let pickF = null;
  for (const f of state.flares) {
    if (f.used || !(get('fg' + f.n, 'armed') > 0)) continue;
    const mine = (f.x - sx) * side > 0;
    if (mine) {
      pickF = f;
      break;
    }
    if (!pickF) pickF = f;
  }
  if (!pickF) return;
  pickF.used = true;
  set('f' + pickF.n, 'ignite', 1);
  set('fg' + pickF.n, 'fire', 1);
  state.flareAt = time;
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
  if (state.grips.length === 0 && state.bays.length === 0) return;
  // The target, looked for every tick so its last place and its death are known when a dart goes.
  const t = pick();
  if (t) {
    if (t.id !== state.tid) {
      state.tid = t.id;
      state.boxAt = -100000; // another robot: measure it again
    }
    state.last = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, at: time, d: t.distance };
  }
  if (t) measure(t);
  fire(t);
  if (t && useApp > 0.5) probe(t);
}

// The rack and the bays.
function fire(t) {
  // The rack.
  if (state.next < state.grips.length && frame - state.lastFire >= gap && frame >= 2) {
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
