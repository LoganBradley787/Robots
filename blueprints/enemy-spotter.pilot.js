// Pilot for the enemy spotter (Batch: `enemy-spotter`): the enemy fab drone's pilot (`enemy-fab-drone.pilot.js`) flying a
// small drone with a radar, a radio, and no bay or guns, so it fires nothing (no bay `ready`). No keys, it runs from deploy.
// It keeps `standoff` (700) meters beside and `above` meters over the nearest robot its radar tracks, out of every gun and
// missile range there is (its radio tells the artillery what it sees), and runs from missiles about to pass close:
// it pops a smoke pod on itself and runs (below), and `enemy-spotter.jammers.js` drops a jammer on anything that gets close.
// Changes from the fab drone's pilot: the smoke and its running, `memory`, dodging by how far off its line a missile would
// pass, and the params in the blueprint (fast, light, quick to climb).
// Pilot for the enemy fab drones (`enemy-fab-drone`, `enemy-bomb-fab-drone`): the enemy drone's pilot
// (`enemy-drone.pilot.js`) with a fabricator bay in place of its four missiles. No keys, it runs from deploy.
// - Track, dodge, and fly: as the enemy drone (a spot `standoff` meters beside and `above` meters over the nearest
//   robot on the other side its radar tracks, home with nothing tracked, dodging missiles about to pass close).
// - Fire: in range, it sends what its bay holds at that robot and lets it go, `settle` seconds after it first tracks
//   it, as soon as the bay has one ready (no reload: the bay's build time is the pace, Logan). The message suits a
//   missile (point, speed, id, arc); a drone bomb reads only the id. The bay builds the next by itself (a missile
//   4.1 s, a heavy drone bomb 8.7 s), so it keeps firing for as long as its batteries last. After letting one go it holds still for `hold` seconds so it leaves the bay cleanly
//   (sliding away at once, the bay's wall shoved a drone bomb still inside it, which wedged and carried it up).
// - Off the line (Logan): nothing it sees within `width` meters to either side, `space` above, or `under` below. It
//   slides away sideways: a drone bomb it let go (or anything else) may wait or fall there, and one flew into its
//   own drone bomb climbing to a new spot.
// - Guns (M13, Logan: they are not smart enough to flip around): with working guns that only point one way (the
//   other side's were shot off), it takes the side of what it tracks that puts that robot in front of them. To get
//   there it crosses `cross` meters over it if it is higher or on its left, under it otherwise (decided once per
//   crossing: two swapping sides must not both go the same way), and the off-the-line rule lets that robot be under or
//   over it while it crosses (two of them trying to swap sides pushed each other apart forever).
// Flying is the hunter drone's hover (time-optimal leaning, balance from its parts, height braking just in time),
// with the AI asking for a sideways speed and a height instead of keys. Left and right are worked out from where the
// propellers are, not their tags, so it works deployed flipped. Only its own propellers (`lprop`, `rprop`) count
// toward its lift: a copy held in the bay may have propellers of its own, asleep.

