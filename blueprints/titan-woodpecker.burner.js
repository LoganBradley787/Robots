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
const spacing = param('spacing', 8, { min: 1, max: 30 }); // m between two burners' stations
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
const wary = param('wary', 235, { min: 0, max: 1000 }); // m from a target with lasers inside which it creeps
const creep = param('creep', 9, { min: 1, max: 100 }); // m/s it closes at, at most, there (a sled's point defense burns what closes faster than 15)
const wiseOff = param('wiseOff', 282, { min: 20, max: 295 }); // m from the core of a target with lasers to the station
const wise = param('wise', 1.1, { min: 0, max: 1.57 }); // rad up from level on our side: the way in to a target with lasers
const keepOff = param('keepOff', 130, { min: 0, max: 500 }); // m: it keeps this far from other enemy robots (guns reach 100)
const awayK = param('awayK', 0.5, { min: 0, max: 10 }); // m/s asked away from one per m it is too near
const awayMass = param('awayMass', 25, { min: 0, max: 100000 }); // kg: lighter enemy robots (darts, pods) are not kept away from nor flown over
const dartSpeed = param('dartSpeed', 45, { min: 1, max: 1000 }); // m/s: an enemy faster than this is a dart, not kept away from
const cruise = param('cruise', 90, { min: 0, max: 500 }); // m over the highest enemy robot it flies at on the way
const cruiseNear = param('cruiseNear', 120, { min: 0, max: 1000 }); // m from its station (sideways) where it stops cruising high
const hunt = param('hunt', 45, { min: 0, max: 600 }); // s a hidden robot it was sent at is hunted before it takes another
const huntAge = param('huntAge', 8, { min: 0, max: 60 }); // s a hidden mover is guessed on along its way
const searchAfter = param('searchAfter', 6, { min: 0, max: 120 }); // s near a still hidden one's place with nothing found before it searches
const searchSpeed = param('searchSpeed', 25, { min: 1, max: 200 }); // m/s the search's guess walks
const searchFar = param('searchFar', 600, { min: 0, max: 3000 }); // m at most the search walks out
const huntUp = param('huntUp', 130, { min: 10, max: 290 }); // m over the guess it hunts from
const huntSpread = param('huntSpread', 45, { min: 0, max: 300 }); // m between two hunting burners
const sweep = param('sweep', 1.25, { min: 0, max: 1.5 }); // rad either side of straight down the feeler swings
const sweepRate = param('sweepRate', 1.2, { min: 0.1, max: 10 }); // rad/s of the feeler's swing phase
const gunBurn = param('gunBurn', 0.25, { min: 0, max: 5 }); // s of beam on each of the target's guns (25 health: a tenth of that)
const gunTry = param('gunTry', 0.4, { min: 0, max: 30 }); // s it tries for a gun before it lets it be
const laserBurn = param('laserBurn', 1, { min: 0, max: 10 }); // s of beam on each of the target's lasers
const laserTry = param('laserTry', 3, { min: 0, max: 30 }); // s it tries for a laser before it lets it be
const gunNear = param('gunNear', 4, { min: 0.5, max: 50 }); // m: the sight must meet the target this near the gun's point
const clear = param('clear', 170, { min: 0, max: 290 }); // m from the target's core it keeps on the way to its station
const roundStep = param('roundStep', 0.5, { min: 0.05, max: 3 }); // rad round the target to the next point on the way
const deep = param('deep', 75, { min: 1, max: 300 }); // m from the core: the beam burns what it meets only this near it
const blockFor = param('blockFor', 1.5, { min: 0.05, max: 10 }); // s of a blocked line before it takes another way in
const turns = [0, 0.3, -0.3, 0.6, -0.6]; // rad: the ways in it tries in turn
const reserve = param('reserve', 900, { min: 0, max: 10000 }); // J kept to fly off the line once spent
const life = param('life', 90, { min: 5, max: 600 }); // s after which it gives up
const every = param('every', 3, { min: 1, max: 60 }); // ticks between two looks through the radio
const climb = param('climb', 16, { min: 0, max: 100 }); // m straight up off the rack: clear of the keep (13 m tall) before it turns
const lazy = param('lazy', 0, { min: 0, max: 1 }); // 1: every other tick on the way
const debug = param('debug', 0, { min: 0, max: 1 }); // 1 logs the burner's flight and aim once a second

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
  state.home = self.pos.x; // where it left from: our base
  state.closeAt = time;
  state.at = time;
  state.beat = Math.floor(random() * 60);
  state.n = 0;
  state.spent = false;
  state.off = null;
  state.want = null;
  state.blocked = 0;
  state.turn = 0;
  state.found = -1000;
  state.force = 0;
  // The target's guns, from its core (titans round 5): burnt first, one after another, nearest first.
  state.n0 = parts.length;
  state.guns = state.t && Array.isArray(state.t.guns) ? state.t.guns.map((g) => ({ x: g[0], y: g[1], fired: 0, tried: 0, need: gunBurn, try: gunTry })) : [];
  // Its lasers first of all (a sled's front turret ends our base from 300 m): plated over and under, so longer on
  // each (a plate in front is 250 health).
  if (state.t && Array.isArray(state.t.lz)) for (const g of state.t.lz) state.guns.unshift({ x: g[0], y: g[1], fired: 0, tried: 0, need: laserBurn, try: laserTry });
  for (const p of parts) if (p.type === 'booster') state.force += p.spec.config.maxForce;
  state.rate = 2;
  for (const p of parts) if (p.type === 'rotator' || p.type === 'heavyrotator') state.rate = p.spec.config.turnSpeed;
  set('radio', 'on', 0);
}

