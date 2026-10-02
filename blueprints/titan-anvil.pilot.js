// titan-anvil pilot: a flying brick of armor that only rams.
// A hard hit hurts what is near the contact (about 6 m deep), so the brick aims the contact at where the enemy's
// main core is: it scans the enemy's main robot, works out how deep its core sits behind each face, and comes in on
// the thinnest one, again and again on the same spot. From the side it flies level through the core's row; from
// below it climbs into the core's column with its roof (gravity stops the climb, so that is safe at the arena's
// edge). A robot known only from gun sights (it hides from radar) is taken from below, across its whole length.
// Something much heavier is not rammed: the brick waits high behind its tail, at the arena's edge.
// It never turns: boosters on each side push it left or right, the lift rows hold its height and keep it level.
// Guns on every face blast what their sights show. Everything goes by `side` and by where its own parts are, so it
// works flipped.

const vmax = param('vmax', 60, { min: 10, max: 90 }); // fastest ram, m/s
const ownDv = param('ownDv', 20, { min: 5, max: 30 }); // the most its own speed may change in a hit, m/s
const heavy = param('heavy', 1.3, { min: 0.1, max: 5 }); // an enemy over this share of its own mass is not rammed
const ceiling = param('ceiling', 225, { min: 50, max: 240 }); // the core never goes above this (the arena ends at 250)
const reserve = param('reserve', 0.05, { min: 0, max: 0.5 }); // share of energy kept for landing
const edge = param('edge', 950, { min: 500, max: 970 }); // the core stays within this of the middle, m
const hideHeight = param('hideHeight', 200, { min: 50, max: 230 }); // m: where it waits out an enemy too heavy to ram
const lapSpeed = param('lapSpeed', 30, { min: 5, max: 80 }); // m/s it flies end to end while waiting (a brick that sits still is worn down)
const lapEnd = param('lapEnd', 700, { min: 100, max: 900 }); // m from the middle where a lap turns
const shove = param('shove', 5000, { min: 0, max: 100000 }); // kg: a ground enemy heavier than this with a deep core is not worth bumping
const jamEvery = param('jamEvery', 4.7, { min: 1, max: 5 }); // s between jammer pods while it waits hidden (a pod jams 5 s)
const match = param('match', 240, { min: 10, max: 10000 }); // s a match lasts: pushing a heavy enemy stops while the energy left still covers hovering to the end
const tall = param('tall', 60, { min: 10, max: 250 }); // m: a heavy enemy standing this far over its core is pushed over by its top
const touch = param('touch', 12, { min: 1, max: 40 }); // m/s it closes on that top at
const thin = param('thin', 5, { min: 0, max: 20 }); // m: a heavy enemy's core this near a side face is rammed there anyway
const breach = param('breach', 78, { min: 10, max: 90 }); // m/s for that ram (it costs the face that hits)
const pushEdge = param('pushEdge', 975, { min: 500, max: 985 }); // how far out its core may go while shoving such an enemy
const local = param('local', 1, { min: 0, max: 1 }); // 1: a crash only hurts near the contact (round 2), so `breach` rams are worth it
const sweepSpeed = param('sweepSpeed', 40, { min: 5, max: 60 }); // m/s while searching with the gun sights
const sweepHeight = param('sweepHeight', 110, { min: 30, max: 200 }); // m: from here the roof and floor guns' sights cover ground to ceiling
const sweepHigh = param('sweepHigh', 185, { min: 30, max: 220 }); // m: the first pass, where the roof guns reach the ceiling
const uppercut = param('uppercut', 32, { min: 5, max: 45 }); // m/s at most when ramming straight up
const drop = param('drop', 75, { min: 20, max: 150 }); // m it sinks under a target before climbing into it
const pingKeep = param('pingKeep', 15, { min: 1, max: 60 }); // s it keeps going for the place gun sights last touched the enemy
const say = param('say', 1, { min: 0, max: 1 }); // 1 logs each change of plan

let guns = null;
let pods = []; // jammer pods not yet used
let gunParts = -1;
let pings = []; // one entry per tick a sight touched the enemy's main robot: its reach that tick

