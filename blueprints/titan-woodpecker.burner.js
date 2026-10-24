// Guide of a titan-woodpecker burner (titans round 5, 2026-10): a small flier with a laser on a rotator under it.
// A dart's two heads break about one armor plate where they land; a beam burns armor in full, the first part on its
// line, 600 health a second, so a burner held still burns a tunnel straight to a core: 2.4 plates a second for as long
// as its batteries last (about 7 s, some 18 plates). Lean like the darts: it never loops over parts after setup.
// - setup() reads the base's message (the dart's: the target's point and speed, its id, its size, and `ax`, `ay`, the
//   way in the base's probes found), plus `slot`, its place beside the other burners.
// - It flies to its station: `standoff` m out from the target's core along the way in (straight down from above when
//   the base sent none and the target is wide, else from our side, up at `rise`), moved sideways by its slot. Every
//   burner's beam goes through the core, so beams from stations a few meters apart dig one tunnel. The station moves
//   with the target, so it follows a flier.
// - It hovers on its booster: it steers its speed to the station's, tilting toward where it must go, and its
//   rotator keeps the beam on the core whatever its tilt. The beam burns only while the laser's sight reads an enemy
//   part (or a wreck lying in the tunnel short of the core), within reach and on the line: never a friend.
// - What it follows: the robot it was sent at while that one is alive, else the heaviest enemy with a live core the
//   radio shares (never a robot picked by its id). One hidden from the radio (a jammer's bubble) is held at its last
//   point: a fortress does not move.
// - Spent (energy down to `reserve`, or its life is up): it flies out sideways off the line, so its wreck does not fall
//   into the tunnel, and then drops with everything off and its script asleep.
const standoff = param('standoff', 210, { min: 20, max: 290 }); // m from the target's core to the station
const rise = param('rise', 0.9, { min: 0, max: 1.57 }); // rad up from level: the way in toward a compact target, on our side
const spacing = param('spacing', 4, { min: 1, max: 30 }); // m between two burners' stations
const vmax = param('vmax', 100, { min: 5, max: 200 }); // m/s at most toward the station
const kpos = param('kpos', 0.6, { min: 0.01, max: 10 }); // 1/s: speed asked per m still to go, close in
const brake = param('brake', 8, { min: 0.5, max: 30 }); // m/s^2 it plans to slow down at: the speed asked is at most what stops it at the station
const kvel = param('kvel', 1.2, { min: 0.1, max: 20 }); // 1/s: how hard it steers its speed onto the one asked
const amax = param('amax', 24, { min: 1, max: 100 }); // m/s^2 at most it asks for, gravity aside
const tiltMax = param('tiltMax', 1.0, { min: 0.05, max: 1.5 }); // rad it leans at most
const kp = param('kp', 4, { min: 0, max: 50 });
const kd = param('kd', 3, { min: 0, max: 50 });
const gain = param('gain', 10, { min: 0, max: 100 }); // 1/s: how hard the rotator turns onto the line
const tol = param('tol', 0.006, { min: 0.0005, max: 0.5 }); // rad: the beam burns only this close to the line (a meter at 250 m)
const onStation = param('onStation', 25, { min: 1, max: 300 }); // m from its station within which it burns
const still = param('still', 0.06, { min: 0.001, max: 1 }); // rad/s: or anywhere, while the line to the core turns slower than this
const reach = param('reach', 296, { min: 10, max: 300 }); // m: the beam's reach, from the barrel
const reserve = param('reserve', 900, { min: 0, max: 10000 }); // J kept to fly off the line once spent
const life = param('life', 90, { min: 5, max: 600 }); // s after which it gives up
const every = param('every', 3, { min: 1, max: 60 }); // ticks between two looks through the radio
const climb = param('climb', 16, { min: 0, max: 100 }); // m straight up off the rack: clear of the keep (13 m tall) before it turns
const debug = param('debug', 1, { min: 0, max: 1 });

