// Guide of a ghost (titan-mirage's dart): two boosters, a heavy gyro, a jammer pod, a radio, a seeker looking ahead, a
// distance charge nose and two heavy warheads. The hull hands it a point, that point's speed and (when it tracks one)
// the robot's id when it lets it go.
// - Sensors (titan-darts, 2026-10): it follows a live target, not a guess. Its radio hears what the hull's radars see
//   (the hull carries a radio by its radars) and what the other ghosts' seekers see; its seeker sees 300 m ahead.
//   The robot it follows: the one the hull named, else the heaviest enemy with a live core near where the point
//   would be. It aims ahead of it by its speed. With nothing live it flies to where the last fix would be by now
//   (the hull's point carried on by its speed) and goes off there, as before.
// - Its pod is lit only in the last `cloak` s before it gets there (about `cloakDist` m out): from then on no sensor
//   further than 150 m away sees it (the target's guns pick it out only for its last few meters), and it is blind
//   past 150 m too (its radio is jammed in its own bubble), so it carries on by the last fix until its seeker, which
//   sees 150 m out of its own bubble, picks the target up again. Lit any sooner, the pod would cut off its radio for
//   most of the flight.
// - It goes off next to a live target (`prox` m from its warhead, counting where both will be by the next tick), or
//   when it starts to pull away after passing within `passed` m. Its charge also goes off by itself next to the first
//   enemy part (1.5 m).
// - A target that died (it stays in view as debris, with no live core) is forgotten: the ghost takes another live
//   enemy it sees near there, and with none it never goes off at the dead one's spot; it flies on until its life ends.
// - It arms as late as still works (titans v2, 2026-10, Logan): within `armDist` m of where it is going, or the
//   moment it will reach ANY enemy it sees within `armTime` s (its middle, padded by the robot's size from its part
//   count), so a ghost that meets a small gun panel or the near end of a big hull on its way goes off there instead of
//   breaking. Armed early, ghosts of one salvo that touch set each other off (armed 200 m out, they did), and a gun
//   that hits an armed warhead sets it off, so the warheads arm only that close. The charge arms `chargeAt` m out:
//   it needs an enemy part within 1.5 m or a hard hit, and shot it only breaks. It ends itself `life` s after letting go at the latest (sized from the distance it was sent: the
//   flight at `lifeSpeed` plus `lifeSpare`, up to `lifeMax`).
// - Sent with an offset (`ox`, `oy`, titans v2, 2026-10), it goes for that point on the robot it follows, measured from
//   its core, not the core: the hull sends such ghosts at the part of a tall enemy that would reach it.
// Let go with no point (knocked loose), it does nothing and stays safe.
const thrust = param('thrust', 800, { min: 1, max: 100000 }); // N, both boosters
const clear = param('clear', 14, { min: 0, max: 100 }); // m straight out of the bay before it turns
const over = param('over', 22, { min: 0, max: 200 }); // m it stays above where it left while still over the hull
const hull = param('hull', 190, { min: 0, max: 1000 }); // m sideways from where it left that count as over the hull
const armDist = param('armDist', 40, { min: 0, max: 2000 }); // m from where it is going: it arms inside this (armed 200 m out, ghosts of one salvo that touched set each other off)
const cloakAt = param('cloakAt', 45, { min: 31, max: 1000 }); // m from where it left before its pod may be lit (the hull's radars and radio must stay outside its bubble)
const cloak = param('cloak', 2, { min: 0, max: 5 }); // s of flight left when the pod is lit
const cloakDist = param('cloakDist', 320, { min: 0, max: 1000 }); // m: and no further out than this
const cross = param('cross', 2.5, { min: 0, max: 20 }); // 1/s: how hard it kills speed across the line to the point
const along = param('along', 50, { min: 0, max: 500 }); // m/s^2 it asks for along the line
const cruise = param('cruise', 170, { min: 10, max: 1000 }); // m/s: faster than this it stops pushing along the line (energy for the end)
const turn = param('turn', 5, { min: 0.1, max: 50 }); // rad/s^2 it plans its turns on
const near = param('near', 2.5, { min: 0, max: 50 }); // m from a guessed point where it sets itself off
const prox = param('prox', 3, { min: 0, max: 20 }); // m from a live target (from its warhead) where it sets itself off
const passed = param('passed', 10, { min: 0, max: 50 }); // m: having come this close, it goes off once it pulls away
const acquire = param('acquire', 150, { min: 1, max: 1000 }); // m: an enemy this close to where the point would be is the one it follows
const minMass = param('minMass', 30, { min: 0, max: 100000 }); // kg: lighter robots (darts, pods) are never followed unless named
const lead = param('lead', 1, { min: 0, max: 2 }); // 1 aims ahead of a tracked robot by its speed
const minClose = param('minClose', 100, { min: 10, max: 1000 }); // m/s: the closing speed it counts on at least when leading
const fixAge = param('fixAge', 6, { min: 0, max: 60 }); // s: a fix is carried on by its speed this long at most
const life = param('life', 10, { min: 1, max: 120 }); // s after letting go it ends itself, at least
const lifeSpeed = param('lifeSpeed', 60, { min: 5, max: 1000 }); // m/s: its life is at least the flight to its point at this speed
const lifeSpare = param('lifeSpare', 5, { min: 0, max: 60 }); // s added to that
const lifeMax = param('lifeMax', 30, { min: 1, max: 120 }); // s at most
const chargeAt = param('chargeAt', 40, { min: 0, max: 1000 }); // m from where it left: its charge arms (titans v2, 2026-10)
const armTime = param('armTime', 0.4, { min: 0, max: 5 }); // s: it arms when it will reach any enemy this soon
const armPad = param('armPad', 4, { min: 0, max: 50 }); // m: an enemy's reach is this plus `armSize` per square root of its parts
const armSize = param('armSize', 1, { min: 0, max: 10 }); // m (its parts as a round blob would be 0.56)

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function boom() {
  set('charge', 'detonate', 1);
  set('heavywarhead', 'detonate', 1);
}

