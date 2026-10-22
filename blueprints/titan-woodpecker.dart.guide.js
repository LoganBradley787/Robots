// Guide of every titan-woodpecker dart (the ones standing on the rack and the ones the bays build). Lean on purpose:
// hundreds fly at once, so it never loops over parts.
// - setup() reads the base's message: the target's point and speed, its id, and how far its parts reach from its core
//   (l, r, d, u, so the dart knows where the target's edge is). With no message it stays a dud and flies up and away.
// - It climbs `climb` m straight up, then steers its speed onto the line to where the target will be: it pushes along
//   the line, cancels its speed across the line (no harder than `acrossMax`), and holds itself up against gravity.
// - `top` in the message (a target wider than it is tall): it flies level `over` m above the target and then down
//   to it at a slope of `loft`, so it lands on the roof at a slant: a wide base is thin from above.
// - Round 2, following a target that moves: the dart has a radio and no sensor of its own. The keep's radar sees the
//   whole arena and the radio shares it, so the dart takes the target's real point and speed all the way in. The
//   radio is switched on one tick in `every` (each dart on its own beat) to keep the cost down, and one tick in
//   `everyNear` once it is within `nearDist` m. Between two looks it carries the last point on by its speed.
// - What it follows: the robot it was sent at while that one is alive, else the heaviest enemy with a live core the
//   radio shares (titan-darts, 2026-10: never a robot picked by its id), whatever the message said. A sighting is
//   believed however far it is from the point sent at launch: round 1's darts flew to where a rammer had been
//   standing. One sent at a robot that has since died (in view as debris) goes after that heaviest one instead.
// - It arms its heads within `armDist` m of the edge of the real robot (as last seen), or of the point it was sent to
//   when it never saw one, so a shell that finds it on the way only breaks it. Titans v2 (2026-10): also within
//   `anyArm` m of the guessed edge of any other enemy robot of `anyMass` kg or more (a gun panel or pod in the way), so
//   a dart that hits any enemy part goes off; never near light ones (their darts), which it would only meet head on.
// - Titans v2: a bay's dart has a nose seeker, on within `seekDist` m of its point: within 150 m it sees a robot
//   hidden in a jammer's bubble. A dart sent with a way in (`ax`, `ay`) comes in along it near the end.
// - It goes off when its heads pass within `prox` m of the core of the robot it tracks (titan-darts, 2026-10, as the
//   hive's darts do), counting where both will be by the next tick: one that passed a small robot by a meter flew
//   on past it.
// - It ends itself when it is spent (its life, or nearly out of energy) or has flown past its point. Its life fits the
//   flight (titan-darts, 2026-10): `life` s at least, and the time to the point it was sent to at `lifeSpeed` plus
//   `lifeSpare` when that is longer, up to `lifeMax`. A fixed 12.5 s ended darts a few hundred meters short.
const climb = param('climb', 9, { min: 0, max: 100 }); // m straight up before it turns
const every = param('every', 20, { min: 1, max: 60 }); // ticks between two looks through the radio, far out
const everyNear = param('everyNear', 3, { min: 1, max: 60 }); // the same, close in
const nearDist = param('nearDist', 160, { min: 0, max: 1000 }); // m from the target where it looks more often
const armDist = param('armDist', 30, { min: 1, max: 300 }); // m from the target's edge where the heads arm
const prox = param('prox', 3, { min: 0, max: 20 }); // m from the tracked robot's core (from the heads) where it goes off
const anyArm = param('anyArm', 12, { min: 0, max: 300 }); // m from the guessed edge of any other enemy robot where the heads arm
const anyMass = param('anyMass', 25, { min: 0, max: 100000 }); // kg: lighter robots (darts) do not arm the heads (armed, a dart passing another went off on it)
const reachK = param('reachK', 1.2, { min: 0.1, max: 5 }); // m of reach guessed per square root of a robot's part count (a long robot reaches about this far)
const reachMax = param('reachMax', 120, { min: 1, max: 300 }); // m: the most a robot whose size it was not told is guessed to reach
const seekDist = param('seekDist', 320, { min: 0, max: 2000 }); // m from its point where the nose seeker (if any) is on
const headAt = param('headAt', 1.5, { min: 0, max: 10 }); // m from the core to the middle of its heads, along the nose
const kp = param('kp', 4, { min: 0, max: 50 });
const kd = param('kd', 1.3, { min: 0, max: 50 });
const push = param('push', 30, { min: 1, max: 200 }); // m/s^2 it asks for along the line
const across = param('across', 3, { min: 0, max: 20 }); // 1/s: how hard it cancels speed across the line
const acrossMax = param('acrossMax', 40, { min: 0, max: 200 }); // m/s^2 at most across the line
const over = param('over', 130, { min: 0, max: 240 }); // m above a wide target it aims at most
const loft = param('loft', 0.45, { min: 0, max: 2 }); // m of aim height per m of ground still to cover
const wayFar = param('wayFar', 260, { min: 0, max: 2000 }); // m: a dart sent at a wide target turns onto the way in from here
const wayNear = param('wayNear', 25, { min: 0, max: 200 }); // m from the core where it stops leaning onto the way in
const ahead = param('ahead', 1.2, { min: 0.1, max: 5 }); // s of flight it looks ahead along its path
const mainMass = param('mainMass', 30, { min: 0, max: 100000 }); // kg: lighter robots (darts, pods) are never followed unless it was sent at one
const life = param('life', 12.5, { min: 1, max: 60 }); // s after which it ends itself, at least (a spent dart on the ground still costs a script)
const lifeSpeed = param('lifeSpeed', 50, { min: 5, max: 500 }); // m/s: its life is at least the time to its point at this speed
const lifeSpare = param('lifeSpare', 5, { min: 0, max: 30 }); // s added to that (the climb, a target that moves away)
const lifeMax = param('lifeMax', 40, { min: 1, max: 120 }); // s at most

