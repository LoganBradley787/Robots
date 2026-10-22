// The pilot of titan-bastion: a ground fortress that never moves. No keys. One script runs everything, so the
// big parts list is handed over once a tick.
// - Hiding: two 1 by 1 bays near the core build jammer pods; a held pod is lit, one bay at a time, so the core is
//   always inside a bubble and no sensor outside sees the fortress. Its radars stand on the end masts, outside.
// - Darts: every dart bay lets its copy go as soon as it is built, at the main enemy. Every dart flies at that
//   robot's core, so they dig on one spot.
// - The main enemy (titan-darts, 2026-10, Logan): picked from what the radars report, never by id: the heaviest
//   enemy with a live core of `mainMass` kg or more (lighter ones, darts and pods, are the turrets' work), kept while
//   it is seen unless one twice as heavy shows up, and given up the moment it dies. A robot that dies stays in the
//   radars' view as debris (no live core), so nothing more goes to its spot. One that vanished alive (into a
//   jammer's bubble or smoke, most likely) has its last place kept `memory` s and darts go there; then it is
//   forgotten. Only while it has never seen an enemy at all does it fire blind: one dart every `blindGap` s, over the
//   top onto the mirror of its own start (a titan hidden from the first second starts about there), down the whole
//   column. Otherwise the darts wait in their bays for a target.
// - Hidden enemies (titans v2, 2026-10): a main enemy that vanished alive (most likely into its own jammer bubble)
//   is not forgotten after `memory` s any more. Two clues say where it is now, both from what the radars see:
//   * where our own darts end early (`ends`): a dart that stops being seen short of the point it was sent to,
//     near the guess, either blew up on something there, was blasted by its guns, or flew into its bubble. All
//     three are next to it. One that ends at its point (it hit the ground there) or past it (its fuse) says nothing:
//     counted, those made the guess chase its own darts' craters.
//   * where new enemy robots first show up (`origins`): darts and drones let go from its bays.
//   * where new debris heavier than a dart first shows up far from us (`debris`): a piece our darts broke off it.
//   Darts go round the middle of the recent debris, else origins, else ends (the least sure: a dart blasted by its
//   guns ends short of it), else its last place, in a sweep of heights and sides (`sweep` m apart; a hull in the
//   bubble is hit by whichever line crosses it). Measured against the hive: the ends alone put the guess 60 m under
//   it, where its turrets blast the darts. The darts arm on the way (see the guide), so
//   a hull they run into in the bubble is hit, seen or not. One seen dead is forgotten at once, as before.
// - Sandbox (titans v2, 2026-10): darts sent blind onto the mirror of its own start only in a match (`arena`); in an
//   open world it waits for its radars. After a win it keeps watching, and the next enemy with a live core is the
//   new main one.
// - A way in (titans v2, 2026-10): every `lookEvery` s it looks at a big main enemy (`wayParts` parts or more) from
//   eight sides, `look` m out, and asks how much of it stands between each side and its core (`scan` with `from`:
//   the summed health of the parts on that line). Most titans face their thick side to the enemy and keep their soft
//   parts behind, so the thinnest side is often the back. When that side is clearly thinner than the way the darts
//   come down anyway (from above, on our side), the darts are sent with `via` points: over the robot's top, down
//   behind it, and in level on that side. Only against a robot standing about still (`wayStill`): the way round
//   takes 15 s and the dart cannot be told where the robot went meanwhile (measured: against the juggernaut on the
//   move the darts came down 400 m from it).
// - Turrets: the rotators with guns on the tower's top each point at a near robot of the other side (darts and
//   small fliers first come first), ahead of it by the shell's flight and up by its fall, and blast while on
//   target with nothing of ours on the gun's sight.
// - Anchors: grapples in the floor, cast down at the ground once it rests. The ropes hold the mesa where it stands
//   against a push toward the arena's edge. One that lost its rope is cast again.
const anchors = param('anchors', 0, { min: 0, max: 200 }); // how many anchors the floor holds (the generator sets it)
const anchorAt = param('anchorAt', 30, { min: 2, max: 600 }); // tick of the first cast
const recast = param('recast', 60, { min: 10, max: 6000 }); // ticks between two tries for an anchor with no rope
const mainMass = param('mainMass', 30, { min: 0, max: 100000 }); // kg: the main enemy is never lighter (darts, pods)
const high = param('high', 15, { min: -100, max: 300 }); // m over the base: targets above this get a straight dart, the rest an arc
const gap = param('gap', 0.05, { min: 0, max: 5 }); // s between two bays letting go
const overlap = param('overlap', 2.6, { min: 0.5, max: 5 }); // s between one jammer bay's pod lighting and the other's
const burn = param('burn', 5.1, { min: 1, max: 10 }); // s after lighting a pod its bay is cleared (a pod jams 5 s)
const blindGap = param('blindGap', 0.7, { min: 0.05, max: 30 }); // s between darts sent blind
const memory = param('memory', 15, { min: 0, max: 120 }); // s a main enemy that vanished alive is remembered and darts go to its last place
const lostAt = param('lostAt', 900, { min: 50, max: 2000 }); // m: one that vanished further off went out of the radars' reach and is forgotten
const originKeep = param('originKeep', 25, { min: 1, max: 300 }); // s an enemy robot's first sighting counts as a clue to where a hidden one is
const originAfter = param('originAfter', 3, { min: 0, max: 60 }); // s into the match before first sightings count (at the start everything is new)
const debrisMass = param('debrisMass', 12, { min: 0, max: 10000 }); // kg: new debris at least this heavy (more than a dart) far off is a clue
const sweep = param('sweep', 30, { min: 1, max: 200 }); // m between the lines of the sweep round a hidden enemy's last place
const endNear = param('endNear', 250, { min: 10, max: 1000 }); // m: a dart of ours that ends this close to the guess is a clue
const maxFlying = param('maxFlying', 40, { min: 1, max: 1000 }); // darts in flight at most: each runs a script, and 90 at once against a hidden mirage made the tick much dearer
const hiddenGap = param('hiddenGap', 1.5, { min: 0.05, max: 30 }); // s between darts to a hidden enemy's last place, with no fresher clue
const debug = param('debug', 0, { min: 0, max: 1 }); // 1 logs the way in and the hidden enemy's guess
const wayParts = param('wayParts', 300, { min: 1, max: 100000 }); // parts: a main enemy this big gets a way in picked
const lookEvery = param('lookEvery', 3, { min: 0.5, max: 60 }); // s between two looks for the way in
const look = param('look', 150, { min: 20, max: 500 }); // m from its core the eight sides are looked from
const wayGain = param('wayGain', 0.7, { min: 0.05, max: 1 }); // the way in is used when its cover is under this share of the usual way's
const inLen = param('inLen', 70, { min: 20, max: 300 }); // m: the last straight run in starts this far from its core
const wayStill = param('wayStill', 4, { min: 0, max: 100 }); // m/s: the way in is only for a robot slower than this (a dart takes 15 s round, and cannot be told where it went)
const overTop = param('overTop', 80, { min: 0, max: 300 }); // m over its highest part the darts pass on their way round
const reach = param('reach', 280, { min: 10, max: 300 }); // m: turrets blast within this
const track = param('track', 450, { min: 10, max: 1000 }); // m: turrets point at things within this
const turnGain = param('turnGain', 8, { min: 0.1, max: 50 }); // rotator turn rate per radian off the aim

