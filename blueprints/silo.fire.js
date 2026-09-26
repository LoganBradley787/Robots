// Silo: every F launches the next of its twelve missiles at a robot on the other side that the radar tracks: the one
// sent the fewest missiles so far, nearest first, so a volley spreads over several targets. Each missile gets that robot's point, speed, and id just before its grip lets go, climbs straight up, arcs
// over, and comes down on it. Spam F for a volley. With nothing tracked, F does nothing (a missile with no point
// would keep climbing).
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other missiles) are skipped
const below = param('below', 10, { min: -100, max: 100 }); // m: a target more than this far below gets an arc shot, the rest a direct one
const COUNT = 12; // grip k holds missile-up k

function tick() {
  if (!keys.pressed('f')) return;
  // Spread a volley: the tracked enemy that has had the fewest missiles so far, the nearest of those (contacts come
  // nearest first).
  state.sent = state.sent || {};
  let t = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < minMass) continue;
    if (!t || (state.sent[c.id] || 0) < (state.sent[t.id] || 0)) t = c;
  }
  if (!t) {
    log('nothing tracked');
    return;
  }
  for (let k = 1; k <= COUNT; k++) {
    if (!(get('grip' + k, 'armed') > 0)) continue;
    // Over the top onto a target well below; straight in (from underneath, after the climb) at one level or above.
    const arc = t.pos.y < self.pos.y - below ? 1 : 0;
    send('missile-up' + k, { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc });
    set('grip' + k, 'fire', 1);
    state.sent[t.id] = (state.sent[t.id] || 0) + 1;
    return;
  }
  log('no missiles left');
}
