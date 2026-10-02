// Walker gait (Batch): D and A walk right and left, W stands it taller and S crouches it. Four legs on rails: each leg is a
// horizontal piston (`drive`, a carriage sliding along the body, three armor plates on its far side to weigh it down)
// carrying a vertical piston (`lift`) that stands a column of armor plates on the ground. The legs walk in two groups (the
// 1st and 3rd along the robot, then the 2nd and 4th), a trot. One half step:
//   - the standing group's carriages draw back at a steady speed: the feet grip the ground, so the body goes forward;
//   - the swinging group draws its feet up, slides its carriages forward on the rail, and puts its feet down again.
// Then the groups swap, so there is always a group pushing. A piston's own motor is a spring, a damper, and an integral
// term that learns the load, and it only stays steady when its head weighs at least a fifth of what it pushes against
// (that is why every leg is armor plates: light heads made the body bounce off the ground). Left and right come from
// where the parts are (the plates on a carriage lie on the side it slides toward), not from their tags, so it walks
// deployed flipped too. `state.want` is the direction (1 right, -1 left, 0 stand); the callers set it.
// W and S use the lift pistons' whole stroke: from a foot's lift (`raise`, so it can still step) to all 2 m, a meter
// over where it starts, at `heightSpeed`. Logan: "W and S seem to do nothing": they moved it 0.6 m at 0.5 m/s and said
// nothing. The key list goes to the status at the start, and how tall it stands each time W or S is let go.
const stand0 = param('stand', 1, { min: 0.3, max: 1.6 }); // m the lift pistons are extended while standing (the body's height over the lowest it can go)
const raise = param('raise', 0.4, { min: 0.1, max: 1.5 }); // m a swinging foot is drawn up
const used = param('used', 2, { min: 0.5, max: 2 }); // m of the drive pistons' stroke a step uses
const liftSpeed = param('liftSpeed', 0.8, { min: 0.1, max: 1 }); // share of the pistons' top speed for lifting and lowering feet
const fwdSpeed = param('fwdSpeed', 0.85, { min: 0.1, max: 1 }); // share of the pistons' top speed for the swing stroke
const upSpeed = param('upSpeed', 0.4, { min: 0.1, max: 1 }); // share of the pistons' top speed for standing up from the ground
const heightSpeed = param('heightSpeed', 0.8, { min: 0.1, max: 1.5 }); // m/s the body rises on W and sinks on S
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
  log('keys: D walk right, A walk left, W stand taller, S crouch, G turrets on or off');
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
  state.want = (keys.down('d') ? 1 : 0) - (keys.down('a') ? 1 : 0);
  if (keys.down('w')) state.stand = Math.min(STROKE, state.stand + heightSpeed * dt);
  if (keys.down('s')) state.stand = Math.max(raise, state.stand - heightSpeed * dt);
  if (keys.released('w') || keys.released('s')) {
    const at = state.stand >= STROKE ? ', as tall as it goes' : state.stand <= raise ? ', as low as it can still step' : '';
    log('legs out ' + state.stand.toFixed(1) + ' of ' + STROKE + ' m' + at);
  }
  walk();
}
