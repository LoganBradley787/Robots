// Drone bomb (M10): a small drone that goes after the nearest robot on the other side and sets its heavy warhead off
// on it. It runs whenever its core is awake: deployed alone it starts at once; carried on something bigger, its core
// sleeps until it is let go, like a missile; woken, it climbs straight up at full power `clearDist` meters clear of
// whatever carried it (out of a fabricator bay's walls too), and goes after the robot its carrier names (a message with
// `id`) while it sees it. Its warheads arm the first time it has a target.
// - Chase: it flies toward where the target will be, at the fastest closing speed it can still brake from over the
//   distance left, so it catches a moving drone without flying past it, but never slower than `ram`: it hits, it does
//   not park against its target. Relative to the target, so a target that runs away at full speed is only caught if
//   the drone bomb is faster.
// - Straight in (Logan, after the fab drones): it flies straight at the target's nearest part from whatever side it
//   is on, never with its lowest part below `low` meters over the target's lowest part, so it does not skim the
//   ground it cannot see, and at least `pass` meters over any friendly robot on the way. It never climbs more than
//   `ceiling` over where it started (two drone bombs chasing each other would otherwise climb forever).
// - Going off: when its warhead nearest the target (it may carry several, on any side) comes within `proximity`
//   meters of any of the target's parts (from scan), on a hard hit (a warhead's fuze, live once armed), or after
//   touching the target with any other part for `stuck` seconds (it keeps pushing its warhead in meanwhile). Every
//   warhead is told to go off; armed ones caught in the blast go off too. With nothing tracked it waits where it
//   cleared, or where it last had a target.
// - Swarms: it keeps `space` meters from friendly robots (other drone bombs let go with it), steering away from them,
//   so they come in from different sides and one blast does not set off the rest.
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
const pass = param('pass', 10, { min: 0, max: 50 }); // m it keeps over a friendly robot on its way to the target
const low = param('low', 1, { min: 0, max: 20 }); // m its lowest part stays over the target's lowest part (the ground may be just under it)
const proximity = param('proximity', 1.5, { min: 0.5, max: 4 }); // m from its warhead to a target part where it goes off
const touch = param('touch', 1.3, { min: 0.5, max: 4 }); // m between one of its parts and a target part that counts as touching (touching cells are 1 m apart)
const stuck = param('stuck', 0.4, { min: 0, max: 5 }); // s of touching with its side before it goes off anyway
const ram = param('ram', 3, { min: 0, max: 30 }); // m/s it still closes at when about to hit (below the fuze's 5, so a side bump does not set it off)
const ceiling = param('ceiling', 40, { min: 0, max: 500 }); // m above where it started it never climbs past
const clearWidth = param('clearWidth', 0, { min: 0, max: 100 }); // m sideways from where it was let go before it comes down (a carrier sets its own half width, so they do not dive through its deck)
const clearDist = param('clearDist', 15, { min: 0, max: 50 }); // m it climbs straight up at full power after waking, before it steers or arms
const space = param('space', 7, { min: 0, max: 30 }); // m it keeps from friendly robots (other drone bombs in a swarm), so one blast does not set off the rest
const spread = param('spread', 12, { min: 0, max: 40 }); // m/s it steers away from a friend right next to it (less further out)
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (missiles) are not worth chasing

