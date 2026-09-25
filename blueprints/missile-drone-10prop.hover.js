// Hover: hold a height. W and S move the height, A and D lean the drone to fly sideways. H turns it off and on.
// The propellers are off auto controls, so this script owns them. It leans by giving the left propellers (tag lprop)
// and the right ones (tag rprop) different throttle, which turns a wide drone far harder than a gyro can, and it
// slowly learns the trim that holds it level when its weight is off center (after one missile is gone). Its own
// gyro is tagged stab: `gyro` by type would also turn the missiles' gyros while they hang on the rails.

const climb = param('climb', 3, { min: 0.5, max: 10 }); // m/s the target height moves while W or S is held
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const brake = param('brake', 0.04, { min: 0, max: 0.3 }); // radians of lean against each m/s of sideways speed, with A and D let go
const lean = param('lean', 0.7, { min: 0, max: 1.2 }); // radians of lean with A or D (about 40 degrees)

function setup() {
  state.target = self.pos.y;
  // Throttle that just holds the weight, from the robot's mass and its propellers; learned more exactly below.
  const props = parts.filter((p) => p.type === 'propeller').length;
  state.base = props > 0 ? clamp((self.mass * 9.81) / (props * lift), 0, 1) : 0.5;
  state.trim = 0; // left-right throttle difference that holds it level; learned below
}

function tick() {
  if (keys.down('w')) state.target += climb * dt;
  if (keys.down('s')) state.target -= climb * dt;

  // Height: push toward the target, brake vertical speed, and slowly learn the throttle that hovers.
  const err = state.target - self.pos.y;
  if (Math.abs(err) < 1) state.base = clamp(state.base + 0.1 * err * dt, 0, 1);
  // Leaning tips the push sideways: divide by the cosine so its upward part still holds the height.
  const lift = (state.base + 0.15 * err - 0.25 * self.vel.y) / Math.max(0.4, Math.cos(self.angle));

  // Lean: A and D tilt the drone; with neither held it leans against its sideways speed to stop.
  let want = clamp(brake * self.vel.x, -lean, lean);
  if (keys.down('a')) want = lean;
  if (keys.down('d')) want = -lean;
  const off = want - self.angle; // counterclockwise positive
  state.trim = clamp(state.trim + 0.05 * off * dt, -0.3, 0.3);
  // More thrust on the right turns it counterclockwise.
  const diff = clamp(state.trim + 0.5 * off - 0.45 * self.angVel, -0.4, 0.4);
  set('lprop', 'throttle', clamp(lift - diff, 0, 1));
  set('rprop', 'throttle', clamp(lift + diff, 0, 1));
  set('stab', 'spin', clamp(-(3 * off - 1.5 * self.angVel), -1, 1)); // the gyro's spin is clockwise positive
}
