// Helm of titan-mirage: the one script on the hull (cloak, flight, and letting ghosts go).
// - Cloak: one jammer pod of the stern block is lit every `period` s, so the main core is always inside a bubble and
//   no sensor outside it sees the hull. The radars stand at the bow, outside the bubble, so the hull still sees.
// - Flight: propellers in a stern group (la) and a bow group (lb) hold the height and keep the hull level; the
//   boosters on the ends (pf toward the bow, pr toward the stern) hold its place `standoff` m from what it tracks.
//   Left and right are worked out from where the parts are, so it flies the same deployed flipped.
// - Ghosts: when enough bays hold a finished ghost, all of them are handed the same point and speed and let go on one
//   tick. The point is the tracked robot with the enemy's main core; with nothing tracked, the place it was last
//   seen, else the mirror of the hull's own start (a hidden enemy stays about there).
const pods = param('pods', 55, { min: 1, max: 500 });
const bays = param('bays', 20, { min: 1, max: 64 });
const period = param('period', 4.5, { min: 1, max: 5 }); // s between pods (a pod jams 5 s)
const height = param('height', 200, { min: 5, max: 240 }); // m the core flies at
const roof = param('roof', 215, { min: 5, max: 245 }); // m the core never asks to fly above (250 is out of bounds, and a ram from below lifts it)
const heavy = param('heavy', 300, { min: 0, max: 100000 }); // kg: an enemy this heavy may be a ram
const danger = param('danger', 380, { min: 0, max: 1000 }); // m: a heavy enemy this close is stepped over or under
const step = param('step', 110, { min: 0, max: 250 }); // m of height kept from it
const standoff = param('standoff', 880, { min: 100, max: 1500 }); // m kept from the tracked robot (inside radar reach, outside a search around its own start)
const cornered = param('cornered', 250, { min: 0, max: 1000 }); // m: held closer than this against the edge, it takes the other side
const backoff = param('backoff', 250, { min: 0, max: 600 }); // m it backs away from its start with nothing tracked
const edge = param('edge', 650, { min: 100, max: 990 }); // it never flies its core past this x either way (well inside: shells push, and a wreck that drifts over x 1000 has lost)
const cruise = param('cruise', 24, { min: 1, max: 60 }); // m/s sideways at most
const reach = param('reach', 960, { min: 50, max: 1000 }); // m: a salvo only at something this close
const salvo = param('salvo', 20, { min: 1, max: 64 }); // ready bays that make a salvo
const wait = param('wait', 6, { min: 0, max: 60 }); // s after the first ghost is ready before a short salvo goes anyway
const blindGap = param('blindGap', 45, { min: 1, max: 120 }); // s between salvos at a place it cannot see
const groundY = param('groundY', 4, { min: 0, max: 200 }); // m: the height it aims at with nothing ever seen
const close = param('close', 320, { min: 0, max: 1000 }); // m: at something this close, every finished ghost goes at once
const level = (param('level', 25, { min: 1, max: 90 }) * Math.PI) / 180; // lets go only this level
const minMass = param('minMass', 40, { min: 0, max: 100000 }); // kg: lighter robots are never the main target

