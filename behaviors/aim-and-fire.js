// @behavior Aim and fire
// @about Turns joints toward the nearest enemy and fires what they carry. It fires by itself, or only while F is held.
// @version 1
// @slot turn turn "what turns" optional many owns guess carries:fire
// @slot fire fire "what fires" required many guess has:sightSide
// @needs sensor "something that sees, such as a radar"
// @note Each firing part is aimed by the joint that carries it; any number of them, and several on one joint.
// @note A firing part on no joint cannot aim: it fires when an enemy crosses its own sight.
// @note It never fires with its own robot or a friend first on a part's sight.
// @note With auto at 0 it aims by itself and fires only while F is held. A key you bind to a fire input still fires it outright.
//
// How it works (the turret scripts of the gun drones and the cannon turrets, with nothing typed in by hand):
// - Pairing: a part's `on` is the id of the joint that carries it. Each part in the group `fire` is aimed by the
//   nearest joint up that chain that is in the group `turn`; with none it is fixed.
// - What a part is like is read off the part, never its name:
//   - where its barrel ends and points: `pos`, `angle`, `rot`, `spec.tip`, and its `aim` output when it has one;
//   - how what it fires flies: the block of its `spec` with a `speed` or a `range` (`spec.gun`, `spec.cannon`,
//     `spec.laser`): shells and bolts are led by their `speed` and raised by their drop; with no `speed` it is a beam;
//   - a part with a `charged` output is charged and released: `fire` is held until `charged` is 1, then let go on
//     target. Its `charge` and `hold` seconds and its `powerDraw` say how long and how much;
//   - how far a joint swings and how fast: `spec.config.range` and `spec.config.turnSpeed`, with its `angle` output.
// - Target: the nearest enemy with a live core the sensors track within 400 m that the joint can swing to. One it
//   could not fire at for half a second (something of ours in the way) is left for a while.
// - Fire, shells: within reach, on the aim point, and nothing of ours first on the sight or near the path.
//   Fire, beams: only while the sight itself shows an enemy in reach.
//   Fire, charged: starts when a target is nearly in reach and the robot can pay for the shot; holds to the end; lets
//   go on target; never lets go with something of ours on the line; with the hold nearly up and the line clear it
//   fires anyway, since a shot at nothing beats a backfire.

const auto = param('auto', 1, { min: 0, max: 1 }); // 1: it fires by itself. 0: it aims by itself and fires only while F is held
const range = param('range', 1000, { min: 1, max: 1000 }); // m: it does not fire at anything further than this (or than a part reaches)

const KEY = 'f'; // held to fire when auto is 0
const G = 9.81;
const RAD = Math.PI / 180;
const TRACK = 400; // m: further than this it does not point at things
const GAIN = 6; // turn rate per radian off the aim
const HOLD = 0.5; // s blocked before it gives up on a target
const SKIP = 1.5; // s it leaves a target it gave up on
const CLEAR = 6; // m: a friend's center this close to the path holds fire
const SIZE = 1; // m off the aim point that still counts as on target (shells)
const TIGHT = 0.012; // radians: on target at the least this close
const FINE = 0.6; // m off the aim point that counts as on it for a charged shot
const LIGHT = 10; // kg: lighter robots (missiles) are not worth a shot that takes seconds to charge
const EARLY = 30; // m past its reach at which a charged part already starts charging
const LINGER = 0.5; // s without a target before it lets a charge drain
const PATIENCE = 0.5; // share of the hold after which any enemy on the sight will do
const SPARE = 0.25; // s of hold left when it fires anyway, if the line is clear of ours
const RESERVE = 0.2; // share of the robot's energy a charge must leave untouched
const BEAM_RESERVE = 0.3; // share of the robot's energy a beam never burns into
const FIXED = 0.35; // radians either side of its barrel a part on no joint looks for a target
const SIGHT = { nothing: 0, own: 1, friend: 2, enemy: 3, none: 4, terrain: 5 };

