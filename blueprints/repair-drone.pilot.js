// Pilot for the repair drone: the enemy drone's hover with a fight of its own, and every repair decision there is. The
// engine only takes orders (`scrap`, `build`, `heal`): what it gives up, what it makes, and in what order is all here.
// No keys, it runs from deploy.
// - Flying: as the enemy drone (time-optimal leaning, balance from its parts, height braking just in time): it holds a
//   spot `standoff` meters beside and `above` meters over what its radar tracks, home with nothing tracked. Left and
//   right go by where the propellers are, not their tags, and the sums are made every tick, so it flies on what it has.
// - Repair (`repair` 1, 0 turns it all off): see `repairs()` at the bottom.

const repairOn = param('repair', 1, { min: 0, max: 1 }); // 0: it never scraps, builds or heals
const climb = param('climb', 10, { min: 0.5, max: 30 }); // m/s, fastest climb or sink it asks for
const lift = param('lift', 120, { min: 10, max: 1000 }); // N, one propeller's full push (the propeller part)
const gyroTorque = param('gyroTorque', 40, { min: 0, max: 1000 }); // N m, the gyro's full torque (the gyro part)
const lean = (param('lean', 50, { min: 0, max: 70 }) * Math.PI) / 180; // most it leans, degrees
const steer = param('steer', 0.08, { min: 0.01, max: 0.5 }); // radians of lean per m/s it is off the sideways speed it wants
const turnLift = param('turnLift', 0.15, { min: 0, max: 1 }); // most throttle it adds over what the height asks for, to turn
const margin = param('margin', 0.7, { min: 0.1, max: 1 }); // share of its turning or climbing power it plans braking on
const speed = param('speed', 12, { min: 1, max: 40 }); // m/s, fastest it flies sideways to get somewhere
const standoff = param('standoff', 150, { min: 5, max: 300 }); // m to the side of the robot it tracks
const above = param('above', -15, { min: -100, max: 100 }); // m above it (its laser is on top: it wants the target over it)
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots are missiles (dodged, not chased)
const maxSpeed = param('maxSpeed', 30, { min: 1, max: 1000 }); // m/s: anything faster is a missile or a drone bomb
const reserve = param('reserve', 0.65, { min: 0.2, max: 1 }); // share of full lift it may lean on
const floor = param('floor', 10, { min: 0, max: 200 }); // m: its lowest part never asked to go below this height
const every = param('every', 6, { min: 1, max: 60 }); // ticks between looks at what repair could do
const safe = param('safe', 1.3, { min: 1, max: 3 }); // times its weight in lift: under this, propellers come before anything
const landAt = param('landAt', 1.12, { min: 0.5, max: 2 }); // times its weight in lift: under this, with nothing to trade, it lands
const tradeAt = param('tradeAt', 2, { min: 1, max: 20 }); // propellers more on one side than the other before it trades
const lopsided = param('lopsided', 6, { min: 1, max: 20 }); // propellers more on one side than the other that it cannot leave, under fire or not
const healAt = param('healAt', 0.9, { min: 0.1, max: 1 }); // share of full health under which it heals what it can
const wanted = param('wanted', 1.6, { min: 1, max: 3 }); // times its weight in lift: over this it leaves propellers lost under fire
const quiet = param('quiet', 3, { min: 0, max: 30 }); // s since it last lost a part before it counts as out of the fire
const quick = param('quick', 2, { min: 0, max: 30 }); // s: a part lost this soon after it was made says the cell is under fire
const hot = param('hot', 6, { min: 0, max: 60 }); // s it leaves such a cell alone
const away = param('away', 330, { min: 50, max: 500 }); // m it stays from what it tracks while it has no laser

function setup() {
  state.home = { x: self.pos.x, y: self.pos.y };
  state.last = '';
  state.landing = false;
  state.lastLoss = -Infinity;
  state.goneCount = 0;
  state.made = {};
  state.hot = {};
  // Its height when its lowest part is on the ground: where it is on the ground.
  let low = self.pos.y;
  for (const p of parts) if (p.pos.y < low) low = p.pos.y;
  state.low = self.pos.y - low + 0.5;
  // The middle of the drone in cells: the core's. `lost()` says cells, not places.
  state.mid = parts.find((p) => p.type === 'core').id.match(/@(-?\d+)/)[1] * 1;
}

/** One of its own propellers. */
const prop = (p) => p.type === 'propeller';

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
    if (!prop(p)) continue;
    const u = along(p) - cu;
    sum += u;
    split += p.tags.includes('rprop') ? u : -u;
    if (u > 0) right += u;
    else left -= u;
  }
  return { inertia, sum, split, right, left };
}

