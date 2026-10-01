// Generator for titan-hive (titans tournament, builder 1, theme: carrier).
// Run from the repo root: node tournaments/gen/titan-hive.mjs
// Writes blueprints/titan-hive.json, the dart recipe as blueprints/titan-hive-dart.json, and copies the dart's guide
// (blueprints/titan-hive-dart.guide.js) to blueprints/titan-hive.dart.guide.js, the name a bay's copy looks for.
// The pilot (blueprints/titan-hive.pilot.js) is written by hand and left alone.
//
// Shape (bottom row is y 0): one thick slab, so one blast cannot cut a wing off.
//   y 0..1   belly turrets (a rotator hanging from a post, its gun under it)
//   y 2..3   two rows of propellers hanging between posts, all along the hull
//   y 4      bottom skin (frames; armor under the core)
//   y 5..6   dense batteries; the core, radars and radio in the middle of row 6 inside an armor ring
//   y 7      top skin
//   y 8      shoulders: propellers on top; middle: the bay floors
//   y 9..15  the dart bays, side by side (each 3 wide: wall, hollow 1 by 7, wall)
import { copyFileSync, writeFileSync } from 'node:fs';

const BAYS = 16;
const SHOULDER = 31; // columns each side of the bays
const TIP = 2; // room for a side turret at each end
const CENTER = BAYS * 3;
const HULL = SHOULDER + CENTER + SHOULDER;
const W = TIP + HULL + TIP;
const H = 16;
const X0 = TIP; // the hull's first column
const CX = X0 + SHOULDER; // the bays' first column
const X1 = X0 + HULL - 1; // the hull's last column
const coreX = X0 + (HULL >> 1);

const cells = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
const put = (x, y, t) => {
  if (cells[y][x] !== '.' && cells[y][x] !== t) throw new Error(`cell ${x},${y} holds ${cells[y][x]}, not free for ${t}`);
  cells[y][x] = t;
};
const legend = {
  l: { part: 'propeller', tags: ['lprop'], auto: false },
  r: { part: 'propeller', tags: ['rprop'], auto: false },
};
let turrets = 0;
/** A gun on a rotator: `rot` 0 carries it up, 90 left, 180 down, 270 right; (x, y) is the rotator's cell. */
function turret(x, y, rot) {
  turrets++;
  const name = `tur${turrets}`;
  const d = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] }[rot];
  legend[`q${turrets}`] = { part: 'rotator', rot, tags: [name, `${name}.rot`], auto: false };
  legend[`m${turrets}`] = { part: 'gun', rot, tags: [name, `${name}.gun`] };
  put(x, y, `q${turrets}`);
  put(x + d[0], y + d[1], `m${turrets}`);
}

let posts = 0;
for (let x = X0; x <= X1; x++) {
  const prop = x < coreX ? 'l' : 'r';
  const ring = Math.abs(x - coreX) <= 1;
  const end = x === X0 || x === X1;
  // Hanging propellers between posts, a belly turret under some posts.
  const post = (x - X0) % 5 === 0 || x === X1;
  put(x, 3, post ? 'F' : prop);
  put(x, 2, post ? 'F' : prop);
  if (post && !end && posts++ % 2 === 1) turret(x, 1, 180);
  // The slab.
  put(x, 4, ring ? 'A' : 'F');
  for (let y = 5; y <= 6; y++) {
    if (x === coreX && y === 6) put(x, y, 'C');
    else if (ring || end) put(x, y, 'A');
    else if (y === 6 && (x === coreX - 3 || x === coreX + 20 || x === coreX - 20)) put(x, y, 'O');
    else if (y === 6 && x === coreX + 3) put(x, y, 'N');
    else put(x, y, 'Z');
  }
  put(x, 7, ring ? 'A' : 'F');
  // Shoulders: propellers on top, a turret looking up at each end.
  if (x < CX || x >= CX + CENTER) {
    if (x === X0 + 1 || x === X1 - 1) turret(x, 8, 0);
    else if (x > X0 + 2 && x < X1 - 2) put(x, 8, prop); // nothing beside a rotator: it would turn with it
  }
}
// Bays on the middle of the top skin.
for (let i = 0; i < BAYS; i++) {
  const x = CX + 3 * i;
  const tok = `b${String.fromCharCode(97 + i)}`;
  legend[tok] = { part: 'fabbay', rot: 0, tags: [`bay${String.fromCharCode(65 + i)}`], makes: 'dart', size: [1, 7] };
  put(x, 8, '=');
  put(x + 1, 8, tok);
  put(x + 2, 8, '=');
  for (let y = 9; y <= 15; y++) {
    put(x, y, '=');
    put(x + 2, y, '=');
  }
}
// A turret out of each end.
turret(X0 - 1, 6, 90);
turret(X1 + 1, 6, 270);

const dart = {
  format: 1,
  name: 'titan-hive-dart',
  grid: ['S^', 'H', 'H', 'C', 'E', 'g', 'k'],
  legend: {
    g: { part: 'heavygyro', rot: 0, auto: false },
    k: { part: 'booster', rot: 0, auto: false },
  },
  scripts: [
    {
      id: 'guide',
      params: { arc: 0, height: 60, arcSpeed: 60, clear: 0.4, clearDist: 18, thrust: 400, gyroTorque: 200, fuse: 13, acquire: 150 },
      source: { file: 'titan-hive-dart.guide.js' },
    },
  ],
};
const dartInHost = JSON.parse(JSON.stringify(dart));
dartInHost.scripts[0].source.file = 'titan-hive.dart.guide.js';

const hive = {
  format: 1,
  name: 'titan-hive',
  grid: cells
    .slice()
    .reverse()
    .map((row) => row.join(' ')),
  legend,
  scripts: [{ id: 'pilot', params: {}, source: { file: 'titan-hive.pilot.js' } }],
  recipes: { dart: dartInHost },
};

writeFileSync('blueprints/titan-hive.json', `${JSON.stringify(hive, null, 1)}\n`);
writeFileSync('blueprints/titan-hive-dart.json', `${JSON.stringify(dart, null, 1)}\n`);
copyFileSync('blueprints/titan-hive-dart.guide.js', 'blueprints/titan-hive.dart.guide.js');
console.log(`titan-hive: ${W} wide, ${H} tall, ${BAYS} bays, ${turrets} turrets`);
