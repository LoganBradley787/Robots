// titan-anvil pilot: a flying brick of armor that only rams.
// A hard hit hurts every part of the body it stops, and the heavier body is stopped less, so the brick flies level
// into the enemy's main robot at a speed picked from both masses: slow enough that its own speed changes by no more
// than `ownDv`, which leaves it whole. It never turns: boosters on each side push it left or right, the lift rows
// hold its height and keep it level. Guns on its faces blast what their sights show, and those sights also find a
// robot hiding from the radar. Everything goes by `side` and by where its own parts are, so it works flipped.

const vmax = param('vmax', 60, { min: 10, max: 90 }); // fastest ram, m/s
const ownDv = param('ownDv', 12.5, { min: 5, max: 20 }); // the most its own speed may change in a hit, m/s
const heavy = param('heavy', 0.7, { min: 0.1, max: 2 }); // an enemy over this share of its own mass is not rammed
const cruise = param('cruise', 60, { min: 10, max: 200 }); // height with nothing to chase, m
const ceiling = param('ceiling', 225, { min: 50, max: 240 }); // the core never goes above this (the arena ends at 250)
const reserve = param('reserve', 0.08, { min: 0, max: 0.5 }); // share of energy kept for landing
const standoff = param('standoff', 450, { min: 300, max: 800 }); // distance kept from an enemy too heavy to ram, m
const edge = param('edge', 950, { min: 500, max: 970 }); // the core stays within this of the middle, m
const sweepSpeed = param('sweepSpeed', 40, { min: 5, max: 60 }); // m/s while searching with the gun sights
const sweepHeight = param('sweepHeight', 110, { min: 30, max: 200 }); // m: from here the top and floor guns' sights cover ground to ceiling
const sweepHigh = param('sweepHigh', 185, { min: 30, max: 220 }); // m: the first pass, where the roof guns reach the ceiling
const uppercut = param('uppercut', 30, { min: 5, max: 40 }); // m/s at most when ramming straight up or down
const pingKeep = param('pingKeep', 12, { min: 1, max: 60 }); // s it keeps going for the place a gun sight last touched the enemy
const say = param('say', 1, { min: 0, max: 1 }); // 1 logs each change of plan

let guns = null;
let gunParts = -1;

function setup() {
  let m = 0;
  let sx = 0;
  let sy = 0;
  let minY = 1e9;
  let minX = 1e9;
  let maxX = -1e9;
  for (const p of parts) {
    if (p.pos.x < minX) minX = p.pos.x;
    if (p.pos.x > maxX) maxX = p.pos.x;
    m += p.mass;
    sx += p.mass * p.pos.x;
    sy += p.mass * p.pos.y;
    if (p.pos.y < minY) minY = p.pos.y;
  }
  const cx = sx / m;
  const cy = sy / m;
  let inertia = 0;
  let arms = 0;
  let lifts = 0;
  let laX = 0;
  let pushes = 0;
  let paX = 0;
  let pushY = 0;
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    inertia += p.mass * (dx * dx + dy * dy);
    if (p.type !== 'booster') continue;
    const t = p.tags;
    if (t.indexOf('la') >= 0) {
      arms += Math.abs(dx);
      lifts++;
      laX += dx;
    } else if (t.indexOf('lb') >= 0) {
      arms += Math.abs(dx);
      lifts++;
    } else if (t.indexOf('pa') >= 0) {
      pushes++;
      paX += dx;
      pushY += dy;
    } else if (t.indexOf('pb') >= 0) {
      pushes++;
      pushY += dy;
    }
  }
  state.inertia = inertia;
  state.leanTorque = Math.max(arms * 400, 1); // N m per unit of throttle difference between the two lift halves
  state.liftForce = Math.max(lifts * 400, 1);
  state.pushForce = Math.max((pushes / 2) * 400, 1); // one side's push (counted again whenever parts are lost)
  state.pushRight = state.pushForce;
  state.pushLeft = state.pushForce;
  state.laLeft = laX < 0; // the `la` lift half sits left of the middle (it does not when flipped)
  state.paDir = paX < 0 ? 1 : -1; // the `pa` boosters sit on the left and push right (the other way when flipped)
  state.pushArm = pushes > 0 ? pushY / pushes : 0; // how far the push line is above the center of mass
  state.bottom = self.pos.y - minY + 0.5; // the core's height over the lowest part's underside
  state.halfWidth = (maxX - minX) / 2;
  state.home = { x: self.pos.x, y: self.pos.y };
  state.leg = 0;
  state.ramVy = null;
  state.mainId = -1;
  state.last = null;
  state.ping = null;
  state.dir = 0;
  state.away = 0;
  state.searchDir = 0;
  state.push = 0;
  state.won = false;
  state.plan = '';
}

