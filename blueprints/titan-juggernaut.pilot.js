// Juggernaut pilot: the one script of the sled. It drives along the ground on two booster banks and fires the roof,
// shelf and deck guns in groups. Enemies are picked by `side` only, and left and right come from where its own guns
// are, so it works flipped.
//
// What it does with the other titan's main robot (robot 1 or 2: the two that started the match):
// - On the ground: it rams it and keeps pushing, nose first, until that robot is past the arena's edge (a main core
//   past x 1000 has lost). A crash only breaks the first few meters, so the push is what ends it.
// - Whenever it pushes hard and does not move (a roped base, a wreck in the way), it backs off and runs at it once.
//   If that does not move it either, it stands back in the far corner for good: something pinned takes no crash
//   damage, each run would only break its own nose, and what is roped cannot follow it out of radar range.
// - In the air and light, or low: it drives its mast through it. The mast reaches the ceiling a main core may fly
//   at, so nothing slower than the sled can stay out of its way, and what it hits is carried toward the edge.
// - In the air, heavy and high: it parks under it and lets the guns work (the top of the mast is too light a hammer
//   for that, and the knock would rock the sled).
// - Not seen (hidden, jammed): it patrols the whole arena, corner to corner. Gun sights are not sensors, so nothing
//   hides from them: when one reads that robot overhead, it comes back, parks the deck under it and fires there.
//
// The ram's speed: a hit changes each body's speed by closing * (the other's mass) / (both masses), and plates near
// the contact break when their own body's change passes 24 m/s. So it never closes faster than keeps its own change
// under `ownDv`.

const top = param('top', 55, { min: 5, max: 90 }); // fastest it drives at something, m/s
const ownDv = param('ownDv', 22, { min: 5, max: 40 }); // the most speed change it takes in a ram, m/s
const minMass = param('minMass', 40, { min: 0, max: 100000 }); // lighter robots are not followed (guns still fire at them)
const mainMax = param('mainMax', 2, { min: 0, max: 1000 }); // robots numbered up to this started the match (0: go by mass only)
const swatMass = param('swatMass', 1500, { min: 0, max: 100000 }); // heavier than this and above the deck, it is not swept
const front = param('front', 49.5); // core to the nose's face, m (the generator sets these nine)
const back = param('back', 50.5);
const roof = param('roof', 24.5); // core up to the roof guns' muzzles
const deckTop = param('deckTop', 104.5); // core up to the deck guns' muzzles
const reach = param('reach', 248.5); // core up to the spar's top
const deck = param('deck', 39.5, { min: -500, max: 500 }); // core to the gun deck's middle, along the hull
const mast = param('mast', 36.5, { min: -500, max: 500 }); // core to the mast, along the hull
const ramTop = param('ramTop', 30, { min: 5, max: 90 }); // how fast it rams what blocks it, m/s
const bins = param('bins', 30); // gun groups, tags bin0, bin1, ...
const bound = param('bound', 955, { min: 100, max: 990 }); // it never drives its core past this (the arena ends at 1000)
const blind = param('blind', 12, { min: 0, max: 100 }); // holding under a hidden robot, guns this near that place fire unseen, m
const chase = param('chase', 58, { min: 5, max: 90 }); // fastest it follows something overhead, m/s
const patrolTop = param('patrolTop', 38, { min: 1, max: 80 }); // how fast it patrols, m/s
const wait = param('wait', 6, { min: 0, max: 60 }); // s parked with no sight of it before it patrols again
const stall = param('stall', 2.5, { min: 0.5, max: 60 }); // s pushing without moving before it backs off for another run
const park = param('park', 955, { min: 20, max: 990 }); // where it stands back to from what a run could not move: the far corner, m from the middle
const tiltMax = param('tiltMax', 10, { min: 1, max: 90 }); // degrees: tilted more than this (riding up on something), it stops pushing
const low = param('low', 0.1, { min: 0, max: 1 }); // under this share of its energy it stops driving

let guns = []; // guns[b]: the live gun parts of group b