const SIGHT_ENEMY = 3;
const SIGHT_NONE = 4;

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function setup() {
  state.t = null;
  for (const m of inbox) if (m.data && typeof m.data.x === 'number') state.t = m.data;
  state.born = time;
  state.y0 = self.pos.y;
  state.at = time;
  state.beat = Math.floor(random() * 60);
  state.n = 0;
  state.spent = false;
  state.off = null;
  state.want = null;
  state.force = 0;
  for (const p of parts) if (p.type === 'booster') state.force += p.spec.config.maxForce;
  state.rate = 2;
  for (const p of parts) if (p.type === 'rotator' || p.type === 'heavyrotator') state.rate = p.spec.config.turnSpeed;
  set('radio', 'on', 0);
}

// The robot to follow among what the radio shares: the one it was sent at while alive, else the heaviest enemy with a
// live core of 30 kg or more.
function sighting(id) {
  let main = null;
  let mine = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id === id) mine = c;
    if (c.mass >= 30 && (!main || c.mass > main.mass)) main = c;
  }
  return mine || main;
}

function laserPart() {
  for (const p of parts) if (p.type === 'laser') return p;
  return null;
}

function tick() {
  const t = state.t;
  state.n++;
  const las = laserPart();
  if (!t || state.spent || !las) {
    spentTick(las);
    return;
  }
  if (contacts.length > 0) {
    const c = sighting(t.id);
    if (c) {
      if (c.id !== t.id || t.blind) {
        t.id = c.id;
        t.blind = 0;
        t.ax = undefined;
      }
      t.x = c.pos.x;
      t.y = c.pos.y;
      t.vx = c.vel.x;
      t.vy = c.vel.y;
      state.at = time;
    }
  }
  set('radio', 'on', (state.n + state.beat) % every === 0 ? 1 : 0);
  if (time - state.born > life || self.energy.stored < reserve) {
    state.spent = true;
    if (debug) log('spent', Math.round(time - state.born), 'e', Math.round(self.energy.stored));
    spentTick(las);
    return;
  }
  // Where the core is now, by its last point and speed (a hidden one stays where it was).
  const age = Math.min(time - state.at, 3);
  const tx = t.x + t.vx * age;
  const ty = t.y + t.vy * age;
  // The way in: from the base's probes, else down onto a wide one, else from our side, up at `rise`.
  let ux;
  let uy;
  if (typeof t.ax === 'number') {
    ux = t.ax;
    uy = t.ay;
  } else if (t.top) {
    ux = 0;
    uy = 1;
  } else {
    ux = (state.side ?? (state.side = self.pos.x < tx ? -1 : 1)) * Math.cos(rise);
    uy = Math.sin(rise);
  }
  if (uy < 0.2) {
    // Never from under it or level with it along the ground: from a little above.
    uy = 0.2;
    ux = sign(ux || 1) * Math.sqrt(1 - uy * uy);
  }
  const k = t.slot ?? 0;
  const side = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * spacing;
  const sx = tx + ux * standoff - uy * side;
  const sy = ty + uy * standoff + ux * side;
  const up = self.pos.y - state.y0 < climb && time - state.born < 3;
  hover(sx, sy, t.vx, t.vy, up);
  state.near = Math.hypot(sx - self.pos.x, sy - self.pos.y) < onStation;
  if (up) {
    // Off the rack: the laser hangs straight down until it is clear of the base (turned, it caught on the keep).
    set('rotator', 'turn', clamp(-3 * get('rotator', 'angle'), -1, 1));
    set('laser', 'fire', 0);
    return;
  }
  if (debug && state.n % 60 === 0) log('burner', Math.round(self.pos.x), Math.round(self.pos.y), 'st', Math.round(sx), Math.round(sy), 'e', Math.round(self.energy.stored), 'v', Math.round(self.vel.x), Math.round(self.vel.y), 'ang', Math.round(self.angle * 57), 'n', parts.length, 'thr', Math.round(100 * (state.thr || 0)));
  aim(las, tx, ty);
}

