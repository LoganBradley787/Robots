// Pilot for the enemy walker (Batch): no keys, it runs from deploy. It stands up, then walks the gait of `walker.gait.js`
// toward the nearest robot on the other side its radar tracks (lighter than `minMass` kg, a missile, is not followed)
// until it is `range` meters away sideways, then stands and lets the turrets (`enemy-walker.turrets.js`) shoot. It walks
// either way, so deployed flipped it works; its armor plates are on the front, so it wants to be deployed facing the
// enemy. It cannot see the ground: stuck against a box (asking to walk and not moving for `stuckTime` s), it stands still
// for `rest` s and tries again. A walking gait, about 0.8 m/s: it is a slow fortress, and what it fights comes to it.
// Gait (below the AI): four legs on rails. Each leg is a horizontal piston (`drive`, a carriage sliding along the body,
// three armor plates on its far side to weigh it down) carrying a vertical piston (`lift`) that stands a column of armor
// plates on the ground. The legs walk in two groups (the 1st and 3rd along the robot, then the 2nd and 4th), a trot: the
// standing group's carriages draw back at a steady speed (the feet grip, so the body goes forward) while the swinging
// group draws its feet up, slides forward on the rail, and puts them down; then the groups swap.
const range = param('range', 120, { min: 10, max: 1000 }); // m sideways from its target where it stops
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (missiles) are not followed
const stuckTime = param('stuckTime', 8, { min: 1, max: 60 }); // s of walking without moving before it gives up for a while
const rest = param('rest', 5, { min: 1, max: 60 }); // s it stands still when it gave up
const stand0 = param('stand', 1, { min: 0.3, max: 1.6 }); // m the lift pistons are extended while standing (the body's height over the lowest it can go)
const raise = param('raise', 0.4, { min: 0.1, max: 1.5 }); // m a swinging foot is drawn up
const used = param('used', 2, { min: 0.5, max: 2 }); // m of the drive pistons' stroke a step uses
const liftSpeed = param('liftSpeed', 0.8, { min: 0.1, max: 1 }); // share of the pistons' top speed for lifting and lowering feet
const fwdSpeed = param('fwdSpeed', 0.85, { min: 0.1, max: 1 }); // share of the pistons' top speed for the swing stroke
const upSpeed = param('upSpeed', 0.4, { min: 0.1, max: 1 }); // share of the pistons' top speed for standing up from the ground
const STROKE = 2; // both kinds of piston, m
const TOP = 1.5; // the pistons' top speed, m/s
const tLift = raise / (liftSpeed * TOP) + 0.1; // s to draw the swinging feet up
const tLower = raise / (liftSpeed * TOP) + 0.15; // s to put them down
const half = tLift + used / (fwdSpeed * TOP) + 0.1 + tLower; // s per half step: the swing must fit in the time the other group draws back

function setup() {
  state.stand = stand0;
  state.up = false;
  state.active = false;
  state.want = 0;
}

/** Which way a carriage slides on its rail (+1 toward +x): the way its shoe plates lie from it (tags do not flip, positions do). */
function shoeSide(d) {
  let best = null;
  for (const p of parts) {
    if (!p.tags.includes('shoe')) continue;
    if (!best || Math.abs(p.pos.x - d.pos.x) + 5 * Math.abs(p.pos.y - d.pos.y) < Math.abs(best.pos.x - d.pos.x) + 5 * Math.abs(best.pos.y - d.pos.y)) best = p;
  }
  return best && best.pos.x < d.pos.x ? -1 : 1;
}

/** Legs by position along the robot, left to right: [{ drive, lift, ex }] (ex: +1 if the carriage slides toward +x). */
function legs() {
  const drives = parts.filter((p) => p.tags.includes('drive')).sort((a, b) => a.pos.x - b.pos.x);
  const lifts = parts.filter((p) => p.tags.includes('lift'));
  const out = [];
  for (const d of drives) {
    let best = null;
    for (const l of lifts) if (!best || Math.abs(l.pos.x - d.pos.x) < Math.abs(best.pos.x - d.pos.x)) best = l;
    if (best && Math.abs(best.pos.x - d.pos.x) < 4) out.push({ drive: d, lift: best, ex: shoeSide(d) });
  }
  return out;
}

