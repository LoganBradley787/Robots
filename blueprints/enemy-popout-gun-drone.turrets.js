// Gun turrets with doors (Batch, popout-gun-drone): the M13 turret script plus armor doors. A turret whose rotator is
// tagged `hidden` sits behind a heavy armor plate on a piston (tagged <turret>.door: the plate is one cell in front of
// the gun, the piston pushes it 2 m clear of the muzzle). It holds still and fires nothing until its door is open, and
// the exposed turrets (no `hidden` tag) fight alone until then. See `doors()` at the bottom for when a door opens.
// The rest is the M13 turret script, unchanged but for armor plates in its shell table:
//
// Gun turrets (M13): every placed `gun-turret` on this robot aims and fires by itself. A turret is a rotator carrying a
// gun; its parts are tagged <turret>.rot and <turret>.gun (`pnpm sim place` names them), so this one script works with
// any number of turrets, whatever they are called.
// - Target: the closest robot on the other side the radar tracks (missiles and drone bombs included) within `track`
//   meters that this turret can swing to (it turns `swing` degrees either way from how it was built). It points at it
//   from there, so it is on target when it comes in range (a missile covers 150 m in about a second). A robot a turret
//   could not shoot for `hold` seconds (a friend or its own robot in the way) is left for `skip` seconds.
// - Which part: something light (under `heavy` kg: a missile, a drone bomb) is aimed at its middle. On anything
//   heavier it scans the parts and picks the best hit per shell: what the part is worth (its guns and warheads most,
//   then its core, radar, and lift, frames least) over the shells it takes to break it and everything of that robot in
//   front of it on the way (a propeller behind a wall of frames costs the whole wall). It picks again every `repick`
//   seconds, and when the part is gone; at most one turret picks per tick (a drone with twelve turrets all scoring a
//   100-part silo on one tick ran over the script's time budget), and a turret waiting its turn aims at the middle.
// - Aim: ahead of that point, where it will be when a shell gets there (from its speed and ours; shells leave at the
//   gun's `speed` plus our own motion), and up by what a shell falls on the way.
// - Fire: within `reach` meters, while the barrel is on the aim point and the gun's sight says nothing of ours is in
//   the way: the sight is a straight line out of the barrel, and shells hit friends and this robot too. A shell lives
//   1 s (300 m); the sight looks 150 m, and past that nothing of ours shows. The sight is straight and the barrel
//   points above the target by the drop, so it also holds fire while a friend the radar tracks is within `clear`
//   meters of the path to the target, nearer than it (a friend just in front of the target sits under the sight line).
//   On target means within `size` meters of the aim point (at least `tight` radians); once firing it keeps on out to
//   twice that, so a barrel wobbling on the edge does not stutter, plus `shake` ticks of its robot's own turn.
// With `auto` at 0, G switches the turrets on and off (they start on); robots that fly themselves leave it at 1.
const auto = param('auto', 1, { min: 0, max: 1 });
const speed = param('speed', 300, { min: 1, max: 5000 }); // m/s, the gun's shell speed (the gun part)
const reach = param('reach', 250, { min: 1, max: 1000 }); // m: further than this it does not shoot
const track = param('track', 400, { min: 1, max: 1000 }); // m: further than this it does not point at things
const swing = (param('swing', 90, { min: 1, max: 180 }) * Math.PI) / 180; // degrees either way a turret turns (the rotator's range)
const gain = param('gain', 6, { min: 0.1, max: 50 }); // turn rate per radian off the aim
const rate = param('rate', 2, { min: 0.1, max: 20 }); // rad/s, the rotator's fastest turn (for leading a moving aim)
const hold = param('hold', 0.5, { min: 0, max: 10 }); // s blocked before it gives up on a target
const skip = param('skip', 1.5, { min: 0, max: 30 }); // s it leaves a target it gave up on
const clear = param('clear', 6, { min: 0, max: 50 }); // m: a friend's center this close to the path holds fire
const heavy = param('heavy', 10, { min: 0, max: 1000 }); // kg: lighter targets are aimed at their middle, heavier by part
const repick = param('repick', 0.3, { min: 0, max: 5 }); // s between choosing which part to aim at
const damage = param('damage', 5, { min: 0.1, max: 1000 }); // a shell's damage (the gun part)
const size = param('size', 1, { min: 0.1, max: 10 }); // m off the aim point that still counts as on target
const wait = param('wait', 10, { min: 0, max: 120 }); // s of fighting before the doors open on their own
const engage = param('engage', 300, { min: 10, max: 1000 }); // m: a robot this near (of `heavy` kg or more) is the fight
const lossOpen = param('lossOpen', 0, { min: 0, max: 1 }); // 1: the doors also open when one of our exposed guns is shot off
const slide = param('slide', 1, { min: 0, max: 10 }); // s the plates need to clear the barrels before hidden guns start
const tight = param('tight', 0.012, { min: 0.001, max: 0.5 }); // radians: on target at the least this close
const shake = param('shake', 0, { min: 0, max: 5 }); // ticks of its robot's turn added to the on-target window (the missilenator 1; the walker hit less with it)
// What breaking each kind of part is worth: disarm it, blow it up, kill or blind it, then ground it.
// Share of a shell's damage each kind of part takes (the parts' `shellDamage`: frames are armor against guns).
const SHELL = { frame: 0.25, armorplate: 0.1 };
const WORTH = { gun: 10, heavywarhead: 12, warhead: 10, core: 8, radar: 6, rotator: 4, booster: 4, propeller: 4, thruster: 3, fabbay: 5, seeker: 3, battery: 2, densebattery: 2, heavygyro: 2, gyro: 2, wheel: 2, cell: 1, decoupler: 1, flare: 0.5, frame: 0.5 };
const g = 9.81;
const SIGHT = { nothing: 0, own: 1, friend: 2, enemy: 3, none: 4, terrain: 5 };

