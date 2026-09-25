// Turret: aims the missile. It hangs straight down; Z swings it toward the left, X toward the right (up to level
// either way), and C brings it back to straight down. With no key it holds its aim. The rotator is off auto controls
// (tagged aim) because its auto keys would turn it the wrong way for a turret that points down: a positive turn is
// counterclockwise, which swings a downward barrel to the right.

const back = param('back', 6, { min: 1, max: 20 }); // how fast C returns it to straight down (per second, of the range)

function setup() {
  state.centering = false;
}

function tick() {
  let turn = 0;
  if (keys.pressed('c')) state.centering = true;
  if (keys.down('z')) turn -= 1;
  if (keys.down('x')) turn += 1;
  if (turn !== 0) state.centering = false;
  if (state.centering) {
    const a = get('aim', 'angle'); // -1 to 1 of its range
    turn = clamp(-back * a, -1, 1);
    if (Math.abs(a) < 0.005) state.centering = false;
  }
  set('aim', 'turn', turn);
}
