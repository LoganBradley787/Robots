// Pilot for the enemy factory (Batch): a ground base with fabricator bays. No keys, it runs from deploy. It never
// moves; all it does is let each copy go at a tracked enemy as soon as its bay has finished it (the bay's build time
// is the pace, as for the fab drones).
// - Bays: every fabricator bay on the robot with a tag starting `msl-` (makes a missile: point, speed, id, and arc in
//   the message) or `bmb-` (makes a drone bomb: only the id is read). The tag is also the copy's scope: `msl-a` builds
//   `msl-a1`, `msl-a2`, ... (the bay's `built` output counts them).
// - Target: the nearest robot on the other side the radar tracks (10 kg or more, so not missiles) inside the copy's
//   range (`missileRange`, `bombRange`: a drone bomb's cell and core hold about 20 s of flight). A target that already
//   has `focus` copies sent in the last `flight` s is left for the next nearest, so a volley does not all go into one
//   car that dies with the first; when every target is covered it takes the nearest anyway.
// - Arc: over the top onto anything not more than `high` m above the base, and past a friendly robot within
//   `clearance` m of the line to the target; straight in (after the climb) at a target well above it.
// - Pace: it waits `settle` s after it first tracks something, and at least `gap` s between two bays letting go, so two
//   copies do not leave side by side on the same tick. Not while tipped over more than `level` degrees (a bay points
//   the way the base does).

const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (missiles) are not worth a copy
const missileRange = param('missileRange', 800, { min: 20, max: 1000 }); // m: further than this a missile bay holds fire
const bombRange = param('bombRange', 450, { min: 20, max: 1000 }); // m: further than this a drone bomb bay holds fire
const minRange = param('minRange', 20, { min: 0, max: 500 }); // m: closer than this it holds fire
const focus = param('focus', 3, { min: 1, max: 30 }); // copies sent at one target within `flight` s before it takes another
const flight = param('flight', 8, { min: 1, max: 60 }); // s a sent copy counts as still on its way
const high = param('high', 8, { min: -100, max: 100 }); // m: a target more than this far above the base gets a straight shot, the rest an arc
const clearance = param('clearance', 20, { min: 0, max: 100 }); // m: a friendly robot this close to the line to the target makes it an arc shot
const settle = param('settle', 1, { min: 0, max: 30 }); // s it holds fire after it first tracks a robot
const gap = param('gap', 0.5, { min: 0, max: 10 }); // s between two bays letting go
const level = (param('level', 15, { min: 1, max: 90 }) * Math.PI) / 180; // launches only within this many degrees of level

function setup() {
  state.bays = [];
  for (const p of parts) {
    if (p.type !== 'fabbay') continue;
    const tag = p.tags.find((t) => t.startsWith('msl-') || t.startsWith('bmb-'));
    if (tag !== undefined) state.bays.push({ tag, missile: tag.startsWith('msl-') });
  }
  state.sent = {}; // target id -> the times a copy was sent at it
  state.lastRelease = -Infinity;
}

/** A friendly robot (10 kg or more) within `clearance` meters of the line from the base to `t`. */
function friendInWay(t) {
  const lx = t.pos.x - self.pos.x;
  const ly = t.pos.y - self.pos.y;
  const l2 = Math.max(1, lx * lx + ly * ly);
  return contacts.some((c) => {
    if (c.side !== 'friend' || c.mass < minMass) return false;
    const fx = c.pos.x - self.pos.x;
    const fy = c.pos.y - self.pos.y;
    const u = (fx * lx + fy * ly) / l2;
    return u > 0 && u < 1 && Math.abs(fx * ly - fy * lx) / Math.sqrt(l2) < clearance;
  });
}

/** Copies sent at this robot in the last `flight` seconds. */
function inFlight(id) {
  const list = state.sent[id];
  if (!list) return 0;
  while (list.length > 0 && time - list[0] > flight) list.shift();
  return list.length;
}

/** The nearest tracked enemy in `range` not yet covered by `focus` copies, else the nearest one. */
function pick(range) {
  let first = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < minMass || c.distance < minRange || c.distance > range) continue;
    if (inFlight(c.id) < focus) return c;
    if (!first) first = c;
  }
  return first;
}

function tick() {
  const tracked = contacts.some((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (!tracked) state.trackedSince = undefined;
  else if (state.trackedSince === undefined) state.trackedSince = time;
  if (!tracked || time - state.trackedSince < settle || Math.abs(self.angle) > level) return;
  for (const bay of state.bays) {
    if (time - state.lastRelease < gap) return;
    if (!(get(bay.tag, 'ready') > 0)) continue;
    const t = pick(bay.missile ? missileRange : bombRange);
    if (!t) continue;
    // The held copy's scope is the bay's tag and its build count (`msl-a3` is the third).
    const scope = bay.tag + get(bay.tag, 'built');
    if (bay.missile) {
      const arc = t.pos.y > self.pos.y + high && !friendInWay(t) ? 0 : 1;
      send(scope, { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc });
    } else {
      send(scope, { id: t.id });
    }
    set(bay.tag, 'release', 1);
    (state.sent[t.id] = state.sent[t.id] || []).push(time);
    state.lastRelease = time;
  }
}
