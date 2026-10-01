// Juggernaut pilot: the one script of the sled. It drives along the ground on two booster banks, picks the closing
// speed of a ram from the two masses, backs off for another run, parks under what it cannot reach, and fires the
// roof guns in groups. Enemies are picked by `side` only, and left and right come from where its own guns are, so it
// works flipped.
//
// The ram: a hard hit changes each body's speed by closing * (the other's mass) / (both masses), and every part of a
// body takes crash damage from that change (12 m/s is safe for most parts, 20 ends them; frames and plates 24).
// A part's share of that depends on where it sits: 1.5 times on the side that was hit, half on the far side. So it
// works out the change that ends the other's core where that core sits (from a scan), and closes that fast when its
// own change stays under `frontKill` (nose first: its core, batteries and boosters sit in its tail) or `rearKill`
// (tail first), once: after one hard hit of its own it only makes runs that cost it nothing much (`frontChip`,
// `rearChip`).

const top = param('top', 45, { min: 5, max: 80 }); // fastest it drives, m/s
const frontKill = param('frontKill', 19.5, { min: 5, max: 30 }); // the most it takes itself for a run that ends the other's core, nose first
const rearKill = param('rearKill', 15.5, { min: 5, max: 30 }); // and tail first
const frontChip = param('frontChip', 14, { min: 5, max: 30 }); // the most it takes on any other run, nose first
const rearChip = param('rearChip', 12, { min: 5, max: 30 }); // and tail first
const margin = param('margin', 1.5, { min: 0, max: 10 }); // m/s over what ends a core
const minMass = param('minMass', 40, { min: 0, max: 100000 }); // lighter robots are not followed (guns still fire at them)
const mainMax = param('mainMax', 2, { min: 0, max: 1000 }); // robots numbered up to this started the match (0: go by mass only)
const front = param('front', 91.5); // core to the nose's face, m (the generator sets these four)
const back = param('back', 28.5);
const roof = param('roof', 23.5); // core up to the gun muzzles
const reach = param('reach', 46.5); // core up to the mast's top
const push = param('push', 57600); // one bank's full push, N
const bins = param('bins', 30); // roof gun groups, tags bin0, bin1, ...
const bound = param('bound', 920, { min: 100, max: 990 }); // it never drives its core past this (the arena ends at 1000)
const deck = param('deck', 86, { min: -500, max: 500 }); // core to the gun deck's middle, along the hull, m
const blind = param('blind', 12, { min: 0, max: 100 }); // holding under a hidden robot, guns this near that place fire unseen, m
const patrolTop = param('patrolTop', 36, { min: 1, max: 80 }); // how fast it patrols, m/s
const wait = param('wait', 6, { min: 0, max: 60 }); // s parked with no sight of it before it patrols again
const chase = param('chase', 58, { min: 5, max: 90 }); // fastest it follows something overhead, m/s
const low = param('low', 0.12, { min: 0, max: 1 }); // under this share of its energy it stops driving

let guns = []; // guns[b]: the live gun parts of group b

function survey() {
  guns = [];
  for (let b = 0; b < bins; b++) guns.push([]);
  for (const p of parts) {
    if (p.type !== 'gun') continue;
    for (const t of p.tags) {
      if (t.length > 3 && t.charCodeAt(0) === 98 && t.charCodeAt(1) === 105 && t.charCodeAt(2) === 110) {
        const b = Number(t.slice(3));
        if (b >= 0 && b < bins) guns[b].push(p);
        break;
      }
    }
  }
  // Which way the nose points: the highest group left sits toward the nose, the lowest toward the tail.
  let lo = -1, hi = -1;
  for (let b = 0; b < bins; b++) {
    if (!guns[b].length) continue;
    if (lo < 0) lo = b;
    hi = b;
  }
  if (lo >= 0 && hi > lo) state.dir = guns[hi][0].pos.x > guns[lo][0].pos.x ? 1 : -1;
}

function setup() {
  state.dir = 1;
  state.lastX = -self.pos.x; // the other side starts mirrored
  state.tid = -1;
  state.scanAt = -1000;
  state.ext = { lx: -2, hx: 2, ly: -1, hy: 1 };
  state.phase = 'charge';
  state.pressed = 0;
  state.side = self.pos.x > 0 ? -1 : 1; // the other side's half
  state.leg = 0;
  state.holdX = null;
  state.holdSeen = -1000;
  state.worn = 0; // hard hits it has taken
  state.vx = 0;
  state.cores = []; // the target's cores, x relative to its position
  state.said = '';
  survey();
}

