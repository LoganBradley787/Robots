// Generator for titan-woodpecker (Titans tournament, theme 4: Volley). Run from the repo root:
//   node tournaments/gen/titan-woodpecker.mjs [pairsPerSide] [baysPerSide]
// It writes blueprints/titan-woodpecker.json, blueprints/titan-woodpecker-dart.json, and a copy of the dart's guide
// for the standalone dart. The hand-written scripts are not touched:
//   titan-woodpecker.brain.js (picks the target, casts the anchors, lets the darts go, runs the bays),
//   titan-woodpecker.dart.guide.js (every dart, placed or built).
//
// Layout (x right, y up, the bottom row is y 0), the same left and right of the middle:
// - The base: an armor floor (y 0), a row of dense batteries (y 1), a frame roof (y 2).
// - The keep (round 2): a solid block of armor plates in the middle, taller than the rack. The MAIN core sits deep in
//   it with a radar and a radio beside it: crash damage is local now, so depth is what keeps a core whole. Nothing
//   flies off to hide any more.
// - Anchors: grapples in the battery row, pointing down through a gap in the floor. The brain casts them at the ground once the base rests, so a
//   robot that pushes the base toward the arena's edge pulls on ropes instead.
// - The rack: darts stand nose up on the roof in pairs around a shared gap, each held by a grip (a decoupler) beside
//   its booster: `D> K . K D<`, five columns a pair. Grip `g<n>` holds dart `d<n>`.
// - The bays: fabricator bays (hollow 1 by 8) at both ends, each making the same dart. Tags `b<n>x`. (Titans v2: moved
//   beside the keep for a while; there the guns and darts aimed at the keep broke them.)
// - A dart (round 2): booster, heavy gyro, radio, cell, core, two blast heads at the very nose (nothing in front of
//   them to soak up the blast). It has no sensor of its own: it steers by what the keep's radar shares over the radio.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bp = (f) => path.join(root, 'blueprints', f);
const NAME = 'titan-woodpecker';

const PAIRS = Number(process.argv[2] ?? 12); // dart pairs on each side of the middle (24 in round 1: half the volley keeps the tick time under the rule)
const BAYS = Number(process.argv[3] ?? 5); // bays on each end (8 in round 1: fewer darts in the air at once keeps the tick time down)
const DART = ['booster', 'heavygyro', 'radio', 'cell', 'core', 'heavywarhead', 'heavywarhead']; // bottom to top
const DH = DART.length;
// A bay's dart (titans v2, 2026-10) has a seeker on its nose: within 150 m it sees through a jammer's bubble, so the
// darts that come later in the fight find a hidden core themselves. The rack's darts go in the first seconds, at what
// the keep's radar sees, and have none (the parts are spent on flares instead).
const BAY_DART = [...DART, 'seeker'];
const BAY_H = BAY_DART.length;
const MID_HALF = 7; // the keep is 15 wide
const CORE_Y = 4; // the main core's row: four plates under it, eleven over it
const ANCHOR_EVERY = 8; // one anchor in the floor every this many columns
const END = 2; // columns of base beyond the bays: the flare columns stand on them
const W = 2 * (END + BAYS * 3 + PAIRS * 5) + 2 * MID_HALF + 1;
const CX = (W - 1) / 2;
const ROOF = 2;
const H = ROOF + 1 + BAY_H + 1;

const KEEP_H = ROOF + DH + 7; // the keep stands five rows over the rack: eleven plates over the main core
const FLARE_TOP = Number(process.argv[4] ?? 28); // the end columns of flares reach up to this row (titans v2)
const g = Array.from({ length: Math.max(KEEP_H, FLARE_TOP) }, () => Array.from({ length: W }, () => '.'));
const put = (x, y, t) => {
  if (g[y][x] !== '.') throw new Error(`cell ${x},${y} taken by ${g[y][x]} (placing ${t})`);
  g[y][x] = t;
};
const legend = {};
const cores = {};
// One script file may serve one core only, so the rack's darts and the base's core carry their script inline (a copy
// of the file, made here).
const guide = { id: 'guide', source: fs.readFileSync(bp(`${NAME}.dart.guide.js`), 'utf8') };

// The base, and the keep in its middle.
let anchors = 0;
for (let x = 0; x < W; x++) {
  if (Math.abs(x - CX) <= MID_HALF) {
    for (let y = 0; y < KEEP_H; y++) {
      if (y === CORE_Y && x === CX) put(x, y, 'C');
      else if (y === CORE_Y && x === CX - 1) put(x, y, 'O');
      else if (y === CORE_Y && x === CX + 1) put(x, y, 'N');
      else if (y === CORE_Y - 1 && Math.abs(x - CX) <= 1) put(x, y, 'Z');
      else put(x, y, 'A');
    }
    continue;
  }
  if (x > 2 && x < W - 3 && Math.abs(x - CX) % ANCHOR_EVERY === ANCHOR_EVERY - 2) {
    anchors++;
    legend[`a${anchors}`] = { part: 'grapple', rot: 180, tags: ['anchor', `an${anchors}`], auto: false };
    // One row up, over a gap in the floor: its barrel must start above the ground to find it.
    put(x, 1, `a${anchors}`);
  } else {
    put(x, 0, 'A');
    if (x === 0 || x === W - 1) put(x, 1, 'A');
    else put(x, 1, 'Z');
  }
  put(x, ROOF, 'F');
}

