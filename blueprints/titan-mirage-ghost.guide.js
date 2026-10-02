// Guide of a ghost (titan-mirage's dart): two boosters, a heavy gyro, a jammer pod, a distance charge nose and two
// heavy warheads behind it. It has no sensor. The hull hands it a point and that point's speed when it lets it go;
// the ghost flies to where the point will be, lights its pod `cloak` s of flight before it gets there (no sensor
// outside the bubble sees it from then on), and its charge goes off by itself next to the first enemy part.
// Let go with no point (knocked loose), it does nothing and stays safe.
const thrust = param('thrust', 800, { min: 1, max: 100000 }); // N, both boosters
const clear = param('clear', 14, { min: 0, max: 100 }); // m straight out of the bay before it turns
const over = param('over', 22, { min: 0, max: 200 }); // m it stays above where it left while still over the hull
const hull = param('hull', 190, { min: 0, max: 1000 }); // m sideways from where it left that count as over the hull
const armAt = param('armAt', 20, { min: 0, max: 1000 }); // m from where it left before it arms
const cloakAt = param('cloakAt', 45, { min: 31, max: 1000 }); // m from where it left before its pod may be lit (the hull's radars must stay outside its bubble)
const cloak = param('cloak', 4.7, { min: 0, max: 5 }); // s of flight left when the pod is lit
const cross = param('cross', 2.5, { min: 0, max: 20 }); // 1/s: how hard it kills speed across the line to the point
const along = param('along', 50, { min: 0, max: 500 }); // m/s^2 it asks for along the line
const turn = param('turn', 5, { min: 0.1, max: 50 }); // rad/s^2 it plans its turns on
const near = param('near', 2.5, { min: 0, max: 50 }); // m from the point where it sets itself off

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function setup() {
  state.t0 = time;
  state.lx = self.pos.x;
  state.ly = self.pos.y;
  state.a0 = self.angle;
  state.aim = null;
  state.best = Infinity;
  for (const msg of inbox) {
    const d = msg.data;
    if (d && typeof d.x === 'number' && typeof d.y === 'number') state.aim = { x: d.x, y: d.y, vx: d.vx || 0, vy: d.vy || 0 };
  }
  set('heavygyro', 'damp', 0);
}

function tick() {
  const aim = state.aim;
  if (!aim) return;
  const t = time - state.t0;
  const px = aim.x + aim.vx * t;
  const py = aim.y + aim.vy * t;
  const out = Math.hypot(self.pos.x - state.lx, self.pos.y - state.ly);
  const dist = Math.hypot(px - self.pos.x, py - self.pos.y);
  const speed = Math.hypot(self.vel.x - aim.vx, self.vel.y - aim.vy);

  if (out >= armAt) {
    set('charge', 'arm', 1);
    set('heavywarhead', 'arm', 1);
  }
  if (out >= cloakAt && dist / Math.max(speed, 140) <= cloak) set('jammer', 'ignite', 1);
  if (out >= armAt && (dist <= near || (dist > state.best + 3 && state.best < 12))) {
    set('charge', 'detonate', 1);
    set('heavywarhead', 'detonate', 1);
  }
  if (dist < state.best) state.best = dist;

  // where to push
  let want;
  if (out < clear) {
    want = state.a0;
  } else {
    let tx = px - self.pos.x;
    let ty = py - self.pos.y;
    // Still over the hull: do not dive through it.
    const floor = state.ly + over;
    if (Math.abs(self.pos.x - state.lx) < hull && py < floor) ty = floor - self.pos.y;
    const d = Math.max(1e-6, Math.hypot(tx, ty));
    tx /= d;
    ty /= d;
    const rvx = self.vel.x - aim.vx;
    const rvy = self.vel.y - aim.vy;
    const closing = rvx * tx + rvy * ty;
    const cx = rvx - closing * tx;
    const cy = rvy - closing * ty;
    const ax = along * tx - cross * cx;
    const ay = along * ty - cross * cy + 9.81;
    want = Math.atan2(ay, ax) - Math.PI / 2;
  }
  const err = wrap(want - self.angle);
  const rate = clamp(sign(err) * Math.sqrt(2 * turn * Math.abs(err)), -8, 8);
  set('heavygyro', 'spin', clamp(-2.5 * (rate - self.angVel), -1, 1));
  set('booster', 'throttle', Math.abs(err) < 0.6 || out < clear ? 1 : 0.2);
}
