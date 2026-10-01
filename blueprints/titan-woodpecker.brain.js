// Brain of titan-woodpecker: picks what the darts fly at, lets the rack go in one long stream, and then lets each bay's
// dart go as it is built. It runs on the main core while the pod stands on the base, and again on the base's own core
// once the pod has left (the same file).
// - Target: the heaviest robot on the other side the radars track that has a live core; once picked it is kept while
//   seen. Its point is its core (`contacts[].pos`), so every dart lands on the same spot, one after another, each
//   blast digging where the last one stopped.
// - Hidden target: with nothing tracked, darts fly to where it was last seen, or to the point across the arena from
//   where this titan started (the other side starts at -x of it), each at another height, and arm near that point.
// - Order: the rack's darts go nearest the enemy first, one every `gap` ticks, so no dart flies over one that is about
//   to leave, and they arrive spaced out (a dart caught in the blast ahead of it would be wasted).
const gap = param('gap', 2, { min: 1, max: 60 }); // ticks between two darts leaving the rack
const bayGap = param('bayGap', 4, { min: 1, max: 120 }); // ticks between two bays letting go
const minMass = param('minMass', 120, { min: 0, max: 100000 }); // kg: lighter robots are not the titan
const rescan = param('rescan', 180, { min: 30, max: 6000 }); // ticks between two looks at the target's size
const memory = param('memory', 15, { min: 0, max: 240 }); // s a last sighting is flown at before the start point is

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
  state.last = null;
  state.shots = 0;
}

function pick() {
  let best = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id === state.tid) return c;
    if (!best || c.mass > best.mass) best = c;
  }
  if (best && best.mass < minMass && state.last && time - state.last.at < memory) return null;
  return best;
}

function measure(t) {
  if (frame - state.boxAt < rescan) return;
  state.boxAt = frame;
  const ps = scan(t.id);
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

function message() {
  const t = pick();
  state.shots++;
  if (t) {
    if (t.id !== state.tid) {
      state.tid = t.id;
      state.boxAt = -100000;
    }
    measure(t);
    state.last = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, at: time };
    const b = state.box;
    // Wider than tall: thin from above, so the darts come down on it.
    const top = b.l + b.r > 1.5 * (b.d + b.u) ? 1 : 0;
    return { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, l: b.l, r: b.r, d: b.d, u: b.u, top };
  }
  const s = state.last;
  if (s && time - s.at < memory) {
    const age = Math.min(time - s.at, 4);
    return { x: s.x + s.vx * age, y: s.y + s.vy * age, vx: 0, vy: 0, id: -1, l: 60, r: 60, d: 40, u: 40, blind: 1 };
  }
  // Never seen: the point across the arena, low for every second dart (a ground titan), the rest at stepped heights.
  const y = state.shots % 2 === 0 ? 3 : 8 + ((state.shots * 29) % 145);
  return { x: state.mirrorX, y, vx: 0, vy: 0, id: -1, l: 80, r: 80, d: 10, u: 10, blind: 1 };
}

function tick() {
  if (state.grips.length === 0 && state.bays.length === 0) return;
  // The rack.
  if (state.next < state.grips.length && frame - state.lastFire >= gap && frame >= 2) {
    const grip = state.grips[state.next++];
    state.lastFire = frame;
    if (get('g' + grip.n, 'armed') > 0) {
      send('d' + grip.n, message());
      set('g' + grip.n, 'fire', 1);
    }
  }
  // The bays.
  if (frame - state.lastBay < bayGap) return;
  for (const tag of state.bays) {
    if (!(get(tag, 'ready') > 0)) continue;
    send(tag + get(tag, 'built'), message());
    set(tag, 'release', 1);
    state.lastBay = frame;
    return;
  }
}
