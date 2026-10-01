// Grapples (Batch): every grapple on this robot tagged `hook` fires by itself, or on F, at an enemy robot that lines up
// with its barrel. A grapple's rope is a straight ray out of the barrel (the way it points, with the drone's tilt), so
// "on target" means one of the robot's parts sits on that ray: the script scans the robots it tracks and checks
// where their parts are against each hook's line, so a rope never goes to the ground behind a robot it missed.
// A hook that would meet a friend of ours first (within `clear` meters of the line) waits.
// - Player (`auto` 0): F throws every hook that lines up with something within `reach`. Reeling in (R), paying out
//   (T), and letting go (X) are plain bindings on the blueprint (hold, target `hook`, channels `reel` and `release`),
//   so they show in the controls list; this script leaves those two inputs alone. It writes the key list to the
//   status once at the start, and says what F did: thrown, or why not (Logan: "its keys are unclear"). The debug
//   overlay marks where each hook's line meets what it would hit.
// - AI (`auto` 1, a robot that flies itself): it fires a hook that lines up (at most `ropes` at a time), reels in to
//   `close` meters, and lets go after carrying. Once every rope is short it holds `hold` seconds (its guns work on what
//   it holds), then the pilot climbs and this script lets go `carryUp` meters higher than where it began (or after
//   `carryMax` seconds), and leaves that robot alone for `spare` seconds. A hook that took the ground or a wall instead
//   of a robot it was lined up on (its end is more than `stray` meters from every robot it saw) is let go at once.
// The pilot (`enemy-grapple-drone.pilot.js`) reads the same numbers (close, hold, carryUp) to know when to climb.
// A rope tied off the middle of the drone hangs straight and pulls it evenly; one from a side grapple pulls the drone
// over (a 1000 N pull 5 m off the center is 5000 N m, more than its props can right). So the AI (`sides` 0) uses only
// the grapple underneath, and the pilot keeps the drone over what it holds; the side grapples are for a player.
// A hook's direction is read from its tag: `hookl` points left, `hookr` right, `hookd` down (as built, on a level robot).
const auto = param('auto', 1, { min: 0, max: 1 });
const reach = param('reach', 50, { min: 1, max: 60 }); // m: it fires at nothing further (the rope reaches 60)
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (missiles) are not hooked
const size = param('size', 0.6, { min: 0.05, max: 5 }); // m: a part this close to a hook's line counts as on it
const clear = param('clear', 4, { min: 0, max: 50 }); // m: a friend this close to the line holds fire
const ropes = param('ropes', 1, { min: 1, max: 3 }); // hooks it lets hold at once (AI)
const sides = param('sides', 1, { min: 0, max: 1 }); // 0: only the grapple under the middle fires (a rope from a side hook pulls the drone off level: the AI leaves them)
const close = param('close', 6, { min: 1, max: 60 }); // m of rope it reels in to (AI)
const hold = param('hold', 3, { min: 0, max: 60 }); // s it holds a short rope before carrying (AI)
const carryUp = param('carryUp', 40, { min: 0, max: 200 }); // m it climbs carrying before letting go (AI)
const carryMax = param('carryMax', 25, { min: 1, max: 120 }); // s it carries at most (AI)
const stray = param('stray', 14, { min: 1, max: 60 }); // m: a hook further than this from what it lined up on is let go (AI)
const rescan = param('rescan', 0.2, { min: 0.05, max: 10 }); // s between looks at a robot's parts
const retry = param('retry', 0.4, { min: 0.05, max: 5 }); // s between shots of one hook
const spare = param('spare', 8, { min: 0, max: 60 }); // s a robot it let go is left alone (AI)
const DIRS = { hookl: Math.PI, hookr: 0, hookd: -Math.PI / 2 };

function setup() {
  state.hooks = {};
  state.skip = {};
  state.parts = {};
  state.scans = 0;
  state.short = undefined;
  state.carryFrom = undefined;
  if (auto < 0.5) {
    log('keys: W up, S down, A left, D right, H hover on or off, G guns on or off, V flare');
    log('ropes: F throw a hook at what lines up (fly over it), R reel in, T pay out, X let go');
  }
}

/** A hook's own tag (`hookl`, `hookr`, `hookd`): it names the hook in `set`, and says which way it was built to point. */
function nameOf(p) {
  for (const t of p.tags) if (t in DIRS) return t;
  return undefined;
}

/** A robot's parts as the radar scans them, looked up at most every `rescan` seconds and 3 a tick. */
function partsOf(c) {
  const memo = state.parts[c.id];
  if (memo && time - memo.at < rescan) return memo.list;
  if (state.scanFrame !== frame) {
    state.scanFrame = frame;
    state.scans = 0;
  }
  if (state.scans >= 3) return memo ? memo.list : undefined;
  state.scans++;
  const list = scan(c.id);
  // Kept as offsets from the core, so they follow the robot between looks.
  const kept = list ? list.map((p) => ({ x: p.pos.x - c.pos.x, y: p.pos.y - c.pos.y })) : undefined;
  state.parts[c.id] = { at: time, list: kept };
  return kept;
}

