// Tumbler: flies end over end on purpose. It never aims for a pose. Each tick it works out the push it wants in the
// world and the turn that keeps the spin, then picks every jet's throttle from where the jets are right now.
// W S A D go up, down, left, right on the screen whatever its angle. Q spins it more counterclockwise, E more clockwise.
const speed = param('speed', 12, { min: 2, max: 30 }); // m/s it flies at with a key held
const spin = param('spin', 3, { min: 0.5, max: 8 }); // rad/s it tumbles at when deployed, counterclockwise
const stiff = param('stiff', 1.5, { min: 0.2, max: 4 }); // how hard it comes back to where it was left, per second
const brisk = param('brisk', 3, { min: 0.5, max: 8 }); // how fast it reaches the speed it wants, per second
const creep = param('creep', 0.3, { min: 0, max: 2 }); // how fast it learns a steady sag, m/s^2 per m second
const clearance = param('clearance', 2.5, { min: 0, max: 10 }); // m it keeps between its tips and the ground at y 0
const trimmost = 3; // m/s^2: the most that learning may add
const brake = 4; // m/s^2 it plans on to stop above the ground
const spinUp = 2; // per second: how fast the spin error turns into turning
const spinKeys = 2; // rad/s per second a held Q or E changes the spin
const slowest = 0.5; // rad/s: the spin steps over this band, so it never comes to rest
const fastest = 8; // rad/s
const passes = 12; // rounds of the throttle solve per tick
const liftFirst = 4; // when the jets cannot do everything, the vertical push counts this many times more
const reg = 0.002; // keeps the solve from swinging one jet against its neighbour
const thrift = 0.01; // what a unit of throttle costs in the solve, so two jets never fight each other for nothing

function setup() {
  state.u = {}; // each jet's throttle last tick, where this tick's solve starts
  state.spin = spin;
  state.jets = -1;
  state.clear = false;
  state.x = self.pos.x; // the point it comes back to with no key held
  state.y = self.pos.y;
  state.trimX = 0;
  state.trimY = 0;
}

/** The speed one axis wants. While a key is held the point it comes back to moves to where it would stop if let go. */
function wanted(axis, plus, minus, center, vel) {
  const k = (plus ? 1 : 0) - (minus ? 1 : 0);
  if (k !== 0) state[axis] = center + vel / brisk;
  return k !== 0 ? k * speed : clamp(stiff * (state[axis] - center), -speed, speed);
}

function tick() {
  // What is left of the robot: its mass, center, and how hard it is to turn.
  let m = 0;
  let cx = 0;
  let cy = 0;
  for (const p of parts) {
    m += p.mass;
    cx += p.mass * p.pos.x;
    cy += p.mass * p.pos.y;
  }
  cx /= m;
  cy /= m;
  let inertia = 0;
  let reach = 0;
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    const d2 = dx * dx + dy * dy;
    inertia += p.mass * (d2 + 1 / 6);
    if (d2 > reach) reach = d2;
  }
  const floor = Math.sqrt(reach) + Math.SQRT2 / 2 + clearance;

  // The push it wants, in the world.
  const left = keys.down('a');
  const right = keys.down('d');
  const up = keys.down('w');
  const down = keys.down('s');
  const wantX = wanted('x', right, left, cx, self.vel.x);
  if (state.y < floor) state.y = floor;
  const above = cy - floor;
  const wantY = Math.max(wanted('y', up, down, cy, self.vel.y), above > 0 ? -Math.sqrt(2 * brake * above) : -stiff * above);
  if (!left && !right) state.trimX = clamp(state.trimX + creep * (state.x - cx) * dt, -trimmost, trimmost);
  if (!up && !down) state.trimY = clamp(state.trimY + creep * (state.y - cy) * dt, -trimmost, trimmost);
  const fx = m * (brisk * (wantX - self.vel.x) + state.trimX);
  const fy = m * (brisk * (wantY - self.vel.y) + state.trimY + 9.81);

  // The turn it wants. Only the spin rate matters, never the angle. Clear of the ground first: a tip would dig in.
  const faster = (keys.down('q') ? 1 : 0) - (keys.down('e') ? 1 : 0);
  if (faster !== 0) {
    state.spin = clamp(state.spin + faster * spinKeys * dt, -fastest, fastest);
    if (Math.abs(state.spin) < slowest) state.spin = faster * slowest;
  }
  if (cy > floor - clearance) state.clear = true;
  const turn = inertia * spinUp * ((state.clear ? state.spin : 0) - self.angVel);

  // Every jet as it is right now: how much of each wanted thing a full throttle gives.
  const jets = [];
  let strongest = 1;
  for (const p of parts) {
    if (p.tags.includes('jets') && p.in.throttle !== undefined && p.spec.config.maxForce > strongest) strongest = p.spec.config.maxForce;
  }
  const arm = Math.max(1, Math.sqrt(reach) / 2); // moments in units of the same size as forces
  for (const p of parts) {
    if (!p.tags.includes('jets') || p.in.throttle === undefined) continue;
    const a = p.angle + ((p.rot + p.spec.acts) * Math.PI) / 180;
    const f = p.spec.config.maxForce / strongest;
    const dx = f * Math.cos(a);
    const dy = f * Math.sin(a);
    const dz = ((p.pos.x - cx) * dy - (p.pos.y - cy) * dx) / arm;
    jets.push({ id: p.id, dx, dy, dz, u: state.u[p.id] || 0 });
  }
  if (jets.length !== state.jets) {
    if (state.jets >= 0) log('tumbler: ' + jets.length + ' jets left');
    state.jets = jets.length;
  }

  // Throttles from 0 to 1 that come closest to all three: one jet at a time, several rounds, from last tick's answer.
  let rx = fx / strongest;
  let ry = fy / strongest;
  let rz = turn / (strongest * arm);
  for (const j of jets) {
    rx -= j.dx * j.u;
    ry -= j.dy * j.u;
    rz -= j.dz * j.u;
  }
  for (let pass = 0; pass < passes; pass++) {
    for (const j of jets) {
      const grad = j.dx * rx + liftFirst * j.dy * ry + j.dz * rz - reg * j.u - thrift;
      const curve = j.dx * j.dx + liftFirst * j.dy * j.dy + j.dz * j.dz + reg;
      const next = clamp(j.u + grad / curve, 0, 1);
      const du = next - j.u;
      j.u = next;
      rx -= j.dx * du;
      ry -= j.dy * du;
      rz -= j.dz * du;
    }
  }
  const u = {};
  for (const j of jets) {
    u[j.id] = j.u;
    set(j.id, 'throttle', j.u);
  }
  state.u = u;
}