function survey() {
  guns = [];
  for (let b = 0; b < bins; b++) guns.push([]);
  let nf = 0, nr = 0;
  for (const p of parts) {
    if (p.type === 'booster') {
      if (p.tags[0] === 'fwd') nf++;
      else if (p.tags[0] === 'rev') nr++;
      continue;
    }
    if (p.type !== 'gun') continue;
    for (const t of p.tags) {
      if (t.length > 3 && t.charCodeAt(0) === 98 && t.charCodeAt(1) === 105 && t.charCodeAt(2) === 110) {
        const b = Number(t.slice(3));
        if (b >= 0 && b < bins) guns[b].push(p);
        break;
      }
    }
  }
  state.nf = nf; // boosters left in each bank
  state.nr = nr;
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
  state.dir = self.pos.x > 0 ? -1 : 1; // until the guns say: the nose faces the middle
  state.side = self.pos.x > 0 ? -1 : 1; // the other side's half
  state.restY = self.pos.y; // the core's height with the wheels on the ground
  state.tid = -1;
  state.scanAt = -1000;
  state.ext = { lx: -2, hx: 2, ly: -1, hy: 1 };
  state.pressed = 0;
  state.ram = 0; // 0 driving, 1 backing off from what blocks it, 2 running at it
  state.ramX = 0;
  state.ramDir = 1;
  state.ramSince = 0;
  state.fails = 0; // runs in a row that ended blocked at the same place
  state.failX = 1e9;
  state.parkX = null; // where it stands once it gives a blocker up
  state.nf = 1;
  state.nr = 1;
  state.leg = 0;
  state.holdX = null;
  state.holdSeen = -1000;
  state.said = '';
  survey();
}

