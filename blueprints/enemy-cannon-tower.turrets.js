// Charged gun turrets (M15): every placed `cannon-turret` or `lance-turret` on this robot charges, aims, and fires by
// itself. A turret is a rotator carrying a cannon or a lance; its parts are tagged <turret>.rot and <turret>.cannon
// (`pnpm sim place` names them), so this one script works with any number of turrets, whatever they are called.
// - How the part works: holding `fire` charges it (`charged` 0 to 1, energy all the way); letting go before it is full
//   drains it and gives the energy back; once full, letting go fires, and held full for longer than its hold it
//   backfires (a puff, a small push, nothing fired) and is dead for a while.
// - Charge: it holds `fire` while an enemy the radar tracks is within `track` meters and it can swing to it, and the
//   robot's energy is above `reserve`. With nothing to shoot at (or low on energy) it lets go and the charge drains.
// - Target: the nearest such robot (the one it has is kept unless another is much closer). Which part: it scans the
//   robot and picks what is worth the most that one bolt can still reach: a bolt takes the health of each part in
//   front off its `damage` (armor in full), so a part behind more health than that is out of reach this shot.
// - Aim: at where that part will be when the bolt gets there (`speed` m/s), raised by the bolt's drop.
// - Fire: once full it lets go when the barrel is within `size` meters of the aim point and the target is within
//   `reach`. The sight is straight and the barrel points above the target by the drop, so the sight is not asked to
//   show the target, only that nothing of ours and no ground is first on the line. After `patience` of its hold any
//   enemy on the sight will do. It never lets go with its own robot or a friend first on the line, or a friend the
//   radar tracks within `clear` meters of it: then it holds, and if the hold runs out it backfires, which hurts
//   nobody. With the hold nearly up (`spare` seconds left) and the line clear of ours it fires anyway: a shot at
//   nothing beats a backfire.
// - `barrel` and `off` say where the barrel's end is from the part's first cell: `barrel` meters along the aim and
//   `off` meters to its left. A cannon is two cells wide, so its barrel's middle is half a cell to the right of its
//   first cell (`off` -0.5; 0.5 when the turret was placed mirrored). A lance is one wide (`off` 0).
const reach = param('reach', 250, { min: 1, max: 2000 }); // m: the part's sight (250 cannon, 400 lance)
const track = param('track', 400, { min: 1, max: 2000 }); // m: it charges and points at things this near
const speed = param('speed', 300, { min: 1, max: 5000 }); // m/s, the bolt (300 cannon, 600 lance)
const damage = param('damage', 500, { min: 1, max: 100000 }); // what one bolt carries (500 cannon, 250 lance)
const full = param('full', 4, { min: 0.1, max: 60 }); // s the part can be held full (4 cannon, 2 lance)
const barrel = param('barrel', 3.5, { min: 0, max: 20 }); // m from the part's first cell to the barrel's end
const off = param('off', 0, { min: -5, max: 5 }); // m the barrel's middle is to the left of the part's first cell (cannon -0.5)
const swing = (param('swing', 90, { min: 1, max: 180 }) * Math.PI) / 180; // degrees either way a turret turns
const gain = param('gain', 6, { min: 0.1, max: 50 }); // turn rate per radian off the aim
const rate = param('rate', 1, { min: 0.1, max: 20 }); // rad/s, the rotator's fastest turn
const size = param('size', 0.6, { min: 0.05, max: 20 }); // m off the aim point that still counts as on it
const patience = param('patience', 0.5, { min: 0, max: 1 }); // share of the hold after which any enemy on the sight will do
const spare = param('spare', 0.25, { min: 0.05, max: 5 }); // s of hold left when it fires anyway (if the line is clear of ours)
const clear = param('clear', 8, { min: 0, max: 50 }); // m: a friend's center this close to the line holds fire
const reserve = param('reserve', 0.2, { min: 0, max: 1 }); // share of the robot's energy below which it does not charge
const repick = param('repick', 0.5, { min: 0, max: 5 }); // s between choosing which part to aim at
const huge = param('huge', 600, { min: 10, max: 100000 }); // parts: a robot bigger than this is weighed only near its closest part
const band = param('band', 6, { min: 0.5, max: 50 }); // m behind a huge robot's closest part that are weighed
const most = param('most', 150, { min: 10, max: 2000 }); // parts of a huge robot weighed at most
const g = 9.81;
// What taking each kind of part is worth to one shot: the core ends the robot, then what can hurt us.
const WORTH = { core: 20, cannon: 14, lance: 12, laser: 12, gun: 8, heavywarhead: 10, warhead: 8, fabbay: 8, radar: 6, heavyrotator: 4, rotator: 4, booster: 4, propeller: 4, thruster: 3, seeker: 3, densebattery: 3, battery: 2, heavygyro: 2, gyro: 2, wheel: 2, cell: 1, decoupler: 1, flare: 0.5, frame: 0.5, armorplate: 0.5 };
const SIGHT = { nothing: 0, own: 1, friend: 2, enemy: 3, none: 4, terrain: 5 };

function setup() {
  state.turrets = {};
  state.low = false;
}

