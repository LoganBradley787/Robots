// Laser turrets (M14): every placed `laser-turret` on this robot aims and burns by itself. A turret is a rotator
// carrying a laser; its parts are tagged <turret>.rot and <turret>.laser (`pnpm sim place` names them), so this one
// script works with any number of turrets, whatever they are called.
// - Target: robots on the other side the radar tracks within `track` meters that this turret can swing to (it turns
//   `swing` degrees either way from how it was built). Something light (under `light` kg: a missile, a drone bomb)
//   coming at us faster than `closing` m/s comes first, nearest first; then the nearest of the rest. A robot it could
//   not burn for `hold` seconds (a friend or its own robot in the way) is left for `skip` seconds.
// - Which part: something light is aimed at its middle. On anything heavier it scans the parts and picks the best per
//   second of beam: what the part is worth (guns, lasers, and warheads most, then its core, radar, and lift, frames
//   least) over the health to burn through, its own and that of everything of that robot in front of it on the line.
//   A beam burns armor in full, so a core behind three plates costs 800 health, not 8000. It picks again every
//   `repick` seconds, and when the part is gone; at most one turret picks per tick.
// - Aim: straight at that point (a beam takes no time to get there), a tick ahead of how it moves against us.
// - Burn: only while the laser's sight says the first thing on its line is an enemy within `reach`: it never burns a
//   friend, its own robot, or the ground, and never spends energy on empty air. It also holds while a friend the radar
//   tracks is within `clear` meters of the line, nearer than what it burns (the sight is a tick old). A wreck (nobody's) it burns only when
//   it hangs in front of the target. A laser draws 600 W while it
//   burns, so below `reserve` of the robot's energy it stops (a flier keeps enough to stay up) and says so once.
const reach = param('reach', 300, { min: 1, max: 1000 }); // m: the laser's range (the laser part)
const track = param('track', 450, { min: 1, max: 1000 }); // m: further than this it does not point at things
const swing = (param('swing', 90, { min: 1, max: 180 }) * Math.PI) / 180; // degrees either way a turret turns (the rotator's range)
const gain = param('gain', 6, { min: 0.1, max: 50 }); // turn rate per radian off the aim
const rate = param('rate', 2, { min: 0.1, max: 20 }); // rad/s, the rotator's fastest turn (for following a moving aim)
const hold = param('hold', 0.5, { min: 0, max: 10 }); // s blocked before it gives up on a target
const skip = param('skip', 1.5, { min: 0, max: 30 }); // s it leaves a target it gave up on
const light = param('light', 10, { min: 0, max: 1000 }); // kg: lighter targets are aimed at their middle, and come first when closing
const closing = param('closing', 5, { min: 0, max: 500 }); // m/s: a light robot coming at us this fast is a threat
const repick = param('repick', 0.3, { min: 0, max: 5 }); // s between choosing which part to aim at
const clear = param('clear', 10, { min: 0, max: 50 }); // m: a friend's center this close to the line holds fire
const reserve = param('reserve', 0.3, { min: 0, max: 1 }); // share of the robot's energy it never burns into
const huge = param('huge', 600, { min: 10, max: 100000 }); // parts: a robot bigger than this is weighed only near its closest part
const band = param('band', 4, { min: 0.5, max: 50 }); // m behind a huge robot's closest part that are weighed
const most = param('most', 150, { min: 10, max: 2000 }); // parts of a huge robot weighed at most
// What burning each kind of part is worth: disarm it, blow it up, kill or blind it, then ground it.
const WORTH = { laser: 12, gun: 10, heavywarhead: 12, warhead: 10, core: 8, radar: 6, rotator: 4, booster: 4, propeller: 4, thruster: 3, fabbay: 5, seeker: 3, battery: 2, densebattery: 2, heavygyro: 2, gyro: 2, wheel: 2, cell: 1, decoupler: 1, flare: 0.5, frame: 0.5, armorplate: 0.5 };
const SIGHT = { nothing: 0, own: 1, friend: 2, enemy: 3, none: 4, terrain: 5 };

function setup() {
  state.turrets = {};
  state.low = false;
}