// The robot to follow among what the radio shares: the one it was sent at while alive, else the heaviest enemy with a
// live core of 30 kg or more.
// While it looks, it also notes the other enemy robots near it that are not flying like darts (gun panels,
// gunships): it keeps out of their guns' reach (`state.away`, a push away from them).
function sighting(id) {
  let main = null;
  let mine = null;
  let ax = 0;
  let ay = 0;
  let top = -Infinity; // the highest enemy robot that is not a dart
  const px = self.pos.x;
  const py = self.pos.y;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id === id) mine = c;
    if (c.mass >= 30 && (!main || c.mass > main.mass)) main = c;
    if (c.mass < awayMass || Math.hypot(c.vel.x, c.vel.y) > dartSpeed) continue;
    if (c.pos.y > top) top = c.pos.y;
    if (c.id === id) continue;
    const rx = px - c.pos.x;
    const ry = py - c.pos.y;
    const d = Math.hypot(rx, ry) || 1;
    if (d < keepOff) {
      ax += (rx / d) * (keepOff - d);
      ay += (ry / d) * (keepOff - d);
    }
  }
  state.away = { x: ax, y: ay };
  state.top = top;
  return { mine, main };
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
    const seen = sighting(t.id);
    // The one it was sent at, while seen. Hidden (a jammer's bubble, out of the radar's reach), it is kept for `hunt`
    // s: one that stood still is burnt where it stood, one moving is hunted (titans round 5: a split titan's king
    // flew off hidden while the burners went after its gunships). Then, or at once for one never named or for one
    // twice as heavy in view, the heaviest enemy in view.
    let c = seen.mine;
    if (!c && seen.main && (t.blind || time - state.at > hunt || seen.main.mass > 2 * (t.mass || 0))) c = seen.main;
    if (c) {
      if (c.id !== t.id || t.blind) {
        if (debug) log('switch', t.id, '->', c.id, 'blind', t.blind ? 1 : 0, 'lost', Math.round(time - state.at), 'v', Math.round(Math.hypot(t.vx, t.vy)), 'm', Math.round(t.mass || 0), Math.round(c.mass));
        t.id = c.id;
        t.blind = 0;
        t.ax = undefined;
      }
      t.x = c.pos.x;
      t.y = c.pos.y;
      t.vx = c.vel.x;
      t.vy = c.vel.y;
      t.mass = c.mass;
      state.at = time;
      state.found = -1000;
    }
  }
  set('radio', 'on', (state.n + state.beat) % every === 0 ? 1 : 0);
  if (time - state.born > life || self.energy.stored < reserve) {
    state.spent = true;
    if (debug) log('spent', Math.round(time - state.born), 'e', Math.round(self.energy.stored));
    spentTick(las);
    return;
  }
  // Where the core is now, by its last point and speed (a hidden one stays where it was, or, moving, is guessed on
  // along its way for up to `huntAge` s, inside the arena).
  // A still one hidden where it stood whose place the feeler finds nothing at for `searchAfter` s (it left in its
  // bubble) is searched for too: the guess walks out away from our base and back, `searchSpeed` m/s, at most
  // `searchFar` m.
  const lost = time - state.at > 1 && time - state.found > 1;
  const close = Math.hypot(t.x - self.pos.x, t.y - self.pos.y) < reach;
  if (!lost || !close) state.closeAt = time;
  const searching = lost && Math.hypot(t.vx, t.vy) < 1.5 && time - state.closeAt > searchAfter;
  const hidden = lost && (Math.hypot(t.vx, t.vy) >= 1.5 || searching);
  const age = Math.min(time - state.at, hidden ? huntAge : 3);
  let tx = t.x + t.vx * age;
  let ty = t.y + t.vy * age;
  if (searching) {
    const away = state.home === undefined ? 1 : sign(t.x - state.home || 1);
    const ph = ((time - state.closeAt - searchAfter) * searchSpeed) % (2 * searchFar);
    tx += away * (ph < searchFar ? ph : 2 * searchFar - ph);
  }
  if (arena && hidden) {
    tx = clamp(tx, -arena.x + 20, arena.x - 20);
    ty = clamp(ty, 2, arena.y - 5);
  }
  if (hidden) {
    // Hunting: over the guess, spread out by slot, the laser's sight swept across the ground below as a feeler. A
    // sight that reads the hunted robot (by its contact id: jammers blind sensors, not a beam's sight) gives its
    // place, and the burner burns there.
    const k = t.slot ?? 0;
    const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * huntSpread;
    const aw = state.away || { x: 0, y: 0 };
    hover(tx + off, ty + huntUp, awayK * aw.x, awayK * aw.y, self.pos.y - state.y0 < climb && time - state.born < 3, Infinity);
    feel(las, t);
    return;
  }
  // The way in: from the base's probes, else down onto a wide one, else from our side, up at `rise`.
  let ux;
  let uy;
  if (typeof t.ax === 'number') {
    // The base's way in (for a target with lasers, the thinnest on our side).
    ux = t.ax;
    uy = t.ay;
  } else if (t.beams > 0) {
    // A target with lasers: from our side, high. Its turrets that face us aim at our base; one that faces away and
    // cannot swing round to the base burns the nearest light thing it can reach (a sled's tail turret took a burner
    // stationed behind it).
    ux = (state.side ?? (state.side = self.pos.x < tx ? -1 : 1)) * Math.cos(wise);
    uy = Math.sin(wise);
  } else if (t.top) {
    ux = 0;
    uy = 1;
  } else {
    ux = (state.side ?? (state.side = self.pos.x < tx ? -1 : 1)) * Math.cos(rise);
    uy = Math.sin(rise);
  }
  // Another way in after the beam kept meeting something far out from the core (a sled's mast): turned by
  // `turns[state.turn]` from the first one.
  const tk = turns[state.turn % turns.length];
  if (tk !== 0) {
    const c = Math.cos(tk);
    const sn = Math.sin(tk);
    const nx = ux * c - uy * sn;
    uy = ux * sn + uy * c;
    ux = nx;
  }
  if (uy < 0.2) {
    // Never from under it or level with it along the ground: from a little above.
    uy = 0.2;
    ux = sign(ux || 1) * Math.sqrt(1 - uy * uy);
  }
  const k = t.slot ?? 0;
  const side = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * spacing;
  // Further out from a target with lasers (titans round 5): a sled's mast stands in the way on our side, and the
  // beam that cuts it brings its top down across the burners waiting nearer in.
  const out = t.beams > 0 ? wiseOff : standoff;
  const sx = tx + ux * out - uy * side;
  const sy = ty + uy * out + ux * side;
  const up = self.pos.y - state.y0 < climb && time - state.born < 3;
  // A target with lasers (the base's message says): inside `wary` m it creeps in, closing slower than its point
  // defense counts as coming at it.
  // Planned as a braking curve, so it is down to `creep` by the time it is `wary` m from the target.
  const slow = t.beams > 0 ? Math.sqrt(creep * creep + 2 * brake * Math.max(0, Math.hypot(tx - self.pos.x, ty - self.pos.y) - wary)) : Infinity;
  // Away from other enemy robots near it (their guns), on top of following the station; round the target, never
  // past it (flying by a flier's keep on the way to a station over it, burners met its gun panels).
  const aw = state.away || { x: 0, y: 0 };
  // Over the fight on the way (titans round 5): a flier's gun panels shoot at our base, and their shells fly 300 m;
  // a burner flying across at their height met that fire. So until it is `cruiseNear` m from its station (sideways)
  // it flies at least `cruise` m over the highest enemy robot it knows of.
  let wy = sy;
  if (Math.abs(sx - self.pos.x) > cruiseNear && state.top > -Infinity) wy = Math.max(sy, state.top + cruise);
  const w = round(tx, ty, sx, wy);
  hover(w.x, w.y, t.vx + awayK * aw.x, t.vy + awayK * aw.y, up, slow, w.left);
  state.near = Math.hypot(sx - self.pos.x, sy - self.pos.y) < onStation;
  if (up) {
    // Off the rack: the laser hangs straight down until it is clear of the base (turned, it caught on the keep).
    set('rotator', 'turn', clamp(-3 * get('rotator', 'angle'), -1, 1));
    set('laser', 'fire', 0);
    return;
  }
  if (debug && state.n % 60 === 0) log('burner', t.beams, Math.round(self.pos.x), Math.round(self.pos.y), 'st', Math.round(sx), Math.round(sy), 'e', Math.round(self.energy.stored), 'v', Math.round(self.vel.x), Math.round(self.vel.y), 'ang', Math.round(self.angle * 57), 'n', parts.length, 'thr', Math.round(100 * (state.thr || 0)));
  const g = state.near ? nextGun(las, tx, ty) : null;
  if (g) gunAim(las, g, tx + g.x, ty + g.y);
  else aim(las, tx, ty);
  // Far from its station and its laser far from the target, it thinks every other tick (its writes hold meanwhile):
  // half the script calls on the way (titans round 5).
  if (lazy > 0.5 && Math.hypot(sx - self.pos.x, sy - self.pos.y) > 80 && Math.hypot(tx - self.pos.x, ty - self.pos.y) > reach + 80) sleep(1);
}

