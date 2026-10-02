// Generator for titan-hive (titans tournament, builder 1, theme: carrier).
// Run from the repo root: node tournaments/gen/titan-hive.mjs
// Writes blueprints/titan-hive.json, the dart recipe as blueprints/titan-hive-dart.json, and copies the dart's guide
// (blueprints/titan-hive-dart.guide.js) to blueprints/titan-hive.dart.guide.js, the name a bay's copy looks for.
// The pilot (blueprints/titan-hive.pilot.js) is written by hand and left alone.
//
// Shape, round 2 (bottom row is y 0): one thick slab with its propellers inside it and a deep armored middle.
//   y 0..1    belly turrets (a rotator hanging from the belly skin, its gun under it)
//   y 2       belly skin (frames): everything that lifts sits above it
//   y 3..5    three rows of propellers between posts, inside the hull
//   y 6       skin
//   y 7..8    dense batteries; radars at the far ends (outside the jammer bubble)
//   y 9       skin
//   y 10..11  shoulders: propellers between posts under a roof; turrets on the roof
//   y 10..16  dart bays (each 4 wide: wall, hollow 2 by 6, wall), five each side of the middle
//   middle    a block 15 wide from y 2 to y 14 around the core at y 8: armor plate four deep, frames outside that, so
//             the core is 6 cells from any face (a crash hurts only about 6 m in). Two 1 by 1 bays on its top build
//             jammer pods the pilot lights in turn, so the core is hidden from sensors all match.
import { copyFileSync, writeFileSync } from 'node:fs';

const SIDE_BAYS = 5; // dart bays each side of the middle
const BAY_W = 4; // a dart bay: wall, hollow 2 wide, wall
const SHOULDER = 28; // columns each side of the bays
const MID = 7; // the middle block reaches this many columns either side of the core
const TIP = 2; // room for a side turret at each end
const HULL = 2 * (SHOULDER + SIDE_BAYS * BAY_W) + 2 * MID + 1;
const W = TIP + HULL + TIP;
const H = 18;
const X0 = TIP; // the hull's first column
const X1 = X0 + HULL - 1; // the hull's last column
const coreX = X0 + (HULL >> 1);
const coreY = 8;
const LB = coreX - MID - SIDE_BAYS * BAY_W; // the left bays' first column
const RB = coreX + MID + 1; // the right bays' first column

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
  const dx = Math.abs(x - coreX);
  if (dx <= MID) {
    // The middle block.
    for (let y = coreY - 6; y <= coreY + 6; y++) {
      const dy = Math.abs(y - coreY);
      put(x, y, dx === 0 && dy === 0 ? 'C' : dx <= 4 && dy <= 4 ? 'A' : 'F');
    }
    continue;
  }
  const prop = x < coreX ? 'l' : 'r';
  const end = x === X0 || x === X1;
  const post = (x - X0) % 5 === 0 || end;
  put(x, 2, 'F');
  for (let y = 3; y <= 5; y++) put(x, y, post ? 'F' : prop);
  if (post && !end && posts++ % 3 === 1) turret(x, 1, 180);
  put(x, 6, 'F');
  for (let y = 7; y <= 8; y++) {
    if (end) put(x, y, 'A');
    else if (x === X0 + 2 || x === X1 - 2) put(x, y, 'O');
    else put(x, y, 'Z');
  }
  put(x, 9, 'F');
  // Shoulders: propellers between posts under a roof.
  if (x < LB || x >= RB + SIDE_BAYS * BAY_W) {
    put(x, 10, post || x === LB - 1 || x === RB + SIDE_BAYS * BAY_W ? 'F' : prop);
    put(x, 11, 'F');
    const fromEnd = Math.min(x - X0, X1 - x);
    if (fromEnd === 4 || fromEnd === 24) turret(x, 12, 0);
  }
}
// Dart bays.
let bays = 0;
for (const first of [LB, RB]) {
  for (let i = 0; i < SIDE_BAYS; i++) {
    const x = first + BAY_W * i;
    const tok = `b${String.fromCharCode(97 + bays)}`;
    legend[tok] = { part: 'fabbay', rot: 0, tags: [`bay${String.fromCharCode(65 + bays)}`], makes: 'dart', size: [2, 6] };
    bays++;
    put(x, 10, '=');
    put(x + 1, 10, tok);
    put(x + 2, 10, '=');
    put(x + 3, 10, '=');
    for (let y = 11; y <= 16; y++) {
      put(x, y, '=');
      put(x + 3, y, '=');
    }
  }
}
// Jammer pod bays on top of the middle block.
for (const [i, x] of [coreX - 3, coreX + 3].entries()) {
  const tok = `j${String.fromCharCode(97 + i)}`;
  legend[tok] = { part: 'fabbay', rot: 0, tags: [`jam${String.fromCharCode(65 + i)}`], makes: 'pod', size: [1, 1] };
  put(x - 1, coreY + 7, '=');
  put(x, coreY + 7, tok);
  put(x + 1, coreY + 7, '=');
  put(x - 1, coreY + 8, '=');
  put(x + 1, coreY + 8, '=');
}
// A turret out of each end.
turret(X0 - 1, 8, 90);
turret(X1 + 1, 8, 270);

const dart = {
  format: 1,
  name: 'titan-hive-dart',
  // The blast head is the very front (a part in front of a blast halves it); the seeker rides beside the second head.
  grid: ['x .', 'H S^', 'C .', 'E .', 'g .', 'k .'],
  legend: {
    x: { part: 'charge' },
    g: { part: 'heavygyro', rot: 0, auto: false },
    k: { part: 'booster', rot: 0, auto: false },
  },
  scripts: [
    {
      id: 'guide',
      params: { arc: 0, height: 60, arcSpeed: 60, clear: 0.4, clearDist: 30, thrust: 400, gyroTorque: 200, fuse: 13, acquire: 150, armDist: 260 },
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
  recipes: { dart: dartInHost, pod: { format: 1, name: 'titan-hive-pod', grid: ['J'] } },
};

writeFileSync('blueprints/titan-hive.json', `${JSON.stringify(hive, null, 1)}\n`);
writeFileSync('blueprints/titan-hive-dart.json', `${JSON.stringify(dart, null, 1)}\n`);
copyFileSync('blueprints/titan-hive-dart.guide.js', 'blueprints/titan-hive.dart.guide.js');
console.log(`titan-hive: ${W} wide, ${H} tall, ${bays} dart bays, ${turrets} turrets`);