function setup() {
  // A carrier may name the robot to go after (a message with its `id`), so a swarm spreads over several targets.
  for (const m of inbox) if (m.data && typeof m.data.id === 'number') state.want = m.data.id;
  state.hold = { x: self.pos.x, y: self.pos.y };
  state.startY = self.pos.y;
  state.start = time;
  state.startX = self.pos.x;
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
  const up = Math.max(1, props * lift * Math.max(0.3, Math.cos(self.angle)));
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

/** Its warhead nearest the point (it may carry several, on any side), or its core with none left. */
function nose(x, y) {
  let best = self.pos;
  let bestD = Infinity;
  for (const p of parts) {
    if (p.type !== 'heavywarhead' && p.type !== 'warhead') continue;
    const d = Math.hypot(p.pos.x - x, p.pos.y - y);
    if (d < bestD) {
      best = p.pos;
      bestD = d;
    }
  }
  return best;
}

/**
 * The target's part closest to the warhead (when scanned), else its core, with the distance from the warhead; its
 * lowest part seen (its core when not scanned); and whether any of its own parts touches any part of the target.
 */
function aimPoint(t, from) {
  const seen = t.distance < 40 ? scan(t.id) : null;
  let best = { x: t.pos.x, y: t.pos.y, d: Math.hypot(t.pos.x - from.x, t.pos.y - from.y), touching: false, bottom: t.pos.y };
  let bottom = t.pos.y;
  for (const p of seen || []) {
    bottom = Math.min(bottom, p.pos.y);
    const d = Math.hypot(p.pos.x - from.x, p.pos.y - from.y);
    if (d < best.d) best = { x: p.pos.x, y: p.pos.y, d, touching: false };
  }
  best.bottom = bottom;
  if (seen && best.d < touch + 6) {
    for (const mine of parts) {
      for (const p of seen) {
        if (Math.abs(mine.pos.x - p.pos.x) < touch && Math.abs(mine.pos.y - p.pos.y) < touch && Math.hypot(mine.pos.x - p.pos.x, mine.pos.y - p.pos.y) < touch) best.touching = true;
      }
    }
  }
  return best;
}

function tick() {
  // Just woken (let go by a carrier or a bay, or deployed): straight up at full power, still safe, until it would coast
  // the rest of the way up. It steers from there: braking a climb leaves no push to lean with, so it wasted a second.
  if (!state.cleared) {
    const left = state.startY + clearDist - self.pos.y;
    if (left > 0 && self.vel.y * Math.max(0, self.vel.y) < 2 * 9.81 * left) {
      fly(0, climb);
      return;
    }
    state.cleared = true;
    state.hold = { x: self.pos.x, y: state.startY + clearDist }; // with nothing to chase it waits here, clear
  }
  // The robot it was sent at while it is still seen, else the nearest.
  const target = contacts.find((c) => c.id === state.want && c.side === 'enemy' && c.core) || contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (!target) {
    const vx = clamp(0.5 * (state.hold.x - self.pos.x), -speed, speed);
    fly(vx, clamp(0.5 * (state.hold.y - self.pos.y), -climb, climb));
    return;
  }
  state.hold = { x: self.pos.x, y: self.pos.y };
  // Armed once it has something to go after (M10): safe while carried and while it waits, so one left hovering with
  // nothing to chase does not go off where it lands when its battery runs out.
  set('heavywarhead', 'arm', 1);
  set('warhead', 'arm', 1);
  // The warhead nearest the target leads, aimed at the target's part nearest that warhead.
  const near = aimPoint(target, nose(target.pos.x, target.pos.y));
  const from = nose(near.x, near.y);
  const aim = aimPoint(target, from);
  if (!aim.touching) state.touchSince = undefined;
  else if (state.touchSince === undefined) state.touchSince = time;
  if (aim.d < proximity || (state.touchSince !== undefined && time - state.touchSince >= stuck)) {
    set('heavywarhead', 'detonate', 1);
    set('warhead', 'detonate', 1);
    return;
  }

  // Where to go: straight at the aim point led by the target's velocity (at most `lead` seconds), its lowest part no
  // lower than `low` over the target's lowest part.
  const rx = aim.x - from.x;
  const ry = aim.y - from.y;
  const dist = Math.hypot(rx, ry);
  const t = Math.min(lead, dist / Math.max(1, speed));
  let gx = rx + target.vel.x * t;
  let gy = ry + target.vel.y * t;
  let lowest = Infinity;
  for (const p of parts) lowest = Math.min(lowest, p.pos.y);
  gy = Math.max(gy, aim.bottom + target.vel.y * t + low - lowest);
  // Over any friendly robot on the way (what let it go included): straight in went through its own fab drone.
  const pd = Math.max(0.01, Math.hypot(gx, gy));
  for (const c of contacts) {
    if (c.side !== 'friend') continue;
    const fx = c.pos.x - from.x;
    const fy = c.pos.y - from.y;
    const along = (fx * gx + fy * gy) / (pd * pd);
    if (along <= 0 || along >= 1 || Math.abs(fx * gy - fy * gx) / pd >= pass) continue;
    gy = Math.max(gy, fy + pass);
  }
  gy = Math.min(gy, state.startY + ceiling - from.y);
  // Let go by a carrier: no lower than where it cleared until it is past the carrier's edge.
  if (!state.wide && Math.abs(self.pos.x - state.startX) < clearWidth) gy = Math.max(gy, state.startY + clearDist - from.y);
  else state.wide = true;
  const gd = Math.max(0.01, Math.hypot(gx, gy));
  // Closing speed: as fast as it can still brake from over the distance left.
  const closing = Math.min(speed, Math.max(ram, Math.sqrt(2 * brake * margin * gd)));
  // A swarm spreads out: away from friendly robots nearby (their radar contacts), more the closer they are.
  let ax = 0;
  let ay = 0;
  for (const c of contacts) {
    if (c.side !== 'friend' || c.distance >= space || c.distance < 0.01) continue;
    const push = spread * (1 - c.distance / space);
    ax += ((self.pos.x - c.pos.x) / c.distance) * push;
    ay += ((self.pos.y - c.pos.y) / c.distance) * push;
  }
  const vx = target.vel.x + (gx / gd) * closing + ax;
  // The target's own climb is added in, so the ceiling caps the climb speed too: no faster than it can stop from by
  // the ceiling (gravity brakes a climb).
  const room = Math.max(0, state.startY + ceiling - from.y);
  const vy = Math.min(target.vel.y + (gy / gd) * closing + ay, Math.sqrt(2 * 9.81 * margin * room));
  fly(clamp(vx, -speed - 20, speed + 20), clamp(vy, -climb, climb));
  mark(from.x + gx, from.y + gy, 'aim');
}