function fly(vx, height, vy) {
  const g = 9.81;
  const props = parts.filter(prop).length;
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
  const most = Math.min(lean, Math.acos(clamp((self.mass * g) / Math.max(1, reserve * props * lift), 0, 1)));
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
  // Turning comes first, but it may add at most `turnLift` to the throttle the height asked for.
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

/** The lowest height its core may be asked for: `floor` plus how far its lowest part hangs below its core. */
function lowestOk() {
  let low = self.pos.y;
  for (const p of parts) if (p.pos.y < low) low = p.pos.y;
  return floor + (self.pos.y - low);
}

/** Says a line once, when it changes. */
function say(text) {
  if (text === state.last) return;
  state.last = text;
  log(text);
}

/** What it has and what it lacks, for the rest of repair to read. */
function look() {
  const gone = lost();
  if (gone.length > state.goneCount) state.lastLoss = time;
  state.goneCount = gone.length;
  // A part it made that is gone again within `quick` seconds: that cell is under fire, and left alone for `hot` seconds.
  for (const p of gone) {
    if (state.made[p.id] === undefined) continue;
    if (time - state.made[p.id] < quick) state.hot[p.id] = time + hot;
    delete state.made[p.id];
  }
  const mine = parts.filter(prop);
  const left = mine.filter((p) => p.tags.includes('lprop')).length;
  const right = mine.length - left;
  const weight = self.mass * 9.81;
  return {
    gone,
    mine,
    left,
    right,
    weight,
    lift: mine.length * lift,
    hold: tank(),
    plates: parts.filter((p) => p.type === 'armorplate'),
    // The nearest thing shooting at it: repair works away from it.
    enemy: contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass),
  };
}

/** The propeller to make next: on the side that has fewer, away from the enemy, nearest the middle first. */
function nextProp(s) {
  const open = s.gone.filter((p) => p.type === 'propeller' && p.touching && !(state.hot[p.id] > time));
  const short = s.left <= s.right ? 'lprop' : 'rprop';
  const side = open.filter((p) => p.tags.includes(short));
  const list = side.length > 0 ? side : open;
  const toward = s.enemy ? Math.sign(s.enemy.pos.x - self.pos.x) : 0;
  const rank = (p) => toward * (p.x - state.mid) + 0.1 * Math.abs(p.x - state.mid);
  return list.slice().sort((a, b) => rank(a) - rank(b))[0];
}