function setup() {
  state.on = true;
  state.turrets = {};
  state.armed = undefined; // when the doors were allowed to open
  state.opened = {}; // turret name: when its door was told to open
  state.fightAt = undefined; // when it first tracked a robot worth fighting
  state.gunsSeen = {}; // most guns each robot was scanned with
  state.checked = -Infinity;
}

/** The turrets still on the robot, by name, from their guns' tags. */
function turrets() {
  const names = [];
  for (const p of parts) {
    for (const t of p.tags) {
      const m = /^(.*)\.gun$/.exec(t);
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

/** A friend the radar tracks within `clear` meters of the path from `from` toward `angle`, nearer than `distance`. */
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
 * The part of `target` worth the most per shell from `from`: its worth over the shells to break it plus everything of
 * that robot within half a cell of the line in front of it. Undefined when it cannot be scanned.
 */
function bestPart(target, from) {
  const list = scanned(target.id);
  if (!list || list.length === 0) return undefined;
  // Best first by what each could score with nothing in front of it; stop once none left can beat the best.
  const shells = (p) => Math.ceil(p.health / (damage * (SHELL[p.type] ?? 1)));
  const order = list.map((p) => ({ p, bound: (WORTH[p.type] ?? 1) / shells(p) }));
  order.sort((a, b) => b.bound - a.bound);
  let best;
  for (const { p, bound } of order) {
    if (best && bound <= best.score) break;
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

/**
 * Where to point to hit a point at `pos` moving at `vel` from `from`: where it is after the shell's time of flight
 * (solved three times), raised by what the shell falls in that time. Returns the angle, the distance, and the time.
 */
function lead(pos, vel, from) {
  const c = { pos, vel };
  const rx = c.pos.x - from.x;
  const ry = c.pos.y - from.y;
  const vx = c.vel.x - self.vel.x;
  const vy = c.vel.y - self.vel.y;
  let t = Math.hypot(rx, ry) / speed;
  let px = rx;
  let py = ry;
  for (let i = 0; i < 3; i++) {
    px = rx + vx * t;
    py = ry + vy * t;
    t = Math.hypot(px, py) / speed;
  }
  return { angle: Math.atan2(py + 0.5 * g * t * t, px), distance: Math.hypot(px, py), t };
}

function aimTurret(name) {
  const gun = tagged(name + '.gun');
  const rot = tagged(name + '.rot');
  if (!gun || !rot) return;
  const st = state.turrets[name] || (state.turrets[name] = { id: 0, blocked: 0, skip: {}, want: undefined, part: undefined, picked: -Infinity, firing: false });
  const aim = gun.out.aim;
  // How it was built: its aim now, less how far it has turned (-1 to 1 of its range).
  const rest = aim - get(name + '.rot', 'angle') * swing;
  const from = { x: gun.pos.x + 0.5 * Math.cos(aim), y: gun.pos.y + 0.5 * Math.sin(aim) };
  let best;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.distance > track || (st.skip[c.id] || 0) > time) continue;
    const l = lead(c.pos, c.vel, from);
    if (Math.abs(wrap(l.angle - rest)) > swing) continue;
    // Keep the target it has unless something is much closer.
    const d = l.distance - (c.id === st.id ? 10 : 0);
    if (!best || d < best.d) best = { c, l, d };
  }
  if (!best || !state.on) {
    st.id = 0;
    st.want = undefined;
    st.firing = false;
    set(name + '.gun', 'fire', 0);
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
  if (best.c.mass >= heavy) {
    if ((time - st.picked >= repick || st.part === undefined) && state.pickFrame !== frame) {
      state.pickFrame = frame;
      st.part = bestPart(best.c, from);
      st.picked = time;
    }
    const list = st.part === undefined ? undefined : scanned(best.c.id);
    const p = list && list.find((x) => x.id === st.part);
    if (p) l = lead(p.pos, best.c.vel, from);
    else st.part = undefined;
  }
  const want = l.angle;
  // The aim point moves: turn at its rate, plus a push toward it.
  const moving = st.want === undefined ? 0 : wrap(want - st.want) / dt;
  st.want = want;
  const err = wrap(want - aim);
  set(name + '.rot', 'turn', clamp(moving / rate + gain * err / rate, -1, 1));
  // On target: within `size` meters of the aim point (or `tight` radians); firing already, twice that.
  // On something turning (Logan: the missilenator shook too much to fire), the barrel swings by its robot's turn each
  // tick: that much wider, so a barrel sweeping across the aim point fires as it passes.
  const within = Math.max(tight, Math.atan2(size, l.distance)) * (st.firing ? 2 : 1) + shake * Math.abs(self.angVel) * dt;
  const on = Math.abs(err) < within;
  const side = gun.out.sightSide;
  // Something of ours in the way: its own robot, a friend, or the ground, nearer than the target.
  const blocked = ((side === SIGHT.own || side === SIGHT.friend || side === SIGHT.terrain) && gun.out.sight < l.distance) || friendOnPath(from, want, l.distance);
  st.blocked = blocked ? st.blocked + dt : 0;
  if (st.blocked > hold) {
    st.skip[best.c.id] = time + skip;
    st.id = 0;
  }
  st.firing = on && !blocked && l.distance <= reach;
  set(name + '.gun', 'fire', st.firing ? 1 : 0);
  mark(from.x + Math.cos(want) * l.distance, from.y + Math.sin(want) * l.distance, name);
}

/**
 * The doors. Once armed (below), a hidden turret's door opens, for good, when the robot it fights is on that turret's
 * side (the far end's plates stay shut and go on being armor). Arming needs one of:
 * - the nearest robot of `heavy` kg or more within `engage` m has lost its guns: it was scanned with at least one
 *   gun before and has none now (one robot scanned every 0.25 s at most, and only while nothing is armed yet);
 * - `wait` seconds since it first tracked such a robot (a target that never had guns);
 * - one of our exposed guns was shot off, when `lossOpen` is 1 (the reserve comes out early; off by default: a hidden gun
 *   that comes out while the enemy still has guns gets shot first).
 */
function doors() {
  const foe = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= heavy && c.distance <= engage);
  if (state.armed === undefined) {
    const exposed = parts.filter((p) => p.type === 'gun' && !p.tags.includes('hidden')).length;
    if (state.exposed === undefined) state.exposed = exposed;
    let why;
    if (lossOpen > 0.5 && exposed < state.exposed) why = 'an exposed gun was shot off';
    if (foe && state.fightAt === undefined) state.fightAt = time;
    if (!why && state.fightAt !== undefined && time - state.fightAt >= wait) why = 'fought ' + wait + ' s';
    if (!why && foe && time - state.checked >= 0.25) {
      state.checked = time;
      const list = scanned(foe.id);
      if (list && list.length > 0) {
        const n = list.filter((p) => p.type === 'gun').length;
        if (n > (state.gunsSeen[foe.id] || 0)) state.gunsSeen[foe.id] = n;
        if (n === 0 && (state.gunsSeen[foe.id] || 0) > 0) why = 'target has no guns left';
      }
    }
    if (why) {
      state.armed = time;
      log('doors armed: ' + why);
    }
  }
  const tracked = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= heavy && c.distance <= track);
  for (const name of turrets()) {
    const rot = tagged(name + '.rot');
    if (!rot || !rot.tags.includes('hidden')) continue;
    if (state.armed !== undefined && state.opened[name] === undefined && tracked) {
      const dx = tracked.pos.x - self.pos.x;
      if (Math.abs(dx) < 20 || Math.sign(dx) === Math.sign(rot.pos.x - self.pos.x)) {
        state.opened[name] = time;
        log(name + ' door opens');
      }
    }
    if (state.opened[name] !== undefined) set(name + '.door', 'extend', 1);
  }
}

function tick() {
  if (auto < 0.5 && keys.pressed('g')) {
    state.on = !state.on;
    // Said in the status: with nothing in range a switched off turret looks the same as one waiting (Logan: "G seems to do nothing").
    log(state.on ? 'turrets on' : 'turrets off: G switches them back on');
  }
  doors();
  for (const name of turrets()) {
    // A hidden turret waits behind its plate until its door is open and clear.
    const rot = tagged(name + '.rot');
    if (rot && rot.tags.includes('hidden') && (state.opened[name] === undefined || time - state.opened[name] < slide)) {
      set(name + '.gun', 'fire', 0);
      set(name + '.rot', 'turn', clamp(-3 * get(name + '.rot', 'angle'), -1, 1));
      continue;
    }
    aimTurret(name);
  }
}