// The bays, at both ends.
let bay = 0;
const addBay = (x0) => {
  bay++;
  const t = `y${bay}`;
  legend[t] = { part: 'fabbay', tags: [`b${bay}x`], makes: 'dart', size: [1, BAY_H] };
  put(x0 + 1, ROOF + 1, t);
  put(x0, ROOF + 1, '=');
  put(x0 + 2, ROOF + 1, '=');
  for (let y = ROOF + 2; y <= ROOF + 1 + BAY_H; y++) {
    put(x0, y, '=');
    put(x0 + 2, y, '=');
  }
};
for (let i = 0; i < BAYS; i++) {
  addBay(END + i * 3);
  addBay(W - END - (i + 1) * 3);
}

// The rack.
let dart = 0;
const addDart = (x, gripX) => {
  dart++;
  const tg = `g${dart}`;
  legend[tg] = { part: 'decoupler', rot: gripX < x ? 270 : 90, tags: [`g${dart}`] };
  put(gripX, ROOF + 1, tg);
  DART.forEach((part, i) => {
    const t = `${'kynechh'[i]}${i}_${dart}`;
    legend[t] = { part, rot: 0, tags: [`d${dart}`], ...(part === 'booster' || part === 'heavygyro' ? { auto: false } : {}) };
    put(x, ROOF + 1 + i, t);
    if (part === 'core') cores[`core@${x},${ROOF + 1 + i}`] = { scope: `d${dart}`, autoControls: false, bindings: [], scripts: [guide] };
  });
};
for (let i = 0; i < PAIRS; i++) {
  for (const x0 of [END + BAYS * 3 + i * 5, CX + MID_HALF + 1 + i * 5]) {
    addDart(x0 + 1, x0);
    addDart(x0 + 3, x0 + 4);
  }
}

const dartBlueprint = (file) => ({
  format: 1,
  name: `${NAME}-dart`,
  autoControls: false,
  grid: ['S^', 'H', 'H', 'C', 'E', 'N', 'y', 'k'],
  legend: { y: { part: 'heavygyro', auto: false }, k: { part: 'booster', rot: 0, auto: false } },
  scripts: [{ id: 'guide', source: { file } }],
});

// Flares (titans v2, 2026-10): a burning flare let go is taken for this titan by every sensor that sees it, so a dart
// or gun steering by contacts goes for the flare. A tall thin column at each end, about 84 m from the keep (flare
// outside, its grip inside, the grips stacked on the roof and held by the end bay's wall). Tried and dropped: columns
// in the middle of each half of the rack (40 m from the keep) drew the blasts onto the thin base there, which broke
// through it and the whole end, bays and batteries, fell away. Tags: flare `f<n>`, grip `fg<n>`.
let flares = 0;
const addFlare = (fx, fy, gx, gy, rot) => {
  flares++;
  legend[`q${flares}`] = { part: 'flare', rot, tags: ['flare', `f${flares}`] };
  legend[`r${flares}`] = { part: 'decoupler', rot, tags: ['fgrip', `fg${flares}`] };
  put(gx, gy, `r${flares}`);
  put(fx, fy, `q${flares}`);
};
for (let y = ROOF + 1; y < FLARE_TOP; y++) {
  addFlare(0, y, 1, y, 90);
  addFlare(W - 1, y, W - 2, y, 270);
}

const blueprint = {
  format: 1,
  name: NAME,
  kind: 'yours',
  autoControls: false,
  grid: g.map((row) => row.join(' ')).reverse(),
  legend,
  primaryCore: `core@${CX},${CORE_Y}`,
  scripts: [{ id: 'brain', source: { file: `${NAME}.brain.js` }, params: { anchors } }],
  cores,
  recipes: { dart: dartBlueprint(`${NAME}.dart.guide.js`) },
};
fs.writeFileSync(bp(`${NAME}.json`), JSON.stringify(blueprint, null, 1) + '\n');
// The saved copy is stamped as one of yours (the builder's library kind); the bay's recipe is not.
const { format: dartFormat, name: dartName, ...dartRest } = dartBlueprint(`${NAME}-dart.guide.js`);
fs.writeFileSync(bp(`${NAME}-dart.json`), JSON.stringify({ format: dartFormat, name: dartName, kind: 'yours', ...dartRest }, null, 1) + '\n');
if (fs.existsSync(bp(`${NAME}.dart.guide.js`))) fs.copyFileSync(bp(`${NAME}.dart.guide.js`), bp(`${NAME}-dart.guide.js`));
console.log(`${NAME}: ${W} wide, ${dart} darts, ${bay} bays, ${anchors} anchors, ${flares} flares`);