// The nearest gun still to burn, or null. One the burner could not line up on for `gunTry` s is let be.
function nextGun(las, tx, ty) {
  let best = null;
  let bd = Infinity;
  for (const g of state.guns) {
    if (g.fired >= g.need || g.tried >= g.try) continue;
    // Guns only once it is being shot (it has lost a part): the core goes first otherwise (a flier's turrets that
    // never aimed at the burners cost it five seconds and the kill).
    if (g.need <= gunBurn && parts.length >= state.n0) continue;
    const r = Math.hypot(tx + g.x - las.pos.x, ty + g.y - las.pos.y);
    const d = r - (g.need > gunBurn ? 1000 : 0);
    if (d < bd && r < reach) {
      bd = d;
      best = g;
    }
  }
  return best;
}

// On a gun: the rotator onto its point, and the beam while the sight reads the target's part at the gun's distance.
function gunAim(las, g, gx, gy) {
  const a = las.out.aim;
  const want = Math.atan2(gy - las.pos.y, gx - las.pos.x);
  const moving = state.want === null ? 0 : wrap(want - state.want) / dt;
  state.want = want;
  const err = wrap(want - a);
  set('rotator', 'turn', clamp((moving - self.angVel + gain * err) / state.rate, -1, 1));
  const d = Math.hypot(gx - las.pos.x, gy - las.pos.y);
  const on = Math.abs(err) < tol && las.out.sightSide === SIGHT_ENEMY && las.out.sightId === state.t.id && Math.abs(las.out.sight - d) < gunNear;
  set('laser', 'fire', on ? 1 : 0);
  g.tried += dt;
  if (on) g.fired += dt;
}