/** Where its blast would be: the front of the ghost (its charge), else its core. */
function headAt() {
  for (const p of parts) if (p.type === 'charge') return p.pos;
  return self.pos;
}

function setup() {
  state.t0 = time;
  state.lx = self.pos.x;
  state.ly = self.pos.y;
  state.a0 = self.angle;
  state.fix = null; // { x, y, vx, vy, t }: the last known place and speed of what it goes after
  state.id = undefined;
  state.off = null; // where on the robot it goes, from its core (none: the core)
  state.live = -100; // when it last had a live fix
  state.dead = false; // what it was sent at died, and nothing else was found
  state.best = Infinity;
  state.armed = false;
  state.meet = false; // it is about to reach an enemy (arms then)
  for (const msg of inbox) {
    const d = msg.data;
    if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') continue;
    state.fix = { x: d.x, y: d.y, vx: d.vx || 0, vy: d.vy || 0, t: time };
    if (typeof d.id === 'number') state.id = d.id;
    if (typeof d.ox === 'number' && typeof d.oy === 'number') state.off = { x: d.ox, y: d.oy };
  }
  state.life = life;
  if (state.fix) {
    const far = Math.hypot(state.fix.x - self.pos.x, state.fix.y - self.pos.y);
    state.life = clamp(lifeSpare + far / lifeSpeed, life, Math.max(life, lifeMax));
  }
  set('heavygyro', 'damp', 0);
}

/** The fix carried on to now by its speed (for `fixAge` s at most), never under the ground. */
function here(f) {
  const age = Math.min(time - f.t, fixAge);
  const o = state.off;
  return { x: f.x + f.vx * age + (o ? o.x : 0), y: Math.max(0, f.y + f.vy * age + (o ? o.y : 0)) };
}

/**
 * Whether it will reach enemy `c` within `armTime` s: its closest pass to the robot's middle over that time, against the
 * robot's reach (titans v2, 2026-10).
 */
function meets(c) {
  const rx = c.center.x - self.pos.x;
  const ry = c.center.y - self.pos.y;
  const vx = self.vel.x - c.vel.x;
  const vy = self.vel.y - c.vel.y;
  const v2 = vx * vx + vy * vy;
  const s = v2 > 0 ? clamp((rx * vx + ry * vy) / v2, 0, armTime) : 0;
  return Math.hypot(rx - vx * s, ry - vy * s) < armPad + armSize * Math.sqrt(c.parts);
}

/**
 * What it follows this tick: the robot named while alive, else the heaviest live enemy near where the point would be.
 * Not yet armed, it also looks at every enemy for one it is about to reach (`state.meet`).
 */
function follow(arming) {
  const p = state.fix ? here(state.fix) : null;
  let best = null;
  let named = null;
  for (const c of contacts) {
    if (arming && c.side === 'enemy' && !state.meet && meets(c)) state.meet = true;
    if (named) {
      if (!arming) break;
      continue;
    }
    if (state.id !== undefined && c.id === state.id) {
      if (c.side === 'enemy' && c.core) {
        named = c;
        continue;
      }
      // It died: forget it (it stays in view as debris).
      state.id = undefined;
      state.dead = true;
      continue;
    }
    if (c.side !== 'enemy' || !c.core || c.mass < minMass || !p) continue;
    if (Math.hypot(c.pos.x - p.x, c.pos.y - p.y) > acquire) continue;
    if (!best || c.mass > best.mass) best = c;
  }
  return named || best;
}

