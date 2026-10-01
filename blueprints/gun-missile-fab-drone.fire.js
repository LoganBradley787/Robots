// F fires the missile the bay holds at the nearest robot on the other side that the radar tracks, as the hunter
// drone's fire does: the missile gets that robot's point, speed, and id, and the bay lets it go on the same tick. It
// climbs out of the bay, tips over, and comes down on it (or goes straight in at a target level or above). Hold F to
// fire each one as soon as it is built (about 4 s apart). The bay builds the next by itself while there is energy.
// The held missile's scope is the bay's tag and its build count (`bay3` is the third), which the bay reports as `built`.
// A fresh press with no such robot tracked sends it at the nearest thing the radar tracks that is not a friend (a
// wall, a wreck), so a practice target works; holding F never spends missiles on wrecks. Every press and every shot
// writes a status line that says what happened and why (Logan: it said "nothing tracked" and nothing else).
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other missiles) are skipped
const below = param('below', 10, { min: -100, max: 100 }); // m: a target more than this far below gets an arc shot, the rest a direct one

/** Why there is nothing to fire at, for the status line. */
function why() {
  if (!parts.some((p) => p.type === 'radar')) return 'nothing tracked: the radar is gone';
  if (contacts.some((c) => c.side === 'friend' && c.mass >= minMass)) return 'nothing tracked: the radar sees only your own side';
  return 'nothing tracked: nothing on the other side within radar range';
}

function tick() {
  if (!keys.down('f')) return;
  const fresh = keys.pressed('f');
  const ready = get('bay', 'ready');
  if (ready === undefined) {
    if (fresh) log('no bay left');
    return;
  }
  if (!(ready > 0)) {
    if (fresh) log('bay still building: ' + Math.round(get('bay', 'progress') * 100) + '%');
    return;
  }
  let t = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= minMass);
  if (!t && fresh) t = contacts.find((c) => c.side !== 'friend' && c.mass >= minMass);
  if (!t) {
    if (fresh) log(why());
    return;
  }
  const arc = t.pos.y < self.pos.y - below ? 1 : 0;
  send('bay' + get('bay', 'built'), { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc });
  set('bay', 'release', 1);
  log('fired at ' + (t.side === 'enemy' ? 'an enemy ' : 'a target ') + Math.round(t.distance) + ' m off');
}