/** The turrets still on the robot, by name, from their lasers' tags. */
function turrets() {
  const names = [];
  for (const p of parts) {
    for (const t of p.tags) {
      const m = /^(.*)\.laser$/.exec(t);
      if (m && !names.includes(m[1])) names.push(m[1]);
    }
  }
  return names;
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * A friend the radar tracks within `clear` meters of the line from `from` toward `angle`, nearer than `distance`. The
 * sight is a tick old and the beam sweeps, so a friend sliding into the line is caught before the sight shows it.
 */
function friendOnPath(from, angle, distance) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  for (const c of contacts) {
    if (c.side !== 'friend') continue;
    const rx = c.center.x - from.x;
    const ry = c.center.y - from.y;
    const along = rx * ux + ry * uy;
    if (along < 0 || along > distance) continue;
    if (Math.abs(rx * uy - ry * ux) < clear) return true;
  }
  return false;
}

/** The part with this tag, or undefined. */
function tagged(tag) {
  for (const p of parts) if (p.tags.includes(tag)) return p;
  return undefined;
}

/** A robot's parts as the radar scans them, once per tick however many turrets ask (at most 4 scans a tick). */
function scanned(id) {
  if (state.scanTick !== frame) {
    state.scanTick = frame;
    state.scans = {};
  }
  if (!(id in state.scans)) state.scans[id] = scan(id);
  return state.scans[id];
}

/**
 * The part of `target` worth the most per second of beam from `from`: its worth over its health plus the health of
 * everything of that robot within half a cell of the line in front of it. Undefined when it cannot be scanned.
 */
function bestPart(target, from) {
  let list = scanned(target.id);
  if (!list || list.length === 0) return undefined;
  // A huge robot: only the parts within `band` m of its part nearest this turret, `most` of them at most.
  if (list.length > huge) {
    let near = Infinity;
    for (const p of list) {
      const d = Math.hypot(p.pos.x - from.x, p.pos.y - from.y);
      if (d < near) near = d;
    }
    const cut = [];
    for (const p of list) {
      if (Math.hypot(p.pos.x - from.x, p.pos.y - from.y) > near + band) continue;
      cut[cut.length] = p;
      if (cut.length >= most) break;
    }
    list = cut;
  }
  // Best first by what each could score with nothing in front of it; stop once none left can beat the best.
  const order = list.map((p) => ({ p, bound: (WORTH[p.type] ?? 1) / Math.max(1, p.health) }));
  order.sort((a, b) => b.bound - a.bound);
  let best;
  for (const { p, bound } of order) {
    if (best && bound <= best.score) break;
    const rx = p.pos.x - from.x;
    const ry = p.pos.y - from.y;
    const d = Math.hypot(rx, ry);
    if (d < 0.1) continue;
    const ux = rx / d;
    const uy = ry / d;
    let cost = Math.max(1, p.health);
    for (const q of list) {
      if (q === p) continue;
      const qx = q.pos.x - from.x;
      const qy = q.pos.y - from.y;
      const along = qx * ux + qy * uy;
      if (along <= 0 || along >= d - 0.3) continue;
      if (Math.abs(qx * uy - qy * ux) < 0.6) cost += q.health;
    }
    const score = (WORTH[p.type] ?? 1) / cost;
    if (!best || score > best.score) best = { id: p.id, score };
  }
  return best && best.id;
}

/** Where to point to burn a point at `pos` moving at `vel` from `from`: a tick ahead of how it moves against us. */
function point(pos, vel, from) {
  const px = pos.x + (vel.x - self.vel.x) * dt - from.x;
  const py = pos.y + (vel.y - self.vel.y) * dt - from.y;
  return { angle: Math.atan2(py, px), distance: Math.hypot(px, py) };
}

/** How fast a contact comes at us (m/s, positive closing). */
function closingSpeed(c) {
  const rx = c.pos.x - self.pos.x;
  const ry = c.pos.y - self.pos.y;
  const d = Math.max(0.1, Math.hypot(rx, ry));
  return -((c.vel.x - self.vel.x) * rx + (c.vel.y - self.vel.y) * ry) / d;
}

