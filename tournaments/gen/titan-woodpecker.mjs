// Generator for titan-woodpecker (Titans tournament, theme 4: Volley). Run from the repo root:
//   node tournaments/gen/titan-woodpecker.mjs [pairsPerSide] [baysPerSide]
// It writes blueprints/titan-woodpecker.json, blueprints/titan-woodpecker-dart.json, and a copy of the dart's guide
// for the standalone dart. The hand-written scripts are not touched:
//   titan-woodpecker.brain.js (picks the target, lets the darts go, runs the bays),
//   titan-woodpecker.king.js (the pod with the main core: jammers, leaving, hover),
//   titan-woodpecker.dart.guide.js (every dart, placed or built).
//
// Layout (x right, y up, the bottom row is y 0), the same left and right of the middle:
// - The base: an armor floor (y 0), a row of dense batteries with the base's own core in the middle and a radar near
//   each end (y 1), a frame roof (y 2).
// - The rack: darts stand nose up on the roof in pairs around a shared gap, each held by a grip (a decoupler) beside
//   its booster: `D> K . K D<`, five columns a pair. Grip `g<n>` holds dart `d<n>`.
// - The bays: fabricator bays (hollow 1 by 7) at both ends, each making the same dart. Tags `b<n>x`.
// - The pod: a small flier on a grip (`cradle`) on the middle of the roof. It holds the MAIN core, four rows of
//   jammer pods (`jam<n>`, lit one after another so the core is never seen), and propellers. Once the rack is empty it
//   lets go and hides far behind the base; the base's own core wakes then and keeps the bays going.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bp = (f) => path.join(root, 'blueprints', f);
const NAME = 'titan-woodpecker';

const PAIRS = Number(process.argv[2] ?? 24); // dart pairs on each side of the middle
const BAYS = Number(process.argv[3] ?? 8); // bays on each end
const DART = ['booster', 'heavygyro', 'cell', 'core', 'heavywarhead', 'heavywarhead', 'seeker']; // bottom to top
const DH = DART.length;
const POD_HALF = 6; // the pod is 13 wide
const MID_HALF = 9; // the middle section is 19 wide
const END = 2;
const W = 2 * (END + BAYS * 3 + PAIRS * 5) + 2 * MID_HALF + 1;
const CX = (W - 1) / 2;
const ROOF = 2;
const H = ROOF + 1 + DH + 1;

const g = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
const put = (x, y, t) => {
  if (g[y][x] !== '.') throw new Error(`cell ${x},${y} taken by ${g[y][x]} (placing ${t})`);
  g[y][x] = t;
};
const legend = {};
const cores = {};
// One script file may serve one core only, so the rack's darts and the base's core carry their script inline (a copy
// of the file, made here).
const guide = { id: 'guide', source: fs.readFileSync(bp(`${NAME}.dart.guide.js`), 'utf8') };

// The base.
for (let x = 0; x < W; x++) {
  put(x, 0, 'A');
  put(x, ROOF, 'F');
  if (x === CX) put(x, 1, 'bc');
  else if (x === 1 || x === W - 2 || x === 3 || x === W - 4) put(x, 1, 'O');
  else if (x === 0 || x === W - 1) put(x, 1, 'A');
  else put(x, 1, 'Z');
}
legend.bc = { part: 'core', tags: ['basecore'] };

// The bays, at both ends.
let bay = 0;
const addBay = (x0) => {
  bay++;
  const t = `y${bay}`;
  legend[t] = { part: 'fabbay', tags: [`b${bay}x`], makes: 'dart', size: [1, DH] };
  put(x0 + 1, ROOF + 1, t);
  put(x0, ROOF + 1, '=');
  put(x0 + 2, ROOF + 1, '=');
  for (let y = ROOF + 2; y <= ROOF + 1 + DH; y++) {
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
    const t = `${'kyechhs'[i]}${i}_${dart}`;
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

// The pod: cradle, four rows of jammers, a body row, propellers on top.
legend.cr = { part: 'decoupler', rot: 0, tags: ['cradle'] };
put(CX, ROOF + 1, 'cr');
const JY = ROOF + 2;
let jam = 0;
for (let r = 0; r < 4; r++) {
  // Lit from the outside in, left and right in turn, the bottom row first: what is left always hangs together.
  for (let k = POD_HALF; k >= 0; k--) {
    for (const x of k === 0 ? [CX] : [CX - k, CX + k]) {
      jam++;
      legend[`j${jam}`] = { part: 'jammer', tags: [`jam${jam}`] };
      put(x, JY + r, `j${jam}`);
    }
  }
}
const BY = JY + 4;
const body = ['F', 'Z', 'Z', 'ky', 'F', 'F', 'C', 'F', 'F', 'ky', 'Z', 'Z', 'F'];
legend.ky = { part: 'heavygyro', auto: false, tags: ['kgyro'] };
legend.pa = { part: 'propeller', auto: false, tags: ['pa'] };
legend.pb = { part: 'propeller', auto: false, tags: ['pb'] };
legend.pm = { part: 'propeller', auto: false, tags: ['pm'] };
body.forEach((t, i) => {
  const x = CX - POD_HALF + i;
  put(x, BY, t);
  put(x, BY + 1, x < CX ? 'pa' : x > CX ? 'pb' : 'pm');
});

const dartBlueprint = (file) => ({
  format: 1,
  name: `${NAME}-dart`,
  autoControls: false,
  grid: ['S^', 'H', 'H', 'C', 'E', 'y', 'k'],
  legend: { y: { part: 'heavygyro', auto: false }, k: { part: 'booster', rot: 0, auto: false } },
  scripts: [{ id: 'guide', source: { file } }],
});

const blueprint = {
  format: 1,
  name: NAME,
  autoControls: false,
  grid: g.map((row) => row.join(' ')).reverse(),
  legend,
  primaryCore: `core@${CX},${BY}`,
  corePriority: [`core@${CX},1`],
  scripts: [
    { id: 'king', source: { file: `${NAME}.king.js` } },
    { id: 'brain', source: { file: `${NAME}.brain.js` } },
  ],
  cores: { [`core@${CX},1`]: { autoControls: false, bindings: [], scripts: [{ id: 'brain', source: fs.readFileSync(bp(`${NAME}.brain.js`), 'utf8') }] }, ...cores },
  recipes: { dart: dartBlueprint(`${NAME}.dart.guide.js`) },
};
fs.writeFileSync(bp(`${NAME}.json`), JSON.stringify(blueprint, null, 1) + '\n');
fs.writeFileSync(bp(`${NAME}-dart.json`), JSON.stringify(dartBlueprint(`${NAME}-dart.guide.js`), null, 1) + '\n');
if (fs.existsSync(bp(`${NAME}.dart.guide.js`))) fs.copyFileSync(bp(`${NAME}.dart.guide.js`), bp(`${NAME}-dart.guide.js`));
console.log(`${NAME}: ${W} wide, ${dart} darts, ${bay} bays, ${jam} jammers`);