/** The turrets still on the robot, by name, from their charged guns' tags. */
function turrets() {
  const names = [];
  for (const p of parts) {
    for (const t of p.tags) {
      const m = /^(.*)\.cannon$/.exec(t);
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

/** A friend the radar tracks within `clear` meters of the line from `from` toward `angle`, nearer than `distance`. */
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

/** A robot's parts as the radar scans them, once per tick however many turrets ask. */
function scanned(id) {
  if (state.scanTick !== frame) {
    state.scanTick = frame;
    state.scans = {};
  }
  if (!(id in state.scans)) state.scans[id] = scan(id);
  return state.scans[id];
}

/**
 * The part of `target` worth the most to one bolt from `from`: its worth, scaled down when the health of everything
 * of that robot in front of it on the line (and its own) is more than a bolt carries. Undefined when it cannot be
 * scanned.
 */
function bestPart(target, from) {
  let list = scanned(target.id);
  if (!list || list.length === 0) return undefined;
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
  // Best first by worth; stop once none left can beat the best.
  const order = list.map((p) => ({ p, bound: WORTH[p.type] ?? 1 }));
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
    const score = cost <= damage ? bound : (bound * damage) / cost / 2;
    if (!best || score > best.score) best = { id: p.id, score };
  }
  return best && best.id;
}

/** Where to point so a bolt from `from` meets a point at `pos` moving at `vel`: led by its flight time, raised by its drop. */
function lead(pos, vel, from) {
  let t = Math.hypot(pos.x - from.x, pos.y - from.y) / speed;
  let px = 0;
  let py = 0;
  for (let i = 0; i < 2; i++) {
    px = pos.x + (vel.x - self.vel.x) * t - from.x;
    py = pos.y + (vel.y - self.vel.y) * t - from.y;
    t = Math.hypot(px, py) / speed;
  }
  return { angle: Math.atan2(py + 0.5 * g * t * t, px), distance: Math.hypot(px, py) };
}

function aimTurret(name, powered) {
  const gun = tagged(name + '.cannon');
  const rot = tagged(name + '.rot');
  if (!gun || !rot) return;
  const st = state.turrets[name] || (state.turrets[name] = { id: 0, want: undefined, part: undefined, aimed: undefined, picked: -Infinity, since: undefined });
  const aim = gun.out.aim;
  const charged = gun.out.charged;
  // How long it has been full: the hold runs from the tick it filled.
  if (charged >= 1) {
    if (st.since === undefined) st.since = time;
  } else st.since = undefined;
  const held = st.since === undefined ? 0 : time - st.since;
  const rest = aim - get(name + '.rot', 'angle') * swing;
  const from = { x: gun.pos.x + barrel * Math.cos(aim) - off * Math.sin(aim), y: gun.pos.y + barrel * Math.sin(aim) + off * Math.cos(aim) };
  const side = gun.out.sightSide;
  // Ours first on the line, or a friend the radar tracks near it: never let go like this.
  const ours = side === SIGHT.own || side === SIGHT.friend || friendOnPath(from, aim, gun.out.sight + 2);
  let best;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.distance > track) continue;
    const l = lead(c.pos, c.vel, from);
    if (Math.abs(wrap(l.angle - rest)) > swing) continue;
    const d = l.distance - (c.id === st.id ? 20 : 0);
    if (!best || d < best.d) best = { c, l, d };
  }
  if (!best) {
    st.id = 0;
    st.want = undefined;
    set(name + '.rot', 'turn', clamp(-3 * get(name + '.rot', 'angle'), -1, 1));
    // Nothing to shoot at. Charging: let go, it drains and the energy comes back. Full: hold on for a target; with
    // the hold nearly up, fire at nothing if the line is clear of ours, else let it backfire.
    set(name + '.cannon', 'fire', charged >= 1 && (ours || held < full - spare) ? 1 : 0);
    return;
  }
  if (best.c.id !== st.id) {
    st.id = best.c.id;
    st.want = undefined;
    st.part = undefined;
    st.picked = -Infinity;
  }
  let l = best.l;
  if ((time - st.picked >= repick || st.part === undefined) && state.pickFrame !== frame) {
    state.pickFrame = frame;
    st.part = bestPart(best.c, from);
    st.picked = time;
  }
  const list = st.part === undefined ? undefined : scanned(best.c.id);
  const p = list && list.find((x) => x.id === st.part);
  if (p) l = lead(p.pos, best.c.vel, from);
  else st.part = undefined;
  // A new part is a jump in the aim point, not its motion: do not turn at that jump's rate.
  if (st.part !== st.aimed) st.want = undefined;
  st.aimed = st.part;
  const want = l.angle;
  const moving = st.want === undefined ? 0 : wrap(want - st.want) / dt;
  st.want = want;
  const err = wrap(want - aim);
  set(name + '.rot', 'turn', clamp((moving - self.angVel + gain * err) / rate, -1, 1));
  mark(from.x + Math.cos(want) * l.distance, from.y + Math.sin(want) * l.distance, name);
  if (charged < 1) {
    // Charging (or dead, or draining: holding does nothing then). Low on energy: let go, it drains back.
    set(name + '.cannon', 'fire', powered ? 1 : 0);
    return;
  }
  const enemy = side === SIGHT.enemy && gun.out.sight <= reach;
  // The ground first on the line, well short of the target: the bolt would only dig a hole.
  const ground = side === SIGHT.terrain && gun.out.sight < l.distance - 5;
  const on = Math.abs(err) * l.distance <= size && l.distance <= reach && !ground;
  const lastCall = held >= full - spare;
  const go = !ours && (on || (enemy && held >= full * patience) || lastCall);
  set(name + '.cannon', 'fire', go ? 0 : 1);
}

function tick() {
  const cap = self.energy.capacity;
  const share = cap > 0 ? self.energy.stored / cap : 0;
  // A robot with no batteries at all (cap 0) has nothing to keep: it charges while the pool lets it.
  const powered = cap <= 0 || (state.low ? share > reserve + 0.05 : share > reserve);
  if (!powered && !state.low) log('charged guns low on energy: not charging');
  if (powered && state.low) log('charged guns charging again');
  state.low = !powered;
  for (const name of turrets()) aimTurret(name, powered);
}