const climb = param('climb', 10, { min: 0.5, max: 30 }); // m/s, fastest climb or sink it asks for
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const gyroTorque = param('gyroTorque', 40, { min: 0, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const lean = (param('lean', 50, { min: 0, max: 70 }) * Math.PI) / 180; // most it leans, degrees
const steer = param('steer', 0.08, { min: 0.01, max: 0.5 }); // radians of lean per m/s it is off the sideways speed it wants
const turnLift = param('turnLift', 0.15, { min: 0, max: 1 }); // most throttle it adds over what the height asks for, to turn
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its turning or climbing power it plans braking on
const speed = param('speed', 12, { min: 1, max: 40 }); // m/s, fastest it flies sideways to get somewhere
const standoff = param('standoff', 50, { min: 5, max: 300 }); // m to the side of the robot it tracks
const above = param('above', 12, { min: 0, max: 100 }); // m above it
const ceiling = param('ceiling', 30, { min: 0, max: 500 }); // m above where it was deployed it never climbs past (two of these tracking each other would otherwise climb forever)
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots are missiles (dodged, not chased)
const clearance = param('clearance', 20, { min: 0, max: 100 }); // m: a friendly robot this close to the line to the target makes it an arc shot
const below = param('below', 10, { min: -100, max: 100 }); // m: a target more than this far below gets an arc shot, the rest a direct one
const minRange = param('minRange', 25, { min: 0, max: 500 }); // m: closer than this it holds fire
const maxRange = param('maxRange', 250, { min: 10, max: 1000 }); // m: further than this it holds fire
const level = (param('level', 15, { min: 1, max: 90 }) * Math.PI) / 180; // fires only within this many degrees of level (a missile leaves the way the bay points; a drone bomb climbs straight up whatever the tilt)
const jitter = param('jitter', 1, { min: 0, max: 10 }); // up to this many seconds more, at random (seeded), so two drones do not fire in step
const nearby = param('nearby', 8, { min: 0, max: 50 }); // m: a friendly robot this close just after a release may still be in the bay
const hold = param('hold', 1, { min: 0, max: 10 }); // s it stays where it let one go, so it leaves the bay cleanly (dodging still comes first)
const space = param('space', 20, { min: 0, max: 100 }); // m above it where nothing may be
const under = param('under', 8, { min: 0, max: 100 }); // m below it where nothing may be (its spot is 12 m over what it tracks, often right over another car)
const width = param('width', 12, { min: 0, max: 100 }); // m to either side that counts as straight above or below (it is 15 wide)
const settle = param('settle', 1.5, { min: 0, max: 30 }); // s it holds fire after it first tracks a robot
const dodge = param('dodge', 1, { min: 0, max: 1 }); // 0: never dodges
const dodgeAhead = param('dodgeAhead', 2.5, { min: 0.2, max: 10 }); // s ahead it looks for a missile passing close
const dodgeMiss = param('dodgeMiss', 10, { min: 1, max: 50 }); // m: a missile passing closer than this is dodged
const dodgeTime = param('dodgeTime', 1.2, { min: 0.1, max: 5 }); // s it keeps dodging
const dodgeRoom = param('dodgeRoom', 15, { min: 0, max: 200 }); // m above the robot it tracks it needs to dodge down (it cannot see the ground)
const reserve = param('reserve', 0.65, { min: 0.2, max: 1 }); // share of full lift it may lean on: it leans no further than keeps its weight up on this much throttle (the 96 kg many-gun drone leaned 44 degrees and sank from 40 m to 8)
const floor = param('floor', 8, { min: 0, max: 200 }); // m: its lowest part never asked to go below this height (y 0 is the ground; the many-gun drone hangs 7 m of guns under its core and scraped it)
const cross = param('cross', 25, { min: 5, max: 200 }); // m under or over what it tracks while crossing to its other side
const dodgeSpeed = param('dodgeSpeed', 14, { min: 1, max: 40 }); // m/s up or down it dodges at
const smokeGap = param('smokeGap', 2.5, { min: 0, max: 20 }); // s between smoke pods
const evade = param('evade', 2.5, { min: 0.1, max: 10 }); // s it keeps running after popping smoke (its radar is blind in its own cloud, so it cannot see the missile it is running from)
const memory = param('memory', 6, { min: 0, max: 30 }); // s it keeps flying to where it last saw its target after losing it (a smoke cloud or a jammer bubble over it or over its own sensors), instead of going home

function setup() {
  state.home = { x: self.pos.x, y: self.pos.y };
  state.lastShot = -Infinity;
  state.wait = jitter * random();
  state.dodgeUntil = -Infinity;
  state.dodgeMove = { vx: 0, vy: 0 };
  state.lastSmoke = -Infinity;
  state.evadeUntil = -Infinity;
}

/** The tag (`smoke1`..) of a smoke pod still attached, lowest first, or undefined. */
function smokePod() {
  for (let k = 1; k <= 9; k++) if (parts.some((p) => p.type === 'smoke' && p.tags.includes('smoke' + k))) return 'smoke' + k;
  return undefined;
}


/**
 * Which side of what it tracks its guns want it on: 1 to its right (its guns face left), -1 to its left (they face
 * right), 0 either (both ways, up or down only, or none). A gun on a turret (`<turret>.gun` beside `<turret>.rot`)
 * counts the way it was built, not where it points now.
 */
function gunSide() {
  let left = 0;
  let right = 0;
  for (const p of parts) {
    if (p.type !== 'gun') continue;
    const tag = p.tags.find((t) => t.endsWith('.gun'));
    const turned = tag ? (get(tag.slice(0, -4) + '.rot', 'angle') ?? 0) * (Math.PI / 2) : 0;
    const x = Math.cos(p.out.aim - turned);
    if (x > 0.5) right++;
    else if (x < -0.5) left++;
  }
  return right > 0 && left === 0 ? -1 : left > 0 && right === 0 ? 1 : 0;
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
  const throttle = clamp((self.mass * (g + upward)) / Math.max(up, 1e-9), 0, 1);

  // Leaning left (counterclockwise) pushes it left: lean against the sideways speed it is short of. A heavy drone
  // leans less: never so far that `reserve` of its full lift, tilted, no longer holds its weight.
  const most = Math.min(lean, Math.acos(clamp((self.mass * g) / (reserve * props * lift), 0, 1)));
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

/** A friendly robot (10 kg or more) within `clearance` meters of the line from it to `t`. */
function friendInWay(t) {
  const lx = t.pos.x - self.pos.x;
  const ly = t.pos.y - self.pos.y;
  const l2 = Math.max(1, lx * lx + ly * ly);
  return contacts.some((c) => {
    if (c.side !== 'friend' || c.mass < minMass) return false;
    const fx = c.pos.x - self.pos.x;
    const fy = c.pos.y - self.pos.y;
    const u = (fx * lx + fy * ly) / l2;
    return u > 0 && u < 1 && Math.abs(fx * ly - fy * lx) / Math.sqrt(l2) < clearance;
  });
}

function fire(t) {
  if (!(get('bay', 'ready') > 0)) return;
  // Over the top onto a target well below, or past a friendly robot near the line to it (in a 5v5 its missiles flew
  // straight through the drones beside it); straight in (from underneath, after the climb) otherwise.
  const arc = t.pos.y < self.pos.y - below || friendInWay(t) ? 1 : 0;
  // The held copy's scope is the bay's tag and its build count (`bay3` is the third).
  send('bay' + get('bay', 'built'), { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc });
  set('bay', 'release', 1);
  state.lastShot = time;
  state.shotAt = { x: self.pos.x, y: self.pos.y };
  state.wait = jitter * random();
}

function tick() {
  let target = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  // Batch: a target that drops out of sight for a moment is still where it was last seen (moving on at its last speed
  // sideways), for `memory` seconds: a ghost. It is flown to and kept off the line of, never fired at.
  if (target) state.seen = { time, id: target.id, mass: target.mass, x: target.pos.x, y: target.pos.y, vx: target.vel.x };
  else if (state.seen && time - state.seen.time < memory) {
    const x = state.seen.x + state.seen.vx * (time - state.seen.time);
    target = { id: state.seen.id, ghost: true, core: true, mass: state.seen.mass, side: 'enemy', pos: { x, y: state.seen.y }, vel: { x: state.seen.vx, y: 0 }, distance: Math.hypot(x - self.pos.x, state.seen.y - self.pos.y) };
  }
  if (!target) state.trackedSince = undefined;
  else if (state.trackedSince === undefined) state.trackedSince = time;

  const danger = dodge > 0.5 ? threat() : undefined;
  // Fire whenever it can, whatever else it is doing, except in a dodge (sliding at once shoves what it let go against
  // the bay's wall). It used to fire only while flying to its spot, and sat on a finished drone bomb while dodging,
  // sliding off the line, or knocked askew (Logan).
  if (target && !target.ghost && !danger && time >= state.dodgeUntil) {
    const range = Math.hypot(target.pos.x - self.pos.x, target.pos.y - self.pos.y);
    const ready = time - state.lastShot >= state.wait && time - state.trackedSince >= settle + state.wait && Math.abs(self.angle) < level;
    if (range >= minRange && range <= maxRange && ready) fire(target);
  }
  if (danger) {
    // Where it can get before the missile passes, each way: climbing and sinking start at once, moving sideways waits
    // for the lean (about half as far). Down only with room below: it cannot see the ground, so it goes by the robot
    // it tracks (usually on the ground). It takes whichever leaves the missile passing furthest away, or stays.
    const t = danger.t;
    const vertical = 0.5 * dodgeSpeed * t;
    const across = 0.25 * dodgeSpeed * t;
    // Batch: and not so low that the dive would end near the ground (its lowest part stays 10 m over `floor`).
    const room = target !== undefined && self.pos.y - target.pos.y > dodgeRoom && self.pos.y - vertical > lowestOk() + 10;
    const options = [
      { vx: 0, vy: 0, dx: 0, dy: 0 },
      { vx: 0, vy: dodgeSpeed, dx: 0, dy: vertical },
      { vx: -dodgeSpeed, vy: 0, dx: -across, dy: 0 },
      { vx: dodgeSpeed, vy: 0, dx: across, dy: 0 },
    ];
    if (room) options.push({ vx: 0, vy: -dodgeSpeed, dx: 0, dy: -vertical });
    // Batch: no more climbing far past its ceiling: running up from a missile it reached 168 m, and was slow to come back.
    if (self.pos.y > state.home.y + ceiling + 40) options.splice(1, 1);
    // Batch: how far off its line the missile would pass, not how far the drone moves: running along the missile's line
    // (a missile flying level, and the drone running sideways) leaves the pass as close as it was.
    const along = Math.hypot(danger.vx, danger.vy) || 1;
    const gapOf = (o) => Math.abs(((danger.px - o.dx) * -danger.vy + (danger.py - o.dy) * danger.vx) / along);
    let best = options[0];
    let bestGap = -1;
    for (const o of options) {
      const gap = gapOf(o);
      if (gap > bestGap) {
        best = o;
        bestGap = gap;
      }
    }
    // Batch: with a pod left it pops smoke on itself at once (a seeker inside or behind a cloud sees nothing, and flies on to
    // where it last saw the drone), and then must be somewhere else: it runs for `evade` seconds, never staying put, since
    // its own radar is blind in the cloud and cannot see the missile any more.
    let keep = dodgeTime;
    if (time < state.evadeUntil) best = state.dodgeMove; // still running from its own cloud
    else {
      const pod = time - state.lastSmoke >= smokeGap ? smokePod() : undefined;
      if (pod) {
        set(pod, 'on', 1);
        state.lastSmoke = time;
        state.evadeUntil = time + evade;
        if (best.vx === 0 && best.vy === 0) best = options.slice(1).reduce((a, o) => (gapOf(o) > gapOf(a) ? o : a));
        keep = evade;
      }
    }
    if (time >= state.dodgeUntil) state.dodgeHeight = self.pos.y;
    state.dodgeMove = best;
    state.dodgeUntil = Math.max(state.dodgeUntil, time + keep);
  }
  if (time < state.dodgeUntil && (state.dodgeMove.vx !== 0 || state.dodgeMove.vy !== 0)) {
    const m = state.dodgeMove;
    if (m.vy !== 0) fly(0, 0, m.vy);
    else fly(m.vx, state.dodgeHeight);
    return;
  }

  // Still while what it let go may be in the bay: `hold` seconds, and on while a friendly robot is within `nearby`
  // meters (up to 4 s). Moving hard with a drone bomb still inside, the bay's wall jammed it and it carried the drone up.
  const leaving = time - state.lastShot < 4 && contacts.some((c) => c.side === 'friend' && c.distance < nearby);
  if (time - state.lastShot < hold || leaving) {
    fly(clamp(0.5 * (state.shotAt.x - self.pos.x), -speed, speed), state.shotAt.y);
    mark(state.shotAt.x, state.shotAt.y, 'hold');
    return;
  }

  // Where it wants to be: beside and over what it tracks, or home.
  let goal = state.home;
  let crossing = false;
  if (target) {
    const guns = gunSide();
    const here = self.pos.x >= target.pos.x ? 1 : -1;
    const side = guns !== 0 ? guns : here;
    goal = { x: target.pos.x + side * standoff, y: Math.min(target.pos.y + above, state.home.y + ceiling) };
    // On the wrong side for its guns: cross over or under it, then go to the spot.
    if (side !== here) {
      crossing = true;
      if (state.crossOver === undefined) {
        const dy = self.pos.y - target.pos.y;
        state.crossOver = Math.abs(dy) > 2 ? dy > 0 : here < 0;
        // Never under something so low that it would take it below the floor.
        if (target.pos.y - cross < lowestOk()) state.crossOver = true;
      }
      // Over: `cross` above it, never past its ceiling plus `cross` (the goal once followed its own height, and a drone
      // chasing one that kept its distance ratcheted up past 200 m and flew off the edge of the world).
      goal = { x: goal.x, y: state.crossOver ? Math.min(target.pos.y + cross, state.home.y + ceiling + cross) : target.pos.y - cross };
    } else state.crossOver = undefined;
  } else state.crossOver = undefined;

  goal = { x: goal.x, y: Math.max(goal.y, lowestOk()) };

  // Off the line (Logan): nothing it sees (friend, enemy, or wreckage) straight above or below it. Something above may
  // come down on it or into its bay (what it let go waits there with nothing in range; debris falls), and a robot below
  // may send something straight up. It slides away sideways at full speed, heading for the height it wants but never
  // toward the thing (held where the slide began, it stayed 60 m over its ceiling after dodging up).
  const line = contacts.find((c) => c.distance > 0.01 && !(crossing && c.id === target.id) && Math.abs(c.pos.x - self.pos.x) < width && c.pos.y - self.pos.y < space && self.pos.y - c.pos.y < under);
  if (!line) {
    // Off it now: with nothing tracked it waits here, not back on the line (two deployed together shared a home).
    if (state.lineY !== undefined) state.home = { x: self.pos.x + state.lineAway * 0.5 * width, y: state.home.y };
    state.lineY = undefined;
  } else {
    if (state.lineY === undefined) state.lineY = self.pos.y;
    // Straight over each other, both would pick the same side: the lower one goes right, the upper one left.
    const dx = self.pos.x - line.pos.x;
    const away = Math.abs(dx) > 1 ? Math.sign(dx) : self.pos.y < line.pos.y ? 1 : -1;
    state.lineAway = away;
    fly(away * speed, line.pos.y > self.pos.y ? Math.min(goal.y, state.lineY) : Math.max(goal.y, state.lineY));
    mark(line.pos.x, line.pos.y, 'off the line');
    return;
  }

  const vx = clamp(0.5 * (goal.x - self.pos.x), -speed, speed);
  fly(vx, goal.y);
  mark(goal.x, goal.y, target ? 'hold' : 'home');
}
