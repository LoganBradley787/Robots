// The base pilot of titan-bastion: runs the mesa once the keep has let go (scope `base`). No keys. It never moves.
// - Hiding: two 1 by 1 bays beside its core build jammer pods; a held pod is lit, one bay at a time, so the mesa's
//   core is always inside a bubble and no sensor outside sees the mesa. Its radars stand on the end masts, outside.
// - Darts: every dart bay lets its copy go as soon as it is built, at the heaviest robot of the other side its
//   radars track (the body, not its small fliers). With nothing tracked (a hidden enemy) it sends them to where it
//   last tracked one, and otherwise blind: one dart every `blindGap` s, over the top onto the mirror of the keep's
//   start (the other side starts at -x), each coming down the column from a different height. The rest wait in
//   their bays, so a full wave leaves the moment something is tracked.
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots are not worth a dart
const high = param('high', 15, { min: -100, max: 300 }); // m over the base: targets above this get a straight dart, the rest an arc
const gap = param('gap', 0.05, { min: 0, max: 5 }); // s between two bays letting go
const overlap = param('overlap', 2.6, { min: 0.5, max: 5 }); // s between one jammer bay's pod lighting and the other's
const burn = param('burn', 5.1, { min: 1, max: 10 }); // s after lighting a pod its bay is cleared (a pod jams 5 s)
const blindGap = param('blindGap', 2, { min: 0.05, max: 30 }); // s between darts sent blind
const startX = param('startX', 16, { min: -100, max: 100 }); // m from the mesa's core to the keep's start column (the mirror point)
const keepLast = param('keepLast', 12, { min: 0, max: 240 }); // s a last tracked place is used before the guess again

function setup() {
  state.bays = [];
  for (const p of parts) {
    if (p.type !== 'fabbay') continue;
    const tag = p.tags.find((t) => t.charAt(0) === 'd');
    if (tag !== undefined) state.bays.push(tag);
  }
  state.home = { x: self.pos.x, y: self.pos.y };
  // The keep's start column: `startX` m from this core toward the mesa's middle (told by where the bays are).
  let mx = 0;
  let nb = 0;
  for (const p of parts) {
    if (p.type !== 'fabbay') continue;
    mx += p.pos.x;
    nb++;
  }
  const mid = nb > 0 ? mx / nb : self.pos.x;
  state.mirrorX = -(self.pos.x + (mid >= self.pos.x ? startX : -startX));
  state.blind = 0;
  state.last = null;
  state.lit = -100;
  state.jbays = [
    { tag: 'jl', lit: -1, wait: 0 },
    { tag: 'jr', lit: -1, wait: 0 },
  ];
  state.released = -100;
  state.next = 0;
}

/**
 * Jammer pods. A pod is lit while its bay still holds it (held copies answer only to their type and id, so it is
 * found by where it is). A burnt out pod leaves its bay thinking it still holds something, so `burn` s after
 * lighting the bay is told to let go, and it builds the next. The two bays take turns, `overlap` s apart.
 */
function jam() {
  for (const b of state.jbays) {
    if (time < b.wait || !(get(b.tag, 'ready') > 0)) continue;
    if (b.lit < 0) {
      if (time - state.lit < overlap) continue;
      let bayX = 0;
      for (const p of parts) if (p.type === 'fabbay' && p.tags.indexOf(b.tag) >= 0) bayX = p.pos.x;
      for (const p of parts) if (p.type === 'jammer' && Math.abs(p.pos.x - bayX) < 2) set(p.id, 'ignite', 1);
      b.lit = time;
      state.lit = time;
    } else if (time - b.lit > burn) {
      set(b.tag, 'release', 1);
      b.lit = -1;
      b.wait = time + 0.3;
    }
  }
}

/** The heaviest tracked robot of the other side with a live core. */
function pick() {
  let best = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < minMass) continue;
    if (!best || c.mass > best.mass) best = c;
  }
  return best;
}

function tick() {
  jam();
  const t = pick();
  if (t) state.last = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, at: time };
  let aim = state.last;
  const blind = !t && (!aim || time - aim.at > keepLast);
  if (blind) {
    // Down the mirror column from 60 m over the ground, 60 m over 60, or 60 m over 120, in turn.
    aim = { x: state.mirrorX, y: [1, 60, 120][state.blind % 3], vx: 0, vy: 0, at: time };
  }
  if (time - state.released < (t ? gap : blindGap)) return;
  // One bay per tick, round robin, so the script stays small.
  for (let i = 0; i < state.bays.length; i++) {
    const tag = state.bays[(state.next + i) % state.bays.length];
    if (!(get(tag, 'ready') > 0)) continue;
    const msg = { x: aim.x, y: aim.y, vx: t ? aim.vx : 0, vy: t ? aim.vy : 0, arc: !blind && aim.y > state.home.y + high ? 0 : 1 };
    if (blind) state.blind++;
    if (t) msg.id = t.id;
    send(tag + get(tag, 'built'), msg);
    set(tag, 'release', 1);
    state.released = time;
    state.next = (state.next + i + 1) % state.bays.length;
    return;
  }
}