function plan(name) {
  if (state.plan === name) return;
  state.plan = name;
  if (say > 0.5) log(name, 'x', self.pos.x.toFixed(0), 'y', self.pos.y.toFixed(0));
}

// Guns: blast whatever enemy is on the sight, and remember where the enemy's main robot was touched by one.
function runGuns() {
  if (guns === null || gunParts !== parts.length) {
    // Parts were lost (or this is the first tick): find the guns again and count the boosters still working.
    guns = [];
    gunParts = parts.length;
    let lifts = 0;
    let pa = 0;
    let pb = 0;
    for (const p of parts) {
      if (p.type === 'gun') guns.push(p);
      else if (p.type === 'booster') {
        const t = p.tags;
        if (t.indexOf('pa') >= 0) pa++;
        else if (t.indexOf('pb') >= 0) pb++;
        else lifts++;
      }
    }
    state.liftForce = Math.max(lifts * 400, 1);
    state.pushRight = Math.max((state.paDir > 0 ? pa : pb) * 400, 1); // push toward +x
    state.pushLeft = Math.max((state.paDir > 0 ? pb : pa) * 400, 1); // push toward -x
    state.pushForce = Math.min(state.pushRight, state.pushLeft);
  }
  for (const p of guns) {
    const enemy = p.out.sightSide === 3;
    if (enemy) {
      set(p.id, 'fire', 1);
      const id = p.out.sightId;
      if (state.mainId >= 0 ? id === state.mainId : id <= 2) {
        const d = p.out.sight;
        state.ping = { x: p.pos.x + Math.cos(p.out.aim) * d, y: p.pos.y + Math.sin(p.out.aim) * d, t: time };
      }
    } else if (p.in.fire > 0.5) set(p.id, 'fire', 0);
  }
}

