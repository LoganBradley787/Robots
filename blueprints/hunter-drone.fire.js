// F launches the next missile (they stand nose up on top) at the nearest robot on the other side that the radar tracks. The missile gets that
// robot's point, speed, and id just before its grip lets go; it climbs, tips over, and comes down on it.
// Order: left outer, right outer, left inner, right inner, so the drone stays balanced. With nothing tracked, F does
// nothing (a missile with no point would keep climbing).
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other missiles) are skipped
const below = param('below', 10, { min: -100, max: 100 }); // m: a target more than this far below gets an arc shot, the rest a direct one
const ORDER = [1, 4, 2, 3]; // grip k holds missile-up k

function tick() {
  if (!keys.pressed('f')) return;
  const t = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (!t) {
    log('nothing tracked');
    return;
  }
  for (const k of ORDER) {
    if (!(get('grip' + k, 'armed') > 0)) continue;
    // Over the top onto a target well below; straight in (from underneath, after the climb) at one level or above.
    const arc = t.pos.y < self.pos.y - below ? 1 : 0;
    send('missile-up' + k, { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc });
    set('grip' + k, 'fire', 1);
    return;
  }
  log('no missiles left');
}
