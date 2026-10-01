// The pod of titan-woodpecker: it holds the main core. It lights its jammer pods one after another, so no sensor ever
// sees this titan's main core (a sensor sees no robot whose core is within 30 m of a lit pod). While the rack empties
// it stands on the base; then it lets go of its cradle, climbs, and hovers far behind the base, out of the way of
// anything that comes for the base (a ram, darts flown at where it started).
// The base's own core wakes when the pod leaves, which needs the base to hold no other core: the pod leaves once the
// only cores left are its own and the base's, or at `latest` s whatever is left.
const jamEvery = param('jamEvery', 4.8, { min: 1, max: 5 }); // s between lighting two jammer pods (one lasts 5 s)
const earliest = param('earliest', 1, { min: 0, max: 60 }); // s it stays at least
const latest = param('latest', 5.3, { min: 0, max: 240 }); // s it leaves at the latest (the bays' first darts are ready at 5.7 s)
const wait = param('wait', 1, { min: 0, max: 10 }); // s it waits after the last dart left (late darts pass over the middle)
const back = param('back', 430, { min: 0, max: 580 }); // m behind where it started
const high = param('high', 205, { min: 10, max: 240 }); // m up
const speed = param('speed', 28, { min: 1, max: 60 }); // m/s sideways at most
const maxLean = param('maxLean', 0.5, { min: 0, max: 1.2 }); // rad

function setup() {
  state.homeX = self.pos.x;
  state.dir = self.pos.x < 0 ? -1 : 1; // away from the middle
  state.jam = 0;
  state.nextJam = 0;
  state.left = false;
  // Which propeller tag is on the left now (tags do not flip with the robot).
  state.leftTag = 'pa';
  for (const p of parts) {
    if (p.type === 'propeller' && p.tags.includes('pa')) {
      state.leftTag = p.pos.x < self.pos.x ? 'pa' : 'pb';
      break;
    }
  }
  state.rightTag = state.leftTag === 'pa' ? 'pb' : 'pa';
}

function tick() {
  if (time >= state.nextJam) {
    state.jam++;
    state.nextJam = time + jamEvery;
    set('jam' + state.jam, 'ignite', 1);
  }
  if (!state.left) {
    set('pa', 'throttle', 0);
    set('pb', 'throttle', 0);
    set('pm', 'throttle', 0);
    if (time < earliest) return;
    let coresLeft = 0;
    for (const p of parts) if (p.type === 'core') coresLeft++;
    if (coresLeft > 2 && time < latest) return;
    if (state.emptyAt === undefined) state.emptyAt = time;
    if (time - state.emptyAt < wait && time < latest) return;
    set('cradle', 'fire', 1);
    state.left = true;
    state.leftAt = time;
    return;
  }
  // Hover: this piece's own propellers only (13, 120 N each).
  let lift = 0;
  let arm = 0;
  for (const p of parts) {
    if (p.type !== 'propeller') continue;
    lift += 120;
    arm += 120 * Math.abs(p.pos.x - self.pos.x);
  }
  lift = Math.max(lift, 1e-9);
  arm = Math.max(arm, 1e-9);
  const m = self.mass;
  const gx = state.homeX + state.dir * back;
  // Straight up first, then away.
  const up = time - state.leftAt < 2.5;
  const vyWant = clamp(1.2 * (high - self.pos.y), -6, 14);
  const ay = clamp(2.5 * (vyWant - self.vel.y), -6, 12);
  const vxWant = up ? 0 : clamp(0.4 * (gx - self.pos.x), -speed, speed);
  const ax = clamp(0.8 * (vxWant - self.vel.x), -6, 6);
  const want = clamp(-Math.atan2(ax, 9.81), -maxLean, maxLean);
  const c = Math.max(Math.cos(self.angle), 0.3);
  const base = clamp((m * (9.81 + ay)) / (lift * c), 0, 0.92);
  const inertia = (m * 14 * 14) / 12;
  const w = 3;
  const turn = clamp((inertia * w * w * (want - self.angle) - 2 * inertia * w * self.angVel) / arm, -0.4, 0.4);
  set(state.leftTag, 'throttle', clamp(base - turn, 0, 1));
  set(state.rightTag, 'throttle', clamp(base + turn, 0, 1));
  set('pm', 'throttle', base);
  set('kgyro', 'spin', clamp(-(3 * (want - self.angle) - 1.5 * self.angVel), -1, 1));
}
