// F fires the missile at the nearest robot on the other side that the radar tracks:
// 1. the turret swings so the missile points at that robot, tilted up by `loft` degrees (a missile leaves the rail slow
//    and sags before its nose comes up, so a level shot scrapes the ground);
// 2. once it points there (or after `wait` seconds), the missile gets the robot's point, speed, and id, and the
//    decouplers let it go on the same tick; it reads the message when it wakes.
// With nothing tracked, F fires at once, straight along the turret. Z and X still aim by hand.
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other missiles) are skipped
const loft = param('loft', 12, { min: 0, max: 45 }) * (Math.PI / 180); // degrees above the line to the robot
const wait = param('wait', 1.5, { min: 0, max: 5 }); // s: fires anyway if the turret has not got there by then
const scope = 'missile-seeker1';

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Where the missile points now: from its thruster to its core. Undefined once it is gone. */
function barrel() {
  const mine = parts.filter((p) => p.tags.indexOf(scope) >= 0);
  const motor = mine.find((p) => p.type === 'thruster');
  const core = mine.find((p) => p.type === 'core');
  if (!motor || !core) return undefined;
  return { x: core.pos.x, y: core.pos.y, angle: Math.atan2(core.pos.y - motor.pos.y, core.pos.x - motor.pos.x) };
}

function fire(t) {
  if (t) send(scope, { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id });
  set('decoupler', 'fire', 1);
  state.aiming = undefined;
}

function tick() {
  const b = barrel();
  if (!b) return;
  const t = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (keys.pressed('f') && state.aiming === undefined) {
    if (!t) return fire(undefined);
    state.aiming = time;
  }
  if (state.aiming === undefined) return;
  if (!t) return fire(undefined);
  const line = Math.atan2(t.pos.y - b.y, t.pos.x - b.x);
  // Up is toward +y whichever way the turret faces.
  const want = line + (Math.cos(line) >= 0 ? loft : -loft);
  const err = wrap(want - b.angle);
  if (Math.abs(err) < 0.01 || time - state.aiming > wait) return fire(t);
  // The rotator's turn is a rate, counterclockwise positive; slow down near the aim so it does not swing past.
  set('rotator', 'turn', clamp(3 * err, -1, 1));
}
