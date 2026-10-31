// Tumbler gunner: the tumbler with a fixed gun on each face. It has no turrets: the whole robot turns to aim. Each tick
// it picks the nearest enemy and the live gun that needs the least turning to face it, turns that gun onto where the
// shells will meet the enemy, and fires only that gun. When the gun goes, the next nearest takes over and it swings round.
// Every jet's throttle comes from the live parts list, as on the tumbler, for the push it wants in the world and the turn.
// With no key held it closes on the enemy and holds `standoff` off it. W S A D take over, up, down, left, right on the
// screen whatever its angle, and it goes on aiming and firing. With nothing to shoot at it hovers and drifts round.
// Flying comes before aiming: if the only gun left would pin a dead face under it, it tumbles and fires as the gun passes.
const speed = param('speed', 12, { min: 2, max: 30 }); // m/s it flies at
const standoff = param('standoff', 60, { min: 10, max: 140 }); // m it closes to and holds from the enemy
const reach = param('reach', 0.5, { min: 0.1, max: 1 }); // share of a shell's whole flight it fires within
const drift = param('drift', 0.4, { min: 0, max: 2 }); // rad/s it drifts round at with nothing to shoot at
const whip = param('whip', 3, { min: 0.5, max: 6 }); // rad/s, the fastest it swings a gun round
const stiff = param('stiff', 1.5, { min: 0.2, max: 4 }); // how hard it comes back to where it wants to be, per second
const brisk = param('brisk', 3, { min: 0.5, max: 8 }); // how fast it reaches the speed it wants, per second
const creep = param('creep', 0.3, { min: 0, max: 2 }); // how fast it learns a steady sag, m/s^2 per m second
const clearance = param('clearance', 2.5, { min: 0, max: 10 }); // m it keeps between its tips and the ground at y 0
const trimmost = 3; // m/s^2: the most that learning may add
const trimNear = 2; // m: it only learns the sag this close to where it wants to be
const brake = 4; // m/s^2 it plans on at most to stop above the ground
const planLift = 0.6; // share of the lift it has to spare that it plans on to stop above the ground
const hoverOn = 1.15; // times its weight: the lift it asks of the way it faces, so a dead face is never left underneath
const sideOn = 0.25; // times its weight: the push it asks of the way it faces, left and right
const leak = 0.1; // of a jet's push: what may be left over sideways when it works out what it can hold up
const lookAhead = 0.5; // s: it drifts on only if it could hover this much further round
const aimUp = 6; // per second: how fast an aim error turns into turning
const spinUp = 10; // per second: how fast a turning error turns into torque while it aims
const spinEasy = 2; // per second, and where it cannot hover: a hard turn would take jets off holding it up
const planTurn = 0.4; // share of the torque the jets could give that it plans on to stop a swing
const keepGun = 0.3; // radians: another gun must need this much less turning to take over
const keepTarget = 10; // m: another enemy must be this much nearer to take over
const size = 1; // m off the aim point that still counts as on target
const tight = 0.012; // radians: on target at the least this close
const clear = 6; // m: a friend's center this close to the path holds fire
const passes = 12; // rounds of the throttle solve per tick
const liftFirst = 4; // when the jets cannot do everything, the vertical push counts this many times more
const turnFirst = 4; // and the turn, where it can hover, this many times more
const reg = 0.002; // keeps the solve from swinging one jet against its neighbour
const thrift = 0.01; // what a unit of throttle costs in the solve, so two jets never fight each other for nothing
const g = 9.81;
const OURS = [1, 2, 5]; // what a gun's sight reports as its own robot, a friend, or the ground

