// Jammer pods for the enemy spotter (Batch). No keys, it runs from deploy. (Its smoke pods are popped by its pilot, which
// has to run from the cloud it makes: `enemy-spotter.pilot.js`.)
// A robot of `heavy` kg or more on the other side within `jamRange` meters (250) gets a jammer let go on its side: the pod is
// lit and its grip fired on the same tick, so it leaves burning. The bubble (30 m, 5 s) blinds every sensor in it and
// hides everything in it from every sensor further than 150 m off (Titans: up close a jam does nothing, so it jams from
// 250 m, not 60), so the spotter drops out of the enemy's radar, seekers, and turrets while it is in it and the enemy
// is not yet that close; a radio in it neither sends nor hears, so the spotter also goes quiet on the artillery's radio for
// those 5 s (the artillery holds where it is and holds fire, its pilot's `memory`). At most one jammer every `jamGap` seconds.
// Jammers are tagged `jam1`..`jam4` with their grips `jgrip1`..`jgrip4`; a pod or grip shot off is just skipped.
const heavy = param('heavy', 10, { min: 0, max: 1000 }); // kg: a robot this heavy or more is worth a jammer (missiles are lighter)
const jamRange = param('jamRange', 250, { min: 0, max: 500 }); // m: an enemy this close gets a jammer (a jam is seen through within 150 m)
const jamGap = param('jamGap', 6, { min: 0, max: 30 }); // s between jammers (each jams 5 s)

function setup() {
  state.lastJam = -1e9;
}

/** A jammer still held on its grip: the one on the wanted side (-1 left of the core, 1 right) first, else any. */
function jammer(side) {
  let other;
  for (let k = 1; k <= 9; k++) {
    const p = parts.find((q) => q.type === 'jammer' && q.tags.includes('jam' + k));
    if (!p || !(get('jgrip' + k, 'armed') > 0) || get('jam' + k, 'jamming') !== 0) continue;
    if (Math.sign(p.pos.x - self.pos.x) === side) return k;
    if (other === undefined) other = k;
  }
  return other;
}

function tick() {
  if (time - state.lastJam < jamGap) return;
  const enemy = contacts.find((c) => c.side === 'enemy' && c.core && c.mass >= heavy && c.distance <= jamRange);
  const k = enemy ? jammer(Math.sign(enemy.pos.x - self.pos.x)) : undefined;
  if (k === undefined) return;
  set('jam' + k, 'ignite', 1);
  set('jgrip' + k, 'fire', 1);
  state.lastJam = time;
}
