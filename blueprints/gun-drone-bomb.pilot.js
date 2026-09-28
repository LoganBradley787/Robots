// Gun drone bomb (Batch): the drone bomb's airframe with a gun where the warhead was, and no warhead. It goes after the
// robot its carrier names (a message with `id`) or the nearest robot on the other side its radar tracks, and hangs
// `hang` meters off it on the side its gun faces, at the height where its barrel line meets the target, and shoots.
// Made for fabricator bays: cheap and quick to build (4.9 s), so a bay keeps a stream of them coming. It runs whenever its core is
// awake: deployed alone it starts at once; held in a bay or on a rack its core sleeps until it is let go.
// - Woken: straight up at full power `clearDist` meters, the first `clearWalls` meters along the tilt it was let go at
//   (out of a bay), as the drone bomb does. It fires nothing until it is clear.
// - Where it hangs: the gun is bolted to the airframe, so it cannot swing. The barrel points along the body, which the
//   flight keeps level, and the drone aims by height: it climbs or sinks until the line the barrel points along (led
//   ahead of a moving target, raised by what a shell falls) meets the aim point. It matches the target's speed, keeps
//   the gun `hang` meters off on the barrel's side, and never lets its lowest part below `low` meters over the
//   target's lowest part. Started on the wrong side, it crosses `cross` meters over the target first.
// - Which part: a light target (under `heavy` kg: a missile, a drone bomb) is aimed at its middle. On anything heavier
//   it scans the parts and picks the best hit per shell, as the gun turrets do (what the part is worth over the shells
//   it and whatever is in front of it take), every `repick` seconds.
// - A swarm shares one line: every gun drone comes in on the same side, so a friend on the barrel's line blocks the
//   sight. The gun's sight says so: blocked for `hold` seconds, it takes the next row (0, +1, -1, +2, -2 ... times
//   `rows` meters) of the target's height, so the swarm fans out over the target; and friends within `space` meters
//   steer apart sideways so they do not stack in one spot.
// - Fire: within `reach` meters while the barrel is on the aim point and the sight is not blocked by our own robot, a
//   friend, or the ground before the target. On target means within `size` meters of the aim point (at least
//   `tight` radians); once firing it keeps on out to twice that.
// Flying is the drone bomb's, asked for a velocity: time-optimal leaning, balance from its parts, so it works flipped.