function setup() {
  state.guns = {};
  state.said = '';
}

/** Says a thing once, and again only when it changes. */
function say(text) {
  if (state.said === text) return;
  state.said = text;
  if (text !== '') log(text);
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** A friend the sensors track within `CLEAR` meters of the path from `from` toward `angle`, nearer than `distance`. */
function friendOnPath(from, angle, distance) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  for (const c of contacts) {
    if (c.side !== 'friend') continue;
    const rx = c.center.x - from.x;
    const ry = c.center.y - from.y;
    const along = rx * ux + ry * uy;
    if (along < 0 || along > distance) continue;
    if (Math.abs(rx * uy - ry * ux) < CLEAR) return true;
  }
  return false;
}

/**
 * What a firing part is like, read off the part: where its barrel ends, where it points, how what it fires flies,
 * how far it fires, and whether it is charged and released.
 */
function describe(p) {
  // The block of its definition that says how what it fires flies: the first with a speed or a range.
  let shot;
  for (const name in p.spec) {
    if (name === 'in' || name === 'config' || name === 'tip') continue;
    const v = p.spec[name];
    if (v !== null && typeof v === 'object' && (v.speed > 0 || v.range > 0)) {
      shot = v;
      break;
    }
  }
  const speed = shot && shot.speed > 0 ? shot.speed : 0; // 0: a beam, there at once
  const sightRange = shot && shot.range > 0 ? shot.range : 0;
  // As far as what it fires flies, and no further than its sight looks, or than a shell flies in half a second where
  // that is further: past its sight it cannot see what is in the way.
  const flight = speed > 0 ? speed * (shot.life > 0 ? shot.life : 1) : sightRange > 0 ? sightRange : range;
  const reach = Math.min(range, flight, speed > 0 ? Math.max(sightRange, 0.5 * speed) : flight);
  const turned = p.angle + p.rot * RAD;
  const aim = p.out.aim !== undefined ? p.out.aim : turned + (p.spec.acts === undefined ? 90 : p.spec.acts) * RAD;
  const tip = p.spec.tip || { x: 0, y: 0 };
  const c = Math.cos(turned);
  const s = Math.sin(turned);
  return {
    aim,
    from: { x: p.pos.x + c * tip.x - s * tip.y, y: p.pos.y + s * tip.x + c * tip.y },
    speed,
    flight,
    reach,
    sighted: p.out.sightSide !== undefined,
    charged: p.out.charged !== undefined,
    hold: shot && shot.hold > 0 ? shot.hold : 1,
    // What one charge takes from the robot's energy: its draw for as long as it charges.
    cost: p.spec.powerDraw * (shot && shot.charge > 0 ? shot.charge : 0),
    draw: p.spec.powerDraw,
  };
}

/**
 * Where to point so what leaves `from` at `speed` meets a point at `pos` moving at `vel`: where it is after the
 * flight time (solved three times), raised by what a shell falls in that time. A beam (`speed` 0) points straight at
 * it, a tick ahead of how it moves against us.
 */
function lead(pos, vel, from, speed) {
  const rx = pos.x - from.x;
  const ry = pos.y - from.y;
  const vx = vel.x - self.vel.x;
  const vy = vel.y - self.vel.y;
  if (!(speed > 0)) {
    const bx = rx + vx * dt;
    const by = ry + vy * dt;
    return { angle: Math.atan2(by, bx), distance: Math.hypot(bx, by) };
  }
  let t = Math.hypot(rx, ry) / speed;
  let px = rx;
  let py = ry;
  for (let i = 0; i < 3; i++) {
    px = rx + vx * t;
    py = ry + vy * t;
    t = Math.hypot(px, py) / speed;
  }
  return { angle: Math.atan2(py + 0.5 * G * t * t, px), distance: Math.hypot(px, py) };
}

