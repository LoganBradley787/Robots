// Pilot for the enemy bomber (`enemy-bomber`, Batch): a drone that flies straight runs over its target at `altitude`
// (70 m) and lets bombs fall on it. No keys, it runs from deploy. A bomb is a frame and a heavy warhead hung under a
// grip (`grip1` to `grip6`, its warhead tagged `bomb1` to `bomb6`); the warhead is NOT armed while it hangs there
// (one hit on the bomber sets nothing off): the pilot arms it on the very tick it opens the grip.
// - Track: the nearest enemy of `minMass` (6 kg) or more its radar sees; with none it holds where it was deployed.
// - Run: it flies along x at `speed` toward the target, past it, until it is a bomb's lead (its release point, about
//   75 m) plus `turn` beyond, then turns round for another pass. It holds `altitude` over the target (never over `maxHeight`, and its
//   lowest part never under `floor`).
// - Drop: a bomb falls under gravity and air drag (`drag` per meter: the world's 0.0025 per cell times a bomb's 2 cells
//   over its 2.5 kg; at 25 m/s it loses about a fifth of its sideways speed in the fall, so an aim that ignored drag
//   landed 7 m short). For each bomb still held it steps its flight forward to the target's height, with the target's
//   own speed, works out where it would land, and lets go when that lands
//   within `tol` of the aim point: the aim point moves on `spread` meters (the way it flies: a later bomb cannot land behind, it is already too late) for each bomb already let go on this pass,
//   so a stick of bombs walks along the target instead of piling on one spot. At most `perPass` bombs a pass. It holds
//   its bombs while a friendly robot is within `safe` of where one would land, and while it is not at speed.
// Flying is the fab drones' hover (time-optimal leaning, height braking, balance from its parts).