function say(what) {
  if ((state.ram !== 0 || state.parkX !== null) && what !== 'back off' && what !== 'run at it' && what !== 'stand back') return;
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
  // What each bank gives now, with some held back for drag: boosters are counted, so a chewed bank is known.
  const aR = Math.max((0.8 * 400 * (dir > 0 ? state.nf : state.nr)) / Math.max(M, 1), 0.05); // toward +x
  const aL = Math.max((0.8 * 400 * (dir > 0 ? state.nr : state.nf)) / Math.max(M, 1), 0.05); // toward -x
  const a = Math.min(aR, aL);

  // The target: the other titan's main robot when it is seen; otherwise the heaviest enemy with a live core, with
  // a lean toward the one it already has.
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
        for (const p of s) {
          const x = p.pos.x, y = p.pos.y;
          if (x < lx) lx = x;
          if (x > hx) hx = x;
          if (y < ly) ly = y;
          if (y > hy) hy = y;
        }
        state.ext = { lx: lx - T.pos.x - 0.5, hx: hx - T.pos.x + 0.5, ly: ly - T.pos.y - 0.5, hy: hy - T.pos.y + 0.5 };
      } else if (T.id !== state.tid) state.ext = { lx: -2, hx: 2, ly: -1, hy: 1 };
      state.scanAt = frame;
      state.tid = T.id;
    }
    state.holdX = null;
  }

  const nose = me.x + dir * front;
  const tail = me.x - dir * back;
  const myL = Math.min(nose, tail);
  const myR = Math.max(nose, tail);
  const mid = (myL + myR) / 2;
  const roofY = me.y + roof;

  let vdes = 0;
  let overhead = null; // [left, right] in world x of what the guns should reach, already led
  let held = null; // the x it holds under with nothing seen
  if (T) {
    const e = state.ext;
    const tl = T.pos.x + e.lx;
    const tr = T.pos.x + e.hx;
    const tlo = T.pos.y + e.ly;
    const tmid = (tl + tr) / 2;
    const tvx = T.vel.x;
    const m = Math.max(T.mass, 1);
    const vc = Math.min(top, (ownDv * (M + m)) / m);
    if (tlo < roofY - 2) {
      // Level with the hull: ram it and push it out of the arena.
      const s = tmid >= mid ? 1 : -1;
      vdes = tvx + s * vc;
      say('push robot ' + T.id);
    } else if (tlo < me.y + reach - 1 && (m <= swatMass || tlo < me.y + deckTop)) {
      // In the air and within the mast's height: drive the mast through it, and on, toward the edge.
      const s = tmid >= me.x + dir * mast ? 1 : -1;
      vdes = tvx + s * vc;
      say('sweep robot ' + T.id);
    } else {
      // Too high and heavy to sweep: sit under its middle and let the guns work.
      const err = tmid - mid;
      vdes = clamp(tvx + sign(err) * Math.min(top, Math.sqrt(2 * 0.6 * a * Math.abs(err))), -chase, chase);
      say('under robot ' + T.id);
    }
    if (tlo > roofY - 3 && tlo - roofY < 290) {
      const lead = (tvx - vx) * (Math.max(tlo - roofY, 0) / 300);
      overhead = [tl - 1 + lead, tr + 1 + lead];
    }
  } else {
    // Nothing seen: patrol corner to corner, straight through where the other side started, and hold under what a
    // gun sight reads.
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
      err = clamp(state.holdX - dir * deck, -bound, bound) - me.x;
      held = state.holdX;
      const quiet = time - state.holdSeen;
      if ((Math.abs(err) < 8 && quiet > wait) || quiet > 45) state.holdX = null;
      say('hold under x ' + Math.round(held));
    } else {
      const goal = (state.leg === 0 ? state.side : -state.side) * bound;
      err = goal - me.x;
      if (Math.abs(err) < 15) state.leg = 1 - state.leg;
      say('patrol leg ' + state.leg);
    }
    vdes = sign(err) * Math.min(patrolTop, Math.sqrt(2 * 0.6 * a * Math.abs(err)));
  }

  // Blocked (pushing hard and not moving: a roped wreck, something heavy): back off and run at it, again and again.
  // A crash breaks what is near the contact, so each run chews further in.
  if (state.parkX !== null) {
    // A push and a run did not move it (roped to the ground): ramming again only breaks its own nose, and parked
    // beside it, its guided copies tunnel to the core in under two minutes. What is roped cannot follow, and a radar
    // sees 1000 m: stand back in the far corner, out of its sight, and let the guns keep the sky.
    const off = state.parkX - me.x;
    vdes = sign(off) * Math.min(patrolTop, Math.sqrt(2 * 0.6 * a * Math.abs(off)));
    state.ram = 0;
    state.pressed = 0;
    say('stand back');
  } else if (state.ram === 1) {
    vdes = -state.ramDir * top;
    if (Math.abs(me.x - state.ramX) >= (ramTop * ramTop) / (2 * a) + 20 || time - state.ramSince > 14) state.ram = 2;
    say('back off');
  } else if (state.ram === 2) {
    vdes = state.ramDir * ramTop;
    if ((me.x - state.ramX) * state.ramDir > -8) state.ram = 0;
    say('run at it');
  }

  // Stay inside the arena: never faster toward an edge than the bank that brakes that way can stop it from.
  vdes = Math.min(vdes, Math.sqrt(2 * 0.6 * aL * Math.max(0, bound - me.x)));
  vdes = Math.max(vdes, -Math.sqrt(2 * 0.6 * aR * Math.max(0, bound + me.x)));
  if (self.energy.stored < low * self.energy.capacity) vdes = 0;

  if (state.ram === 0) {
    if (Math.abs(vdes) > 5 && Math.abs(vx) < 1.5) state.pressed += dt;
    else state.pressed = 0;
    if (state.pressed > stall && state.parkX === null) {
      state.pressed = 0;
      state.ramDir = sign(vdes);
      if (Math.abs(me.x - state.failX) < 40) state.fails += 1;
      else state.fails = 1;
      state.failX = me.x;
      if (state.fails >= 2) state.parkX = -state.ramDir * park;
      else {
        state.ram = 1;
        state.ramX = me.x;
        state.ramSince = time;
      }
    }
  }

  const err = vdes - vx;
  // Tilted or off the ground, a bank's push lifts it: coast until it is level again.
  const level = Math.abs(self.angle) < (tiltMax * Math.PI) / 180 && me.y < state.restY + 6;
  const u = !level || Math.abs(err) < 0.25 ? 0 : clamp(err / 1.5, -1, 1);
  const right = dir > 0 ? 'fwd' : 'rev'; // the bank that pushes toward +x
  const left = dir > 0 ? 'rev' : 'fwd';
  set(right, 'throttle', Math.max(u, 0));
  set(left, 'throttle', Math.max(-u, 0));

  // Guns, a group at a time: on when one of its sights reads an enemy, when the target is over it, or when it
  // holds under a hidden robot and the group is near that place.
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