/** Steer toward (x, y), moving with (vx, vy): lean toward where it must go, thrust enough to hold its height. */
function hover(x, y, vx, vy, up) {
  const px = self.pos.x;
  const py = self.pos.y;
  let ax;
  let ay;
  if (up) {
    ax = 0;
    ay = amax;
  } else {
    const ex = x - px;
    const ey = y - py;
    const d = Math.hypot(ex, ey) || 1;
    const sp = Math.min(vmax, kpos * d, Math.sqrt(2 * brake * d));
    ax = kvel * (vx + (ex / d) * sp - self.vel.x);
    ay = kvel * (vy + (ey / d) * sp - self.vel.y);
    const a = Math.hypot(ax, ay);
    if (a > amax) {
      ax *= amax / a;
      ay *= amax / a;
    }
  }
  ay += 9.81;
  const want = clamp(Math.atan2(-ax, ay), -tiltMax, tiltMax);
  const err = wrap(want - self.angle);
  set('heavygyro', 'spin', clamp(-(kp * err - kd * self.angVel), -1, 1));
  // Thrust along its own axis (up the body): the share of the asked push that lies along it.
  const along = -Math.sin(self.angle) * ax + Math.cos(self.angle) * ay;
  state.thr = clamp((along * self.mass) / Math.max(state.force, 1), 0, 1);
  set('booster', 'throttle', state.thr);
}

/** The rotator keeps the beam on the core; the beam burns only when on the line and an enemy part is in front. */
function aim(las, tx, ty) {
  const a = las.out.aim;
  const fx = las.pos.x;
  const fy = las.pos.y;
  const dx = tx - fx;
  const dy = ty - fy;
  if (Math.hypot(dx, dy) > reach + 60) {
    // Far out: the laser hangs straight, so its weight does not swing about the burner on the way.
    state.want = null;
    set('rotator', 'turn', clamp(-3 * get('rotator', 'angle'), -1, 1));
    set('laser', 'fire', 0);
    return;
  }
  const want = Math.atan2(dy, dx);
  const moving = state.want === null ? 0 : wrap(want - state.want) / dt;
  state.want = want;
  const err = wrap(want - a);
  set('rotator', 'turn', clamp((moving - self.angVel + gain * err) / state.rate, -1, 1));
  const dist = Math.hypot(dx, dy);
  const side = las.out.sightSide;
  const sight = las.out.sight;
  const wreck = side === SIGHT_NONE && sight > 3 && sight < dist + 2;
  // Only from its station, or while the line holds still: a beam swept across armor while flying in warmed many
  // plates and broke few (six burners took 25 parts off a fortress).
  const steady = state.near || Math.abs(moving) < still;
  const fire = steady && dist <= reach + 40 && sight <= reach && Math.abs(err) < tol && (side === SIGHT_ENEMY || wreck) ? 1 : 0;
  set('laser', 'fire', fire);
  if (debug) {
    state.fires = (state.fires || 0) + fire;
    state.errs = Math.max(state.errs || 0, Math.abs(err));
    if (state.n % 60 === 0) {
      log('aim', 'fires', state.fires, 'maxerr', Math.round(state.errs * 1000), 'side', side, 'sight', Math.round(sight), 'dist', Math.round(dist), 'near', state.near ? 1 : 0, 'mv', Math.round(moving * 1000));
      state.fires = 0;
      state.errs = 0;
    }
  }
}

/** Spent: out sideways off the line for a few seconds, then everything off and asleep. */
function spentTick(las) {
  set('laser', 'fire', 0);
  set('radio', 'on', 0);
  if (!state.off) state.off = { x: self.pos.x + (self.pos.x < (state.t ? state.t.x : 0) ? -80 : 80), y: self.pos.y, at: time };
  if (time - state.off.at < 4 && self.energy.stored > 50) {
    hover(state.off.x, state.off.y, 0, 0, false);
    return;
  }
  set('booster', 'throttle', 0);
  set('heavygyro', 'spin', 0);
  set('rotator', 'turn', 0);
  sleep(30);
}
