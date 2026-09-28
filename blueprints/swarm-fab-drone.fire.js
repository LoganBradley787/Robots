// F lets go of the drone bomb the bay holds, as the carrier does: it is told which enemy to go after (the tracked one
// sent the fewest so far, nearest first, so a swarm spreads over several targets) and then finds it with its own
// radar; with nothing tracked it is let go anyway and hunts on its own. Hold F to let each one go as soon as it is
// built. The bay builds the next by itself while there is energy.
// The held drone bomb's scope is the bay's tag and its build count (`bay3` is the third), which the bay reports as `built`.
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (missiles) are not worth a drone bomb

function setup() {
  state.sent = {};
}

function tick() {
  if (!keys.down('f')) return;
  if (!(get('bay', 'ready') > 0)) {
    if (keys.pressed('f')) log('bay still building: ' + Math.round(get('bay', 'progress') * 100) + '%');
    return;
  }
  let t = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < minMass) continue;
    if (!t || (state.sent[c.id] || 0) < (state.sent[t.id] || 0)) t = c;
  }
  if (t) {
    send('bay' + get('bay', 'built'), { id: t.id });
    state.sent[t.id] = (state.sent[t.id] || 0) + 1;
  }
  set('bay', 'release', 1);
}
