// Fixed guns (Batch): every gun tagged `hgun` fires while its own sight sees an enemy robot within `range` meters, and
// only then. A grapple drone cannot carry rotator turrets (a robot with a rotator cannot hold a rope: the rope does
// not pull), so its guns are fixed: two on the ends pointing out, and two under the body pointing straight down,
// either side of what the middle grapple holds, so what hangs on the rope is shot by them. The sight is a straight
// line 150 m long, so the rule is exact: nothing of ours is ever on it when it fires (the sight reads an enemy first),
// and a flare or a friend in the way reads as itself, not an enemy.
// With `auto` at 0 (a player), G switches the guns off and on (they start on); robots that fly themselves leave it at 1.
const auto = param('auto', 1, { min: 0, max: 1 });
const range = param('range', 140, { min: 1, max: 150 }); // m: an enemy further along the sight than this is left alone (shells last 1 s: 300 m, 5 damage)
const SIDE_ENEMY = 3; // the gun's `sightSide` for an enemy robot

function setup() {
  state.on = true;
}

function tick() {
  if (auto < 0.5 && keys.pressed('g')) state.on = !state.on;
  for (const p of parts) {
    if (p.type !== 'gun' || !p.tags.includes('hgun')) continue;
    const name = p.tags.find((t) => t !== 'hgun');
    if (!name) continue;
    set(name, 'fire', state.on && p.out.sightSide === SIDE_ENEMY && p.out.sight <= range ? 1 : 0);
  }
}