const pos = (p) => (p.out.position || 0) * STROKE;

/** Sets a piston's rate to head for `target` meters, at most `frac` of its top speed. */
function moveTo(p, target, frac) {
  set(p.id, 'extend', clamp(6 * (target - pos(p)), -frac, frac));
}

/** Where a leg's carriage is (m out along its rail) at the front of its stroke when walking toward d, and at the rear. */
const front = (leg, d) => (d * leg.ex > 0 ? used : 0);

/** One tick of walking toward `state.want` (1 right, -1 left, 0 stand still). */
function walk() {
  const all = legs();
  if (all.length === 0) return;
  const stand = state.stand;
  if (!state.up) {
    // Off the ground first, slowly: four pistons take the weight.
    let done = true;
    for (const l of all) {
      moveTo(l.lift, stand, upSpeed);
      set(l.drive.id, 'extend', 0);
      if (Math.abs(pos(l.lift) - stand) > 0.02) done = false;
    }
    if (done) state.up = true;
    return;
  }
  const want = Math.sign(state.want || 0);
  if (state.active && time - state.t0 >= half) state.active = false;
  if (!state.active && want !== 0) {
    // A half step starts: the group whose carriages are farthest forward stands and draws back.
    const score = [0, 0];
    const count = [0, 0];
    all.forEach((l, i) => {
      score[i % 2] += Math.abs(pos(l.drive) - front(l, want));
      count[i % 2]++;
    });
    const a = count[0] ? score[0] / count[0] : 1e9;
    const b = count[1] ? score[1] / count[1] : 1e9;
    state.stanceGroup = a <= b ? 0 : 1;
    state.d = want;
    state.t0 = time;
    state.active = true;
  }
  if (!state.active) {
    for (const l of all) {
      moveTo(l.lift, stand, liftSpeed);
      set(l.drive.id, 'extend', 0);
    }
    return;
  }
  const tau = time - state.t0;
  const d = state.d;
  all.forEach((l, i) => {
    if (i % 2 === state.stanceGroup) {
      // Standing: feet down, carriages draw back at the speed that fills the half step.
      moveTo(l.lift, stand, liftSpeed);
      moveTo(l.drive, used - front(l, d), used / half / TOP);
    } else if (tau < tLift) {
      moveTo(l.lift, stand - raise, liftSpeed);
      set(l.drive.id, 'extend', 0);
    } else if (tau < half - tLower) {
      moveTo(l.lift, stand - raise, liftSpeed);
      moveTo(l.drive, front(l, d), fwdSpeed);
    } else {
      moveTo(l.lift, stand, liftSpeed);
      set(l.drive.id, 'extend', 0);
    }
  });
}

function tick() {
  const target = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  let want = 0;
  if (target) {
    const dx = target.pos.x - self.pos.x;
    if (Math.abs(dx) > range) want = Math.sign(dx);
    mark(target.pos.x - Math.sign(dx) * range, self.pos.y, 'stop');
  }
  // Pushing against a box it cannot see: no progress for `stuckTime` s of asking to walk, and it stands for a while.
  if (want !== 0 && state.up) {
    if (state.checkAt === undefined || Math.abs(self.pos.x - state.checkX) > 1) {
      state.checkAt = time;
      state.checkX = self.pos.x;
    } else if (time - state.checkAt > stuckTime) {
      state.restUntil = time + rest;
      state.checkAt = undefined;
    }
  } else state.checkAt = undefined;
  if (time < (state.restUntil || -1)) want = 0;
  state.want = want;
  walk();
}
