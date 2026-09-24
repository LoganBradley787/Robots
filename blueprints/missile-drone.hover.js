// Hover: hold a height. W and S move the height, A and D lean the drone to fly sideways. H turns it off and on.
// The propellers are off auto controls, so this script owns them. It leans by giving the left propellers (tag lprop)
// and the right ones (tag rprop) different throttle, which turns a wide drone far harder than a gyro can, and it
// slowly learns the trim that holds it level when its weight is off center (after one missile is gone).

const climb = param('climb', 3, { min: 0.5, max: 10 }); // m/s the target height moves while W or S is held
const lean = param('lean', 0.3, { min: 0, max: 1 }); // radians of lean with A or D

function setup() {
  state.target = self.pos.y;
  state.base = 0.6; // throttle that just holds the weight; learned below
  state.trim = 0; // left-right throttle difference that holds it level; learned below
}

function tick() {
  if (keys.down('w')) state.target += climb * dt;
  if (keys.down('s')) state.target -= climb * dt;

  // Height: push toward the target, brake vertical speed, and slowly learn the throttle that hovers.
  const err = state.target - self.pos.y;
  if (Math.abs(err) < 1) state.base = clamp(state.base + 0.1 * err * dt, 0, 1);
  const lift = state.base + 0.15 * err - 0.25 * self.vel.y;

  // Lean: A and D tilt the drone; with neither held it leans against its sideways speed to stop.
  let want = clamp(0.08 * self.vel.x, -lean, lean);
  if (keys.down('a')) want = lean;
  if (keys.down('d')) want = -lean;
  const off = want - self.angle; // counterclockwise positive
  state.trim = clamp(state.trim + 0.05 * off * dt, -0.3, 0.3);
  // More thrust on the right turns it counterclockwise.
  const diff = clamp(state.trim + 0.5 * off - 0.45 * self.angVel, -0.4, 0.4);
  set('lprop', 'throttle', clamp(lift - diff, 0, 1));
  set('rprop', 'throttle', clamp(lift + diff, 0, 1));
  set('gyro', 'spin', clamp(-(3 * off - 1.5 * self.angVel), -1, 1)); // the gyro's spin is clockwise positive
}