function setup() {
  state.t = null;
  state.seeker = parts.some((p) => p.type === 'seeker');
  if (state.seeker) set('seeker', 'on', 0);
  for (const m of inbox) if (m.data && typeof m.data.x === 'number') state.t = m.data;
  state.at = time;
  state.born = time;
  state.y0 = self.pos.y;
  state.a0 = self.angle;
  state.armed = false;
  state.best = Infinity;
  state.beat = Math.floor(random() * 60);
  state.n = 0;
  state.seen = false;
  state.gap = Infinity; // m from its core to the nearest other enemy's guessed edge, at the last look
  state.gapAt = 0;
  state.looked = false;
  state.radioOn = false;
  state.life = life;
  if (state.t) {
    const far = Math.hypot(state.t.x - self.pos.x, state.t.y - self.pos.y);
    state.life = clamp(lifeSpare + far / lifeSpeed, life, Math.max(life, lifeMax));
  }
}

// The radio, switched on (it works the tick after) or off, remembered so the next tick knows it looked.
function radio(on) {
  set('radio', 'on', on);
  state.radioOn = on > 0;
}

function steer(want, full) {
  let err = want - self.angle;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  // A gyro's spin is clockwise positive, the angle counterclockwise positive.
  set('heavygyro', 'spin', clamp(-(kp * err - kd * self.angVel), -1, 1));
  set('booster', 'throttle', Math.abs(err) < 0.9 ? full : 0.3);
}

// The robot to follow among what the radio shares: the one it was sent at while it is alive, else the heaviest enemy
// with a live core.
// While it looks, it also notes how near the nearest other enemy with a live core is (`state.gap`, from its core to the
// robot's guessed edge), so a robot that gets in the way (a gun panel, a pod) arms the heads before they touch it.
function sighting(id) {
  let main = null;
  let mine = null;
  let gap = Infinity;
  const px = self.pos.x;
  const py = self.pos.y;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id === id) mine = c;
    else if (c.mass >= anyMass) {
      const g = Math.hypot(c.pos.x - px, c.pos.y - py) - reachOf(c);
      if (g < gap) gap = g;
    }
    if (c.mass >= mainMass && (!main || c.mass > main.mass)) main = c;
  }
  state.gap = gap;
  state.gapAt = time;
  return mine || main;
}

// How far a robot's parts are guessed to reach from its core, from its part count, on the long side (a robot whose
// size the base did not send has no measured box).
function reachOf(c) {
  return clamp(reachK * Math.sqrt(c.parts), 1.5, reachMax);
}

