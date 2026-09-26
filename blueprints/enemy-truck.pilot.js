// Pilot for an enemy launcher truck (M10): a wheeled base with a radar and four standing missiles. No keys; it runs
// from deploy.
// - Drive: toward the nearest robot on the other side its radar tracks until it is `range` meters away sideways, then
//   it stops (the wheels brake by asking for the speed it has, the other way). Closer than `tooClose`, it backs off.
//   With nothing tracked it stays put. It cannot see the ground: it only knows it by its own tilt, and stops driving
//   past `tip` degrees.
// - Fire: stopped and nearly level, `settle` seconds after it first tracks something, one missile every `reload`
//   seconds (plus a seeded bit of `jitter`) at the tracked robot sent the fewest so far (nearest first). Over the top
//   onto a ground target, straight in (from underneath, after the climb) at one more than `high` meters above it.

const speed = param('speed', 6, { min: 0.5, max: 20 }); // m/s, fastest it drives
const range = param('range', 150, { min: 20, max: 500 }); // m sideways from its target where it stops to fire
const tooClose = param('tooClose', 40, { min: 0, max: 200 }); // m: closer than this it backs off
const tip = (param('tip', 30, { min: 5, max: 80 }) * Math.PI) / 180; // degrees of tilt where it stops driving
const wheelTop = param('wheelTop', 22.5, { min: 1, max: 100 }); // m/s at wheel speed 1 (the wheel's 50 rad/s at 0.45 m)
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (missiles) are not tracked or shot at
const high = param('high', 8, { min: -100, max: 100 }); // m: a target more than this far above gets a straight shot, the rest an arc
const minRange = param('minRange', 30, { min: 0, max: 500 }); // m: closer than this it holds fire
const maxRange = param('maxRange', 300, { min: 10, max: 1000 }); // m: further than this it holds fire
const still = param('still', 1, { min: 0.1, max: 10 }); // m/s: it only fires this slow or slower
const level = (param('level', 10, { min: 1, max: 90 }) * Math.PI) / 180; // launches only within this many degrees of level
const reload = param('reload', 3, { min: 0.2, max: 60 }); // s between launches
const jitter = param('jitter', 1, { min: 0, max: 10 }); // up to this many seconds more, at random (seeded)
const settle = param('settle', 1.5, { min: 0, max: 30 }); // s it holds fire after it first tracks a robot
const COUNT = 4; // grip k holds missile-up k

function setup() {
  state.lastShot = -Infinity;
  state.wait = jitter * random();
  state.sent = {};
}

/** Launches the next missile at the tracked enemy in range sent the fewest so far (nearest first). */
function fire() {
  let t = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < minMass || c.distance < minRange || c.distance > maxRange) continue;
    if (!t || (state.sent[c.id] || 0) < (state.sent[t.id] || 0)) t = c;
  }
  if (!t) return;
  for (let k = 1; k <= COUNT; k++) {
    if (!(get('grip' + k, 'armed') > 0)) continue;
    const arc = t.pos.y > self.pos.y + high ? 0 : 1;
    send('missile-up' + k, { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc });
    set('grip' + k, 'fire', 1);
    state.sent[t.id] = (state.sent[t.id] || 0) + 1;
    state.lastShot = time;
    state.wait = jitter * random();
    return;
  }
}

function tick() {
  const target = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (!target) state.trackedSince = undefined;
  else if (state.trackedSince === undefined) state.trackedSince = time;

  // The speed it wants: toward the target until in range, away when too close, else stopped.
  let want = 0;
  if (target) {
    const dx = target.pos.x - self.pos.x;
    const d = Math.abs(dx);
    const dir = Math.sign(dx);
    if (d > range) want = dir * Math.min(speed, 0.5 * (d - range));
    else if (d < tooClose) want = -dir * Math.min(speed, 0.5 * (tooClose - d));
  }
  const tipped = Math.abs(self.angle) > tip;
  if (tipped) want = 0;
  // Wheel speed 1 turns the wheels at `wheelTop`; ask for a bit more or less than the speed wanted to get there (and
  // to brake: the wheels only hold back when asked to turn the other way).
  set('wheels', 'speed', tipped ? 0 : clamp(want / wheelTop + 0.3 * (want - self.vel.x), -1, 1));

  const ready = target && time - state.lastShot >= reload + state.wait && time - state.trackedSince >= settle;
  if (ready && Math.abs(self.vel.x) < still && Math.abs(self.angle) < level) fire();
  if (target) mark(target.pos.x - Math.sign(target.pos.x - self.pos.x) * range, self.pos.y, 'stop');
}