function setup() {
  state.bays = [];
  state.turrets = [];
  for (const p of parts) {
    if (p.type === 'fabbay') {
      const tag = p.tags.find((t) => t.length === 2 && t.charAt(0) === 'd');
      if (tag !== undefined) state.bays.push(tag);
    } else if (p.type === 'gun') {
      const tag = p.tags.find((t) => t.slice(-4) === '.gun');
      // The part object is the same every tick, updated in place: keep it to read the gun's place and sight.
      if (tag !== undefined) state.turrets.push({ gun: p, gunTag: tag, rotTag: tag.slice(0, -4) + '.rot' });
    }
  }
  state.home = { x: self.pos.x, y: self.pos.y };
  state.mirrorX = -self.pos.x;
  state.blind = 0;
  state.last = null; // the main enemy: { x, y, vx, vy, id, at, d }, its last place while seen, kept a while once it vanishes
  state.everSeen = false; // whether any enemy that could be the main one was ever seen
  state.hidden = null; // the main enemy that vanished alive: { x, y, id } of its last place, kept until it is seen again or dead
  state.known = {}; // ids of enemy robots seen so far, to tell a new one
  state.origins = []; // { x, y, at }: where new enemy robots were first seen, newest last
  state.debris = []; // { x, y, at }: where new heavy debris first showed up far from us, newest last
  state.ends = []; // { x, y, at }: where our darts stopped being seen near the guess, newest last
  state.darts = {}; // our darts in flight by contact id: { x, y, f } (last place, the frame it was seen)
  state.guess = null; // the last guess at a hidden enemy, for telling which dart ends count
  state.sweepK = 0;
  state.way = null; // the way in for the main enemy: { id, via } (points from its core), or null for the usual arc
  state.look = null; // the look in progress: { id, k, cover: [], top }
  state.lit = -100;
  state.jbays = [
    { tag: 'jl', lit: -1, wait: 0 },
    { tag: 'jr', lit: -1, wait: 0 },
  ];
  state.released = -100;
  state.next = 0;
}