function aimTurret(name, charged) {
  const laser = tagged(name + '.laser');
  const rot = tagged(name + '.rot');
  if (!laser || !rot) return;
  const st = state.turrets[name] || (state.turrets[name] = { id: 0, blocked: 0, skip: {}, want: undefined, part: undefined, aimed: undefined, picked: -Infinity });
  const aim = laser.out.aim;
  // How it was built: its aim now, less how far it has turned (-1 to 1 of its range).
  const rest = aim - get(name + '.rot', 'angle') * swing;
  // The barrel's end: the base cell's center plus a cell and a half along the aim.
  const from = { x: laser.pos.x + 1.5 * Math.cos(aim), y: laser.pos.y + 1.5 * Math.sin(aim) };
  let best;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.distance > track || (st.skip[c.id] || 0) > time) continue;
    const l = point(c.pos, c.vel, from);
    if (Math.abs(wrap(l.angle - rest)) > swing) continue;
    // Threats first; keep the target it has unless something is much closer.
    const threat = c.mass < light && closingSpeed(c) > closing;
    const d = l.distance - (c.id === st.id ? 10 : 0) - (threat ? 10000 : 0);
    if (!best || d < best.d) best = { c, l, d };
  }
  if (!best) {
    st.id = 0;
    st.want = undefined;
    set(name + '.laser', 'fire', 0);
    set(name + '.rot', 'turn', clamp(-3 * get(name + '.rot', 'angle'), -1, 1));
    return;
  }
  if (best.c.id !== st.id) {
    st.id = best.c.id;
    st.blocked = 0;
    st.want = undefined;
    st.part = undefined;
    st.picked = -Infinity;
  }
  // A heavy target: aim at the part chosen, if it is still there.
  let l = best.l;
  if (best.c.mass >= light) {
    if ((time - st.picked >= repick || st.part === undefined) && state.pickFrame !== frame) {
      state.pickFrame = frame;
      st.part = bestPart(best.c, from);
      st.picked = time;
    }
    const list = st.part === undefined ? undefined : scanned(best.c.id);
    const p = list && list.find((x) => x.id === st.part);
    if (p) l = point(p.pos, best.c.vel, from);
    else st.part = undefined;
    // A new part is a jump in the aim point, not its motion: do not turn at that jump's rate.
    if (st.part !== st.aimed) st.want = undefined;
    st.aimed = st.part;
  }
  const want = l.angle;
  // The aim point moves: turn at its rate, plus a push toward it, less its own robot's spin (the rotator turns
  // against its base; a drone pitching while it flies swung the beam off a part 200 m away).
  const moving = st.want === undefined ? 0 : wrap(want - st.want) / dt;
  st.want = want;
  const err = wrap(want - aim);
  set(name + '.rot', 'turn', clamp((moving - self.angVel + gain * err) / rate, -1, 1));
  const side = laser.out.sightSide;
  // Something of ours in the way of the target: its own robot, a friend, or the ground.
  const blocked = ((side === SIGHT.own || side === SIGHT.friend || side === SIGHT.terrain) && laser.out.sight < l.distance) || friendOnPath(from, aim, Math.min(laser.out.sight, l.distance) + 2);
  st.blocked = blocked ? st.blocked + dt : 0;
  if (st.blocked > hold) {
    st.skip[best.c.id] = time + skip;
    st.id = 0;
  }
  // Burn whatever enemy is first on the line (sweeping across one on the way to the target burns it too), or a wreck
  // just in front of the target (a part burnt off it and hanging on the line kept the beam off for 10 s). Only near
  // the target: a wreck of ours still carrying a warhead or a laser could be anywhere else on the line.
  const wreck = side === SIGHT.none && laser.out.sight < l.distance + 2 && laser.out.sight > l.distance - 15;
  const burn = charged && (side === SIGHT.enemy || wreck) && laser.out.sight <= reach && !blocked;
  set(name + '.laser', 'fire', burn ? 1 : 0);
  mark(from.x + Math.cos(want) * l.distance, from.y + Math.sin(want) * l.distance, name);
}

function tick() {
  const cap = self.energy.capacity;
  const share = cap > 0 ? self.energy.stored / cap : 0;
  // A little above the reserve before it starts again, so it does not flicker on the line.
  // A robot with no batteries at all (cap 0) has nothing to keep: it burns while the pool lets it.
  const charged = cap <= 0 || (state.low ? share > reserve + 0.02 : share > reserve);
  if (!charged && !state.low) log('lasers low on energy: holding fire');
  if (charged && state.low) log('lasers back on');
  state.low = !charged;
  for (const name of turrets()) aimTurret(name, charged);
}