function tick() {
  const m = self.mass;
  const x = self.pos.x;
  const y = self.pos.y;
  const vx = self.vel.x;
  const vy = self.vel.y;

  // The two titans are the first two robots of a match (numbers 1 and 2), and a robot that comes apart keeps its
  // number with its main core: the enemy numbered 1 or 2 is the one whose core decides the match.
  let main = null;
  for (const c of contacts) {
    if (state.mainId < 0 && c.side === 'enemy' && c.core && c.id <= 2) state.mainId = c.id;
    if (c.id !== state.mainId) continue;
    if (c.side === 'enemy' && c.core) main = c;
    else if (!c.core) state.won = true;
  }
  runGuns();

  let target = null;
  if (main) {
    state.last = { x: main.center.x, y: main.center.y, vx: main.vel.x, vy: main.vel.y, m: main.mass, t: time };
    target = state.last;
  } else if (state.ping && time - state.ping.t < pingKeep) {
    // Seen by a gun sight only. Never seen by radar: something on the ground is taken for too heavy to ram.
    const known = state.last ? state.last.m : state.ping.y < 15 ? 1e9 : 0;
    target = { x: state.ping.x, y: state.ping.y, vx: 0, vy: 0, m: known };
  } else if (state.last && time - state.last.t < 2) {
    const age = time - state.last.t;
    target = { x: state.last.x + state.last.vx * age, y: Math.max(1, state.last.y + state.last.vy * age), vx: state.last.vx, vy: state.last.vy, m: state.last.m };
  }

  const charge = self.energy.capacity > 0 ? self.energy.stored / self.energy.capacity : 1;
  const floor = state.bottom + 0.3;
  let wantVx = 0;
  let wantH = cruise;
  let ramVy = null; // a wanted climb rate when ramming straight up or down
  let land = false;

  if (state.won) {
    plan('done: landing');
    land = true;
  } else if (charge < reserve) {
    plan('low energy: landing');
    land = true;
  } else if (target && target.m > heavy * m) {
    // Too heavy to ram: stay high and far, cross over it when cornered, sit down while it is far and still.
    const dx = target.x - x;
    if (state.away === 0) state.away = dx > 0 ? -1 : 1;
    let spot = target.x + state.away * standoff;
    if (Math.abs(spot) > edge - 30) {
      state.away = -state.away;
      spot = target.x + state.away * standoff;
    }
    const still = Math.abs(target.vx) < 3 && Math.abs(dx) > standoff - 50;
    if (still) {
      plan('too heavy and still: resting');
      land = true;
    } else {
      plan('too heavy: keeping away');
      wantVx = clamp(0.5 * (spot - x), -vmax, vmax);
      wantH = target.y < 60 ? ceiling : cruise;
    }
  } else if (target) {
    plan('ramming');
    const dx = target.x - x;
    const speed = Math.min(vmax, (ownDv * (m + target.m)) / Math.max(target.m, 1));
    const runup = clamp((speed * speed) / (2 * (state.pushForce / m)), 40, 300);
    if (state.dir === 0) state.dir = dx >= 0 ? 1 : -1;
    if (dx * state.dir < -runup) state.dir = -state.dir; // far enough past it: come back
    const dy = target.y - y;
    if (Math.abs(dx) < 0.6 * state.halfWidth && Math.abs(dy) > state.bottom) {
      // It is straight above or below: ram it with the roof or the floor. Gravity stops a climb, so this is safe
      // right at the arena's edge, where a sideways run-up has no room.
      wantVx = target.vx + clamp(0.8 * dx, -15, 15);
      ramVy = target.vy + (dy > 0 ? 1 : -1) * Math.min(speed, uppercut);
    } else {
      wantVx = target.vx + state.dir * speed;
      const closing = Math.max(5, Math.abs(vx - target.vx));
      const lead = clamp(Math.abs(dx) / closing, 0, 3);
      wantH = target.y + target.vy * lead;
    }
  } else {
    // Nothing known (it hides from the radar): fly level at a height from where the roof and floor guns' sights
    // reach from the ground to the ceiling, and sweep the enemy's half to its edge, then the whole arena.
    plan('searching');
    // The first pass is high (a hiding core mostly waits high up at its own end) and fast until the enemy's start.
    const far = state.home.x < 0 ? 1 : -1;
    const legs = [far * (edge - 10), 0, far * (edge - 10), -far * (edge - 10)];
    const to = legs[state.leg % legs.length];
    if (Math.abs(to - x) < 10) state.leg++;
    const hurry = state.leg === 0 && (x + state.home.x * 0.5) * far < 0; // not yet halfway to the enemy's start
    wantVx = clamp(0.5 * (to - x), -(hurry ? vmax : sweepSpeed), hurry ? vmax : sweepSpeed);
    wantH = state.leg === 0 ? sweepHigh : sweepHeight;
  }

  // Height: a wanted climb rate toward the height, never sinking faster than it can stop before the ground.
  let lift;
  if (land) {
    wantVx = 0;
    wantH = floor;
  }
  wantH = clamp(wantH, floor, ceiling);
  const room = Math.max(0, y - floor);
  const sink = Math.max(1, Math.sqrt(2 * 3 * room));
  const rise = Math.sqrt(2 * 8 * Math.max(0, ceiling + 15 - y)); // gravity alone stops a climb before the arena's roof
  const wantVy = ramVy !== null && !land ? clamp(ramVy, -sink, rise) : clamp(1.0 * (wantH - y), -Math.min(14, sink), Math.min(10, rise));
  const ay = clamp(2.5 * (wantVy - vy), -9.81, 5);
  lift = (m * (9.81 + ay)) / state.liftForce / Math.max(0.5, Math.cos(self.angle));
  if (land && room < 0.4 && Math.abs(vy) < 1) lift = 0; // sitting on the ground

  // Level: a spring and damper on the tilt, through the difference between the two lift halves, plus what cancels
  // the push boosters' own turning.
  const w = 2;
  const torque = state.inertia * (-w * w * self.angle - 2 * w * self.angVel) + state.pushArm * state.push;
  const diff = clamp(torque / state.leanTorque, -0.35, 0.35);
  lift = clamp(lift, 0, 1 - Math.abs(diff));
  const leftLift = lift > 0 ? clamp(lift - diff, 0, 1) : 0;
  const rightLift = lift > 0 ? clamp(lift + diff, 0, 1) : 0;
  set('la', 'throttle', state.laLeft ? leftLift : rightLift);
  set('lb', 'throttle', state.laLeft ? rightLift : leftLift);

  // The arena ends at x 1000 either way: never faster toward an edge than it can stop before `edge`.
  // Going right is stopped by the boosters that push left, and the other way round: count what is left of each.
  const stopRight = (0.8 * state.pushLeft) / m;
  const stopLeft = (0.8 * state.pushRight) / m;
  wantVx = clamp(wantVx, -Math.sqrt(2 * stopLeft * Math.max(0, x + edge)), Math.sqrt(2 * stopRight * Math.max(0, edge - x)));

  // Sideways: the boosters on one side or the other.
  const u = clamp(0.6 * (wantVx - vx), -1, 1);
  set('pa', 'throttle', clamp(u * state.paDir, 0, 1));
  set('pb', 'throttle', clamp(-u * state.paDir, 0, 1));
  state.push = u * (u > 0 ? state.pushRight : state.pushLeft);
}