/**
 * Jammer pods. A pod is lit while its bay still holds it. A burnt out pod leaves its bay thinking it still holds
 * something, so `burn` s after lighting the bay is told to let go, and it builds the next. The two bays take
 * turns, `overlap` s apart, so one bubble is always up.
 */
function jam() {
  for (const b of state.jbays) {
    if (time < b.wait || !(get(b.tag, 'ready') > 0)) continue;
    if (b.lit < 0) {
      if (time - state.lit < overlap) continue;
      set(b.tag + get(b.tag, 'built'), 'ignite', 1);
      b.lit = time;
      state.lit = time;
    } else if (time - b.lit > burn) {
      set(b.tag, 'release', 1);
      b.lit = -1;
      b.wait = time + 0.3;
    }
  }
}

/**
 * The main enemy: the one it had while still seen (unless one twice as heavy shows up), else the heaviest enemy with a
 * live core of `mainMass` or more (nearest first, so a tie goes to the nearer). Forgets the remembered one when it is
 * seen dead, `memory` s after it vanished, or at once when it vanished out at the radars' edge.
 */
function pick() {
  const mem = state.last;
  let heaviest = null;
  let kept = null;
  let gone = false;
  for (const c of contacts) {
    if (mem && c.id === mem.id && (c.side !== 'enemy' || !c.core)) gone = true;
    if (c.side !== 'enemy' || !c.core || c.mass < mainMass) continue;
    if (mem && c.id === mem.id) kept = c;
    if (!heaviest || c.mass > heaviest.mass) heaviest = c;
  }
  const main = kept && !(heaviest && heaviest.mass > 2 * kept.mass) ? kept : heaviest;
  if (main) {
    state.last = { x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, id: main.id, at: time, d: main.distance };
    state.everSeen = true;
    state.hidden = null;
  } else if (mem && (gone || time - mem.at > memory || mem.d > lostAt)) {
    // Vanished alive near enough to have been hiding, not out at the radars' edge: kept as hidden.
    state.hidden = gone || mem.d > lostAt ? null : { x: mem.x, y: mem.y, id: mem.id };
    state.last = null;
  }
  if (state.hidden) {
    for (const c of contacts) if (c.id === state.hidden.id && (c.side !== 'enemy' || !c.core)) state.hidden = null;
  }
  return main;
}

