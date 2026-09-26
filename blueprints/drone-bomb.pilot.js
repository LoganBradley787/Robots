// Drone bomb (M10): a small drone that goes after the nearest robot on the other side and sets its heavy warhead off
// on it. It runs whenever its core is awake: deployed alone it starts at once; carried on something bigger, its core
// sleeps until it is let go, like a missile.
// - Chase: it flies toward where the target will be, at the fastest closing speed it can still brake from over the
//   distance left, so it catches a moving drone without flying past it. Relative to the target, so a target that runs
//   away at full speed is only caught if the drone bomb is faster.
// - Height: it cannot see the ground, so it keeps `above` meters over the target until it is within `close` meters
//   sideways, then comes straight in.
// - Going off: within `proximity` meters of any of the target's parts (from scan), or on a hard hit (its warhead's
//   fuze, live once armed). With nothing tracked it hovers where it is and waits.
// Flying is the enemy drone's hover (time-optimal leaning, balance from its parts), asked for a velocity instead of
// keys. Left and right are worked out from where the propellers are, so it works deployed flipped.

const climb = param('climb', 25, { min: 1, max: 60 }); // m/s, fastest climb or sink it asks for
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const gyroTorque = param('gyroTorque', 40, { min: 0, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const lean = (param('lean', 55, { min: 0, max: 75 }) * Math.PI) / 180; // most it leans, degrees
const steer = param('steer', 0.08, { min: 0.01, max: 0.5 }); // radians of lean per m/s it is off the sideways speed it wants
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its turning or climbing power it plans braking on
const speed = param('speed', 30, { min: 1, max: 80 }); // m/s, fastest it closes on a target
const brake = param('brake', 7, { min: 1, max: 40 }); // m/s^2 it plans to brake at when closing (leaning back and cutting lift)
const lead = param('lead', 1.5, { min: 0, max: 5 }); // most seconds ahead it aims at a moving target
const above = param('above', 6, { min: 0, max: 50 }); // m over the target it keeps until close
const close = param('close', 12, { min: 1, max: 100 }); // m sideways from the target where it comes straight in
const proximity = param('proximity', 1.5, { min: 0.5, max: 4 }); // m from a target part where it goes off
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (missiles) are not worth chasing

function setup() {
  // Armed as soon as it is awake: safe while carried, live once let go (M10).
  set('heavywarhead', 'arm', 1);
  set('warhead', 'arm', 1);
  state.hold = { x: self.pos.x, y: self.pos.y };
}

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
  let right = 0; // lever arms of the propellers right of the center of mass
  let left = 0;
  for (const p of parts) {
    if (p.type !== 'propeller') continue;
    const u = along(p) - cu;
    sum += u;
    split += p.tags.includes('rprop') ? u : -u;
    if (u > 0) right += u;
    else left -= u;
  }
  return { inertia, sum, split, right, left };
}

/** Flies toward a sideways speed `vx` and a climb speed `vy`. */
function fly(vx, vy) {
  const g = 9.81;
  const props = parts.filter((p) => p.type === 'propeller').length;
  const up = props * lift * Math.max(0.3, Math.cos(self.angle));
  const rise = Math.max(0.5, up / self.mass - g);
  const upward = clamp(5 * (vy - self.vel.y), -g, rise);
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

/** Where the warhead is (it leads the way in), or the core if the warhead is gone. */
function nose() {
  const w = parts.find((p) => p.type === 'heavywarhead' || p.type === 'warhead');
  return w ? w.pos : self.pos;
}

/** The target's part closest to the warhead (when scanned), else its core, with the distance from the warhead. */
function aimPoint(t, from) {
  const seen = t.distance < 40 ? scan(t.id) : null;
  let best = { x: t.pos.x, y: t.pos.y, d: Math.hypot(t.pos.x - from.x, t.pos.y - from.y) };
  for (const p of seen || []) {
    const d = Math.hypot(p.pos.x - from.x, p.pos.y - from.y);
    if (d < best.d) best = { x: p.pos.x, y: p.pos.y, d };
  }
  return best;
}

function tick() {
  const target = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (!target) {
    const vx = clamp(0.5 * (state.hold.x - self.pos.x), -speed, speed);
    fly(vx, clamp(0.5 * (state.hold.y - self.pos.y), -climb, climb));
    return;
  }
  state.hold = { x: self.pos.x, y: self.pos.y };
  const from = nose();
  const aim = aimPoint(target, from);
  if (aim.d < proximity) {
    set('heavywarhead', 'detonate', 1);
    set('warhead', 'detonate', 1);
    return;
  }

  // Where to go: the aim point led by the target's velocity (at most `lead` seconds), and high over it until close.
  const rx = aim.x - from.x;
  const ry = aim.y - from.y;
  const dist = Math.hypot(rx, ry);
  const t = Math.min(lead, dist / Math.max(1, speed));
  let gx = rx + target.vel.x * t;
  let gy = ry + target.vel.y * t;
  if (Math.abs(gx) > close) gy = Math.max(gy, target.pos.y + above - from.y);
  const gd = Math.max(0.01, Math.hypot(gx, gy));
  // Closing speed: as fast as it can still brake from over the distance left.
  const closing = Math.min(speed, Math.sqrt(2 * brake * margin * gd));
  const vx = target.vel.x + (gx / gd) * closing;
  const vy = target.vel.y + (gy / gd) * closing;
  fly(clamp(vx, -speed - 20, speed + 20), clamp(vy, -climb, climb));
  mark(from.x + gx, from.y + gy, 'aim');
}
