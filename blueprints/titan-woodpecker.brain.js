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
const recast = param('recast', 120, { min: 10, max: 6000 }); // ticks between two tries for an anchor with no rope

function setup() {
  state.mirrorX = -self.pos.x;
  state.grips = [];
  state.bays = [];
  for (const p of parts) {
    if (p.type === 'decoupler') {
      const tag = p.tags.find((t) => /^g\d+$/.test(t));
      if (tag) state.grips.push({ n: Number(tag.slice(1)), x: p.pos.x });
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
    const one = scan(t.id, { near: { x: t.pos.x + dx, y: t.pos.y + dy }, most: 1 });
    if (!one) return null;
    for (const p of one) out.push(p);
  }
  return out;
}

function measure(t) {
  if (frame - state.boxAt < rescan) return;
  state.boxAt = frame;
  const ps = t.parts > huge ? extremes(t) : scan(t.id);
  if (!ps || ps.length === 0) return;
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

/** What a dart is told: the target `t` (this tick's pick), else its remembered place, else (never seen) the far side. */
function message(t) {
  state.shots++;
  if (t) {
    measure(t);
    const b = state.box;
    // Wider than tall: thin from above, so the darts come down on it.
    const top = b.l + b.r > 1.5 * (b.d + b.u) ? 1 : 0;
    return { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, l: b.l, r: b.r, d: b.d, u: b.u, top };
  }
  const s = state.last;
  if (s) {
    const age = Math.min(time - s.at, 4);
    return { x: s.x + s.vx * age, y: Math.max(1, s.y + s.vy * age), vx: 0, vy: 0, id: -1, l: 60, r: 60, d: 40, u: 40, blind: 1 };
  }
  // Seen once and gone: nothing to fly at.
  if (state.everSeen) return null;
  // Never seen: the point across the arena, low for every second dart (a ground titan), the rest at stepped heights.
  const y = state.shots % 2 === 0 ? 3 : 8 + ((state.shots * 29) % 145);
  return { x: state.mirrorX, y, vx: 0, vy: 0, id: -1, l: 80, r: 80, d: 10, u: 10, blind: 1 };
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