function tick() {
  if (!state.fix) return;
  const t = time - state.t0;
  if (t > state.life) {
    boom();
    return;
  }
  const out = Math.hypot(self.pos.x - state.lx, self.pos.y - state.ly);

  const c = follow(!state.armed && out >= 20);
  if (c) {
    state.fix = { x: c.pos.x, y: c.pos.y, vx: c.vel.x, vy: c.vel.y, t: time };
    state.id = c.id;
    state.live = time;
    state.dead = false;
  }
  const live = time - state.live < 0.25;
  const p = here(state.fix);
  const dist = Math.hypot(p.x - self.pos.x, p.y - self.pos.y);
  const speed = Math.hypot(self.vel.x - state.fix.vx, self.vel.y - state.fix.vy);

  // The charge arms once clear of the hull: it goes off only next to an enemy part or on a hard hit, never for a
  // friend near it, and shot it breaks without a blast, so armed early it costs nothing and catches whatever enemy
  // the ghost runs into.
  if (out >= chargeAt) set('charge', 'arm', 1);
  if (!state.armed && out >= 20 && ((dist < armDist && !state.dead) || state.meet)) {
    set('charge', 'arm', 1);
    set('heavywarhead', 'arm', 1);
    state.armed = true;
  }
  if (out >= cloakAt && dist <= cloakDist && dist / Math.max(speed, 100) <= cloak) set('jammer', 'ignite', 1);
  if (state.armed) {
    if (live) {
      // Next to it now or by the next tick (at 160 m/s it covers nearly 3 m a tick).
      const w = headAt();
      const rx = p.x - w.x;
      const ry = p.y - w.y;
      const vx = state.fix.vx - self.vel.x;
      const vy = state.fix.vy - self.vel.y;
      const v2 = vx * vx + vy * vy;
      const s = v2 > 0 ? clamp(-(rx * vx + ry * vy) / v2, 0, dt) : 0;
      if (Math.hypot(rx + vx * s, ry + vy * s) <= prox) boom();
      if (state.best < passed && dist > state.best + 3) boom();
    } else if (!state.dead && (dist <= near || (state.best < 12 && dist > state.best + 3))) {
      // The guessed point, only while what it was sent at may still be there: never at a dead one's spot.
      boom();
    }
  }
  if (dist < state.best) state.best = dist;

  // Where to push: ahead of a moving target by its speed and the time to get there.
  let want;
  if (out < clear) {
    want = state.a0;
  } else {
    const closing = Math.max(minClose, speed);
    const go = Math.min(dist / closing, 3) * lead;
    let tx = p.x + state.fix.vx * (time - state.live < 1 ? go : 0) - self.pos.x;
    let ty = Math.max(0, p.y + state.fix.vy * (time - state.live < 1 ? go : 0)) - self.pos.y;
    // Still over the hull: do not dive through it.
    const floor = state.ly + over;
    if (Math.abs(self.pos.x - state.lx) < hull && self.pos.y + ty < floor) ty = floor - self.pos.y;
    const d = Math.max(1e-6, Math.hypot(tx, ty));
    tx /= d;
    ty /= d;
    const rvx = self.vel.x - state.fix.vx;
    const rvy = self.vel.y - state.fix.vy;
    const toward = rvx * tx + rvy * ty;
    const cx = rvx - toward * tx;
    const cy = rvy - toward * ty;
    // Past `cruise` it stops pushing along the line: no drag slows it, and the energy is for the turns at the end.
    const push = Math.hypot(self.vel.x, self.vel.y) < cruise ? along : 0;
    const ax = push * tx - cross * cx;
    const ay = push * ty - cross * cy + 9.81;
    want = Math.atan2(ay, ax) - Math.PI / 2;
    state.need = (Math.hypot(ax, ay) * self.mass) / thrust;
  }
  const err = wrap(want - self.angle);
  const rate = clamp(sign(err) * Math.sqrt(2 * turn * Math.abs(err)), -8, 8);
  set('heavygyro', 'spin', clamp(-2.5 * (rate - self.angVel), -1, 1));
  const full = out < clear ? 1 : clamp(state.need || 1, 0.15, 1);
  set('booster', 'throttle', Math.abs(err) < 0.6 || out < clear ? full : 0.2);
}