function setup() {
  state.u = {}; // each jet's throttle last tick, where this tick's solve starts
  state.jets = -1;
  state.guns = -1;
  state.gun = '';
  state.target = 0;
  state.bearing = undefined; // the bearing to the aim point last tick, for how fast it moves
  state.aimedAt = 0; // and the enemy that was
  state.firing = false;
  state.clear = false;
  state.x = self.pos.x; // the point it wants to be at
  state.y = self.pos.y;
  state.trimX = 0;
  state.trimY = 0;
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** The way a part acts in the world. */
function acts(p) {
  return p.angle + ((p.rot + p.spec.acts) * Math.PI) / 180;
}

/** The end of a gun's barrel in the world. */
function muzzle(p) {
  const a = p.angle + (p.rot * Math.PI) / 180;
  const tip = p.spec.tip;
  return { x: p.pos.x + tip.x * Math.cos(a) - tip.y * Math.sin(a), y: p.pos.y + tip.x * Math.sin(a) + tip.y * Math.cos(a) };
}

/** Where to point from `from` to hit a contact: ahead by the shell's flight and up by its drop, as the stock turrets do. */
function lead(c, from, shell) {
  const rx = c.pos.x - from.x;
  const ry = c.pos.y - from.y;
  const vx = c.vel.x - self.vel.x;
  const vy = c.vel.y - self.vel.y;
  let t = Math.hypot(rx, ry) / shell;
  let px = rx;
  let py = ry;
  for (let i = 0; i < 3; i++) {
    px = rx + vx * t;
    py = ry + vy * t;
    t = Math.hypot(px, py) / shell;
  }
  return { angle: Math.atan2(py + 0.5 * g * t * t, px), distance: Math.hypot(px, py) };
}

/** The nearest enemy with a core. Keeps the one it has unless something is much closer. */
function pickTarget() {
  let best;
  let near = Infinity;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    const d = c.distance - (c.id === state.target ? keepTarget : 0);
    if (d < near) {
      near = d;
      best = c;
    }
  }
  return best;
}

/** The most the jets can push along (ux, uy), in N, with the robot turned by `by` from where it is now. */
function pushAt(jets, strongest, by, ux, uy) {
  const c = Math.cos(by);
  const s = Math.sin(by);
  let push = 0;
  for (const j of jets) push += Math.max(0, ux * (j.dx * c - j.dy * s) + uy * (j.dx * s + j.dy * c));
  return push * strongest;
}

/**
 * What the jets can hold up with no push left over sideways, in N, with the robot turned by `by` from where it is now.
 * Jets that lift and lean one way are only as much use as the ones leaning the other way balance them: a robot with a
 * face gone can push only on the side away from that face, so straight up is out of reach with it in the lower half.
 */
function liftAt(jets, strongest, by) {
  const c = Math.cos(by);
  const s = Math.sin(by);
  let rightUp = 0;
  let rightOut = 0;
  let leftUp = 0;
  let leftOut = 0;
  for (const j of jets) {
    const x = j.dx * c - j.dy * s;
    const y = j.dx * s + j.dy * c;
    if (y <= 0) continue;
    if (x > 0) {
      rightUp += y;
      rightOut += x;
    } else {
      leftUp += y;
      leftOut -= x;
    }
  }
  if (rightOut > leftOut) return strongest * (leftUp + rightUp * Math.min(1, (leftOut + leak) / rightOut));
  return strongest * (rightUp + leftUp * Math.min(1, (rightOut + leak) / leftOut));
}

/**
 * The gun that needs the least turning to face `bearing`, of those it can still fly with once it faces it: a whole face
 * of jets shot off must not end up where it is needed to hold it up, or to stop the gun's kick pushing it away. Gravity
 * pulls it down for free, so a dead face does best on top. Keeps the one it has unless another is much closer.
 */
function pickGun(guns, bearing, jets, strongest, weight) {
  let best;
  let least = Infinity;
  for (const p of guns) {
    const by = wrap(bearing - acts(p));
    const mine = p.id === state.gun;
    const ask = weight * (mine ? 1 : 1.1);
    const up = liftAt(jets, strongest, by);
    const side = Math.min(pushAt(jets, strongest, by, 1, 0), pushAt(jets, strongest, by, -1, 0));
    const off = Math.abs(by) - (mine ? keepGun : 0) + (up < ask * hoverOn ? 2 * Math.PI : 0) + (side < ask * sideOn ? 2 * Math.PI : 0);
    if (off < least) {
      least = off;
      best = p;
    }
  }
  return best;
}

