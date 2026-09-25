// Hover: hold a height. W and S move the height, A and D lean the drone to fly sideways.
// H turns the script off and on. The propellers are off auto controls, so this script owns them.
// Exact sensors make this simple: no estimating, just feedback on the real height and speed.

const climb = param('climb', 3, { min: 0.5, max: 10 }); // m/s the target height moves while W or S is held
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const lean = param('lean', 0.35, { min: 0, max: 1 }); // radians of lean with A or D

function setup() {
  state.target = self.pos.y;
  // Throttle that just holds the weight, from the robot's mass and its propellers; learned more exactly below.
  const props = parts.filter((p) => p.type === 'propeller').length;
  state.base = props > 0 ? clamp((self.mass * 9.81) / (props * lift), 0, 1) : 0.5;
}

function tick() {
  if (keys.down('w')) state.target += climb * dt;
  if (keys.down('s')) state.target -= climb * dt;

  // Height: push toward the target, brake vertical speed, and slowly learn the throttle that hovers.
  const err = state.target - self.pos.y;
  state.base = clamp(state.base + 0.1 * err * dt, 0, 1);
  set('propeller', 'throttle', clamp(state.base + 0.15 * err - 0.25 * self.vel.y, 0, 1));

  // Lean: A and D tilt the drone; with neither held it leans against its sideways speed to stop.
  let want = clamp(0.08 * self.vel.x, -lean, lean);
  if (keys.down('a')) want = lean;
  if (keys.down('d')) want = -lean;
  const turn = 3 * (want - self.angle) - 1.5 * self.angVel; // counterclockwise positive
  set('gyro', 'spin', clamp(-turn, -1, 1)); // the gyro's spin is clockwise positive
}