function measure() {
  let m = 0;
  let mx = 0;
  let my = 0;
  for (const p of parts) {
    m += p.mass;
    mx += p.mass * p.pos.x;
    my += p.mass * p.pos.y;
  }
  if (!(m > 0)) return;
  const cx = mx / m;
  const cy = my / m;
  let inertia = 0;
  let fa = 0;
  let xa = 0;
  let fb = 0;
  let xb = 0;
  let ff = 0;
  let fr = 0;
  let bow = 0;
  let stern = 0;
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    inertia += p.mass * (dx * dx + dy * dy);
    if (p.type === 'propeller') {
      if (p.tags.indexOf('la') >= 0) {
        fa += 120;
        xa += 120 * dx;
      } else if (p.tags.indexOf('lb') >= 0) {
        fb += 120;
        xb += 120 * dx;
      }
    } else if (p.type === 'booster') {
      if (p.tags.indexOf('la') >= 0) {
        fa += 400;
        xa += 400 * dx;
      } else if (p.tags.indexOf('lb') >= 0) {
        fb += 400;
        xb += 400 * dx;
      } else if (p.tags.indexOf('pf') >= 0) {
        ff += 400;
        stern += p.pos.x - self.pos.x;
      } else if (p.tags.indexOf('pr') >= 0) {
        fr += 400;
        bow += p.pos.x - self.pos.x;
      }
    }
  }
  state.m = m;
  state.inertia = inertia;
  state.fa = fa;
  state.fb = fb;
  state.ra = fa > 0 ? xa / fa : -1;
  state.rb = fb > 0 ? xb / fb : 1;
  state.ff = ff;
  state.fr = fr;
  if (ff > 0 || fr > 0) state.dir = bow - stern >= 0 ? 1 : -1;
}

function setup() {
  state.x0 = self.pos.x;
  state.dir = self.pos.x <= 0 ? 1 : -1; // the way the bow points along x
  state.main = -1; // the contact id of the robot with the enemy's main core
  state.last = null; // where it was last seen
  state.firstReady = -1;
  state.lastSalvo = -100;
  state.dodge = 0;
  state.dodgeAt = -100;
  state.side = 0; // which side of the tracked robot it keeps to (-1 left, 1 right)
  measure();
}

/** The robot to go after: the one with the enemy's main core, else the nearest tracked of some weight. */
function target() {
  let best = null;
  let named = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id === 1 || c.id === 2) named = c; // the two titans are robots 1 and 2: this is the piece with the main core
    if (c.mass >= minMass && !best) best = c; // nearest first: what is on its way here is stopped before it arrives
  }
  return named || best;
}

