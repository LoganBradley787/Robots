// Pilot for the enemy grapple drone (`enemy-grapple-drone`, Batch): the enemy gun drone's pilot with grapples in place of
// fire. No keys, it runs from deploy.
// - Hunt: it flies to a spot `above` meters straight over the nearest robot on the other side its radar tracks (a drone
//   or a car, anything of `minMass` kg or more; missiles are dodged, not chased), with its down grapple on the line to
//   it, home with nothing tracked, dodging missiles about to pass close. The grapples
//   (`enemy-grapple-drone.grapples.js`) fire by themselves the moment one lines up with a part of it within `reach` (50 m).
// - Hooked: it holds where it is while the rope reels the robot in to `close` meters (the guns in its turrets work on
//   what it holds), waits `hold` seconds, then carries it: climbs `carryUp` meters and away, and the grapple script lets
//   go up there. Something dropped from 40 m or more loses a default part or more to the fall (crash damage).
// - What it holds counts as weight: a share (`share`) of the held robot's mass is added to its own for lift and height.
// Flying is the hunter drone's hover (time-optimal leaning, balance from its parts, height braking just in time), with
// the AI asking for a sideways speed and a height instead of keys. Left and right are worked out from where the
// propellers are, not their tags, so it works deployed flipped. Only its own propellers (`lprop`, `rprop`) count.
// Its guns (turrets on each end) shoot what they can: what it holds included, when it swings into their reach.

