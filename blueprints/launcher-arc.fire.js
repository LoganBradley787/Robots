// F fires the missile (the one core on the robot besides its own) at the nearest robot on the other side that the radar tracks:
// 1. the turret swings so the missile points at that robot, tilted up by `loft` degrees (a missile leaves the rail slow
//    and sags before its nose comes up, so a level shot scrapes the ground);
// 2. once it points there (or after `wait` seconds), the missile gets the robot's point, speed, and id, and the
//    decouplers let it go on the same tick; it reads the message when it wakes.
// With nothing tracked, it tilts up by `loft` from where the turret points and fires straight. Z and X still aim by hand.
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other missiles) are skipped
const loft = param('loft', 12, { min: 0, max: 45 }) * (Math.PI / 180); // degrees above the line to the robot
const wait = param('wait', 1.5, { min: 0, max: 5 }); // s: fires anyway if the turret has not got there by then

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** The missile on the rail: the core that is not this robot's own, and the thruster nearest it. */
function missile() {
  let core;
  for (const p of parts) {
    if (p.type !== 'core' || Math.hypot(p.pos.x - self.pos.x, p.pos.y - self.pos.y) < 0.01) continue;
    core = p;
    break;
  }
  if (!core) return undefined;
  let motor;
  let best = Infinity;
  for (const p of parts) {
    const d = p.type === 'thruster' ? Math.hypot(p.pos.x - core.pos.x, p.pos.y - core.pos.y) : Infinity;
    if (d < best) {
      best = d;
      motor = p;
    }
  }
  if (!motor) return undefined;
  return { id: core.id, x: core.pos.x, y: core.pos.y, angle: Math.atan2(core.pos.y - motor.pos.y, core.pos.x - motor.pos.x) };
}

function fire(b, t) {
  if (t) send(b.id, { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id });
  set('decoupler', 'fire', 1);
  state.aiming = undefined;
}

/** `angle` tilted up by `loft`: toward +y whichever way the turret faces. */
function lofted(angle) {
  return angle + (Math.cos(angle) >= 0 ? loft : -loft);
}

function tick() {
  const b = missile();
  if (!b) return;
  const t = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (keys.pressed('f') && state.aiming === undefined) {
    state.aiming = time;
    // With nothing tracked: straight along the turret, tilted up the same way.
    state.straight = lofted(b.angle);
  }
  if (state.aiming === undefined) return;
  const want = t ? lofted(Math.atan2(t.pos.y - b.y, t.pos.x - b.x)) : state.straight;
  const err = wrap(want - b.angle);
  if (Math.abs(err) < 0.01 || time - state.aiming > wait) return fire(b, t);
  // The rotator's turn is a rate, counterclockwise positive; slow down near the aim so it does not swing past.
  set('rotator', 'turn', clamp(3 * err, -1, 1));
}