const climb = param('climb', 12, { min: 1, max: 60 }); // m/s, fastest climb or sink it asks for
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const gyroTorque = param('gyroTorque', 40, { min: 0, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const lean = (param('lean', 45, { min: 0, max: 75 }) * Math.PI) / 180; // most it leans, degrees
const diveLean = (param('diveLean', 70, { min: 0, max: 88 }) * Math.PI) / 180; // most it leans while asked to go down, degrees
const steer = param('steer', 0.08, { min: 0.01, max: 0.5 }); // radians of lean per m/s it is off the sideways speed it wants
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its turning or climbing power it plans braking on
const speed = param('speed', 30, { min: 1, max: 80 }); // m/s, fastest it closes on a target
const brake = param('brake', 7, { min: 1, max: 40 }); // m/s^2 it plans to brake at when closing
const xgain = param('xgain', 0.6, { min: 0.05, max: 5 }); // m/s of sideways speed per meter it is off its spot (its lean is slow: more swings)
const dropBrake = param('dropBrake', 15, { min: 1, max: 40 }); // m/s^2 it plans to brake a descent at (its propellers)
const hang = param('hang', 40, { min: 5, max: 200 }); // m from its gun to the target, on the barrel's side
const reach = param('reach', 250, { min: 1, max: 1000 }); // m: further than this it does not shoot
const track = param('track', 400, { min: 1, max: 1000 }); // m: further than this it does not scan its target
const low = param('low', 1, { min: 0, max: 20 }); // m its lowest part stays over the target's lowest part (the ground may be just under it)
const cross = param('cross', 25, { min: 5, max: 200 }); // m over the target while crossing to the barrel's side
const ceiling = param('ceiling', 60, { min: 0, max: 500 }); // m above where it started it never climbs past (crossing adds `cross`)
const clearWidth = param('clearWidth', 0, { min: 0, max: 100 }); // m sideways from where it was let go before it comes down (a carrier's half width)
const clearWalls = param('clearWalls', 5, { min: 0, max: 20 }); // m it moves holding the tilt it was let go at (out of a bay)
const clearDist = param('clearDist', 15, { min: 0, max: 50 }); // m it climbs straight up at full power after waking, before it steers or shoots
const space = param('space', 8, { min: 0, max: 30 }); // m it keeps from friendly robots (sideways)
const spread = param('spread', 10, { min: 0, max: 40 }); // m/s it steers away from a friend right next to it (less further out)
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (missiles) are not worth chasing
const heavy = param('heavy', 10, { min: 0, max: 1000 }); // kg: lighter targets are aimed at their middle, heavier by part
const repick = param('repick', 0.5, { min: 0, max: 5 }); // s between choosing which part to aim at
const damage = param('damage', 5, { min: 0.1, max: 1000 }); // a shell's damage (the gun part)
const gunSpeed = param('gunSpeed', 300, { min: 1, max: 5000 }); // m/s, the gun's shell speed (the gun part)
const size = param('size', 1.5, { min: 0.1, max: 10 }); // m off the aim point that still counts as on target
const tight = param('tight', 0.012, { min: 0.001, max: 0.5 }); // radians: on target at the least this close
const hold = param('hold', 0.6, { min: 0, max: 10 }); // s a friend blocks the sight before it takes the next row
const rows = param('rows', 3, { min: 0.5, max: 10 }); // m between the rows it takes over the target's height
const vgain = param('vgain', 2, { min: 0.1, max: 10 }); // m/s of climb per meter its barrel line is off the aim point

const g = 9.81;
// What breaking each kind of part is worth, and the share of a shell's damage each takes (see gun-turret.turrets.js).
const SHELL = { frame: 0.25 };
const WORTH = { gun: 10, heavywarhead: 12, warhead: 10, core: 8, radar: 6, rotator: 4, booster: 4, propeller: 4, thruster: 3, fabbay: 5, seeker: 3, battery: 2, densebattery: 2, heavygyro: 2, gyro: 2, wheel: 2, cell: 1, decoupler: 1, flare: 0.5, frame: 0.5 };
const SIGHT = { nothing: 0, own: 1, friend: 2, enemy: 3, none: 4, terrain: 5 };
const ROWS = [0, 1, -1, 2, -2, 3, -3];

function setup() {
  // A carrier or bay may name the robot to go after (a message with its `id`), so a swarm spreads over several targets.
  for (const m of inbox) if (m.data && typeof m.data.id === 'number') state.want = m.data.id;
  state.startY = self.pos.y;
  state.startX = self.pos.x;
  state.startAngle = self.angle; // a bay or rack it leaves may be tilted
  state.hold = { x: self.pos.x, y: self.pos.y };
  state.tie = random() < 0.5 ? -1 : 1; // which way two friends exactly on top of each other steer
  state.id = 0;
  state.row = 0;
  state.blocked = 0;
  state.firing = false;
  state.part = undefined;
  state.picked = -Infinity;
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

/** Flies toward a sideways speed `vx` and a climb speed `vy`, or holding the tilt `angle` when given. */
function fly(vx, vy, angle) {
  const g = 9.81;
  const props = parts.filter((p) => p.type === 'propeller').length;
  const up = Math.max(1, props * lift * Math.max(0.3, Math.cos(self.angle)));
  const rise = Math.max(0.5, up / self.mass - g);
  const upward = clamp(5 * (vy - self.vel.y), -g, rise);
  let throttle = clamp((self.mass * (g + upward)) / Math.max(up, 1e-9), 0, 1);
  // At least the push along its lean that the whole acceleration it wants calls for (sideways and up together):
  // asked to go down and sideways, the height alone cut the push to nothing, and it hung leaning with no push while
  // gravity slowly took it down (Logan).
  const across = clamp(3 * (vx - self.vel.x), -15, 15);
  const along = -Math.sin(self.angle) * across + Math.cos(self.angle) * (g + upward); // leaning left pushes it left
  let sideways = clamp((self.mass * along) / (props * lift), 0, 1);
  // Asked to go down, that push may hold it up by at most half of gravity, so it still drops.
  const c = Math.cos(self.angle);
  if (upward < 0 && c > 0.05) sideways = Math.min(sideways, (self.mass * (g + upward + 0.5 * g)) / (c * props * lift));
  throttle = Math.max(throttle, sideways);

  // Leaning left (counterclockwise) pushes it left: lean against the sideways speed it is short of.
  // Going down it leans further, so its push is mostly sideways and gravity does the dropping.
  const most = upward < 0 ? Math.max(lean, diveLean) : lean;
  const want = angle !== undefined ? angle : clamp(-steer * (vx - self.vel.x), -most, most);
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


function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** A robot's parts as the radar scans them, once per tick however many ask (at most 4 scans a tick). */
function scanned(id) {
  if (state.scanTick !== frame) {
    state.scanTick = frame;
    state.scans = {};
  }
  if (!(id in state.scans)) state.scans[id] = scan(id);
  return state.scans[id];
}

/** The part of `target` worth the most per shell from `from` (the gun turrets' scoring); undefined when it cannot be scanned. */
function bestPart(target, from, floorY) {
  const list = scanned(target.id);
  if (!list || list.length === 0) return undefined;
  const shells = (p) => Math.ceil(p.health / (damage * (SHELL[p.type] ?? 1)));
  const order = list.map((p) => ({ p, bound: (WORTH[p.type] ?? 1) / shells(p) }));
  order.sort((a, b) => b.bound - a.bound);
  let best;
  for (const { p, bound } of order) {
    if (best && bound <= best.score) break;
    if (p.pos.y < floorY) continue; // too low for the gun to get a line to
    const worth = WORTH[p.type] ?? 1;
    const rx = p.pos.x - from.x;
    const ry = p.pos.y - from.y;
    const d = Math.hypot(rx, ry);
    if (d < 0.1) continue;
    const ux = rx / d;
    const uy = ry / d;
    let cost = shells(p);
    for (const q of list) {
      if (q === p) continue;
      const qx = q.pos.x - from.x;
      const qy = q.pos.y - from.y;
      const along = qx * ux + qy * uy;
      if (along <= 0 || along >= d - 0.3) continue;
      if (Math.abs(qx * uy - qy * ux) < 0.6) cost += shells(q);
    }
    const score = worth / cost;
    if (!best || score > best.score) best = { id: p.id, score };
  }
  return best && best.id;
}

/** Where to point to hit a point at `pos` moving at `vel` from `from`: led by the shell's flight time, raised by its fall. */
function aimLead(pos, vel, from) {
  const rx = pos.x - from.x;
  const ry = pos.y - from.y;
  const vx = vel.x - self.vel.x;
  const vy = vel.y - self.vel.y;
  let t = Math.hypot(rx, ry) / gunSpeed;
  let px = rx;
  let py = ry;
  for (let i = 0; i < 3; i++) {
    px = rx + vx * t;
    py = ry + vy * t;
    t = Math.hypot(px, py) / gunSpeed;
  }
  return { angle: Math.atan2(py + 0.5 * g * t * t, px), distance: Math.hypot(px, py) };
}

/** The lowest of its parts (its core with none). */
function lowestY() {
  let low = self.pos.y;
  for (const p of parts) low = Math.min(low, p.pos.y);
  return low;
}

function tick() {
  const gun = parts.find((p) => p.type === 'gun');
  // Just woken: straight up at full power, still safe, until it would coast the rest of the way up (as the drone bomb).
  if (!state.cleared) {
    const left = state.startY + clearDist - self.pos.y;
    if (left > 0 && self.vel.y * Math.max(0, self.vel.y) < 2 * g * left) {
      fly(0, climb, Math.hypot(self.pos.x - state.startX, self.pos.y - state.startY) < clearWalls ? state.startAngle : undefined);
      return;
    }
    state.cleared = true;
    state.hold = { x: self.pos.x, y: state.startY + clearDist }; // with nothing to chase it waits here, clear
  }
  // The robot it was sent at while it is still seen, else the nearest it already had, else the nearest.
  let target = contacts.find((c) => c.id === state.want && c.side === 'enemy' && c.core);
  if (!target) {
    for (const c of contacts) {
      if (c.side !== 'enemy' || !c.core || c.mass < minMass) continue;
      if (!target || c.distance - (c.id === state.id ? 10 : 0) < target.distance - (target.id === state.id ? 10 : 0)) target = c;
    }
  }
  if (!gun || !target) {
    if (gun) set('gun', 'fire', 0);
    state.firing = false;
    const vx = clamp(0.5 * (state.hold.x - self.pos.x), -speed, speed);
    fly(vx, clamp(0.5 * (state.hold.y - self.pos.y), -climb, climb));
    return;
  }
  if (target.id !== state.id) {
    state.id = target.id;
    state.row = 0;
    state.blocked = 0;
    state.part = undefined;
    state.picked = -Infinity;
  }

  state.hold = { x: self.pos.x, y: self.pos.y };

  const aim = gun.out.aim; // where the barrel points in the world
  const dir = Math.cos(aim) >= 0 ? 1 : -1; // 1: it hangs left of the target, shooting right
  const from = { x: gun.pos.x + 0.5 * Math.cos(aim), y: gun.pos.y + 0.5 * Math.sin(aim) };

  // Scanned close enough: the target's parts give its height range, its lowest part, and the part to aim at.
  const list = target.distance < track ? scanned(target.id) : null;
  let minY = target.pos.y;
  let maxY = target.pos.y;
  for (const p of list || []) {
    minY = Math.min(minY, p.pos.y);
    maxY = Math.max(maxY, p.pos.y);
  }
  let point = { x: target.center.x, y: target.center.y };
  if (list && target.mass >= heavy) {
    if (time - state.picked >= repick || state.part === undefined) {
      state.part = bestPart(target, from, minY + low - 0.5);
      state.picked = time;
    }
    const p = state.part === undefined ? undefined : list.find((x) => x.id === state.part);
    if (p) point = { x: p.pos.x, y: p.pos.y };
    else state.part = undefined;
  }
  // The row it takes over the target's height (a friend blocked the line before), kept inside the target.
  if (list && target.mass >= heavy) point.y = clamp(point.y + ROWS[state.row] * rows, minY, maxY);

  const l = aimLead(point, target.vel, from);
  const err = wrap(l.angle - aim);
  // How far the aim point is above the barrel line at the target's distance, for a level barrel; plus what the barrel's
  // own tilt (recoil leans it) adds, kept small so a hard turn does not steer the height.
  const tilt = dir > 0 ? aim : wrap(Math.PI - aim);
  state.tilt = state.tilt === undefined ? tilt : state.tilt + (tilt - state.tilt) * Math.min(1, dt / 0.4);
  const miss = l.distance * Math.sin(l.angle) - l.distance * Math.sin(clamp(state.tilt, -0.2, 0.2));

  // Sideways: the gun `hang` off the target on the barrel's side, matching its speed; crossing over it first when it
  // starts on the wrong side.
  if ((self.pos.x - target.pos.x) * dir > 0) state.crossing = true;
  else if ((self.pos.x - target.pos.x) * dir < -0.5 * hang) state.crossing = false;
  const goalX = target.center.x - dir * hang;
  const dx = goalX - gun.pos.x;
  const closing = Math.min(speed, Math.sqrt(2 * brake * margin * Math.abs(dx)), xgain * Math.abs(dx));
  let vx = target.vel.x + Math.sign(dx) * closing;
  // A swarm spreads out sideways: away from friendly robots close by, more the closer they are.
  let ay = 0;
  for (const c of contacts) {
    if (c.side !== 'friend' || c.distance >= space || c.distance < 0.01) continue;
    const away = Math.abs(self.pos.x - c.pos.x) > 0.3 ? Math.sign(self.pos.x - c.pos.x) : state.tie;
    vx += away * spread * (1 - c.distance / space);
    if (c.distance < 3.5) ay += (self.pos.y >= c.pos.y ? 1 : -1) * 4;
  }

  // Up and down: the barrel line meets the aim point. Crossing: over the target. Never its lowest part under `low`
  // over the target's lowest part, never past the ceiling.
  // Braking plans: going down it brakes on its propellers (`dropBrake`), going up on gravity.
  const climbTo = (err) => Math.sign(err) * Math.min(climb, vgain * Math.abs(err), Math.sqrt(2 * (err < 0 ? dropBrake : g) * margin * Math.abs(err)));
  let vy = target.vel.y + climbTo(miss) + ay;
  if (state.crossing) vy = target.vel.y + climbTo(maxY + cross - gun.pos.y);
  const under = lowestY() - (minY + low);
  if (under < 0) vy = Math.max(vy, target.vel.y - 3 * under);
  const room = state.startY + ceiling + (state.crossing ? cross : 0) - self.pos.y;
  if (room < 0) vy = Math.min(vy, 3 * room);
  // Let go by a carrier: no lower than where it cleared until it is past the carrier's edge.
  if (!state.wide && Math.abs(self.pos.x - state.startX) < clearWidth) vy = Math.max(vy, 3 * (state.startY + clearDist - self.pos.y));
  else state.wide = true;
  fly(clamp(vx, -speed - 20, speed + 20), clamp(vy, -climb, climb));

  // Fire: on target within reach, the sight clear of our own robot, a friend, and the ground before the target.
  const side = gun.out.sightSide;
  const friendly = (side === SIGHT.own || side === SIGHT.friend) && gun.out.sight < l.distance;
  const terrain = side === SIGHT.terrain && gun.out.sight < l.distance;
  const within = Math.max(tight, Math.atan2(size, l.distance)) * (state.firing ? 2 : 1);
  const on = Math.abs(err) < within;
  state.blocked = friendly && !state.crossing ? state.blocked + dt : 0;
  if (state.blocked > hold) {
    state.row = (state.row + 1) % ROWS.length;
    state.blocked = 0;
  }
  state.firing = !state.crossing && on && !friendly && !terrain && l.distance <= reach;
  set('gun', 'fire', state.firing ? 1 : 0);
  mark(from.x + Math.cos(l.angle) * l.distance, from.y + Math.sin(l.angle) * l.distance, 'aim');
}