/**
 * Where new enemy robots first show up (titans v2, 2026-10): a robot hidden in its jammer bubble still lets its darts
 * and drones go from its bays, and they are seen from the start, so where they appear is near it. Every new enemy id
 * with a live core counts, after the first `originAfter` s (at the start every robot is new).
 */
function watchOrigins() {
  for (const c of contacts) {
    if (state.known[c.id]) continue;
    if (c.side === 'enemy' && c.core) {
      state.known[c.id] = 1;
      if (time >= originAfter) state.origins.push({ x: c.pos.x - c.vel.x * 0.3, y: c.pos.y - c.vel.y * 0.3, at: time });
    } else if (c.side === 'none' && c.mass >= debrisMass) {
      state.known[c.id] = 1;
      if (time >= originAfter && Math.hypot(c.pos.x - state.home.x, c.pos.y - state.home.y) > 150) state.debris.push({ x: c.pos.x, y: c.pos.y, at: time });
    }
  }
  while (state.origins.length > 0 && (state.origins.length > 12 || time - state.origins[0].at > originKeep)) state.origins.shift();
  while (state.debris.length > 0 && (state.debris.length > 12 || time - state.debris[0].at > originKeep)) state.debris.shift();
}

/**
 * Our darts in flight (titans v2, 2026-10): friendly robots lighter than `mainMass` out past the roof. One no longer
 * seen ended there (a blast, a hit, or a bubble); near the guess at a hidden enemy, that is a clue to it.
 */
function watchDarts() {
  for (const c of contacts) {
    if (c.side !== 'friend' || c.mass >= mainMass) continue;
    const d = state.darts[c.id];
    if (d) {
      d.x = c.pos.x;
      d.y = c.pos.y;
      d.f = frame;
    } else {
      // New: the dart let go last (one a tick at most), with the point it was sent to.
      state.darts[c.id] = { x: c.pos.x, y: c.pos.y, f: frame, aim: state.sent };
      state.sent = null;
    }
  }
  // Near its last place, not near the latest guess: measured against the hive, ends near the guess walked the guess
  // 120 m off in a minute.
  const g = state.hidden || state.guess;
  state.flying = 0;
  for (const id in state.darts) {
    const d = state.darts[id];
    if (d.f === frame) {
      state.flying++;
      continue;
    }
    delete state.darts[id];
    const a = d.aim;
    // Short of its point: more than 30 m from it, on our side of it.
    const short = a && Math.hypot(d.x - a.x, d.y - a.y) > 30 && (a.x - state.home.x) * (d.x - a.x) + (a.y - state.home.y) * (d.y - a.y) < 0;
    if (g && short && Math.hypot(d.x - g.x, d.y - g.y) < endNear && Math.hypot(d.x - state.home.x, d.y - state.home.y) > 100) state.ends.push({ x: d.x, y: d.y, at: time });
  }
  while (state.ends.length > 0 && (state.ends.length > 10 || time - state.ends[0].at > originKeep)) state.ends.shift();
}

/** The middle of a list of clues, or null with none. */
function middle(o) {
  if (o.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const p of o) {
    x += p.x;
    y += p.y;
  }
  return { x: x / o.length, y: Math.max(1, y / o.length) };
}

/**
 * The way in (titans v2, 2026-10). One scan a tick: the cover of the main enemy's core from each of eight sides, then
 * its highest part. Then the thinnest side against the usual way (the side 45 degrees up toward us), and the `via`
 * points that bring a dart in on it: none for that usual way, else over the top (when the straight line would cross
 * the robot), down to 2.2 runs out and a little up, then the run itself, level for a robot on the ground.
 */
