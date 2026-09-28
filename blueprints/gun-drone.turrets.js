// Gun turrets (M13): every placed `gun-turret` on this robot aims and fires by itself. A turret is a rotator carrying a
// gun; its parts are tagged <turret>.rot and <turret>.gun (`pnpm sim place` names them), so this one script works with
// any number of turrets, whatever they are called.
// - Target: the closest robot on the other side the radar tracks (missiles and drone bombs included) within `track`
//   meters that this turret can swing to (it turns `swing` degrees either way from how it was built). It points at it
//   from there, so it is on target when it comes in range (a missile covers 150 m in about a second). A robot a turret
//   could not shoot for `hold` seconds (a friend or its own robot in the way) is left for `skip` seconds.
// - Aim: ahead of the target, where it will be when a shell gets there (from its speed and ours; shells leave at the
//   gun's `speed` plus our own motion), and up by what a shell falls on the way.
// - Fire: within `reach` meters, while the barrel is on the aim point and the gun's sight says nothing of ours is in
//   the way: the sight is a straight line out of the barrel, and shells hit friends and this robot too. A shell lives
//   1 s (300 m); the sight looks 150 m, and past that nothing of ours shows (a friend beyond it is a risk it takes).
// With `auto` at 0, G switches the turrets on and off (they start on); robots that fly themselves leave it at 1.
const auto = param('auto', 1, { min: 0, max: 1 });
const speed = param('speed', 300, { min: 1, max: 5000 }); // m/s, the gun's shell speed (the gun part)
const reach = param('reach', 250, { min: 1, max: 1000 }); // m: further than this it does not shoot
const track = param('track', 400, { min: 1, max: 1000 }); // m: further than this it does not point at things
const swing = (param('swing', 90, { min: 1, max: 180 }) * Math.PI) / 180; // degrees either way a turret turns (the rotator's range)
const gain = param('gain', 6, { min: 0.1, max: 50 }); // turn rate per radian off the aim
const rate = param('rate', 2, { min: 0.1, max: 20 }); // rad/s, the rotator's fastest turn (for leading a moving aim)
const hold = param('hold', 0.5, { min: 0, max: 10 }); // s blocked before it gives up on a target
const skip = param('skip', 1.5, { min: 0, max: 30 }); // s it leaves a target it gave up on
const g = 9.81;
const SIGHT = { nothing: 0, own: 1, friend: 2, enemy: 3, none: 4, terrain: 5 };

function setup() {
  state.on = true;
  state.turrets = {};
}

/** The turrets still on the robot, by name, from their guns' tags. */
function turrets() {
  const names = [];
  for (const p of parts) {
    for (const t of p.tags) {
      const m = /^(.*)\.gun$/.exec(t);
      if (m && !names.includes(m[1])) names.push(m[1]);
    }
  }
  return names;
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** The part with this tag, or undefined. */
function tagged(tag) {
  for (const p of parts) if (p.tags.includes(tag)) return p;
  return undefined;
}

/**
 * Where to point to hit `c` from `from`: its position after the shell's time of flight (solved three times), raised by
 * what the shell falls in that time. Returns the angle, the distance, and the time.
 */
function lead(c, from) {
  const rx = c.pos.x - from.x;
  const ry = c.pos.y - from.y;
  const vx = c.vel.x - self.vel.x;
  const vy = c.vel.y - self.vel.y;
  let t = Math.hypot(rx, ry) / speed;
  let px = rx;
  let py = ry;
  for (let i = 0; i < 3; i++) {
    px = rx + vx * t;
    py = ry + vy * t;
    t = Math.hypot(px, py) / speed;
  }
  return { angle: Math.atan2(py + 0.5 * g * t * t, px), distance: Math.hypot(px, py), t };
}

function aimTurret(name) {
  const gun = tagged(name + '.gun');
  const rot = tagged(name + '.rot');
  if (!gun || !rot) return;
  const st = state.turrets[name] || (state.turrets[name] = { id: 0, blocked: 0, skip: {}, want: undefined });
  const aim = gun.out.aim;
  // How it was built: its aim now, less how far it has turned (-1 to 1 of its range).
  const rest = aim - get(name + '.rot', 'angle') * swing;
  const from = { x: gun.pos.x + 0.5 * Math.cos(aim), y: gun.pos.y + 0.5 * Math.sin(aim) };
  let best;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.distance > track || (st.skip[c.id] || 0) > time) continue;
    const l = lead(c, from);
    if (Math.abs(wrap(l.angle - rest)) > swing) continue;
    // Keep the target it has unless something is much closer.
    const d = l.distance - (c.id === st.id ? 10 : 0);
    if (!best || d < best.d) best = { c, l, d };
  }
  if (!best || !state.on) {
    st.id = 0;
    st.want = undefined;
    set(name + '.gun', 'fire', 0);
    set(name + '.rot', 'turn', clamp(-3 * get(name + '.rot', 'angle'), -1, 1));
    return;
  }
  if (best.c.id !== st.id) {
    st.id = best.c.id;
    st.blocked = 0;
    st.want = undefined;
  }
  const want = best.l.angle;
  // The aim point moves: turn at its rate, plus a push toward it.
  const moving = st.want === undefined ? 0 : wrap(want - st.want) / dt;
  st.want = want;
  const err = wrap(want - aim);
  set(name + '.rot', 'turn', clamp(moving / rate + gain * err / rate, -1, 1));
  // On target: within about a meter and a half of it, or a hundredth of a radian.
  const on = Math.abs(err) < Math.max(0.01, Math.atan2(1.5, best.l.distance));
  const side = gun.out.sightSide;
  // Something of ours in the way: its own robot, a friend, or the ground, nearer than the target.
  const blocked = (side === SIGHT.own || side === SIGHT.friend || side === SIGHT.terrain) && gun.out.sight < best.l.distance;
  st.blocked = blocked ? st.blocked + dt : 0;
  if (st.blocked > hold) {
    st.skip[best.c.id] = time + skip;
    st.id = 0;
  }
  set(name + '.gun', 'fire', on && !blocked && best.l.distance <= reach ? 1 : 0);
  mark(from.x + Math.cos(want) * best.l.distance, from.y + Math.sin(want) * best.l.distance, name);
}

function tick() {
  if (auto < 0.5 && keys.pressed('g')) state.on = !state.on;
  for (const name of turrets()) aimTurret(name);
}
