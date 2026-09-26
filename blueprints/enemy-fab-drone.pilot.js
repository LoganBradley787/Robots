// Pilot for the enemy fab drones (`enemy-fab-drone`, `enemy-bomb-fab-drone`): the enemy drone's pilot
// (`enemy-drone.pilot.js`) with a fabricator bay in place of its four missiles. No keys, it runs from deploy.
// - Track, dodge, and fly: as the enemy drone (a spot `standoff` meters beside and `above` meters over the nearest
//   robot on the other side its radar tracks, home with nothing tracked, dodging missiles about to pass close).
// - Fire: in range, it sends what its bay holds at that robot and lets it go, `settle` seconds after it first tracks
//   it and at most one every `reload` seconds. The message suits a missile (point, speed, id, arc); a drone bomb reads
//   only the id. The bay builds the next by itself (a missile 4.1 s, a drone bomb 7.2 s), so it keeps firing for as
//   long as its batteries last. After letting one go it holds where it was for `hold` seconds, so it does not fly
//   into it while it climbs clear (it did, switching targets just after a drone bomb left).
// - Room: it never climbs with a friendly robot less than `space` meters above it and `width` to either side (what it
//   let go, other drones on its side): a drone bomb with nothing in range waits where it cleared, and one it let go
//   met it as it climbed to a new spot.
// Flying is the hunter drone's hover (time-optimal leaning, balance from its parts, height braking just in time),
// with the AI asking for a sideways speed and a height instead of keys. Left and right are worked out from where the
// propellers are, not their tags, so it works deployed flipped. Only its own propellers (`lprop`, `rprop`) count
// toward its lift: a copy held in the bay may have propellers of its own, asleep.