/**
 * Where to fly next: the station, unless the straight way there passes within `clear` m of the target's core. Then a
 * point a step round the target, on a circle at least `clear` m out, the short way unless that way runs under it.
 * `left` is about how far there is still to go, for the braking curve.
 */
function round(tx, ty, sx, sy) {
  const bx = self.pos.x;
  const by = self.pos.y;
  const dx = sx - bx;
  const dy = sy - by;
  const l2 = dx * dx + dy * dy || 1;
  const u = clamp(((tx - bx) * dx + (ty - by) * dy) / l2, 0, 1);
  if (Math.hypot(bx + u * dx - tx, by + u * dy - ty) >= clear) return { x: sx, y: sy, left: Math.sqrt(l2) };
  const pb = Math.atan2(by - ty, bx - tx);
  const ps = Math.atan2(sy - ty, sx - tx);
  let d = wrap(ps - pb);
  const under = wrap(-Math.PI / 2 - pb);
  if (Math.sign(under) === Math.sign(d) && Math.abs(under) < Math.abs(d)) d = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI;
  const step = sign(d) * Math.min(Math.abs(d), roundStep);
  const r = Math.max(clear + 20, Math.min(Math.hypot(bx - tx, by - ty), standoff));
  return { x: tx + r * Math.cos(pb + step), y: ty + r * Math.sin(pb + step), left: Math.abs(d) * r + standoff * 0.2 };
}