/** A friend the radar tracks within `clear` meters of the path from `from` toward `angle`, nearer than `distance`. */
function friendOnPath(from, angle, distance) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  for (const c of contacts) {
    if (c.side !== 'friend') continue;
    const rx = c.center.x - from.x;
    const ry = c.center.y - from.y;
    const along = rx * ux + ry * uy;
    if (along >= 0 && along <= distance && Math.abs(rx * uy - ry * ux) < clear) return true;
  }
  return false;
}

/** The speed one axis wants. While a key is held the point it wants to be at moves to where it would stop if let go. */
function wanted(axis, plus, minus, center, vel) {
  const k = (plus ? 1 : 0) - (minus ? 1 : 0);
  if (k !== 0) state[axis] = center + vel / brisk;
  return k !== 0 ? k * speed : clamp(stiff * (state[axis] - center), -speed, speed);
}

function tick() {
  // What is left of the robot: its mass, center, and how hard it is to turn.
  let m = 0;
  let cx = 0;
  let cy = 0;
  for (const p of parts) {
    m += p.mass;
    cx += p.mass * p.pos.x;
    cy += p.mass * p.pos.y;
  }
  cx /= m;
  cy /= m;
  let inertia = 0;
  let span = 0;
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    const d2 = dx * dx + dy * dy;
    inertia += p.mass * (d2 + 1 / 6);
    if (d2 > span) span = d2;
  }
  const floor = Math.sqrt(span) + Math.SQRT2 / 2 + clearance;

  // Every jet as it is right now: how much of each wanted thing a full throttle gives.
  const jets = [];
  let strongest = 1;
  for (const p of parts) {
    if (p.tags.includes('jets') && p.in.throttle !== undefined && p.spec.config.maxForce > strongest) strongest = p.spec.config.maxForce;
  }
  const arm = Math.max(1, Math.sqrt(span) / 2); // moments in units of the same size as forces
  let spinPlus = 0; // what all the jets that turn it counterclockwise give, and the same clockwise
  let spinMinus = 0;
  for (const p of parts) {
    if (!p.tags.includes('jets') || p.in.throttle === undefined) continue;
    const a = acts(p);
    const f = p.spec.config.maxForce / strongest;
    const dx = f * Math.cos(a);
    const dy = f * Math.sin(a);
    const dz = ((p.pos.x - cx) * dy - (p.pos.y - cy) * dx) / arm;
    jets.push({ id: p.id, dx, dy, dz, u: state.u[p.id] || 0 });
    if (dz > 0) spinPlus += dz;
    else spinMinus -= dz;
  }
  if (jets.length !== state.jets) {
    if (state.jets >= 0) log('tumbler-gunner: ' + jets.length + ' jets left');
    state.jets = jets.length;
  }

  // What it is shooting at, and with what.
  const guns = [];
  for (const p of parts) if (p.tags.includes('guns') && p.in.fire !== undefined) guns.push(p);
  if (guns.length !== state.guns) {
    if (state.guns >= 0) log('tumbler-gunner: ' + guns.length + ' guns left');
    state.guns = guns.length;
  }
  const target = guns.length > 0 ? pickTarget() : undefined;
  state.target = target ? target.id : 0;
  let gun;
  let holds = false; // whether it can hover with that gun on target
  if (target) {
    const bearing = lead(target, { x: cx, y: cy }, guns[0].spec.gun.speed).angle;
    gun = pickGun(guns, bearing, jets, strongest, m * g);
    state.gun = gun.id;
    holds = liftAt(jets, strongest, wrap(bearing - acts(gun))) >= m * g * hoverOn;
  }

  // Where it wants to be: on the line to the enemy, `standoff` off it, unless a key has it.
  const left = keys.down('a');
  const right = keys.down('d');
  const up = keys.down('w');
  const down = keys.down('s');
  if (target && !left && !right && !up && !down) {
    const rx = cx - target.pos.x;
    const ry = cy - target.pos.y;
    const d = Math.max(1, Math.hypot(rx, ry));
    state.x = target.pos.x + (rx / d) * standoff;
    state.y = target.pos.y + (ry / d) * standoff;
  }

  // The push it wants, in the world.
  const wantX = wanted('x', right, left, cx, self.vel.x);
  if (state.y < floor) state.y = floor;
  const above = cy - floor;
  const lift = liftAt(jets, strongest, 0);
  const stopping = clamp(planLift * (lift / m - g), 0.5, brake);
  const wantY = Math.max(wanted('y', up, down, cy, self.vel.y), above > 0 ? -Math.sqrt(2 * stopping * above) : -stiff * above);
  if (!left && !right && Math.abs(state.x - cx) < trimNear) state.trimX = clamp(state.trimX + creep * (state.x - cx) * dt, -trimmost, trimmost);
  if (!up && !down && Math.abs(state.y - cy) < trimNear) state.trimY = clamp(state.trimY + creep * (state.y - cy) * dt, -trimmost, trimmost);
  const fx = m * (brisk * (wantX - self.vel.x) + state.trimX);
  const fy = m * (brisk * (wantY - self.vel.y) + state.trimY + g);

  // The turn it wants. Clear of the ground first: a tip would dig in.
  if (cy > floor - clearance) state.clear = true;
  let fire = false;
  // Drifting round: it stops short of a way of facing that cannot hold it up, and hurries past one it finds itself in.
  const hovers = lift >= m * g * hoverOn;
  let rate = !hovers ? whip : liftAt(jets, strongest, drift * lookAhead) < m * g * hoverOn ? 0 : drift;
  if (gun) {
    const from = muzzle(gun);
    const shell = gun.spec.gun;
    const l = lead(target, from, shell.speed);
    const err = wrap(l.angle - acts(gun));
    // The aim point moves: turn at its rate, plus a push toward it, no faster than it can stop in.
    const moving = state.bearing === undefined || state.aimedAt !== target.id ? 0 : wrap(l.angle - state.bearing) / dt;
    state.bearing = l.angle;
    state.aimedAt = target.id;
    const stop = (planTurn * (err > 0 ? spinMinus : spinPlus) * strongest * arm) / inertia;
    const swing = Math.min(aimUp * Math.abs(err), whip, Math.sqrt(2 * stop * Math.abs(err)));
    rate = holds ? moving + (err > 0 ? swing : -swing) : whip;
    // On target: within `size` meters of the aim point (or `tight` radians); firing already, twice that. Tumbling, a
    // gun passes that in less than a tick: the tick's turn is added, so it fires as it goes by.
    const within = Math.max(tight, Math.atan2(size, l.distance)) * (state.firing ? 2 : 1) + (holds ? 0 : Math.abs(self.angVel) * dt);
    const blocked = (OURS.includes(gun.out.sightSide) && gun.out.sight < l.distance) || friendOnPath(from, l.angle, l.distance);
    fire = Math.abs(err) < within && l.distance <= reach * shell.speed * shell.life && !blocked;
    mark(from.x + Math.cos(l.angle) * l.distance, from.y + Math.sin(l.angle) * l.distance, 'aim');
  } else {
    state.bearing = undefined;
  }
  state.firing = fire;
  for (const p of guns) set(p.id, 'fire', fire && p === gun ? 1 : 0);
  const firm = gun ? holds : hovers;
  const turn = inertia * (firm ? spinUp : spinEasy) * ((state.clear ? rate : 0) - self.angVel);
  const turnWeight = firm ? turnFirst : 1;

  // Throttles from 0 to 1 that come closest to all three: one jet at a time, several rounds, from last tick's answer.
  let rx = fx / strongest;
  let ry = fy / strongest;
  let rz = turn / (strongest * arm);
  for (const j of jets) {
    rx -= j.dx * j.u;
    ry -= j.dy * j.u;
    rz -= j.dz * j.u;
  }
  for (let pass = 0; pass < passes; pass++) {
    for (const j of jets) {
      const grad = j.dx * rx + liftFirst * j.dy * ry + turnWeight * j.dz * rz - reg * j.u - thrift;
      const curve = j.dx * j.dx + liftFirst * j.dy * j.dy + turnWeight * j.dz * j.dz + reg;
      const next = clamp(j.u + grad / curve, 0, 1);
      const du = next - j.u;
      j.u = next;
      rx -= j.dx * du;
      ry -= j.dy * du;
      rz -= j.dz * du;
    }
  }
  const u = {};
  for (const j of jets) {
    u[j.id] = j.u;
    set(j.id, 'throttle', j.u);
  }
  state.u = u;
}