const climb = param('climb', 10, { min: 0.5, max: 30 }); // m/s, fastest climb or sink it asks for
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const gyroTorque = param('gyroTorque', 40, { min: 0, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const lean = (param('lean', 50, { min: 0, max: 70 }) * Math.PI) / 180; // most it leans, degrees
const steer = param('steer', 0.08, { min: 0.01, max: 0.5 }); // radians of lean per m/s it is off the sideways speed it wants
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its turning or climbing power it plans braking on
const speed = param('speed', 12, { min: 1, max: 40 }); // m/s, fastest it flies sideways to get somewhere
const standoff = param('standoff', 50, { min: 5, max: 300 }); // m to the side of the robot it tracks
const above = param('above', 12, { min: 0, max: 100 }); // m above it
const ceiling = param('ceiling', 30, { min: 0, max: 500 }); // m above where it was deployed it never climbs past (two of these tracking each other would otherwise climb forever)
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots are missiles (dodged, not chased)
const below = param('below', 10, { min: -100, max: 100 }); // m: a target more than this far below gets an arc shot, the rest a direct one
const minRange = param('minRange', 25, { min: 0, max: 500 }); // m: closer than this it holds fire
const maxRange = param('maxRange', 250, { min: 10, max: 1000 }); // m: further than this it holds fire
const level = (param('level', 15, { min: 1, max: 90 }) * Math.PI) / 180; // launches only within this many degrees of level
const reload = param('reload', 3, { min: 0.5, max: 60 }); // s between launches
const jitter = param('jitter', 1, { min: 0, max: 10 }); // up to this many seconds more, at random (seeded), so two drones do not fire in step
const hold = param('hold', 2, { min: 0, max: 10 }); // s it stays where it let one go (dodging still comes first)
const space = param('space', 20, { min: 0, max: 100 }); // m: a friendly robot less than this far above it stops its climb
const width = param('width', 12, { min: 0, max: 100 }); // and less than this far to either side (it is 15 wide)
const settle = param('settle', 1.5, { min: 0, max: 30 }); // s it holds fire after it first tracks a robot
const dodge = param('dodge', 1, { min: 0, max: 1 }); // 0: never dodges
const dodgeAhead = param('dodgeAhead', 2.5, { min: 0.2, max: 10 }); // s ahead it looks for a missile passing close
const dodgeMiss = param('dodgeMiss', 10, { min: 1, max: 50 }); // m: a missile passing closer than this is dodged
const dodgeTime = param('dodgeTime', 1.2, { min: 0.1, max: 5 }); // s it keeps dodging
const dodgeRoom = param('dodgeRoom', 15, { min: 0, max: 200 }); // m above the robot it tracks it needs to dodge down (it cannot see the ground)
const dodgeSpeed = param('dodgeSpeed', 14, { min: 1, max: 40 }); // m/s up or down it dodges at

function setup() {
  state.home = { x: self.pos.x, y: self.pos.y };
  state.lastShot = -Infinity;
  state.wait = jitter * random();
  state.dodgeUntil = -Infinity;
  state.dodgeMove = { vx: 0, vy: 0 };
}

/** One of its own propellers (a copy held in the bay may have its own, asleep). */
const own = (p) => p.type === 'propeller' && (p.tags.includes('lprop') || p.tags.includes('rprop'));

/** The drone as a body that turns: moment of inertia and propeller lever arms, from every part still attached. */
function body() {
  const c = Math.cos(self.angle);
  const s = Math.sin(self.angle);
  const along = (p) => (p.pos.x - self.pos.x) * c + (p.pos.y - self.pos.y) * s;
  const across = (p) => -(p.pos.x - self.pos.x) * s + (p.pos.y - self.pos.y) * c;
  let mass = 0;
  let mu = 0;
  let mv = 0;
  for (const p of parts) {
    mass += p.mass;
    mu += p.mass * along(p);
    mv += p.mass * across(p);
  }
  const cu = mass > 0 ? mu / mass : 0;
  const cv = mass > 0 ? mv / mass : 0;
  let inertia = 0;
  for (const p of parts) inertia += p.mass * ((along(p) - cu) ** 2 + (across(p) - cv) ** 2 + 1 / 6);
  let sum = 0; // equal throttle on every propeller turns it by lift * throttle * sum
  let split = 0; // rprop minus lprop: a throttle difference d turns it by lift * d * split
  let right = 0; // lever arms of the propellers right of the center of mass: all at full is the hardest ccw turn
  let left = 0;
  for (const p of parts) {
    if (!own(p)) continue;
    const u = along(p) - cu;
    sum += u;
    split += p.tags.includes('rprop') ? u : -u;
    if (u > 0) right += u;
    else left -= u;
  }
  return { inertia, sum, split, right, left };
}

/** Flies toward a sideways speed `vx` and a height `height` (or a climb speed `vy` when given). */
function fly(vx, height, vy) {
  const g = 9.81;
  const props = parts.filter(own).length;
  const up = props * lift * Math.max(0.3, Math.cos(self.angle));
  const rise = Math.max(0.5, up / self.mass - g);
  let climbing = vy;
  if (climbing === undefined) {
    const err = height - self.pos.y;
    const stop = err > 0 ? g : rise;
    climbing = Math.sign(err) * Math.min(Math.sqrt(2 * margin * stop * Math.abs(err)), 3 * Math.abs(err), climb);
  }
  const upward = clamp(5 * (climbing - self.vel.y), -g, rise);
  const throttle = clamp((self.mass * (g + upward)) / up, 0, 1);

  // Leaning left (counterclockwise) pushes it left: lean against the sideways speed it is short of.
  const want = clamp(-steer * (vx - self.vel.x), -lean, lean);
  const off = want - self.angle;
  const b = body();
  const ccw = lift * b.right + gyroTorque;
  const cw = lift * b.left + gyroTorque;
  const stopping = off >= 0 ? cw : ccw;
  const spinUp = (margin * stopping) / Math.max(1, b.inertia);
  const spin = Math.sign(off) * Math.min(Math.sqrt(2 * spinUp * Math.abs(off)), 6 * Math.abs(off));
  const torque = clamp((b.inertia * (spin - self.angVel)) / (4 * dt), -cw, ccw);
  const gyro = clamp(torque, -gyroTorque, gyroTorque);
  let base = throttle;
  let diff = 0;
  for (let i = 0; i < 4; i++) {
    diff = b.split !== 0 ? (torque - gyro - lift * base * b.sum) / (lift * b.split) : 0;
    const d = Math.abs(diff);
    base = d >= 0.5 ? 0.5 : clamp(throttle, d, 1 - d);
  }
  set('lprop', 'throttle', clamp(base - diff, 0, 1));
  set('rprop', 'throttle', clamp(base + diff, 0, 1));
  set('stab', 'spin', gyroTorque > 0 ? clamp(-gyro / gyroTorque, -1, 1) : 0); // the gyro's spin is clockwise positive
}

/** A missile that will pass close soon: where it will be relative to the drone when closest, or undefined. */
function threat() {
  let worst;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass >= minMass) continue;
    const rx = c.pos.x - self.pos.x;
    const ry = c.pos.y - self.pos.y;
    const vx = c.vel.x - self.vel.x;
    const vy = c.vel.y - self.vel.y;
    const v2 = vx * vx + vy * vy;
    if (v2 < 1) continue;
    const t = -(rx * vx + ry * vy) / v2; // seconds to its closest pass
    if (t < 0 || t > dodgeAhead) continue;
    const px = rx + vx * t;
    const py = ry + vy * t;
    const miss = Math.hypot(px, py);
    if (miss > dodgeMiss) continue;
    if (!worst || t < worst.t) worst = { t, px, py, vx, vy, miss };
  }
  return worst;
}