function wayIn(t) {
  if (!t || t.parts < wayParts) {
    state.way = null;
    state.look = null;
    return;
  }
  const L = state.look;
  if (!L || L.id !== t.id) {
    if (state.way && state.way.id === t.id && time - state.way.at < lookEvery) return;
    state.look = { id: t.id, k: 0, cover: [], top: t.pos.y };
    return;
  }
  if (L.k < 8) {
    const a = (L.k * Math.PI) / 4;
    const from = { x: t.pos.x + look * Math.cos(a), y: t.pos.y + look * Math.sin(a) };
    let cover = Infinity;
    if (from.y > 0.5) {
      const r = scan(t.id, { of: ['core'], from, wide: 1 });
      if (r) {
        let best = Infinity;
        for (const p of r) {
          const d = Math.hypot(p.pos.x - t.pos.x, p.pos.y - t.pos.y);
          if (d < best) {
            best = d;
            cover = p.cover;
          }
        }
      }
    }
    L.cover.push(cover);
    L.k++;
    return;
  }
  const r = scan(t.id, { near: { x: t.pos.x, y: t.pos.y + 1e6 }, most: 1 });
  if (r && r.length > 0) {
    L.top = r[0].pos.y;
    L.topX = r[0].pos.x;
  } else L.topX = t.pos.x;
  state.look = null;
  // The usual way: down from above on our side (45 degrees up toward us; straight up when we are under it).
  const toUs = self.pos.x < t.pos.x ? 3 : 1;
  const usual = Math.min(L.cover[toUs], L.cover[2]);
  let k = -1;
  for (let i = 0; i < 8; i++) if (L.cover[i] < Infinity && (k < 0 || L.cover[i] < L.cover[k])) k = i;
  if (debug > 0) log('way: covers ' + L.cover.map((c) => (c < Infinity ? Math.round(c) : '-')).join(' ') + ' top ' + Math.round(L.top) + ' best ' + k);
  if (k < 0 || k === 2 || k === toUs || !(L.cover[k] < wayGain * usual)) {
    state.way = { id: t.id, via: null, at: time };
    return;
  }
  const a = (k * Math.PI) / 4;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const lowY = 3 - t.pos.y; // never under 3 m over the ground
  const run = { x: Math.round(inLen * dx), y: Math.round(Math.max(lowY, inLen * dy)) };
  const via = [];
  // Round the far side: over its highest part (a mast stands where a line over the middle would cross it; darts
  // climbing for the middle broke on the juggernaut's mast), down to 2.2 runs out and a little up, then the run.
  // Sides that face us (the run starts on our side of its core) need none of that.
  if ((t.pos.x + run.x - self.pos.x) * (t.pos.x - self.pos.x) > 0 && Math.abs(run.x) > 1) {
    const back = Math.sign(run.x) * 20; // past the top a little, so the turn down is beyond it
    via.push({ x: Math.round(L.topX - t.pos.x + back), y: Math.round(L.top - t.pos.y + overTop) });
    via.push({ x: Math.round(run.x * 2.2), y: Math.round(Math.max(lowY, run.y) + 55) });
  }
  via.push(run);
  state.way = { id: t.id, via, at: time };
}