/** Steer toward (x, y), moving with (vx, vy): lean toward where it must go, thrust enough to hold its height. */
function hover(x, y, vx, vy, up, slow, left) {
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
    const go = Math.max(d, left ?? 0);
    const sp = Math.min(vmax, kpos * go, Math.sqrt(2 * brake * go), slow ?? Infinity);
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
  // A wreck lying in the tunnel near the core burns too; one far out does not, nor does an enemy part far out from
  // the core (a sled's mast): that line is blocked, and after `blockFor` s of it the burner takes another way in.
  if (side === SIGHT_ENEMY && las.out.sightId === state.t.id) {
    // The sight is on it: it is here, hidden or not. Found by the feeler and still hidden, the point moves in as the
    // beam burns its way.
    state.found = time;
    if (time - state.at > 1 && Math.abs(err) < tol && Math.hypot(state.t.vx, state.t.vy) < 1.5 && state.hunted) {
      state.t.x = fx + Math.cos(a) * (sight + 2);
      state.t.y = fy + Math.sin(a) * (sight + 2);
    }
  }
  const deepEnough = sight > dist - deep;
  const wreck = side === SIGHT_NONE && sight > 3 && sight < dist + 2 && deepEnough;
  // Not against a target with lasers: moving off its safe side, burners closed on it fast and were burnt.
  if (state.near && !(state.t.beams > 0) && (side === SIGHT_ENEMY || side === SIGHT_NONE) && !deepEnough && Math.abs(err) < tol && dist <= reach + 40) {
    state.blocked += dt;
    if (state.blocked > blockFor) {
      state.turn++;
      state.blocked = 0;
    }
  }
  // Only from its station, or while the line holds still: a beam swept across armor while flying in warmed many
  // plates and broke few (six burners took 25 parts off a fortress).
  const steady = state.near || Math.abs(moving) < still;
  const fire = steady && dist <= reach + 40 && sight <= reach && Math.abs(err) < tol && ((side === SIGHT_ENEMY && (deepEnough || state.turn >= turns.length || state.t.beams > 0)) || wreck) ? 1 : 0;
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

/**
 * The hunt's feeler: the rotator swings the laser to and fro under the burner (fire off) and its sight is read every
 * tick. On the hunted robot it takes the point the sight met, a little in along the line, as the robot's place.
 */
function feel(las, t) {
  set('laser', 'fire', 0);
  state.want = null;
  const k = t.slot ?? 0;
  const want = -Math.PI / 2 + sweep * Math.sin(time * sweepRate + k * 1.3);
  const err = wrap(want - las.out.aim);
  set('rotator', 'turn', clamp((-self.angVel + gain * err) / state.rate, -1, 1));
  if (las.out.sightSide === SIGHT_ENEMY && las.out.sightId === t.id) {
    const a = las.out.aim;
    const d = las.out.sight + 2;
    t.x = las.pos.x + Math.cos(a) * d;
    t.y = las.pos.y + Math.sin(a) * d;
    t.vx = 0;
    t.vy = 0;
    state.found = time;
    state.hunted = true;
    if (debug) log('found', t.id, Math.round(t.x), Math.round(t.y));
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