function tick() {
  set('j' + Math.min(pods - 1, Math.floor(time / period)), 'ignite', 1);
  if (frame % 30 === 0) measure();

  // what it goes after, and where that was last
  const t = target();
  if (t) state.last = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, at: time };

  // height: its own, or well over or under a heavy enemy that is close (a ram flies level)
  let high = height;
  let threat = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < heavy) continue;
    if (Math.abs(c.pos.x - self.pos.x) > danger) continue;
    threat = c;
    break;
  }
  if (threat) {
    // Over or under, picked once per close pass (a ram that follows must not be crossed).
    // Something low is stayed over at its own height or more; only something near its own height is ducked under.
    if (state.dodge === 0) state.dodge = threat.pos.y < height - 60 ? 1 : -1;
    state.dodgeAt = time;
    high = state.dodge > 0 ? Math.max(height, threat.pos.y + step) : threat.pos.y - step;
  } else if (time - state.dodgeAt > 4) {
    state.dodge = 0;
  }
  high = clamp(high, 25, roof);
  const vyWant = clamp(1.0 * (high - self.pos.y), -Math.min(22, Math.sqrt(2 * 6 * Math.max(0, self.pos.y - 15))), 22);
  const az = clamp(2.5 * (vyWant - self.vel.y), -8, 10);
  const lift = state.m * (9.81 + az);
  const w = 1.3;
  const torque = state.inertia * (-(w * w) * self.angle - 2 * w * self.angVel);
  const ra = state.ra;
  const rb = state.rb;
  let pushA = lift / 2;
  if (Math.abs(ra - rb) > 1e-6) pushA = (torque - rb * lift) / (ra - rb);
  let pushB = lift - pushA;
  // Lopsided lift (one side's propellers worn away): level comes first. The side that cannot give its share gives
  // what it has, and the good side is throttled down to what balances it, so the hull sinks level instead of rolling.
  if (Math.abs(ra) > 1e-6 && Math.abs(rb) > 1e-6) {
    if (pushA > state.fa) {
      pushA = state.fa;
      pushB = (torque - ra * pushA) / rb;
    } else if (pushB > state.fb) {
      pushB = state.fb;
      pushA = (torque - rb * pushB) / ra;
    }
  }
  set('la', 'throttle', clamp(pushA / Math.max(state.fa, 1e-9), 0, 1));
  set('lb', 'throttle', clamp(pushB / Math.max(state.fb, 1e-9), 0, 1));

  // place: standoff from the tracked robot, on the side it is on unless only the other side has the room
  let want = state.x0 - state.dir * backoff;
  if (t) {
    if (state.side === 0) state.side = self.pos.x === t.pos.x ? -state.dir : sign(self.pos.x - t.pos.x);
    const held = Math.abs(clamp(t.pos.x + state.side * standoff, -edge, edge) - t.pos.x);
    const other = Math.abs(clamp(t.pos.x - state.side * standoff, -edge, edge) - t.pos.x);
    if (held < cornered && other > held + 200) state.side = -state.side;
    want = t.pos.x + state.side * standoff;
    // On its own side it never comes nearer the middle than where it started (that is where everyone looks first).
    if (state.side === -state.dir) want = state.side * Math.max(state.side * want, state.side * state.x0);
  }
  want = clamp(want, -edge, edge);
  // No faster than it can still stop in the room left (its boosters are small for its weight).
  const stop = (0.6 * Math.min(state.ff, state.fr)) / Math.max(state.m, 1);
  const room = Math.abs(want - self.pos.x);
  const vWant = sign(want - self.pos.x) * Math.min(cruise, Math.sqrt(2 * stop * room));
  const ax = clamp(1.5 * (vWant - self.vel.x), -3, 3) * state.dir; // along the bow
  set('pf', 'throttle', clamp((ax * state.m) / Math.max(state.ff, 1e-9), 0, 1));
  set('pr', 'throttle', clamp((-ax * state.m) / Math.max(state.fr, 1e-9), 0, 1));

  // ghosts
  let ready = 0;
  let alive = 0;
  for (let i = 0; i < bays; i++) {
    const r = get('g' + String.fromCharCode(97 + i), 'ready');
    if (r === undefined || r === null) continue;
    alive++;
    if (r > 0) ready++;
  }
  if (ready === 0) {
    state.firstReady = -1;
    return;
  }
  if (state.firstReady < 0) state.firstReady = time;
  if (Math.abs(self.angle) > level) return;
  const hot = t && t.distance < close;
  if (!hot && ready < Math.min(salvo, alive) && time - state.firstReady < wait) return;
  let aim = null;
  if (t) {
    // Not at something close under the deck: a ghost would dive through its own hull.
    const fore = (t.pos.x - self.pos.x) * state.dir; // m along the hull from the core toward the bow
    const under = t.pos.y < self.pos.y - 4 && fore > -40 && fore < 215;
    if (t.distance <= reach && !under) aim = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y };
  } else if (time - state.lastSalvo >= blindGap) {
    // Nothing tracked: the place it was last seen (it kept its speed for a few seconds at most), else the mirror of the start.
    const l = state.last;
    if (l && time - l.at < 4) aim = { x: l.x + l.vx * (time - l.at), y: l.y + l.vy * (time - l.at), vx: l.vx, vy: l.vy };
    else if (l) aim = { x: l.x, y: l.y, vx: 0, vy: 0 };
    else aim = { x: -state.x0, y: groundY, vx: 0, vy: 0 };
    if (Math.hypot(aim.x - self.pos.x, aim.y - self.pos.y) > reach + 200) aim = null;
  }
  if (!aim) return;
  for (let i = 0; i < bays; i++) {
    const tag = 'g' + String.fromCharCode(97 + i);
    if (!(get(tag, 'ready') > 0)) continue;
    send(tag + get(tag, 'built'), aim);
    set(tag, 'release', 1);
  }
  state.lastSalvo = time;
  state.firstReady = -1;
}
