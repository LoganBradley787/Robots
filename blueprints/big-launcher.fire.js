// F launches the big missile at the nearest robot on the other side that the radar tracks: the missile gets that
// robot's point, speed, and id just before both grips let go, climbs straight up, arcs over, and comes down on it.
// With nothing tracked, F does nothing (a missile with no point would keep climbing). D and A drive the cart.
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other missiles) are skipped

function tick() {
  if (!keys.pressed('f')) return;
  if (!(get('grip', 'armed') > 0)) {
    log('no missile left');
    return;
  }
  const t = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (!t) {
    log('nothing tracked');
    return;
  }
  send('big-missile1', { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id });
  set('grip', 'fire', 1);
}