/** A plate to give up: the one furthest from the enemy, so the side facing it keeps its armor. */
function spare(s) {
  const toward = s.enemy ? s.enemy.pos.x - self.pos.x : 0;
  const rank = (p) => (p.pos.x - self.pos.x) * toward;
  return s.plates.slice().sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * Rung 3: propellers from the side that has more buy one for the side that has fewer, so it stays level. The outermost
 * one goes: it was the one doing most to tip it.
 */
function trade(s) {
  const more = s.right > s.left ? 'rprop' : 'lprop';
  if (Math.abs(s.right - s.left) < tradeAt) return undefined;
  const list = s.mine.filter((p) => p.tags.includes(more)).slice();
  list.sort((a, b) => Math.abs(b.pos.x - self.pos.x) - Math.abs(a.pos.x - self.pos.x));
  return list[0];
}

/**
 * Repair: every decision there is, in order. Nothing here is general: it is what this drone wants.
 * - Staying up comes first: under `safe` times its weight in lift, a long job stops and a propeller is next.
 * - Rung 1: armor pays. A plate is 4 in the tank (a propeller is 1, a laser 20), so it gives one up as soon as
 *   something is lost, the plate furthest from the enemy, and goes back to the turret once it can fly.
 * - Rung 2: a laser it cannot pay for, with all the plates it has left, waits. What it has goes on propellers.
 * - Rung 3: with no plate left, propellers on the side that has more buy one on the side that has fewer.
 * - Rung 4: nothing left to trade and not enough lift: it lands while it still can, and on the ground propellers do
 *   nothing, so they pay for armor where the enemy is.
 * - What was made comes out at 1 percent health, so what it can reach it heals: the laser first, since a laser at 1
 *   percent goes off at the first shell, then what lifts.
 */
function repairs() {
  if (repairOn < 1 || frame % every !== 0) return;
  const s = look();
  // Lopsided is as bad as short: with one side gone it falls out of the air, whatever it lifts on paper.
  const tipping = Math.abs(s.left - s.right) >= lopsided;
  const short = s.lift < safe * s.weight || tipping;
  const running = job();
  state.landing = state.landing || (s.lift < landAt * s.weight && s.plates.length === 0 && s.hold < 0.5 && !trade(s));
  if (state.landing) return ground(s, running);
  if (running) {
    if (short && running.kind !== 'scrap' && running.left > 0.7 && s.gone.some((p) => p.type === 'propeller' && p.touching)) {
      say('stop: it has to stay up');
      stopJob();
    }
    return;
  }
  // Under fire, what it makes dies at 1 percent health: it makes only what it cannot fly without, and leaves alone a
  // cell that just ate what it put there.
  const calm = time - state.lastLoss > quiet;
  const propeller = calm || tipping || s.lift < wanted * s.weight ? nextProp(s) : undefined;
  // The way back to a laser: mast, rotator, laser. Priced whole: a rotator with no laser it can pay for is money gone.
  const chain = s.gone.filter((p) => p.tags.includes('laser-turret1') || (p.type === 'frame' && p.x === state.mid));
  const turret = chain.filter((p) => p.touching)[0];
  const bill = chain.reduce((n, p) => n + p.create, 0);
  const plateWorth = s.plates.length === 0 ? 0 : own({ of: 'armor' }).reduce((n, p) => n + p.gives, 0);
  const canLaser = chain.length > 0 && s.hold + plateWorth >= bill;
  // A frame the other parts hang on (the end of the lower row).
  const link = s.gone.filter((p) => p.type === 'frame' && p.touching && p.x !== state.mid)[0];
  const lift1 = propeller ?? link;
  // What it wants most, then what it can pay for.
  const first = short ? (lift1 ?? (canLaser ? turret : undefined)) : ((canLaser ? turret : undefined) ?? lift1);
  if (first && s.hold >= first.create) {
    say(`build ${first.id}: ${first.create} of ${s.hold.toFixed(1)}`);
    if (build(first.id).ok) state.made[first.id] = time;
    return;
  }
  if (first) {
    const plate = spare(s);
    if (plate) {
      say(`scrap ${plate.id}`);
      scrap(plate.id);
      return;
    }
    const swap = trade(s);
    if (swap) {
      say(`trade: scrap ${swap.id} for the other side`);
      scrap(swap.id);
      return;
    }
  }
  if (s.hold > 0.05) {
    const hurt = own({ has: ['throttle', 'fire', 'turn'] }).filter((p) => p.health < healAt * p.maxHealth);
    const pick = hurt.find((p) => p.type === 'laser') ?? hurt.find((p) => p.type === 'rotator') ?? hurt[0];
    if (pick) heal(pick.id);
  }
}

/**
 * Rung 4: down, then every propeller goes to armor: on the ground they lift nothing. A plate if all of them can pay for
 * one, the frames it has lost if not, and then it heals what is left of its armor, lowest first.
 */
function ground(s, running) {
  if (running || self.pos.y > state.low + 1.5 || Math.abs(self.vel.y) > 0.5) return;
  const toward = s.enemy ? s.enemy.pos.x - self.pos.x : 0;
  const near = (a, b) => (b.x - state.mid) * toward - (a.x - state.mid) * toward;
  const plate = s.gone.filter((p) => p.type === 'armorplate' && p.touching).sort(near)[0];
  const props = s.mine.length > 0 ? own({ of: ['lprop', 'rprop'] }) : [];
  const worth = s.hold + props.reduce((n, p) => n + p.gives, 0);
  const frame = s.gone.filter((p) => p.type === 'frame' && p.touching).sort(near)[0];
  const next = plate && worth >= plate.create ? plate : frame;
  if (next && s.hold >= next.create) {
    say(`on the ground: build ${next.id}`);
    build(next.id);
    return;
  }
  if (props[0]) {
    say(`on the ground: scrap ${props[0].id}`);
    scrap(props[0].id);
    return;
  }
  if (s.hold > 0.05) {
    const hurt = own({ of: ['armor', 'frame', 'core'] }).filter((a) => a.health < healAt * a.maxHealth);
    hurt.sort((a, b) => a.health / a.maxHealth - b.health / b.maxHealth);
    if (hurt[0]) heal(hurt[0].id);
  }
}

function tick() {
  repairs();
  if (state.landing) {
    // Down gently while it still can, then the propellers stop.
    const near = self.pos.y - state.low;
    if (near > 0.6 || Math.abs(self.vel.y) > 0.3) fly(0, 0, near > 6 ? -3 : -1);
    else {
      set('lprop', 'throttle', 0);
      set('rprop', 'throttle', 0);
    }
    return;
  }
  const target = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass && Math.hypot(c.vel.x, c.vel.y) <= maxSpeed);
  // With its laser gone it stays out of reach while it works.
  const armed = parts.some((p) => p.type === 'laser');
  let goal = state.home;
  if (target) {
    const here = self.pos.x >= target.pos.x ? 1 : -1;
    goal = { x: target.pos.x + here * (armed ? standoff : away), y: target.pos.y + above };
  }
  const edge = arena ? arena.x - 100 : Infinity;
  goal = { x: clamp(goal.x, -edge, edge), y: Math.max(goal.y, lowestOk()) };
  fly(clamp(0.5 * (goal.x - self.pos.x), -speed, speed), goal.y);
  mark(goal.x, goal.y, target ? 'hold' : 'home');
}
