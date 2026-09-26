// Flares (M11). V lets go of the next flare of every flare rack at once, lit on the same tick its grip lets go, so it
// leaves burning. While a flare burns (2 s), every sensor that sees it takes it for this robot, so whatever steers by
// those sensors goes for the flare instead. Timing is everything: pop them about a second before something arrives.
// Too early and they burn out before it gets here; too late and it is already on you.
// A rack is any placed `flare-rack`: its flares are tagged <rack>.flare1 to <rack>.flare3, its grips <rack>.fgrip1 to
// <rack>.fgrip3 (`pnpm sim place` names them), so this script works with any number of racks, whatever they are called.
// With `auto` at 1 (robots that fly themselves), it pops them by itself when something light (under `minMass`) on the
// other side is about to pass within `miss` meters in the next `ahead` seconds, at most one set every `gap` seconds.
const auto = param('auto', 0, { min: 0, max: 1 });
const ahead = param('ahead', 1.2, { min: 0.1, max: 5 }); // s: how far ahead it looks for a close pass
const miss = param('miss', 8, { min: 0, max: 50 }); // m: a pass this close counts
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: only robots lighter than this count as incoming
const gap = param('gap', 1.5, { min: 0, max: 10 }); // s between sets when popping by itself

function setup() {
  state.last = -1e9;
}

/** The racks still on the robot, by name, from their grips' tags. */
function racks() {
  const names = [];
  for (const p of parts) {
    for (const t of p.tags) {
      const m = /^(.*)\.fgrip\d+$/.exec(t);
      if (m && !names.includes(m[1])) names.push(m[1]);
    }
  }
  return names;
}

/** Lets go of the lowest numbered flare each rack still holds, burning. False when every rack is empty. */
function pop() {
  const names = racks();
  for (let k = 1; k <= 9; k++) {
    let any = false;
    for (const r of names) {
      // A grip still holding an unlit flare (a flare shot off leaves its grip empty).
      if (!(get(r + '.fgrip' + k, 'armed') > 0) || get(r + '.flare' + k, 'burning') !== 0) continue;
      set(r + '.flare' + k, 'ignite', 1);
      set(r + '.fgrip' + k, 'fire', 1);
      any = true;
    }
    if (any) {
      state.last = time;
      return true;
    }
  }
  return false;
}

/** Something light on the other side that will pass within `miss` meters in the next `ahead` seconds, if any. */
function incoming() {
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass >= minMass) continue;
    const rx = c.pos.x - self.pos.x;
    const ry = c.pos.y - self.pos.y;
    const vx = c.vel.x - self.vel.x;
    const vy = c.vel.y - self.vel.y;
    const v2 = vx * vx + vy * vy;
    if (v2 < 1) continue;
    const t = -(rx * vx + ry * vy) / v2; // seconds to its closest pass
    if (t < 0 || t > ahead) continue;
    if (Math.hypot(rx + vx * t, ry + vy * t) <= miss) return c;
  }
  return undefined;
}

function tick() {
  if (keys.pressed('v') && !pop()) log('no flares left');
  if (auto > 0.5 && time - state.last >= gap && incoming()) pop();
}