const climb = param('climb', 10, { min: 0.5, max: 30 }); // m/s, fastest climb or sink it asks for
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const gyroTorque = param('gyroTorque', 40, { min: 0, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const lean = (param('lean', 50, { min: 0, max: 70 }) * Math.PI) / 180; // most it leans, degrees
const steer = param('steer', 0.08, { min: 0.01, max: 0.5 }); // radians of lean per m/s it is off the sideways speed it wants
const turnLift = param('turnLift', 0.15, { min: 0, max: 1 }); // most throttle it adds over what the height asks for, to turn
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its turning or climbing power it plans braking on
const reserve = param('reserve', 0.65, { min: 0.2, max: 1 }); // share of full lift it may lean on
const floor = param('floor', 8, { min: 0, max: 200 }); // m: its lowest part never asked to go below this height
const speed = param('speed', 25, { min: 5, max: 40 }); // m/s, how fast it flies a run
const altitude = param('altitude', 70, { min: 20, max: 200 }); // m over the target it flies its runs
const ceiling = param('ceiling', 150, { min: 0, max: 500 }); // m above where it was deployed it never climbs past
const maxHeight = param('maxHeight', 200, { min: 30, max: 500 }); // m: never asks for more height than this
const minMass = param('minMass', 6, { min: 0, max: 1000 }); // kg: lighter robots are missiles, not targets (a car with parts shot off is still one)
const tol = param('tol', 2.5, { min: 0.2, max: 20 }); // m: a bomb goes when it would land this close to the aim point
const spread = param('spread', 4, { min: 0, max: 20 }); // m: each bomb of a pass aims this much further back than the last
const perPass = param('perPass', 3, { min: 1, max: 6 }); // most bombs it lets go on one pass
const safe = param('safe', 10, { min: 0, max: 100 }); // m: nothing friendly this close to where a bomb would land
const turn = param('turn', 15, { min: 0, max: 300 }); // m it flies past the target, over and above the lead of a bomb (its release point is that far before the target: it needs it to turn round and get up to speed; braking adds about 35 m)
const gap = param('gap', 0.25, { min: 0, max: 5 }); // s between two bombs, so their blasts and kicks do not overlap
const drag = param('drag', 0.002, { min: 0, max: 0.05 }); // 1/m: air drag on a bomb, AIR_DRAG * its cells / its mass
const g = 9.81;

function setup() {
  state.home = { x: self.pos.x, y: self.pos.y };
  state.dir = 0;
  state.dropped = 0; // bombs let go on this pass
  state.last = -Infinity;
  state.runOut = flight(altitude, speed, 0).dx + turn; // the lead of a bomb let go at speed, and a stretch to turn in
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


/** Bombs still hanging: `{ k, x, y }` with the warhead's world position. */
function held() {
  const out = [];
  for (let k = 1; k <= 6; k++) {
    if (!(get('grip' + k, 'armed') > 0)) continue;
    const w = parts.find((p) => p.tags.includes('bomb' + k));
    if (w) out.push({ k, x: w.pos.x, y: w.pos.y });
  }
  return out;
}

/**
 * A bomb let go at height `h` over its aim (sideways speed `vx`, vertical `vy`) falls under gravity and drag: returns
 * the seconds it takes to reach the aim's height and how far it drifts sideways (stepped, drag has no closed form).
 */
function flight(h, vx, vy) {
  const step = 0.05;
  let x = 0;
  let y = h;
  let t = 0;
  while (t < 30) {
    const speedNow = Math.hypot(vx, vy);
    vx -= drag * speedNow * vx * step;
    vy -= (g + drag * speedNow * vy) * step;
    const ny = y + vy * step;
    if (ny <= 0) {
      const f = y / Math.max(y - ny, 1e-9);
      return { t: t + f * step, dx: x + f * vx * step };
    }
    x += vx * step;
    y = ny;
    t += step;
  }
  return { t, dx: x };
}

function tick() {
  const target = contacts.find((c) => c.side === 'enemy' && c.mass >= minMass);
  const bombs = held();

  let goalY = state.home.y;
  let vx = 0;
  if (target && bombs.length > 0) {
    goalY = Math.min(target.pos.y + altitude, state.home.y + ceiling, maxHeight);
    if (state.dir === 0) state.dir = Math.sign(target.pos.x - self.pos.x) || 1;
    const past = (self.pos.x - target.pos.x) * state.dir;
    if (past > state.runOut) {
      state.dir = -state.dir; // come round
      state.dropped = 0;
    }
    vx = state.dir * speed;
    // Drop: the bombs that would land on the aim point now.
    const atSpeed = Math.sign(self.vel.x) === state.dir && Math.abs(self.vel.x) > 0.6 * speed;
    if (atSpeed && state.dropped < perPass && time - state.last >= gap && Math.abs(self.pos.y - target.pos.y - altitude) < 15) {
      for (const b of bombs) {
        const f = flight(b.y - (target.pos.y + 1), self.vel.x, self.vel.y);
        const fallT = f.t;
        const landX = b.x + f.dx;
        const aimX = target.pos.x + target.vel.x * fallT + state.dir * spread * state.dropped;
        if (Math.abs(landX - aimX) > tol) continue;
        // Nothing of ours under it.
        const clear = !contacts.some((c) => c.side === 'friend' && Math.abs(c.pos.x + c.vel.x * fallT - landX) < safe && c.pos.y < b.y);
        mark(landX, target.pos.y, 'bomb ' + b.k);
        if (!clear) break;
        set('bomb' + b.k, 'arm', 1);
        set('grip' + b.k, 'fire', 1);
        state.dropped++;
        state.last = time;
        break;
      }
    }
    mark(target.pos.x + state.dir * spread * state.dropped, target.pos.y, 'aim');
  } else {
    state.dir = 0;
    state.dropped = 0;
    if (target) goalY = Math.min(target.pos.y + altitude, state.home.y + ceiling, maxHeight); // out of bombs: keep clear
    vx = clamp(0.5 * (state.home.x - self.pos.x), -speed, speed);
  }
  goalY = Math.max(goalY, lowestOk());
  fly(vx, goalY);
}
