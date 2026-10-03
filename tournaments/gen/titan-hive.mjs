// Generator for titan-hive (titans tournament, builder 1, theme: carrier).
// Run from the repo root: node tournaments/gen/titan-hive.mjs
// Writes blueprints/titan-hive.json, the dart recipe as blueprints/titan-hive-dart.json, and copies the dart's guide
// (blueprints/titan-hive-dart.guide.js) to blueprints/titan-hive.dart.guide.js, the name a bay's copy looks for.
// The pilot (blueprints/titan-hive.pilot.js) is written by hand and left alone.
//
// Shape (bottom row is y 0): one thick slab with its propellers inside it and a deep armored middle. Since the heavy
// armor plate went to 20 kg (2026-10-02) it has a fourth row of propellers and plate three deep, not four (below).
//   y 0..1    belly turrets (a rotator hanging from the belly skin, its gun under it)
//   y 2       belly skin (frames): everything that lifts sits above it
//   y 3..6    four rows of propellers between posts, inside the hull
//   y 7       skin
//   y 8..9    dense batteries; radars at the far ends (outside the jammer bubble)
//   y 10      skin
//   y 11..12  shoulders: propellers between posts under a roof; turrets on the roof
//   y 11..17  dart bays (each 4 wide: wall, hollow 2 by 6, wall), five each side of the middle
//   middle    a block 15 wide from y 2 to y 15 around the core at y 9: armor plate three deep, frames outside that,
//             so the core is 6 cells from any face (a crash hurts only about 6 m in). Two 1 by 1 bays on its top
//             build jammer pods the pilot lights in turn, so the core is hidden from sensors all match.
import { copyFileSync, writeFileSync } from 'node:fs';

const SIDE_BAYS = 5; // dart bays each side of the middle
const BAY_W = 4; // a dart bay: wall, hollow 2 wide, wall
const SHOULDER = 28; // columns each side of the bays
const MID = 7; // the middle block reaches this many columns either side of the core
const TIP = 2; // room for a side turret at each end
// Heavy armor plates are 20 kg each since 2026-10-02 (5 before): a flier pays two propellers of lift per plate. The
// old block of plate four deep (80 plates, 1.6 t) left the ship at 3.2 t and push to weight 1.02: it sank. Now the
// plate is ARMOR deep around the core (48 plates, and 4 on the hull ends: 1.04 t), frames fill the rest of the middle block (depth still stops
// a crash and every part in the way still halves a blast; only shells and beams get through frames sooner), and one
// more row of propellers (76) carries what is left: 2.7 t, push to weight 1.54 (it was 1.67 on 5 kg plates).
// Measured before choosing (seed 1, against the gun wall): plate two deep on three propeller rows (2.2 t) lost its
// core at 57 s, this at 76 s. More propellers on the same armor changed no result.
const ARMOR = Number(process.env.HIVE_ARMOR ?? 3); // plate this many cells deep around the core
const PROP_ROWS = Number(process.env.HIVE_PROP_ROWS ?? 4); // rows of propellers inside the hull
const END_PLATES = (process.env.HIVE_END_PLATES ?? '1') !== '0'; // two plates on each end of the battery rows, in front of the radars
const UP = PROP_ROWS - 3; // rows everything over the propellers sits higher than in round 2
const HULL = 2 * (SHOULDER + SIDE_BAYS * BAY_W) + 2 * MID + 1;
const W = TIP + HULL + TIP;
const H = 18 + UP;
const X0 = TIP; // the hull's first column
const X1 = X0 + HULL - 1; // the hull's last column
const coreX = X0 + (HULL >> 1);
const coreY = 8 + UP;
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
    for (let y = 2; y <= coreY + 6; y++) {
      const dy = Math.abs(y - coreY);
      put(x, y, dx === 0 && dy === 0 ? 'C' : dx <= ARMOR && dy <= ARMOR ? 'A' : 'F');
    }
    continue;
  }
  const prop = x < coreX ? 'l' : 'r';
  const end = x === X0 || x === X1;
  const post = (x - X0) % 5 === 0 || end;
  put(x, 2, 'F');
  for (let y = 3; y <= 5 + UP; y++) put(x, y, post ? 'F' : prop);
  if (post && !end && posts++ % 3 === 1) turret(x, 1, 180);
  put(x, 6 + UP, 'F');
  for (let y = 7 + UP; y <= 8 + UP; y++) {
    if (end) put(x, y, END_PLATES ? 'A' : 'F');
    else if (x === X0 + 2 || x === X1 - 2) put(x, y, 'O');
    else put(x, y, 'Z');
  }
  put(x, 9 + UP, 'F');
  // Shoulders: propellers between posts under a roof.
  if (x < LB || x >= RB + SIDE_BAYS * BAY_W) {
    put(x, 10 + UP, post || x === LB - 1 || x === RB + SIDE_BAYS * BAY_W ? 'F' : prop);
    put(x, 11 + UP, 'F');
    const fromEnd = Math.min(x - X0, X1 - x);
    if (fromEnd === 4 || fromEnd === 24) turret(x, 12 + UP, 0);
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
    put(x, 10 + UP, '=');
    put(x + 1, 10 + UP, tok);
    put(x + 2, 10 + UP, '=');
    put(x + 3, 10 + UP, '=');
    for (let y = 11 + UP; y <= 16 + UP; y++) {
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
turret(X0 - 1, 8 + UP, 90);
turret(X1 + 1, 8 + UP, 270);

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