const climb = param('climb', 10, { min: 0.5, max: 30 }); // m/s, fastest climb or sink it asks for
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const gyroTorque = param('gyroTorque', 40, { min: 0, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const lean = (param('lean', 50, { min: 0, max: 70 }) * Math.PI) / 180; // most it leans, degrees
const steer = param('steer', 0.08, { min: 0.01, max: 0.5 }); // radians of lean per m/s it is off the sideways speed it wants
const turnLift = param('turnLift', 0.15, { min: 0, max: 1 }); // most throttle it adds over what the height asks for, to turn
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its turning or climbing power it plans braking on
const speed = param('speed', 12, { min: 1, max: 40 }); // m/s, fastest it flies sideways to get somewhere
const above = param('above', 14, { min: 0, max: 100 }); // m above it (its core over the robot it tracks)
const lead = param('lead', 0.6, { min: 0, max: 5 }); // s ahead of a moving robot it flies to
const ceiling = param('ceiling', 30, { min: 0, max: 500 }); // m above where it was deployed it never climbs past (two of these tracking each other would otherwise climb forever)
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots are missiles (dodged, not chased)
const space = param('space', 20, { min: 0, max: 100 }); // m above it where nothing may be
const under = param('under', 8, { min: 0, max: 100 }); // m below it where nothing may be (its spot is 12 m over what it tracks, often right over another car)
const width = param('width', 12, { min: 0, max: 100 }); // m to either side that counts as straight above or below (it is 15 wide)
const dodge = param('dodge', 1, { min: 0, max: 1 }); // 0: never dodges
const dodgeAhead = param('dodgeAhead', 2.5, { min: 0.2, max: 10 }); // s ahead it looks for a missile passing close
const dodgeMiss = param('dodgeMiss', 10, { min: 1, max: 50 }); // m: a missile passing closer than this is dodged
const dodgeTime = param('dodgeTime', 1.2, { min: 0.1, max: 5 }); // s it keeps dodging
const dodgeRoom = param('dodgeRoom', 15, { min: 0, max: 200 }); // m above the robot it tracks it needs to dodge down (it cannot see the ground)
const reserve = param('reserve', 0.65, { min: 0.2, max: 1 }); // share of full lift it may lean on: it leans no further than keeps its weight up on this much throttle (the 96 kg many-gun drone leaned 44 degrees and sank from 40 m to 8)
const floor = param('floor', 8, { min: 0, max: 200 }); // m: its lowest part never asked to go below this height (y 0 is the ground; the many-gun drone hangs 7 m of guns under its core and scraped it)
const dodgeSpeed = param('dodgeSpeed', 14, { min: 1, max: 40 }); // m/s up or down it dodges at

const reach = param('reach', 50, { min: 1, max: 60 }); // m: the grapples fire within this (the grapples script's `reach`)
const close = param('close', 6, { min: 1, max: 60 }); // m of rope it reels to (the grapples script's `close`)
const hold = param('hold', 3, { min: 0, max: 60 }); // s it holds a short rope before carrying (the grapples script's `hold`)
const carryUp = param('carryUp', 40, { min: 0, max: 200 }); // m it climbs carrying before the rope is let go (the grapples script's)
const carrySpeed = param('carrySpeed', 6, { min: 0, max: 30 }); // m/s it flies away sideways while carrying
const holdSpeed = param('holdSpeed', 4, { min: 0, max: 20 }); // m/s, fastest it slides to stay over what it holds
const reelClimb = param('reelClimb', 2, { min: 0, max: 10 }); // m/s it climbs while the rope reels in
const holdLean = (param('holdLean', 20, { min: 0, max: 70 }) * Math.PI) / 180; // most it leans while it holds something (a rope pulls the drone about its hook)
const share = param('share', 0.6, { min: 0, max: 2 }); // share of the held robot's mass it counts as its own weight

function setup() {
  state.home = { x: self.pos.x, y: self.pos.y };
  state.dodgeUntil = -Infinity;
  state.dodgeMove = { vx: 0, vy: 0 };
  state.load = 0;
}

/** The lowest height its core may be asked for: `floor` plus how far its lowest part hangs below its core. */
function lowestOk() {
  let low = self.pos.y;
  for (const p of parts) if (p.pos.y < low) low = p.pos.y;
  return floor + (self.pos.y - low);
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
  const m = self.mass + (state.load || 0); // what it hangs on the rope counts as weight
  const props = parts.filter(own).length;
  const up = props * lift * Math.max(0.3, Math.cos(self.angle));
  const rise = Math.max(0.5, up / m - g);
  let climbing = vy;
  if (climbing === undefined) {
    const err = height - self.pos.y;
    const stop = err > 0 ? g : rise;
    climbing = Math.sign(err) * Math.min(Math.sqrt(2 * margin * stop * Math.abs(err)), 3 * Math.abs(err), climb);
  }
  const upward = clamp(5 * (climbing - self.vel.y), -g, rise);
  const throttle = clamp((m * (g + upward)) / Math.max(up, 1e-9), 0, 1);

  // Leaning left (counterclockwise) pushes it left: lean against the sideways speed it is short of. A heavy drone
  // leans less: never so far that `reserve` of its full lift, tilted, no longer holds its weight.
  const most = Math.min(state.load > 0 ? holdLean : lean, Math.acos(clamp((m * g) / (reserve * props * lift), 0, 1)));
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
  // Turning comes first, but it may add at most `turnLift` to the throttle the height asked for: swinging side to side
  // between targets with every propeller at half or more, the fab drones climbed past 300 m asking to come down.
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

/** The grapples on this robot: parts tagged `hook`. */
const isHook = (p) => p.type === 'grapple' && p.tags.includes('hook');

function tick() {
  const hooks = parts.filter(isHook);
  const held = hooks.filter((p) => p.out.hooked > 0.5);
  const target = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  // Holding something: the robot nearest the hook, and its weight on the rope. Carrying: every rope short for `hold` s.
  state.load = 0;
  if (held.length > 0) {
    let near;
    for (const c of contacts) {
      if (c.side !== 'enemy' || !c.core) continue;
      const d = Math.hypot(c.pos.x - held[0].pos.x, c.pos.y - held[0].pos.y);
      if (!near || d < near.d) near = { c, d };
    }
    if (near) {
      state.load = share * near.c.mass;
      state.held = near.c;
    }
  }
  const short = held.length > 0 && held.every((p) => p.out.length <= close + 1.5);
  if (held.length === 0) {
    state.holdAt = undefined;
    state.shortAt = undefined;
    state.carryFrom = undefined;
  } else if (state.holdAt === undefined) state.holdAt = { x: self.pos.x, y: self.pos.y };
  if (short) {
    if (state.shortAt === undefined) state.shortAt = time;
  } else {
    state.shortAt = undefined;
    state.carryFrom = undefined;
  }
  const carrying = short && time - state.shortAt >= hold;
  if (carrying && state.carryFrom === undefined) {
    state.carryFrom = { x: self.pos.x, y: self.pos.y };
    // Away from the rest of the fight: the side it is already on (its home side for straight above).
    const dx = self.pos.x - (target ? target.pos.x : state.home.x);
    state.carryAway = Math.abs(dx) > 1 ? Math.sign(dx) : 1;
  }

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
    if (room && held.length === 0) options.push({ vx: 0, vy: -dodgeSpeed, dx: 0, dy: -vertical });
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

  if (held.length > 0) {
    if (carrying) {
      // Up and away: the rope is let go `carryUp` meters higher than where it began.
      fly(state.carryAway * carrySpeed, state.carryFrom.y + carryUp + 5);
      mark(self.pos.x + state.carryAway * 10, state.carryFrom.y + carryUp, 'carry');
    } else {
      // Reeling in: the rope brings the robot to it (or it to the robot); it keeps its height.
      // It keeps straight over what it holds, so the rope hangs straight down from its middle and pulls it evenly
      // (a rope at an angle tips the drone about the hook, 4 m under its center of mass), and gives way to a pull.
      const c = state.held;
      const hook = parts.find((p) => p.tags.includes('hookd'));
      const over = c ? c.pos.x - (hook ? hook.pos.x - self.pos.x : 0) : self.pos.x;
      fly(clamp(0.5 * (over - self.pos.x), -holdSpeed, holdSpeed), 0, reelClimb); // climbing slowly keeps the rope taut: a robot that holds its own height would stall the winch
      mark(over, state.holdAt.y, 'reel');
    }
    return;
  }

  // Where it wants to be: straight over what it tracks, its down grapple (`hookd`) on the line to it, or home. It looks
  // where the robot will be in `lead` seconds, so it does not trail one that is moving.
  let goal = state.home;
  if (target) {
    const hook = parts.find((p) => p.tags.includes('hookd'));
    const dx = hook ? hook.pos.x - self.pos.x : 0;
    goal = { x: target.pos.x + target.vel.x * lead - dx, y: Math.min(target.pos.y + above, state.home.y + ceiling) };
  }

  goal = { x: goal.x, y: Math.max(goal.y, lowestOk()) };

  // Off the line (Logan): nothing it sees (friend, enemy, or wreckage) straight above or below it, except what it is
  // after: it flies over that on purpose.
  const line = contacts.find((c) => c.distance > 0.01 && !(target && c.id === target.id) && Math.abs(c.pos.x - self.pos.x) < width && c.pos.y - self.pos.y < space && self.pos.y - c.pos.y < under);
  if (!line) {
    if (state.lineY !== undefined) state.home = { x: self.pos.x + state.lineAway * 0.5 * width, y: state.home.y };
    state.lineY = undefined;
  } else {
    if (state.lineY === undefined) state.lineY = self.pos.y;
    const dx = self.pos.x - line.pos.x;
    const away = Math.abs(dx) > 1 ? Math.sign(dx) : self.pos.y < line.pos.y ? 1 : -1;
    state.lineAway = away;
    fly(away * speed, line.pos.y > self.pos.y ? Math.min(goal.y, state.lineY) : Math.max(goal.y, state.lineY));
    mark(line.pos.x, line.pos.y, 'off the line');
    return;
  }

  const vx = clamp(0.5 * (goal.x - self.pos.x), -speed, speed);
  fly(vx, goal.y);
  mark(goal.x, goal.y, target ? 'hunt' : 'home');
}