/** The enemy this part goes for: the nearest it can swing to, keeping the one it has unless another is much closer. */
function pick(st, d, rest, swing) {
  let best;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.distance > TRACK || (st.skip[c.id] || 0) > time) continue;
    // Not missiles: a shot that takes seconds to charge is for the robot that sent them.
    if (d.charged && c.mass < LIGHT) continue;
    const l = lead(c.pos, c.vel, d.from, d.speed);
    if (Math.abs(wrap(l.angle - rest)) > swing) continue;
    const near = l.distance - (c.id === st.id ? 10 : 0);
    if (!best || near < best.near) best = { c, l, near };
  }
  return best;
}

/**
 * One firing part for one tick: `joint` is what aims it (undefined for a fixed part), `turns` whether this part is
 * the one its joint follows (the first on it; the others on the same joint fire when they come on target themselves).
 */
function engage(gun, joint, turns, allow) {
  const st = state.guns[gun.id] || (state.guns[gun.id] = { id: 0, blocked: 0, skip: {}, want: null, firing: false, since: null, seen: -1000 });
  const d = describe(gun);
  const side = d.sighted ? gun.out.sightSide : SIGHT.nothing;
  const sight = d.sighted ? gun.out.sight : Infinity;
  // How far the joint swings either way, how fast, and where the barrel points with the joint at rest.
  const span = joint ? joint.spec.config.range : 0;
  const turned = joint && joint.out.angle !== undefined && span > 0 ? joint.out.angle : 0;
  const swing = joint ? (span > 0 ? span : Math.PI) : FIXED;
  const rate = joint && joint.spec.config.turnSpeed > 0 ? joint.spec.config.turnSpeed : 1;
  const rest = d.aim - turned * (span > 0 ? span : 0);
  // Charged: how long it has been full (the hold runs from the tick it filled).
  const level = d.charged ? gun.out.charged : 0;
  if (level >= 1) {
    if (st.since === null) st.since = time;
  } else st.since = null;
  const held = st.since === null ? 0 : time - st.since;
  // Ours first on the line, or a friend the sensors track near it all the way out: a charged part never lets go like this.
  const ours = side === SIGHT.own || side === SIGHT.friend || (d.charged && friendOnPath(d.from, d.aim, d.flight));
  const cap = self.energy.capacity;

  const best = pick(st, d, rest, swing);
  if (!best) {
    st.id = 0;
    st.want = null;
    st.blocked = 0;
    if (joint && turns) set(joint.id, 'turn', clamp(-3 * turned, -1, 1));
    if (d.charged) {
      // Nothing to fire at. Charging: after a moment let go, it drains and the energy comes back. Full: hold on for a
      // target; with the hold nearly up, fire at nothing if the line is clear of ours, else let it backfire.
      const keep = level >= 1 ? ours || (allow && held < d.hold - SPARE) : allow && level > 0 && time - st.seen < LINGER;
      st.firing = false;
      set(gun.id, 'fire', keep ? 1 : 0);
      return;
    }
    // No target the sensors track: it still fires at an enemy that crosses its own sight.
    st.firing = allow && d.sighted && side === SIGHT.enemy && sight <= d.reach && !friendOnPath(d.from, d.aim, sight);
    set(gun.id, 'fire', st.firing ? 1 : 0);
    return;
  }
  st.seen = time;
  if (best.c.id !== st.id) {
    st.id = best.c.id;
    st.blocked = 0;
    st.want = null;
  }
  const l = best.l;
  const want = l.angle;
  const err = wrap(want - d.aim);
  if (joint && turns) {
    // The aim point moves: turn at its rate, less the robot's own turning, plus a push toward it.
    const moving = st.want === null ? 0 : wrap(want - st.want) / dt;
    set(joint.id, 'turn', clamp((moving - self.angVel + GAIN * err) / rate, -1, 1));
    mark(d.from.x + Math.cos(want) * l.distance, d.from.y + Math.sin(want) * l.distance, 'aim');
  }
  st.want = want;

  if (d.charged) {
    if (level < 1) {
      // Under way: hold on to the end. Not started: start when the robot can pay for a shot on top of its reserve
      // (batteries too small for both must be full) and the target is near enough to be in reach by the time it is full.
      const powered = cap <= 0 || self.energy.stored >= Math.min(d.cost + RESERVE * cap, 0.98 * cap);
      if (!powered && level <= 0 && allow) say('Aim and fire: too little energy to charge. It waits.');
      st.firing = false;
      set(gun.id, 'fire', allow && (level > 0 || (powered && l.distance <= d.reach + EARLY)) ? 1 : 0);
      return;
    }
    const enemy = side === SIGHT.enemy && sight <= d.reach;
    // The ground first on the line, well short of the target: the shot would only dig a hole.
    const ground = side === SIGHT.terrain && sight < l.distance - 5;
    const on = Math.abs(err) * l.distance <= FINE && l.distance <= d.reach && !ground;
    const lastCall = held >= d.hold - SPARE;
    // F let go with it full means fire now, if the line is clear of ours.
    const go = !ours && (!allow || on || (enemy && held >= d.hold * PATIENCE) || lastCall);
    st.firing = go;
    set(gun.id, 'fire', go ? 0 : 1);
    return;
  }

  if (d.speed <= 0 && d.sighted) {
    // A beam: only while the sight itself shows an enemy in reach, and never into its last energy.
    const powered = cap <= 0 || d.draw <= 0 || self.energy.stored >= BEAM_RESERVE * cap;
    st.firing = allow && powered && side === SIGHT.enemy && sight <= d.reach && !friendOnPath(d.from, d.aim, sight);
    set(gun.id, 'fire', st.firing ? 1 : 0);
    return;
  }

  // Shells: on target means within `SIZE` meters of the aim point (at least `TIGHT` radians); firing already, twice
  // that, so a barrel wobbling on the edge does not stutter.
  const on = Math.abs(err) < Math.max(TIGHT, Math.atan2(SIZE, l.distance)) * (st.firing ? 2 : 1);
  // Something of ours in the way: its own robot, a friend, or the ground, nearer than the target; or a friend near the path.
  const blocked = ((side === SIGHT.own || side === SIGHT.friend || side === SIGHT.terrain) && sight < l.distance) || friendOnPath(d.from, want, l.distance);
  st.blocked = blocked ? st.blocked + dt : 0;
  if (st.blocked > HOLD) {
    st.skip[best.c.id] = time + SKIP;
    st.id = 0;
  }
  // A part on no joint cannot come on target by itself: an enemy on its own sight will do as well.
  const crossing = !joint && side === SIGHT.enemy && sight <= d.reach;
  st.firing = allow && !blocked && ((on && l.distance <= d.reach) || crossing);
  set(gun.id, 'fire', st.firing ? 1 : 0);
}

function tick() {
  const byId = {};
  for (const p of parts) byId[p.id] = p;
  const allow = auto > 0.5 || keys.down(KEY);
  let any = false;
  /** Joints that already follow a part this tick, by id. */
  const led = {};
  for (const gun of parts) {
    if (!gun.tags.includes('fire') || gun.in.fire === undefined) continue;
    any = true;
    // The joint that aims it: the nearest one up the chain of what carries it that is in the group `turn`.
    let joint;
    let at = gun.on;
    for (let n = 0; at && n < 8; n++) {
      const j = byId[at];
      if (!j) break;
      if (j.tags.includes('turn') && j.in.turn !== undefined) {
        joint = j;
        break;
      }
      at = j.on;
    }
    const turns = joint !== undefined && led[joint.id] === undefined;
    if (turns) led[joint.id] = true;
    engage(gun, joint, turns, allow);
  }
  if (!any) say('Aim and fire: nothing is in the group "fire". Put the parts that fire in that group.');
  else if (state.said.indexOf('energy') < 0) say('');
}
