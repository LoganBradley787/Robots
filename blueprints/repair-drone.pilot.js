// Pilot for the repair drone: the enemy drone's hover with a fight of its own, and every repair decision there is. The
// engine only takes orders (`scrap`, `build`, `heal`): what it gives up, what it makes, and in what order is all here.
// No keys, it runs from deploy.
// - Flying: as the enemy drone (time-optimal leaning, balance from its parts, height braking just in time): it holds a
//   spot `standoff` meters beside and `above` meters over what its radar tracks, home with nothing tracked. Left and
//   right go by where the propellers are, not their tags, and the sums are made every tick, so it flies on what it has.
// - Repair (`repair` 1, 0 turns it all off): see `repairs()` at the bottom.

const repairOn = param('repair', 1, { min: 0, max: 1 }); // 0: it never scraps, builds or heals
const climb = param('climb', 10, { min: 0.5, max: 30 }); // m/s, fastest climb or sink it asks for
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const gyroTorque = param('gyroTorque', 40, { min: 0, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const lean = (param('lean', 50, { min: 0, max: 70 }) * Math.PI) / 180; // most it leans, degrees
const steer = param('steer', 0.08, { min: 0.01, max: 0.5 }); // radians of lean per m/s it is off the sideways speed it wants
const turnLift = param('turnLift', 0.15, { min: 0, max: 1 }); // most throttle it adds over what the height asks for, to turn
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its turning or climbing power it plans braking on
const speed = param('speed', 12, { min: 1, max: 40 }); // m/s, fastest it flies sideways to get somewhere
const standoff = param('standoff', 150, { min: 5, max: 300 }); // m to the side of the robot it tracks
const above = param('above', -6, { min: -100, max: 100 }); // m above it (its laser is on top: it wants the target over it)
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots are missiles (dodged, not chased)
const maxSpeed = param('maxSpeed', 30, { min: 1, max: 1000 }); // m/s: anything faster is a missile or a drone bomb
const reserve = param('reserve', 0.65, { min: 0.2, max: 1 }); // share of full lift it may lean on
const floor = param('floor', 10, { min: 0, max: 200 }); // m: its lowest part never asked to go below this height
const every = param('every', 6, { min: 1, max: 60 }); // ticks between looks at what repair could do

function setup() {
  state.home = { x: self.pos.x, y: self.pos.y };
  state.last = '';
}

/** One of its own propellers. */
const prop = (p) => p.type === 'propeller';

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
    if (!prop(p)) continue;
    const u = along(p) - cu;
    sum += u;
    split += p.tags.includes('rprop') ? u : -u;
    if (u > 0) right += u;
    else left -= u;
  }
  return { inertia, sum, split, right, left };
}

function fly(vx, height, vy) {
  const g = 9.81;
  const props = parts.filter(prop).length;
  const up = props * lift * Math.max(0.3, Math.cos(self.angle));
  const rise = Math.max(0.5, up / self.mass - g);
  let climbing = vy;
  if (climbing === undefined) {
    const err = height - self.pos.y;
    const stop = err > 0 ? g : rise;
    climbing = Math.sign(err) * Math.min(Math.sqrt(2 * margin * stop * Math.abs(err)), 3 * Math.abs(err), climb);
  }
  const upward = clamp(5 * (climbing - self.vel.y), -g, rise);
  const throttle = clamp((self.mass * (g + upward)) / Math.max(up, 1e-9), 0, 1);

  // Leaning left (counterclockwise) pushes it left: lean against the sideways speed it is short of. A heavy drone
  // leans less: never so far that `reserve` of its full lift, tilted, no longer holds its weight.
  const most = Math.min(lean, Math.acos(clamp((self.mass * g) / Math.max(1, reserve * props * lift), 0, 1)));
  const want = clamp(-steer * (vx - self.vel.x), -most, most);
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
  // Turning comes first, but it may add at most `turnLift` to the throttle the height asked for.
  for (let i = 0; i < 4; i++) {
    diff = b.split !== 0 ? (torque - gyro - lift * base * b.sum) / (lift * b.split) : 0;
    const d = Math.abs(diff);
    base = d >= 0.5 ? 0.5 : clamp(throttle, d, 1 - d);
    base = Math.min(base, Math.max(throttle + turnLift, Math.min(throttle, 1 - d)));
  }
  set('lprop', 'throttle', clamp(base - diff, 0, 1));
  set('rprop', 'throttle', clamp(base + diff, 0, 1));
  set('stab', 'spin', gyroTorque > 0 ? clamp(-gyro / gyroTorque, -1, 1) : 0); // the gyro's spin is clockwise positive
}

/** The lowest height its core may be asked for: `floor` plus how far its lowest part hangs below its core. */
function lowestOk() {
  let low = self.pos.y;
  for (const p of parts) if (p.pos.y < low) low = p.pos.y;
  return floor + (self.pos.y - low);
}

/** Says a line once, when it changes. */
function say(text) {
  if (text === state.last) return;
  state.last = text;
  log(text);
}

/** Repair. Rung 1: armor pays for propellers and the laser. */
function repairs() {
  if (repairOn < 1 || frame % every !== 0 || job()) return;
  const gone = lost();
  const props = parts.filter(prop).length;
  const need = self.mass * 9.81;
  // What to make next: propellers while it could not lean or climb on what it has, the turret, then the other propellers.
  const flyable = gone.filter((p) => p.type === 'propeller' && p.touching);
  const turret = gone.filter((p) => p.tags.includes('laser-turret1') && p.touching);
  const wanted = props * lift < 1.5 * need && flyable.length > 0 ? flyable : turret.length > 0 ? turret : flyable;
  const next = wanted[0];
  const hold = tank();
  if (next && hold >= next.create) {
    const r = build(next.id);
    say(`build ${next.id}: ${JSON.stringify(r)}`);
    return;
  }
  // Heal what was rebuilt, laser first, while the tank lasts.
  if (!next && hold > 0.05) {
    const hurt = own({ has: ['throttle', 'fire', 'turn'] }).filter((p) => p.health < 0.9 * p.maxHealth);
    hurt.sort((a, b) => a.heal - b.heal);
    const first = hurt.find((p) => p.type === 'laser') ?? hurt.find((p) => p.type === 'rotator') ?? hurt[0];
    if (first) {
      heal(first.id);
      return;
    }
  }
  if (next && hold < next.create) {
    const plate = parts.find((p) => p.type === 'armorplate');
    if (plate) {
      say(`scrap ${plate.id}: ${JSON.stringify(scrap(plate.id))}`);
      return;
    }
  }
}

function tick() {
  repairs();
  const target = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass && Math.hypot(c.vel.x, c.vel.y) <= maxSpeed);
  let goal = state.home;
  if (target) {
    const here = self.pos.x >= target.pos.x ? 1 : -1;
    goal = { x: target.pos.x + here * standoff, y: target.pos.y + above };
  }
  goal = { x: goal.x, y: Math.max(goal.y, lowestOk()) };
  fly(clamp(0.5 * (goal.x - self.pos.x), -speed, speed), goal.y);
  mark(goal.x, goal.y, target ? 'hold' : 'home');
}