function setup() {
  let m = 0;
  let sx = 0;
  let sy = 0;
  let minY = 1e9;
  let maxY = -1e9;
  let minX = 1e9;
  let maxX = -1e9;
  for (const p of parts) {
    if (p.pos.x < minX) minX = p.pos.x;
    if (p.pos.x > maxX) maxX = p.pos.x;
    if (p.pos.y < minY) minY = p.pos.y;
    if (p.pos.y > maxY) maxY = p.pos.y;
    m += p.mass;
    sx += p.mass * p.pos.x;
    sy += p.mass * p.pos.y;
  }
  const cx = sx / m;
  const cy = sy / m;
  let inertia = 0;
  let arms = 0;
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
      laX += dx;
    } else if (t.indexOf('lb') >= 0) arms += Math.abs(dx);
    else if (t.indexOf('pa') >= 0) {
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
  state.laLeft = laX < 0; // the `la` lift half sits left of the middle (it does not when flipped)
  state.paDir = paX < 0 ? 1 : -1; // the `pa` boosters sit on the left and push right (the other way when flipped)
  state.pushArm = pushes > 0 ? pushY / pushes : 0; // how far the push line is above the center of mass
  state.bottom = self.pos.y - minY + 0.5; // the core's height over the lowest part's underside
  state.top = maxY - self.pos.y + 0.5; // and under the highest part's top
  state.halfWidth = (maxX - minX) / 2 + 0.5;
  state.home = { x: self.pos.x, y: self.pos.y };
  state.liftForce = 1;
  state.pushRight = 1;
  state.pushLeft = 1;
  state.mainId = -1;
  state.last = null;
  state.shape = null;
  state.shapeAt = -100;
  state.dir = 0;
  state.up = false;
  state.upAt = 0;
  state.upCount = 0;
  state.stallAt = 0;
  state.backing = false;
  state.evade = false;
  state.jamAt = -100;
  state.hideSide = 0;
  state.leg = 0;
  state.push = 0;
  state.won = false;
  state.plan = '';
}

function plan(name) {
  if (state.plan === name) return;
  state.plan = name;
  if (say > 0.5) log(name, 'x', self.pos.x.toFixed(0), 'y', self.pos.y.toFixed(0));
}

// Guns: blast whatever enemy is on the sight, and note where the enemy's main robot was touched by one.
function runGuns() {
  if (guns === null || gunParts !== parts.length) {
    // Parts were lost (or this is the first tick): find the guns again and count the boosters still working.
    guns = [];
    pods = [];
    gunParts = parts.length;
    let lifts = 0;
    let pa = 0;
    let pb = 0;
    for (const p of parts) {
      if (p.type === 'gun') guns.push(p);
      else if (p.type === 'jammer') {
        if (!(p.out.jamming > 0.5)) pods.push(p);
      } else if (p.type === 'booster') {
        const t = p.tags;
        if (t.indexOf('pa') >= 0) pa++;
        else if (t.indexOf('pb') >= 0) pb++;
        else lifts++;
      }
    }
    state.liftForce = Math.max(lifts * 400, 1);
    state.pushRight = Math.max((state.paDir > 0 ? pa : pb) * 400, 1); // push toward +x
    state.pushLeft = Math.max((state.paDir > 0 ? pb : pa) * 400, 1); // push toward -x
  }
  let lo = 1e9;
  let hi = -1e9;
  let ylo = 1e9;
  for (const p of guns) {
    if (p.out.sightSide === 3) {
      set(p.id, 'fire', 1);
      const id = p.out.sightId;
      if (state.mainId >= 0 ? id === state.mainId : id <= 2) {
        const d = p.out.sight;
        const px = p.pos.x + Math.cos(p.out.aim) * d;
        const py = p.pos.y + Math.sin(p.out.aim) * d;
        if (px < lo) lo = px;
        if (px > hi) hi = px;
        if (py < ylo) ylo = py;
      }
    } else if (p.in.fire > 0.5) set(p.id, 'fire', 0);
  }
  if (hi >= lo) {
    pings.push({ lo, hi, ylo, t: time });
    if (pings.length > 300) pings.shift();
  }
}