/** How far along the ray from `from` toward `angle` the nearest part of `c` within `size` of it is, or undefined. */
function onLine(c, from, angle) {
  const list = partsOf(c);
  if (!list) return undefined;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  let best;
  for (const o of list) {
    const rx = c.pos.x + o.x - from.x;
    const ry = c.pos.y + o.y - from.y;
    const along = rx * ux + ry * uy;
    if (along < 0.5 || along > reach) continue;
    if (Math.abs(rx * uy - ry * ux) > size) continue;
    if (best === undefined || along < best) best = along;
  }
  return best;
}

/** A friend the radar tracks within `clear` meters of the line from `from` toward `angle`, nearer than `distance`. */
function friendOnLine(from, angle, distance) {
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

function tick() {
  const rigs = [];
  for (const p of parts) {
    if (p.type !== 'grapple' || !p.tags.includes('hook')) continue;
    const name = nameOf(p);
    if (!name) continue;
    const aim = self.angle + DIRS[name];
    const from = { x: p.pos.x + 0.5 * Math.cos(aim), y: p.pos.y + 0.5 * Math.sin(aim) };
    const st = state.hooks[name] || (state.hooks[name] = { id: 0, last: -Infinity, checked: false });
    rigs.push({ name, aim, from, st, hooked: p.out.hooked > 0.5, length: p.out.length });
  }

  const held = rigs.filter((r) => r.hooked);
  const taken = new Set(held.map((r) => r.st.id));

  // Carrying: every rope is short. The pilot times it the same way, from the moment the last rope came in.
  const short = held.length > 0 && held.every((r) => r.length <= close + 1.5);
  if (short && state.short === undefined) state.short = time;
  if (!short) {
    state.short = undefined;
    state.carryFrom = undefined;
  }
  const carrying = short && time - state.short >= hold;
  if (carrying && state.carryFrom === undefined) state.carryFrom = { y: self.pos.y, time };

  // What F did this press, for the status line (player).
  const asked = auto < 0.5 && keys.pressed('f');
  let thrown = 0;
  let lined = 0;
  let blocked = 0;
  for (const r of rigs) {
    const { name, st } = r;
    let fire = 0;
    let reel = 0;
    let release = 0;
    if (r.hooked) {
      if (auto > 0.5) {
        if (!st.checked) {
          st.checked = true;
          // Over `stray` meters from every robot it could have been lined up on: it hooked the ground or a wall.
          const ex = r.from.x + Math.cos(r.aim) * r.length;
          const ey = r.from.y + Math.sin(r.aim) * r.length;
          const c = contacts.find((k) => k.id === st.id) || contacts.find((k) => k.side === 'enemy' && Math.hypot(k.pos.x - ex, k.pos.y - ey) < stray);
          const far = c ? Math.hypot(c.pos.x - ex, c.pos.y - ey) : Infinity;
          if (far > stray) release = 1;
          else st.id = c.id;
          log(name, 'hooked', st.id, 'length', r.length.toFixed(1), 'from its core', far.toFixed(1));
        }
        reel = r.length > close ? 1 : 0;
        if (carrying && (self.pos.y - state.carryFrom.y >= carryUp || time - state.carryFrom.time >= carryMax)) {
          release = 1;
          state.skip[st.id] = time + spare;
        }
      } else if (!st.checked) {
        st.checked = true;
        log(name, 'hooked, rope', r.length.toFixed(0), 'm: R reel in, T pay out, X let go');
      }
    } else if (name === 'hookd' || sides > 0.5) {
      st.checked = false;
      // Free: the nearest robot it lines up with.
      let best;
      for (const c of contacts) {
        if (c.side !== 'enemy' || !c.core || c.mass < minMass || c.distance > reach + 15) continue;
        if ((state.skip[c.id] || 0) > time || taken.has(c.id)) continue;
        const along = onLine(c, r.from, r.aim);
        if (along !== undefined && (!best || along < best.along)) best = { c, along };
      }
      if (best) {
        st.id = best.c.id;
        mark(r.from.x + Math.cos(r.aim) * best.along, r.from.y + Math.sin(r.aim) * best.along, 'hook');
        lined++;
        const wants = auto > 0.5 ? held.length < ropes : keys.pressed('f');
        if (wants && time - st.last >= retry) {
          if (friendOnLine(r.from, r.aim, best.along)) blocked++;
          else {
            fire = 1;
            thrown++;
            st.last = time;
            taken.add(best.c.id);
          }
        }
      }
    }
    set(name, 'fire', fire);
    // A player's R, T, and X are bindings on these two inputs: only a robot that flies itself drives them from here.
    if (auto > 0.5) {
      set(name, 'reel', reel);
      set(name, 'release', release);
    }
  }
  if (asked && thrown === 0) {
    if (rigs.length === 0) log('no hooks left');
    else if (held.length === rigs.length) log('every hook holds something already: X lets go');
    else if (blocked > 0) log('a friend is in the way of the hook');
    else if (lined === 0) log('nothing lines up within ' + reach + ' m: fly straight over it, or level with it for a side hook');
  }
}
