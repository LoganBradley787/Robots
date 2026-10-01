// The keep of titan-bastion: a small flier that carries the main core. No keys.
// - On its first tick it lets go of the mesa (the grip under it), climbs to `high` m, and flies `back` m further
//   from the middle of the arena (x 0) than where it started, away from the other side. It never looks at a team
//   number: "away" is the sign of its own x.
// - It stays hidden: two 1 by 1 bays build jammer pods; a pod is lit while still held, one bay at a time, so one
//   bubble (30 m) is always around its core. It has no sensors of its own (they would be blind in the bubble).
// - Hover: height by a spring and damper on all propellers, lean by throttling the two sides differently (sides
//   told apart by position, so it works flipped), heavy gyros damp the swing.
const high = param('high', 185, { min: 10, max: 240 }); // m it hovers at (the bound is 250)
const back = param('back', 380, { min: 0, max: 550 }); // m behind its start it parks (the bound is x 1000)
const speed = param('speed', 14, { min: 1, max: 40 }); // m/s sideways at most
const climb = param('climb', 12, { min: 1, max: 30 }); // m/s up at most
const maxLean = (param('lean', 14, { min: 1, max: 40 }) * Math.PI) / 180;
const overlap = param('overlap', 2.6, { min: 0.5, max: 5 }); // s between one bay's pod lighting and the other's
const burn = param('burn', 5.1, { min: 1, max: 10 }); // s after lighting a pod its bay is cleared (a pod jams 5 s)

function setup() {
  state.homeX = self.pos.x + (self.pos.x >= 0 ? 1 : -1) * back;
  state.started = time;
  state.lit = -100;
  state.jbays = [
    { tag: 'ja', lit: -1, wait: 0 },
    { tag: 'jb', lit: -1, wait: 0 },
  ];
  // Which tagged side is on the left now (a flipped deploy swaps them).
  let ax = 0;
  let na = 0;
  for (const p of parts) {
    if (p.tags.indexOf('pa') >= 0) {
      ax += p.pos.x;
      na++;
    }
  }
  state.aLeft = na === 0 || ax / na < self.pos.x;
  state.arm = 5; // m, the side propellers' mean distance from the middle
}

/**
 * Jammer pods. A pod is lit while its bay still holds it, so the bubble moves with the keep. A burnt out pod leaves
 * its bay thinking it still holds something, so `burn` s after lighting the bay is told to let go, and it builds
 * the next. The two bays take turns, `overlap` s apart, so one bubble is always up.
 */
function jam() {
  for (const b of state.jbays) {
    if (time < b.wait || !(get(b.tag, 'ready') > 0)) continue;
    if (b.lit < 0) {
      if (time - state.lit < overlap) continue;
      set(b.tag + get(b.tag, 'built'), 'ignite', 1);
      b.lit = time;
      state.lit = time;
    } else if (time - b.lit > burn) {
      set(b.tag, 'release', 1);
      b.lit = -1;
      b.wait = time + 0.3;
    }
  }
}

function tick() {
  set('kd', 'fire', 1);
  jam();
  // Hover. Mass and lift from what it is made of: 7 propellers of 120 N.
  const m = self.mass;
  const lift = 7 * 120;
  const up = time - state.started < 0.3 ? 1 : 0;
  const wantVy = clamp(0.6 * (high - self.pos.y), -climb, climb);
  const c = Math.max(0.5, Math.cos(self.angle));
  let base = (m * (9.81 + 2.5 * (wantVy - self.vel.y))) / (lift * c);
  if (up) base = 1;
  // Sideways: a wanted speed toward home, turned into a lean (leaning counterclockwise pushes left).
  const wantVx = self.pos.y < 30 ? 0 : clamp(0.4 * (state.homeX - self.pos.x), -speed, speed);
  const wantLean = clamp(-0.12 * (wantVx - self.vel.x), -maxLean, maxLean);
  // Lean loop: inertia about m * 13^2 / 12, torque per unit of difference 6 props * 120 N * arm.
  const inertia = (m * 169) / 12;
  const torque = 6 * 120 * state.arm;
  const w = 3;
  const d = clamp(((inertia * w * w) / torque) * (wantLean - self.angle) - ((2 * inertia * w) / torque) * self.angVel, -0.3, 0.3);
  base = clamp(base, 0, 1 - Math.abs(d));
  const left = clamp(base - d, 0, 1);
  const right = clamp(base + d, 0, 1);
  set('pa', 'throttle', state.aLeft ? left : right);
  set('pb', 'throttle', state.aLeft ? right : left);
  set('pc', 'throttle', clamp(base, 0, 1));
  set('kg', 'spin', clamp(2 * self.angVel - 2 * (wantLean - self.angle), -1, 1));
}
