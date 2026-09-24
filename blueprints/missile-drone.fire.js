// F fires the next missile: the right one first, so the left one never flies under a missile still hanging there.
function tick() {
  if (!keys.pressed('f')) return;
  if (get('right', 'armed') > 0) set('right', 'fire', 1);
  else if (get('left', 'armed') > 0) set('left', 'fire', 1);
}