/** Casts every anchor that holds no rope. A cast needs a rise, and `fire` is only set on the beat tick. */
function castAnchors() {
  if (anchors < 1 || frame < anchorAt || (frame - anchorAt) % recast !== 0) return;
  for (let i = 1; i <= anchors; i++) {
    const tag = 'an' + i;
    if (!(get(tag, 'hooked') > 0.5)) set(tag, 'fire', 1);
  }
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Turrets: each takes one of the nearest robots of the other side in turn, so they do not all take the same. */
function turrets() {
  const near = [];
  for (const c of contacts) {
    if (c.distance > track) break; // nearest first
    if (c.side === 'enemy') near.push(c);
    if (near.length >= 4) break;
  }
  for (let i = 0; i < state.turrets.length; i++) {
    const t = state.turrets[i];
    const gun = t.gun;
    if (near.length === 0) {
      set(t.gunTag, 'fire', 0);
      set(t.rotTag, 'turn', 0);
      continue;
    }
    const c = near[i % near.length];
    let dx = c.pos.x - gun.pos.x;
    let dy = c.pos.y - gun.pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const flight = d / 300;
    dx += c.vel.x * flight;
    dy += c.vel.y * flight + 4.905 * flight * flight;
    const err = wrap(Math.atan2(dy, dx) - gun.out.aim);
    set(t.rotTag, 'turn', clamp(turnGain * err, -1, 1));
    const side = gun.out.sightSide;
    const ok = d < reach && Math.abs(err) < Math.max(0.012, 1.2 / d) && side !== 1 && side !== 2;
    set(t.gunTag, 'fire', ok ? 1 : 0);
  }
}

function tick() {
  jam();
  castAnchors();
  turrets();
  watchOrigins();
  watchDarts();
  const t = pick();
  wayIn(t);
  let aim = state.last;
  let wait = t ? gap : blindGap;
  let guess = false;
  if (!t && !aim && (state.hidden || !state.everSeen)) {
    // Hidden (or never seen): the middle of where its new robots showed up, else its last place, more slowly.
    const o = middle(state.debris) || middle(state.origins) || middle(state.ends);
    const h = o || state.hidden;
    if (h) {
      // The sweep: a 3 by 5 grid of points round the middle, in turn: three heights round it and one on the ground
      // under it (no heights for one on the ground). Measured: the mirage, hidden, came down to the ground while
      // the darts kept looking for it in the air.
      const k = state.sweepK % 15;
      const dx = ((k % 3) - 1) * 2 * sweep;
      const row = Math.floor(k / 3);
      const y = h.y <= 30 || row === 4 ? 1 : h.y + (row - 1.5) * sweep;
      aim = { x: h.x + dx, y: Math.max(1, y), vx: 0, vy: 0, at: time };
      // With a clue, as fast as for a robot in view; with only its last place, slower.
      wait = o ? gap : hiddenGap;
    }
    guess = aim !== null;
    if (guess) state.guess = { x: aim.x, y: aim.y };
    if (debug > 0 && guess && frame % 300 === 0) log('guess ' + Math.round(aim.x) + ',' + Math.round(aim.y) + ' from ' + state.debris.length + ' debris, ' + state.origins.length + ' origins, ' + state.ends.length + ' ends');
  }
  // Blind fire onto the mirror of its own start: only in a match, and only while it has never seen an enemy.
  const blind = !t && !aim && !state.everSeen && arena !== null && arena !== undefined;
  // Nothing seen, remembered or guessed: nothing to fire at.
  if (!t && !aim && !blind) return;
  if (!t && aim && !guess) {
    // Vanished alive: where it was last seen, carried on by its speed for a moment.
    const age = Math.min(time - aim.at, 2);
    aim = { x: aim.x + aim.vx * age, y: Math.max(1, aim.y + aim.vy * age), vx: 0, vy: 0, at: aim.at };
  }
  if (blind) {
    // Over the top onto the mirror column: from 60 m over the ground, or from 60 m over 150 and on down.
    aim = { x: state.mirrorX, y: state.blind % 2 === 0 ? 1 : 150, vx: 0, vy: 0, at: time };
  }
  if (time - state.released < wait || state.flying >= maxFlying) return;
  // One bay per tick, round robin.
  for (let i = 0; i < state.bays.length; i++) {
    const tag = state.bays[(state.next + i) % state.bays.length];
    if (!(get(tag, 'ready') > 0)) continue;
    const msg = { x: aim.x, y: aim.y, vx: t ? aim.vx : 0, vy: t ? aim.vy : 0, arc: !blind && aim.y > state.home.y + high ? 0 : 1 };
    if (t) msg.id = t.id;
    if (t && state.way && state.way.id === t.id && state.way.via && Math.hypot(t.vel.x, t.vel.y) < wayStill) msg.via = state.way.via;
    if (blind) state.blind++;
    if (guess) state.sweepK++;
    state.sent = { x: aim.x, y: aim.y };
    send(tag + get(tag, 'built'), msg);
    set(tag, 'release', 1);
    state.released = time;
    state.next = (state.next + i + 1) % state.bays.length;
    return;
  }
}
