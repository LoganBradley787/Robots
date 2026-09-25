// Hover: hold a height. W and S move the height, A and D lean the drone to fly sideways. H turns it off and on.
// The propellers are off auto controls, so this script owns them. It leans by giving the left propellers (tag lprop)
// and the right ones (tag rprop) different throttle, which turns a wide drone far harder than a gyro can, and it
// works out the split that holds it level when its weight is off center (after one missile is gone). Its own
// gyro is tagged stab: `gyro` by type would also turn the missiles' gyros while they hang on the rails.

const climb = param('climb', 3, { min: 0.5, max: 10 }); // m/s the target height moves while W or S is held
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const lean = param('lean', 0.3, { min: 0, max: 1 }); // radians of lean with A or D

function setup() {
  state.target = self.pos.y;
  // Throttle that just holds the weight, from the robot's mass and its propellers; learned more exactly below.
  const props = parts.filter((p) => p.type === 'propeller').length;
  state.base = props > 0 ? clamp((self.mass * 9.81) / (props * lift), 0, 1) : 0.5;
  state.trim = 0; // left-right throttle difference that holds it level; learned below
}

/**
 * The left-right throttle split that keeps the drone from turning at this throttle: equal throttle turns it when the
 * propellers are not centered on its weight (a missile gone from one side). Worked out from every attached part's
 * mass and position along the body, so it is right the moment the weight shifts.
 */
function balance(throttle) {
  const c = Math.cos(self.angle);
  const s = Math.sin(self.angle);
  const along = (p) => (p.pos.x - self.pos.x) * c + (p.pos.y - self.pos.y) * s;
  let mass = 0;
  let moment = 0;
  for (const p of parts) {
    mass += p.mass;
    moment += p.mass * along(p);
  }
  const center = mass > 0 ? moment / mass : 0;
  let sum = 0;
  let split = 0;
  for (const p of parts) {
    if (p.type !== 'propeller') continue;
    const u = along(p) - center;
    sum += u;
    split += (p.tags.includes('rprop') ? 1 : -1) * u;
  }
  return split !== 0 ? (-throttle * sum) / split : 0;
}

function tick() {
  if (keys.down('w')) state.target += climb * dt;
  if (keys.down('s')) state.target -= climb * dt;

  // Height: push toward the target, brake vertical speed, and slowly learn the throttle that hovers.
  const err = state.target - self.pos.y;
  if (Math.abs(err) < 1) state.base = clamp(state.base + 0.1 * err * dt, 0, 1);
  const throttle = state.base + 0.15 * err - 0.25 * self.vel.y;

  // Lean: A and D tilt the drone; with neither held it leans against its sideways speed to stop.
  let want = clamp(0.08 * self.vel.x, -lean, lean);
  if (keys.down('a')) want = lean;
  if (keys.down('d')) want = -lean;
  const off = want - self.angle; // counterclockwise positive
  // A slow trim mops up what the balance misses.
  state.trim = clamp(state.trim + 0.05 * off * dt, -0.2, 0.2);
  // More thrust on the right turns it counterclockwise.
  const diff = balance(throttle) + state.trim + clamp(0.5 * off - 0.45 * self.angVel, -0.4, 0.4);
  set('lprop', 'throttle', clamp(throttle - diff, 0, 1));
  set('rprop', 'throttle', clamp(throttle + diff, 0, 1));
  set('stab', 'spin', clamp(-(3 * off - 1.5 * self.angVel), -1, 1)); // the gyro's spin is clockwise positive
}
