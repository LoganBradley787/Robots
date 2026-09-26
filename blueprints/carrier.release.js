// Carrier: F lets go of the next of its six drone bombs, G lets go of every one left at once. Each is told which
// enemy to go after (the tracked one sent the fewest so far, nearest first, so a swarm spreads over several targets)
// and then finds it with its own radar; with nothing tracked it is let go anyway and hunts on its own.
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (missiles) are not worth a drone bomb
const COUNT = 6; // grip k (two decouplers) holds drone-bomb k

/** Lets go of drone bomb k, naming a target when one is tracked. */
function release(k) {
  let t = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass < minMass) continue;
    if (!t || (state.sent[c.id] || 0) < (state.sent[t.id] || 0)) t = c;
  }
  if (t) {
    send('drone-bomb' + k, { id: t.id });
    state.sent[t.id] = (state.sent[t.id] || 0) + 1;
  }
  set('grip' + k, 'fire', 1);
}

function tick() {
  const one = keys.pressed('f');
  const all = keys.pressed('g');
  if (!one && !all) return;
  state.sent = state.sent || {};
  let released = 0;
  for (let k = 1; k <= COUNT; k++) {
    if (!(get('grip' + k, 'armed') > 0)) continue;
    release(k);
    released++;
    if (one) break;
  }
  if (released === 0) log('no drone bombs left');
}
