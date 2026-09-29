// F fires the missile the bay holds at the nearest robot on the other side that the radar tracks, as the hunter
// drone's fire does: the missile gets that robot's point, speed, and id, and the bay lets it go on the same tick. It
// climbs out of the bay, tips over, and comes down on it (or goes straight in at a target level or above). Hold F to
// fire each one as soon as it is built (about 4 s apart). The bay builds the next by itself while there is energy.
// The held missile's scope is the bay's tag and its build count (`bay3` is the third), which the bay reports as `built`.
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other missiles) are skipped
const below = param('below', 10, { min: -100, max: 100 }); // m: a target more than this far below gets an arc shot, the rest a direct one

function tick() {
  if (!keys.down('f')) return;
  if (!(get('bay', 'ready') > 0)) {
    if (keys.pressed('f')) log('bay still building: ' + Math.round(get('bay', 'progress') * 100) + '%');
    return;
  }
  const t = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (!t) {
    if (keys.pressed('f')) log('nothing tracked');
    return;
  }
  const arc = t.pos.y < self.pos.y - below ? 1 : 0;
  send('bay' + get('bay', 'built'), { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc });
  set('bay', 'release', 1);
}
