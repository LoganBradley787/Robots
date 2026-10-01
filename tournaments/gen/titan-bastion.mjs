// Generator for titan-bastion (Titans tournament, theme 2: Fortress). Run from the repo root:
//   node tournaments/gen/titan-bastion.mjs
// It writes blueprints/titan-bastion.json and copies the dart's guide. The hand-written scripts
// (titan-bastion.keep.js, titan-bastion.base.pilot.js) are not touched.
//
// Layout (x right, y up, the bottom row is y 0):
// - The mesa: W wide. An armor floor, two rows of dense batteries with the mesa's own core in the middle, an armor
//   roof ROOF rows deep, armor end walls.
// - On the roof: two banks of dart bays in armored wells, a mast of radars at each end (more than 30 m from the
//   jammer bays, so the mesa's own bubble does not blind them), and a jammer bay either side of the middle.
// - The keep: a small flier holding the MAIN core, standing on a grip on the roof's middle. It lets go on the
//   first tick, climbs, and hides in its own jammer bubble far behind the mesa. The mesa's core wakes then and runs
//   the base pilot (scope `base`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bp = (f) => path.join(root, 'blueprints', f);

const W = 101; // mesa width, odd so the core is on the middle column
const MID = (W - 1) / 2;
const ROOF = 3; // armor rows over the batteries
// The mesa's own core sits off the middle: blind darts sent at the mirrored start point land on the middle column.
// It stays within 30 m of both jammer bays (at MID - 10 and MID + 10).
const BASE_CORE = MID - 16;
const BODY = 3 + ROOF; // floor + 2 battery rows + roof
const TOP = BODY - 1; // the roof's top row
const BAYS_PER_BANK = 6;
const WELL = 7; // armor column height beside a dart bay (the bay is 6 tall)
const H = BODY + WELL + 2;

const g = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
const put = (x, y, t) => {
  if (g[y][x] !== '.') throw new Error(`cell ${x},${y} taken by ${g[y][x]} (placing ${t})`);
  g[y][x] = t;
};
const legend = {
  mc: { part: 'core', tags: ['base'] },
  P: { part: 'propeller', auto: false, tags: ['pa'] },
  Pb: { part: 'propeller', auto: false, tags: ['pb'] },
  Pc: { part: 'propeller', auto: false, tags: ['pc'] },
  kg: { part: 'heavygyro', auto: false, tags: ['kg'] },
  kd: { part: 'decoupler', rot: 0, tags: ['kd'] },
  ja: { part: 'fabbay', tags: ['ja'], makes: 'pod', size: [1, 1] },
  jb: { part: 'fabbay', tags: ['jb'], makes: 'pod', size: [1, 1] },
  jl: { part: 'fabbay', tags: ['base', 'base.jl'], makes: 'pod', size: [1, 1] },
  jr: { part: 'fabbay', tags: ['base', 'base.jr'], makes: 'pod', size: [1, 1] },
};

// The mesa's body.
for (let x = 0; x < W; x++) {
  put(x, 0, 'A');
  for (let y = 1; y <= 2; y++) put(x, y, x < 2 || x >= W - 2 ? 'A' : x === BASE_CORE && y === 2 ? 'mc' : 'Z');
  for (let y = 3; y < BODY; y++) put(x, y, 'A');
}

// A fabricator bay with its origin (floor middle) at (x, y), hollow w by h.
function bay(x, y, token, w, h) {
  const half = (w - 1) / 2;
  for (let dx = -half - 1; dx <= half + 1; dx++) put(x + dx, y, dx === 0 ? token : '=');
  for (let dy = 1; dy <= h; dy++) {
    put(x - half - 1, y + dy, '=');
    put(x + half + 1, y + dy, '=');
  }
}
const column = (x, y0, n, t) => {
  for (let y = y0; y < y0 + n; y++) if (g[y][x] === '.') put(x, y, t);
};

// Dart bays in wells: armor, bay (3 wide), armor, bay, ... The same on both sides of the middle.
let n = 0;
for (const side of [-1, 1]) {
  for (let i = 0; i < BAYS_PER_BANK; i++) {
    const x = side < 0 ? 8 + 4 * i : W - 1 - 8 - 4 * i;
    const token = `d${'abcdefghijklmnopqrstuvwxyz'[n]}`; // a letter, not a number: copies are named <tag><count>
    legend[token] = { part: 'fabbay', tags: ['base', `base.${token}`], makes: 'dart' };
    bay(x, TOP + 1, token, 1, 5);
    column(x - 2, TOP + 1, WELL, 'A');
    column(x + 2, TOP + 1, WELL, 'A');
    n++;
  }
}
// Radar masts on the outer ends (the outermost well columns and one more column outside them).
for (const x of [2, 6, W - 3, W - 7]) {
  column(x, TOP + 1, WELL, 'A');
  put(x, TOP + 1 + WELL, 'O');
}
// The mesa's jammer bays, 10 m either side of its core.
bay(MID - 10, TOP + 1, 'jl', 1, 1);
bay(MID + 10, TOP + 1, 'jr', 1, 1);

// The keep, on a grip on the roof's middle. 13 wide, 3 tall.
const ky = TOP + 2;
put(MID, TOP + 1, 'kd');
const row0 = ['Z', 'kg', 'F', 'F', 'F', 'F', 'C', 'F', 'F', 'F', 'F', 'kg', 'Z'];
row0.forEach((t, i) => put(MID - 6 + i, ky, t));
for (const dx of [-6, -5, -4, 0, 4, 5, 6]) put(MID + dx, ky + 1, 'F');
bay(MID - 2, ky + 1, 'ja', 1, 1);
bay(MID + 2, ky + 1, 'jb', 1, 1);
for (const dx of [-6, -5, -4]) put(MID + dx, ky + 2, 'P');
for (const dx of [4, 5, 6]) put(MID + dx, ky + 2, 'Pb');
put(MID, ky + 2, 'Pc');

// Recipes: the dart is the stock missile-up with its guide under our name; the pod is one jammer.
const dart = JSON.parse(fs.readFileSync(bp('missile-up.json'), 'utf8'));
dart.name = 'dart';
delete dart.bindings;
dart.scripts = [{ id: 'guide', params: { ...dart.scripts[0].params, fuse: 14 }, source: { file: 'titan-bastion.dart.guide.js' } }];
fs.copyFileSync(bp('missile-up.guide.js'), bp('titan-bastion.dart.guide.js'));

const out = {
  format: 1,
  name: 'titan-bastion',
  autoControls: false,
  grid: g
    .slice()
    .reverse()
    .map((r) => r.join(' ')),
  legend,
  primaryCore: `core@${MID},${ky}`,
  scripts: [{ id: 'keep', source: { file: 'titan-bastion.keep.js' } }],
  cores: {
    [`core@${BASE_CORE},2`]: { scope: 'base', scripts: [{ id: 'pilot', source: { file: 'titan-bastion.base.pilot.js' } }] },
  },
  recipes: {
    dart,
    pod: { format: 1, name: 'pod', autoControls: false, grid: ['J'] },
  },
};
fs.writeFileSync(bp('titan-bastion.json'), JSON.stringify(out, null, 1) + '\n');
const count = g.flat().filter((t) => t !== '.' && t !== '=').length;
console.log(`titan-bastion: ${count} parts, ${W} wide, ${H} tall; main core at cell (${MID}, ${ky}): spawn height ${ky + 0.55}`);