function say(what) {
  if (state.said === what) return;
  state.said = what;
  log(what);
}

function tick() {
  if (frame % 20 === 0) survey();
  const me = self.pos;
  const vx = self.vel.x;
  const M = self.mass;
  const dir = state.dir;
  const a = (0.8 * push) / Math.max(M, 1); // what a bank gives, with some held back for drag
  if (Math.abs(vx - state.vx) > 13) state.worn += 1;
  state.vx = vx;

  // The target: the enemy's first robot when it is seen (a robot keeps its number while its first core lives, and
  // what breaks off or is built gets a higher one, so the lowest numbers are the two that started the match);
  // otherwise the heaviest enemy with a live core, with a lean toward the one it already has.
  let T = null;
  let best = 0;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id <= mainMax) {
      T = c;
      break;
    }
    if (c.mass < minMass) continue;
    const score = c.mass * (c.id === state.tid ? 1.5 : 1);
    if (score > best) {
      best = score;
      T = c;
    }
  }
  if (T) {
    if (T.id !== state.tid || frame - state.scanAt >= 30) {
      const s = scan(T.id);
      if (s && s.length) {
        let lx = 1e9, hx = -1e9, ly = 1e9, hy = -1e9;
        const cores = [];
        for (const p of s) {
          const x = p.pos.x, y = p.pos.y;
          if (p.type === 'core' && cores.length < 40) cores.push(x - T.pos.x);
          if (x < lx) lx = x;
          if (x > hx) hx = x;
          if (y < ly) ly = y;
          if (y > hy) hy = y;
        }
        state.cores = cores;
        state.ext = { lx: lx - T.pos.x - 0.5, hx: hx - T.pos.x + 0.5, ly: ly - T.pos.y - 0.5, hy: hy - T.pos.y + 0.5 };
      } else if (T.id !== state.tid) {
        state.ext = { lx: -2, hx: 2, ly: -1, hy: 1 };
        state.cores = [];
      }
      if (T.id !== state.tid) state.phase = 'charge';
      state.scanAt = frame;
      state.tid = T.id;
    }
    state.lastX = T.pos.x;
  }

  const nose = me.x + dir * front;
  const tail = me.x - dir * back;
  const myL = Math.min(nose, tail);
  const myR = Math.max(nose, tail);
  const mid = (myL + myR) / 2;
  const roofY = me.y + roof;

  let vdes = 0;
  let overhead = null; // [left, right] in world x of what the roof guns should reach, already led
  let held = null; // the x it holds under with nothing seen
  if (T) {
    const e = state.ext;
    const tl = T.pos.x + e.lx;
    const tr = T.pos.x + e.hx;
    const tlo = T.pos.y + e.ly;
    const tmid = (tl + tr) / 2;
    const tvx = T.vel.x;
    if (tlo < me.y + reach - 1) {
      // Something it can touch: ram it.
      const s = tmid >= mid ? 1 : -1;
      const gap = s > 0 ? tl - myR : myL - tr;
      const m = Math.max(T.mass, 1);
      // The other's core that a hit from this side reaches least (the far side counts half, the near side 1.5).
      let w = 1;
      if (state.cores.length) {
        const c = (e.lx + e.hx) / 2;
        const half = Math.max((e.hx - e.lx) / 2, 0.5);
        w = 1.5;
        for (const x of state.cores) w = Math.min(w, 1 + 0.5 * clamp((-s * (x - c)) / half, -1, 1));
      }
      const end = 12 + 8 / Math.sqrt(w) + margin; // the change that ends that core
      const cost = (end * m) / M; // what giving it costs this robot
      const noseFirst = s * dir > 0;
      let own = noseFirst ? frontChip : rearChip;
      if (state.worn < 1 && cost <= (noseFirst ? frontKill : rearKill)) own = Math.max(own, cost);
      const vc = Math.min(top, (own * (M + m)) / m);
      const closing = s * (vx - tvx);
      const need = (vc * vc) / (2 * a) + 20;
      if (state.phase === 'charge') {
        vdes = tvx + s * vc;
        if (gap < 3 && closing < 0.5 * vc) state.pressed += dt;
        else state.pressed = 0;
        if (state.pressed > 0.4) {
          state.phase = 'backoff';
          state.pressed = 0;
        }
        say('charge ' + Math.round(vc) + ' m/s at robot ' + T.id);
      } else {
        vdes = tvx - s * top;
        const edge = s > 0 ? me.x < -bound + 60 : me.x > bound - 60;
        if (gap >= need || edge) state.phase = 'charge';
        say('back off from robot ' + T.id);
      }
    } else {
      // Too high to touch: sit under its middle and let the roof guns work.
      const err = tmid - mid;
      vdes = clamp(tvx + sign(err) * Math.min(top, Math.sqrt(2 * 0.6 * a * Math.abs(err))), -chase, chase);
      say('under robot ' + T.id);
    }
    if (tlo > roofY - 3 && tlo - roofY < 290) {
      const lead = (tvx - vx) * (Math.max(tlo - roofY, 0) / 300);
      overhead = [tl - 1 + lead, tr + 1 + lead];
    }
  } else {
    // Nothing seen (hidden, jammed, or gone): patrol the other side's half, from the middle to its far corner and
    // back, straight through where it started. Gun sights are not sensors, so nothing hides from them: when one
    // reads the enemy's first robot overhead, it comes back, parks the deck under that place and fires there.
    state.tid = -1;
    const deckX = me.x + dir * deck;
    let seenAt = null;
    for (let b = bins - 1; b >= 0 && seenAt === null; b--) {
      const g = guns[b];
      if (!g) continue;
      for (const p of g) {
        if (p.out.sightSide === 3 && (mainMax <= 0 || p.out.sightId <= mainMax)) {
          seenAt = p.pos.x;
          break;
        }
      }
    }
    if (seenAt !== null) {
      if (state.holdX === null || Math.abs(seenAt - state.holdX) > 6) state.holdX = seenAt;
      state.holdSeen = time;
    }
    let err;
    if (state.holdX !== null) {
      err = state.holdX - deckX;
      held = state.holdX;
      const quiet = time - state.holdSeen;
      if ((Math.abs(err) < 8 && quiet > wait) || quiet > 45) state.holdX = null;
      say('hold under x ' + Math.round(state.holdX === null ? 0 : state.holdX));
    } else {
      const far = state.side * 985;
      const near = -state.side * 100;
      const goal = state.leg === 0 ? far : near;
      err = goal - deckX;
      const stuck = state.leg === 0 && state.side * me.x > bound - 12;
      if (Math.abs(err) < 12 || stuck) state.leg = 1 - state.leg;
      say('patrol leg ' + state.leg);
    }
    vdes = sign(err) * Math.min(patrolTop, Math.sqrt(2 * 0.6 * a * Math.abs(err)));
  }

  // Stay inside the arena: never faster toward an edge than it can stop from.
  vdes = Math.min(vdes, Math.sqrt(2 * 0.7 * a * Math.max(0, bound - me.x)));
  vdes = Math.max(vdes, -Math.sqrt(2 * 0.7 * a * Math.max(0, bound + me.x)));
  if (self.energy.stored < low * self.energy.capacity) vdes = 0;

  const err = vdes - vx;
  const u = Math.abs(err) < 0.25 ? 0 : clamp(err / 1.5, -1, 1);
  const right = dir > 0 ? 'fwd' : 'rev'; // the bank that pushes toward +x
  const left = dir > 0 ? 'rev' : 'fwd';
  set(right, 'throttle', Math.max(u, 0));
  set(left, 'throttle', Math.max(-u, 0));

  // Roof and deck guns, a group at a time: on when one of its sights reads an enemy, when the target is over it,
  // or when it holds under a hidden robot and the group is near that place.
  for (let b = 0; b < bins; b++) {
    const g = guns[b];
    if (!g || !g.length) continue;
    let fire = 0;
    for (const p of g) {
      if (p.out.sightSide === 3) {
        fire = 1;
        break;
      }
    }
    if (!fire && overhead) {
      const xa = g[0].pos.x;
      const xb = g[g.length - 1].pos.x;
      if (Math.max(xa, xb) >= overhead[0] && Math.min(xa, xb) <= overhead[1]) fire = 1;
    }
    if (!fire && held !== null && Math.abs(g[0].pos.x - held) <= blind) fire = 1;
    set('bin' + b, 'fire', fire);
  }
}