function tick() {
  const t = state.t;
  state.n++;
  if (!t) {
    // Knocked loose with no target: fly up and away from the base, unarmed.
    radio(0);
    steer(state.a0, 1);
    return;
  }
  const px = self.pos.x;
  const py = self.pos.y;
  // A look now and then. The radio works the tick after it is switched on.
  if (contacts.length === 0 && state.looked) {
    // The radio was on and shared nothing: no robot near that it knows of.
    state.gap = Infinity;
    state.gapAt = time;
  }
  state.looked = state.radioOn;
  if (contacts.length > 0) {
    const c = sighting(t.id);
    if (c) {
      if (t.blind || c.id !== t.id) {
        // First real sighting of a robot the base could not name: a guess at its size, and at it from the side.
        t.id = c.id;
        t.blind = 0;
        // Its size from its part count (titans v2, 2026-10): a fixed 20 m left darts unarmed when they met the edge
        // of a wide robot found by the seeker or the radio after a blind start, and they broke on it.
        t.l = t.r = t.d = t.u = reachOf(c);
        t.top = 0;
        t.ax = undefined; // the way in was found for another robot
      }
      t.x = c.pos.x;
      t.y = c.pos.y;
      t.vx = c.vel.x;
      t.vy = c.vel.y;
      state.at = time;
      state.seen = true;
    }
  }
  if (py - state.y0 < climb && time - state.born < 1.5) {
    radio(0);
    steer(state.a0, 1);
    return;
  }
  // Where the target is now, by its last known point and speed (at most 12 s of guessing).
  const age = Math.min(time - state.at, 12);
  const tx = t.x + t.vx * age;
  const ty = t.y + t.vy * age;
  let dx = tx - px;
  let dy = ty - py;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < state.best) state.best = dist;
  if (time - state.born > state.life || self.energy.stored < 25 || (state.best < 60 && dist > state.best + 120)) {
    set('heavywarhead', 'arm', 1);
    set('heavywarhead', 'detonate', 1);
    return;
  }
  // Another enemy robot near (titans v2, 2026-10): its guessed edge, carried on by the dart's own speed since the last
  // look (as if flying straight at it), so the heads are armed before a robot in the way is touched, never after.
  const speed = Math.sqrt(self.vel.x * self.vel.x + self.vel.y * self.vel.y);
  const gapNow = state.gap - (speed + 30) * (time - state.gapAt);
  const beat = dist < nearDist || gapNow < nearDist ? everyNear : every;
  const look = (state.n + state.beat) % beat === 0 ? 1 : 0;
  radio(look);
  // The nose seeker (a bay's dart, titans v2, 2026-10), on only near the end and on the radio's beat: within 150 m it
  // sees a robot hidden in a jammer's bubble, so a dart sent at a guess finds the core itself. Every tick it is on,
  // the dart has contacts to read, so it looks no more often than the radio does.
  if (state.seeker) set('seeker', 'on', look && dist < seekDist ? 1 : 0);
  if (!state.armed && ((px > tx - t.l - armDist && px < tx + t.r + armDist && py > ty - t.d - armDist && py < ty + t.u + armDist) || gapNow < anyArm)) {
    set('heavywarhead', 'arm', 1);
    state.armed = true;
  }
  // Next to the robot it tracks: from its heads (`headAt` m up the nose from the core), now or by the next tick.
  if (state.armed && state.seen && time - state.at < 0.3) {
    const hx = px - Math.sin(self.angle) * headAt;
    const hy = py + Math.cos(self.angle) * headAt;
    const rx = tx - hx;
    const ry = ty - hy;
    const wx = t.vx - self.vel.x;
    const wy = t.vy - self.vel.y;
    const w2 = wx * wx + wy * wy;
    const s = w2 > 0 ? clamp(-(rx * wx + ry * wy) / w2, 0, dt) : 0;
    if (Math.hypot(rx + wx * s, ry + wy * s) < prox) {
      set('heavywarhead', 'detonate', 1);
      return;
    }
  }
  // Lead: aim where the target will be when the dart gets there.
  const rvx = self.vel.x - t.vx;
  const rvy = self.vel.y - t.vy;
  const closing = dist > 1e-6 ? (rvx * dx + rvy * dy) / dist : 0;
  const go = Math.min(dist / Math.max(closing, 60), 6);
  dx += t.vx * go;
  dy += t.vy * go;
  // A wide target: follow a path that runs level at `over` m above it and then down to it at a slope of `loft`,
  // by aiming at the point on that path `ahead` s of flight in front (a dart at full speed turns slowly, so it has to
  // start the bend early). Inside that distance it aims at the target itself.
  const far = Math.sqrt(dx * dx + dy * dy);
  if (typeof t.ax === 'number' && (!t.blind || t.sweep) && (far < wayFar || !t.top)) {
    // A way in from the base (titans v2, 2026-10): the thinnest line into the core it found. The dart flies at a point
    // out along that line, `loft` m out per m it still has to go (at most `over`), so the point slides in to the core
    // as the dart closes and the dart ends up coming in along the line. Against a wide target it first flies the
    // high path below until `wayFar` m out: lower down, a stream of darts met the enemy's own darts coming the other
    // way along the same line, and broke on them.
    const out = Math.min(loft * Math.max(0, far - wayNear), over);
    dx += t.ax * out;
    dy += t.ay * out;
  } else if (t.top) {
    const adx = Math.abs(dx);
    const reach = clamp(ahead * Math.sqrt(self.vel.x * self.vel.x + self.vel.y * self.vel.y), 60, 220);
    if (adx > reach) {
      dy += Math.min(loft * (adx - reach), over);
      dx = dx > 0 ? reach : -reach;
    }
  }
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  // Speed across the line (relative to the target), cancelled; a steady push along it; gravity held.
  const lat = rvx * -uy + rvy * ux;
  const fix = clamp(across * lat, -acrossMax, acrossMax);
  const ax = ux * push - fix * -uy;
  const ay = uy * push - fix * ux + 9.81;
  steer(Math.atan2(-ax, ay), 1);
}