function fire(t) {
  if (!(get('bay', 'ready') > 0)) return;
  // Over the top onto a target well below; straight in (from underneath, after the climb) at one level or above.
  const arc = t.pos.y < self.pos.y - below ? 1 : 0;
  // The held copy's scope is the bay's tag and its build count (`bay3` is the third).
  send('bay' + get('bay', 'built'), { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc });
  set('bay', 'release', 1);
  state.lastShot = time;
  state.shotAt = { x: self.pos.x, y: self.pos.y };
  state.wait = jitter * random();
}

function tick() {
  const target = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (!target) state.trackedSince = undefined;
  else if (state.trackedSince === undefined) state.trackedSince = time;

  const danger = dodge > 0.5 ? threat() : undefined;
  if (danger) {
    // Where it can get before the missile passes, each way: climbing and sinking start at once, moving sideways waits
    // for the lean (about half as far). Down only with room below: it cannot see the ground, so it goes by the robot
    // it tracks (usually on the ground). It takes whichever leaves the missile passing furthest away, or stays.
    const t = danger.t;
    const vertical = 0.5 * dodgeSpeed * t;
    const across = 0.25 * dodgeSpeed * t;
    const room = target !== undefined && self.pos.y - target.pos.y > dodgeRoom;
    const options = [
      { vx: 0, vy: 0, dx: 0, dy: 0 },
      { vx: 0, vy: dodgeSpeed, dx: 0, dy: vertical },
      { vx: -dodgeSpeed, vy: 0, dx: -across, dy: 0 },
      { vx: dodgeSpeed, vy: 0, dx: across, dy: 0 },
    ];
    if (room) options.push({ vx: 0, vy: -dodgeSpeed, dx: 0, dy: -vertical });
    let best = options[0];
    let bestGap = -1;
    for (const o of options) {
      const gap = Math.hypot(danger.px - o.dx, danger.py - o.dy);
      if (gap > bestGap) {
        best = o;
        bestGap = gap;
      }
    }
    if (time >= state.dodgeUntil) state.dodgeHeight = self.pos.y;
    state.dodgeMove = best;
    state.dodgeUntil = time + dodgeTime;
  }
  if (time < state.dodgeUntil && (state.dodgeMove.vx !== 0 || state.dodgeMove.vy !== 0)) {
    const m = state.dodgeMove;
    if (m.vy !== 0) fly(0, 0, m.vy);
    else fly(m.vx, state.dodgeHeight);
    return;
  }

  // Never climbs with a friendly robot overhead: what it let go may be waiting there (a drone bomb with nothing in
  // range hovers where it cleared), and climbing to a new spot it flew into one.
  const over = contacts.some((c) => c.side === 'friend' && c.pos.y > self.pos.y && c.pos.y - self.pos.y < space && Math.abs(c.pos.x - self.pos.x) < width);
  const top = (y) => (over ? Math.min(y, self.pos.y) : y);

  if (time - state.lastShot < hold) {
    fly(clamp(0.5 * (state.shotAt.x - self.pos.x), -speed, speed), top(state.shotAt.y));
    mark(state.shotAt.x, state.shotAt.y, 'hold');
    return;
  }

  let goal = state.home;
  if (target) {
    const side = self.pos.x >= target.pos.x ? 1 : -1;
    goal = { x: target.pos.x + side * standoff, y: Math.min(target.pos.y + above, state.home.y + ceiling) };
    const range = Math.hypot(target.pos.x - self.pos.x, target.pos.y - self.pos.y);
    const ready = time - state.lastShot >= reload + state.wait && time - state.trackedSince >= settle + state.wait && Math.abs(self.angle) < level;
    if (range >= minRange && range <= maxRange && ready) fire(target);
  }
  const vx = clamp(0.5 * (goal.x - self.pos.x), -speed, speed);
  fly(vx, top(goal.y));
  mark(goal.x, goal.y, target ? 'hold' : 'home');
}
