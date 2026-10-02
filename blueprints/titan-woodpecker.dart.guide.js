// Guide of every titan-woodpecker dart (the ones standing on the rack and the ones the bays build). Lean on purpose:
// hundreds fly at once, so it never loops over parts.
// - setup() reads the base's message: the target's point and speed, its id, and how far its parts reach from its core
//   (l, r, d, u, so the dart knows where the target's edge is). With no message it stays a dud and flies up and away.
// - It climbs `climb` m straight up, then steers its speed onto the line to where the target will be: it pushes along
//   the line, cancels its speed across the line (no harder than `acrossMax`), and holds itself up against gravity.
// - `top` in the message (a target wider than it is tall): it flies level `over` m above the target and then down
//   to it at a slope of `loft`, so it lands on the roof at a slant: a wide base is thin from above.
// - Round 2, following a target that moves: the dart has a radio and no sensor of its own. The keep's radar sees the
//   whole arena and the radio shares it, so the dart takes the target's real point and speed all the way in. The
//   radio is switched on one tick in `every` (each dart on its own beat) to keep the cost down, and one tick in
//   `everyNear` once it is within `nearDist` m. Between two looks it carries the last point on by its speed.
// - What it follows: the robot it was sent at, else the other side's main robot (the two that start a match are
//   robots 1 and 2), whatever the message said. A sighting is believed however far it is from the point sent at
//   launch: round 1's darts flew to where a rammer had been standing.
// - It arms its heads within `armDist` m of the edge of the real robot (as last seen), or of the point it was sent to
//   when it never saw one, so a shell that finds it on the way only breaks it.
// - It ends itself when it is spent (`life` s, or nearly out of energy) or has flown past its point.
const climb = param('climb', 9, { min: 0, max: 100 }); // m straight up before it turns
const every = param('every', 20, { min: 1, max: 60 }); // ticks between two looks through the radio, far out
const everyNear = param('everyNear', 3, { min: 1, max: 60 }); // the same, close in
const nearDist = param('nearDist', 160, { min: 0, max: 1000 }); // m from the target where it looks more often
const armDist = param('armDist', 30, { min: 1, max: 300 }); // m from the target's edge where the heads arm
const kp = param('kp', 4, { min: 0, max: 50 });
const kd = param('kd', 1.3, { min: 0, max: 50 });
const push = param('push', 30, { min: 1, max: 200 }); // m/s^2 it asks for along the line
const across = param('across', 3, { min: 0, max: 20 }); // 1/s: how hard it cancels speed across the line
const acrossMax = param('acrossMax', 40, { min: 0, max: 200 }); // m/s^2 at most across the line
const over = param('over', 130, { min: 0, max: 240 }); // m above a wide target it aims at most
const loft = param('loft', 0.45, { min: 0, max: 2 }); // m of aim height per m of ground still to cover
const ahead = param('ahead', 1.2, { min: 0.1, max: 5 }); // s of flight it looks ahead along its path
const life = param('life', 12.5, { min: 1, max: 60 }); // s after which it ends itself (a spent dart on the ground still costs a script)

function setup() {
  state.t = null;
  for (const m of inbox) if (m.data && typeof m.data.x === 'number') state.t = m.data;
  state.at = time;
  state.born = time;
  state.y0 = self.pos.y;
  state.a0 = self.angle;
  state.armed = false;
  state.best = Infinity;
  state.beat = Math.floor(random() * 60);
  state.n = 0;
  state.seen = false;
}

function steer(want, full) {
  let err = want - self.angle;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  // A gyro's spin is clockwise positive, the angle counterclockwise positive.
  set('heavygyro', 'spin', clamp(-(kp * err - kd * self.angVel), -1, 1));
  set('booster', 'throttle', Math.abs(err) < 0.9 ? full : 0.3);
}

// The robot to follow among what the radio shares: the one it was sent at, else the other side's main robot.
function sighting(id) {
  let main = null;
  for (const c of contacts) {
    if (c.side !== 'enemy') continue;
    if (c.id === id) return c;
    if (c.id <= 2 && c.core) main = c;
  }
  return main;
}

function tick() {
  const t = state.t;
  state.n++;
  if (!t) {
    // Knocked loose with no target: fly up and away from the base, unarmed.
    set('radio', 'on', 0);
    steer(state.a0, 1);
    return;
  }
  const px = self.pos.x;
  const py = self.pos.y;
  // A look now and then. The radio works the tick after it is switched on.
  if (contacts.length > 0) {
    const c = sighting(t.id);
    if (c) {
      if (t.blind || c.id !== t.id) {
        // First real sighting of a robot the base could not name: a guess at its size, and at it from the side.
        t.id = c.id;
        t.blind = 0;
        t.l = t.r = 20;
        t.d = t.u = 10;
        t.top = 0;
      }
      t.x = c.pos.x;
      t.y = c.pos.y;
      t.vx = c.vel.x;
      t.vy = c.vel.y;
      state.at = time;
      state.seen = true;
    }
  }
  if (py - state.y0 < climb && time - state.born < 1.5) {
    set('radio', 'on', 0);
    steer(state.a0, 1);
    return;
  }
  // Where the target is now, by its last known point and speed (at most 12 s of guessing).
  const age = Math.min(time - state.at, 12);
  const tx = t.x + t.vx * age;
  const ty = t.y + t.vy * age;
  let dx = tx - px;
  let dy = ty - py;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < state.best) state.best = dist;
  if (time - state.born > life || self.energy.stored < 25 || (state.best < 60 && dist > state.best + 120)) {
    set('heavywarhead', 'arm', 1);
    set('heavywarhead', 'detonate', 1);
    return;
  }
  const beat = dist < nearDist ? everyNear : every;
  set('radio', 'on', (state.n + state.beat) % beat === 0 ? 1 : 0);
  if (!state.armed && px > tx - t.l - armDist && px < tx + t.r + armDist && py > ty - t.d - armDist && py < ty + t.u + armDist) {
    set('heavywarhead', 'arm', 1);
    state.armed = true;
  }
  // Lead: aim where the target will be when the dart gets there.
  const rvx = self.vel.x - t.vx;
  const rvy = self.vel.y - t.vy;
  const closing = dist > 1e-6 ? (rvx * dx + rvy * dy) / dist : 0;
  const go = Math.min(dist / Math.max(closing, 60), 6);
  dx += t.vx * go;
  dy += t.vy * go;
  // A wide target: follow a path that runs level at `over` m above it and then down to it at a slope of `loft`,
  // by aiming at the point on that path `ahead` s of flight in front (a dart at full speed turns slowly, so it has to
  // start the bend early). Inside that distance it aims at the target itself.
  if (t.top) {
    const adx = Math.abs(dx);
    const reach = clamp(ahead * Math.sqrt(self.vel.x * self.vel.x + self.vel.y * self.vel.y), 60, 220);
    if (adx > reach) {
      dy += Math.min(loft * (adx - reach), over);
      dx = dx > 0 ? reach : -reach;
    }
  }
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  // Speed across the line (relative to the target), cancelled; a steady push along it; gravity held.
  const lat = rvx * -uy + rvy * ux;
  const fix = clamp(across * lat, -acrossMax, acrossMax);
  const ax = ux * push - fix * -uy;
  const ay = uy * push - fix * ux + 9.81;
  steer(Math.atan2(-ax, ay), 1);
}
