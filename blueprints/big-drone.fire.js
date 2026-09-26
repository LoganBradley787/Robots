// Big drone: every F launches the next of its four big missiles at a robot on the other side that the radar tracks:
// the one sent the fewest missiles so far, nearest first, so a volley spreads over several targets. Each missile gets
// that robot's point, speed, and id just before its two grips let go, climbs clear, and flies straight in at a target
// level or above, or over the top onto one well below. With nothing tracked, F does nothing.
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (other missiles) are skipped
const below = param('below', 10, { min: -100, max: 100 }); // m: a target more than this far below gets an arc shot, the rest a direct one
const COUNT = 4; // grips k (two decouplers) hold big-missile k

function tick() {
  if (!keys.pressed('f')) return;
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
    const arc = t.pos.y < self.pos.y - below ? 1 : 0;
    send('big-missile' + k, { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, arc });
    set('grip' + k, 'fire', 1);
    state.sent[t.id] = (state.sent[t.id] || 0) + 1;
    return;
  }
  log('no missiles left');
}