// How deep the enemy's main core sits behind each of its faces, from a scan: the parts on its row give left and
// right, the parts on its column give below and above.
function measure(main) {
  const seen = scan(main.id);
  if (!seen) return;
  const cx = main.pos.x;
  const cy = main.pos.y;
  let L = cx;
  let R = cx;
  let B = cy;
  let T = cy;
  let low = 1e9;
  let high = -1e9;
  let hullLo = 1e9;
  let hullHi = -1e9;
  let topX = cx;
  for (const p of seen) {
    const x = p.pos.x;
    const y = p.pos.y;
    if (y < low) low = y;
    if (y > high) {
      high = y;
      topX = x;
    }
    if (x < hullLo) hullLo = x;
    if (x > hullHi) hullHi = x;
    if (Math.abs(y - cy) < 1.6) {
      if (x < L) L = x;
      if (x > R) R = x;
    }
    if (Math.abs(x - cx) < 1.6) {
      if (y < B) B = y;
      if (y > T) T = y;
    }
  }
  state.shape = { L: cx - L, R: R - cx, B: cy - B, T: T - cy, low: low - cy, high: high - cy, hullLo: hullLo - cx, hullHi: hullHi - cx, topX: topX - cx, ground: low < 3 };
  state.shapeAt = time;
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
  if (main && time - state.shapeAt > 2) measure(main);
  while (pings.length > 0 && time - pings[0].t > pingKeep) pings.shift();

  const charge = self.energy.capacity > 0 ? self.energy.stored / self.energy.capacity : 1;
  const hoverPower = ((m * 9.81) / 400) * 60; // J/s the lift boosters draw holding its weight
  const floor = state.bottom + 0.3;
  const push = Math.min(state.pushRight, state.pushLeft);
  let wantVx = 0;
  let wantH = sweepHeight;
  let ramVy = null; // a wanted climb rate when ramming straight up
  let land = false;
  let limit = edge; // how far from the middle the core may go this tick

  // What is known of the enemy's main robot: seen by radar (its core's place), or only touched by gun sights.
  let target = null;
  if (main) {
    state.last = { x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, m: main.mass, t: time };
    target = state.last;
  } else if (state.last && time - state.last.t < 2) {
    const age = time - state.last.t;
    target = { x: state.last.x + state.last.vx * age, y: Math.max(1, state.last.y + state.last.vy * age), vx: state.last.vx, vy: state.last.vy, m: state.last.m };
  }
  const shape = main && state.shape && time - state.shapeAt < 6 ? state.shape : null;

  // Climbing into something from below: sink `drop` under its underside while lining up, then climb at full speed
  // until the climb stalls (the hit, or the ceiling), and start over.
  const fromBelow = (atX, underside, tvx, tvy) => {
    const start = Math.max(floor, underside - state.top - drop);
    atX = clamp(atX, -edge, edge);
    wantVx = tvx + clamp(0.8 * (atX - x), -vmax, vmax);
    if (!state.up) {
      wantH = start;
      if (Math.abs(atX - x) < 8 && y - start < 8) {
        state.up = true;
        state.upAt = time;
      }
    } else {
      ramVy = tvy + uppercut;
      const age = time - state.upAt;
      if ((age > 2 && vy < 4) || age > 14) {
        state.up = false;
        state.upCount++;
      }
    }
  };
  // Flying level through a point. `prefer` (1 or -1, 0 for either) is the way it must be going when it hits: going
  // the other way it passes over the top (`over`, a core height) and comes back.
  const fromSide = (t, prefer, over, fast) => {
    const dx = t.x - x;
    const speed = fast || Math.min(vmax, (ownDv * (m + t.m)) / Math.max(t.m, 1));
    const runup = clamp((speed * speed) / (2 * (push / m)), 40, 250);
    if (state.dir === 0) state.dir = dx >= 0 ? 1 : -1;
    const ahead = state.dir > 0 ? limit - x : x + limit; // room left before the arena's edge
    if (dx * state.dir < 0 && (dx * state.dir < -runup || ahead < 30)) {
      state.dir = -state.dir; // past it (or backed off far enough): come again
      state.backing = false;
    }
    // Pressed against it and going nowhere: back off for a run-up and bump it again. A bump shoves it much
    // further than a steady push, and a brick that sits still is an easy mark.
    if (!state.backing && Math.abs(dx) < state.halfWidth + 30 && Math.abs(vx - t.vx) < 2) {
      if (time - state.stallAt > 2.5) {
        state.dir = dx >= 0 ? -1 : 1;
        state.backing = true;
        state.stallAt = time;
      }
    } else state.stallAt = time;
    wantVx = t.vx + state.dir * speed;
    if (prefer !== 0 && state.dir !== prefer && over !== null && !state.backing) wantH = over;
    else {
      const closing = Math.max(5, Math.abs(vx - t.vx));
      wantH = t.y + t.vy * clamp(Math.abs(dx) / closing, 0, 3);
    }
  };

  if (state.won) {
    plan('done: landing');
    land = true;
  } else if (charge < reserve) {
    plan('low energy: landing');
    land = true;
  } else if (state.evade || (target && target.m > heavy * m && self.energy.stored < Math.max(0, match - time) * hoverPower * 1.08)) {
    state.evade = true;
    // Nothing it can do to this enemy, so it only has to last: it hides in its own jammer bubbles (no sensor sees
    // it, its own radar included) and flies from end to end, high up, never sitting still.
    plan('waiting it out, hidden');
    if (time - state.jamAt > jamEvery && pods.length > 0) {
      const pod = pods.pop();
      set(pod.id, 'ignite', 1);
      state.jamAt = time;
    }
    if (state.hideSide === 0) state.hideSide = x >= 0 ? -1 : 1;
    if (x * state.hideSide > lapEnd) state.hideSide = -state.hideSide;
    wantVx = state.hideSide * lapSpeed;
    wantH = hideHeight;
  } else if (target && target.m > heavy * m) {
    // Too heavy to ram head on: its own speed would hardly change. Three answers, from a scan of it.
    if (local > 0.5 && shape && Math.min(shape.L, shape.R) <= thin) {
      // Its core sits just behind a side face (it lies on its side): ram that face as fast as it can fly. The
      // brick's own face pays for it; the core behind six plates does not.
      // Pressed against it and going nowhere (no room for a run-up near the arena's edge), it backs off and comes
      // again: each bump shoves the enemy on, and its core loses once it is past the edge.
      plan('heavy: ramming the face its core is behind');
      const prefer = shape.L < shape.R ? 1 : -1;
      let over = target.y + shape.high + state.bottom + 10;
      if (over > ceiling) over = null;
      limit = pushEdge;
      fromSide(target, prefer, over, breach);
    } else if (shape && shape.high > tall) {
      // It stands tall (a mast): a push on the top of it is a long lever against its weight, so fly into the top
      // and keep pushing until it goes over.
      // It comes up to the top gently (matching the enemy's own speed, `touch` m/s faster) so the meeting is no crash.
      plan('heavy: pushing its top over');
      const top = target.y + shape.high;
      const tx = target.x + shape.topX;
      fromSide({ x: tx, y: Math.min(top - 14, ceiling), vx: target.vx, vy: 0, m: 0 }, 0, null, Math.abs(tx - x) > 150 ? vmax : touch);
    } else {
      // Nothing to take hold of.
      state.evade = true;
      wantH = hideHeight;
    }
  } else if (target) {
    // Seen by radar: come in on the face its core is nearest to.
    const side = shape ? Math.min(shape.L, shape.R) : 0;
    const under = shape ? target.y - shape.B : target.y;
    // Near the arena's edge there is no room for a run-up from the side (a hiding core waits right at the edge):
    // anything in the air there is taken from below, which needs no room sideways.
    const cornered = edge - Math.abs(target.x) < 100 && target.y > 60;
    if (((shape && !shape.ground && shape.B + 3 < side) || cornered) && under - state.top - 30 > floor) {
      plan('ramming from below');
      fromBelow(target.x, under, target.vx, target.vy);
    } else {
      plan('ramming from the side');
      let prefer = 0;
      let over = null;
      if (shape) {
        const reachable = Math.min(shape.L, shape.R) <= 6; // a crash reaches about 6 m in
        if (reachable && Math.abs(shape.L - shape.R) > 3) prefer = shape.L < shape.R ? 1 : -1; // going right hits its left face
        else if (!reachable && shape.ground) {
          prefer = target.x >= 0 ? 1 : -1; // too deep: bump it out over the nearer edge
          if (target.m > shove) state.evade = true; // unless it is too heavy for bumps to move it that far
        }
        if (prefer !== 0) {
          over = target.y + shape.high + state.bottom + 10;
          if (over > ceiling) over = shape.ground ? null : target.y + shape.low - state.top - 10;
          if (over !== null && over < floor) over = null;
          if (!reachable) limit = pushEdge;
        }
      }
      fromSide(target, prefer, over);
    }
  } else if (pings.length > 0) {
    // Hidden from radar, touched by gun sights. In the air: climb into it from below, at the middle of what the
    // sights touched, then toward each end in turn (its core is somewhere along it). On the ground: from the side.
    let lo = 1e9;
    let hi = -1e9;
    let ylo = 1e9;
    for (const p of pings) {
      if (time - p.t > 4 && pings.length > 30) continue;
      if (p.lo < lo) lo = p.lo;
      if (p.hi > hi) hi = p.hi;
      if (p.ylo < ylo) ylo = p.ylo;
    }
    const mass = state.last ? state.last.m : 0;
    if (ylo > 40 && ylo - state.top - 30 > floor) {
      plan('ramming a hidden one from below');
      const span = hi - lo;
      const step = Math.max(0, span / 2 - state.halfWidth * 0.5);
      const k = state.upCount % 3;
      fromBelow(clamp((lo + hi) / 2 + (k === 1 ? -step : k === 2 ? step : 0), -edge, edge), ylo, 0, 0);
    } else if (mass > heavy * m) {
      state.evade = true;
      wantH = hideHeight;
    } else {
      // On the ground and hidden: its core is likely deep, so bump it out over the nearer edge.
      plan('ramming a hidden one from the side');
      const mid = (lo + hi) / 2;
      limit = pushEdge;
      fromSide({ x: mid, y: Math.max(ylo, floor), vx: 0, vy: 0, m: mass }, mid >= 0 ? 1 : -1, Math.min(ceiling, 60 + state.bottom));
    }
  } else {
    // Nothing known (it hides from the radar): fly level at a height from where the roof and floor guns' sights
    // reach from the ground to the ceiling, and sweep the enemy's half to its edge, then the whole arena.
    // The first pass is high (a hiding core mostly waits high up at its own end) and fast until the enemy's start.
    plan('searching');
    state.up = false;
    const far = state.home.x < 0 ? 1 : -1;
    const legs = [far * (edge - 10), 0, far * (edge - 10), -far * (edge - 10)];
    const to = legs[state.leg % legs.length];
    if (Math.abs(to - x) < 10) state.leg++;
    const hurry = state.leg === 0 && (x + state.home.x * 0.5) * far < 0; // not yet halfway to the enemy's start
    wantVx = clamp(0.5 * (to - x), -(hurry ? vmax : sweepSpeed), hurry ? vmax : sweepSpeed);
    wantH = state.leg === 0 ? sweepHigh : sweepHeight;
  }

  // Height: a wanted climb rate toward the height, never sinking faster than it can stop before the ground.
  if (land) {
    wantVx = 0;
    wantH = floor;
  }
  wantH = clamp(wantH, floor, ceiling);
  const room = Math.max(0, y - floor);
  const sink = Math.max(1, Math.sqrt(2 * 3 * room));
  const rise = Math.sqrt(2 * 8 * Math.max(0, ceiling + 15 - y)); // gravity alone stops a climb before the arena's roof
  const wantVy = ramVy !== null && !land ? clamp(ramVy, -sink, rise) : clamp(1.0 * (wantH - y), -Math.min(16, sink), Math.min(12, rise));
  const ay = clamp(2.5 * (wantVy - vy), -9.81, 6);
  let lift = (m * (9.81 + ay)) / state.liftForce / Math.max(0.5, Math.cos(self.angle));
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
  wantVx = clamp(wantVx, -Math.sqrt(2 * stopLeft * Math.max(0, x + limit)), Math.sqrt(2 * stopRight * Math.max(0, limit - x)));

  // Sideways: the boosters on one side or the other.
  const u = clamp(0.6 * (wantVx - vx), -1, 1);
  set('pa', 'throttle', clamp(u * state.paDir, 0, 1));
  set('pb', 'throttle', clamp(-u * state.paDir, 0, 1));
  state.push = u * (u > 0 ? state.pushRight : state.pushLeft);
}
