// Generator for titan-bastion (Titans tournament, theme 2: Fortress). Run from the repo root:
//   node tournaments/gen/titan-bastion.mjs
// It writes blueprints/titan-bastion.json and the dart's guide (the stock missile-up guide with one small change).
// The hand-written script blueprints/titan-bastion.pilot.js is not touched.
//
// Round 2 (crash damage is local now, so depth protects a core): a real fortress, no flying keep.
// Layout (x right, y up, the bottom row is y 0):
// - The mesa: W wide, BODY rows of heavy armor, dense batteries under the bays. The MAIN core is on the middle
//   column, DEEP rows above the floor, more than 6 m from every face a ram can touch.
// - Over the core: a wide tier and on it a tower of armor, so a dig from above or from a slant meets 17 to 21
//   plates before the core. Aimed turrets on the tower's top blast what dives at it.
// - On the roof: two banks of dart bays in armored wells, a mast of radars at each end (more than 30 m from the
//   jammer bays, so the mesa's own bubble does not blind them), and a jammer bay either side of the tier.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bp = (f) => path.join(root, 'blueprints', f);

const W = 141; // mesa width, odd so the core is on the middle column
const MID = (W - 1) / 2;
const BODY = 9; // rows of the mesa's body
const TOP = BODY - 1; // the roof's top row
const DEEP = 7; // the main core's row: this many rows of armor under it
// Wide and thick: the gun wall dug 10 plates to the core in 100 s through a 15 wide tower, so a slanting line to
// the core now meets 17 or more.
const TIER = { half: 24, rows: 6 }; // the wide tier over the core
// The tower is thicker toward the enemy (+x as authored; the right titan is flipped, so that side always faces the
// other titan): 24 plates in front of the core's column, 10 behind. The gun wall still got through 18 at 220 s.
const TOWER = { back: 10, front: 24, rows: 14 }; // the tower on the tier
const BAYS_PER_BANK = 10;
const WELL = 9; // armor column height beside a dart bay (the bay is 6 tall): 3 over its top, so a shell slanting in under 45 degrees meets armor, not the bay
const TURRETS = [-6, -1, 4, 9, 14, 19]; // columns from the middle, on the tower's top
const JAM = [-13, -18]; // jammer bays at these columns from the middle: on the tier, behind the tower
const ANCHOR_EVERY = 5; // one anchor in the floor every this many columns
const H = BODY + TIER.rows + TOWER.rows + 2;

const g = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
const put = (x, y, t) => {
  if (g[y][x] !== '.') throw new Error(`cell ${x},${y} taken by ${g[y][x]} (placing ${t})`);
  g[y][x] = t;
};
const legend = {
  jl: { part: 'fabbay', tags: ['jl'], makes: 'pod', size: [1, 1] },
  jr: { part: 'fabbay', tags: ['jr'], makes: 'pod', size: [1, 1] },
};

// The mesa's body: armor, with batteries in rows 1 to 3 under the two banks of bays.
const underBank = (x) => (x >= 4 && x <= 48) || (x >= W - 49 && x <= W - 5);
for (let x = 0; x < W; x++) {
  for (let y = 0; y < BODY; y++) {
    if (x === MID && y === DEEP) put(x, y, 'C');
    else put(x, y, y >= 1 && y <= 3 && underBank(x) ? 'Z' : 'A');
  }
}
// Anchors: grapples in row 1, pointing down through a gap in the floor. The pilot casts them at the ground, and
// each rope (it holds 30 kN) keeps the mesa where it stands when something pushes it toward the arena's edge.
let anchors = 0;
for (let x = ANCHOR_EVERY * 2; x <= W - 1 - ANCHOR_EVERY * 2; x += ANCHOR_EVERY) {
  if (Math.abs(x - MID) < 2) continue;
  anchors++;
  legend[`a${anchors}`] = { part: 'grapple', rot: 180, auto: false, tags: ['anchor', `an${anchors}`] };
  g[1][x] = `a${anchors}`;
  g[0][x] = '.';
}
// The tier and the tower over the core.
for (let y = BODY; y < BODY + TIER.rows; y++) for (let x = MID - TIER.half; x <= MID + TIER.half; x++) put(x, y, 'A');
const towerTop = BODY + TIER.rows + TOWER.rows - 1;
for (let y = BODY + TIER.rows; y <= towerTop; y++) for (let x = MID - TOWER.back; x <= MID + TOWER.front; x++) put(x, y, 'A');
// Turrets on the tower's top: a rotator carrying a gun, pointing up, 3 columns apart.
TURRETS.forEach((dx, i) => {
  const n = `t${i + 1}`;
  legend[`r${i + 1}`] = { part: 'rotator', rot: 0, auto: false, tags: [`${n}.rot`] };
  legend[`m${i + 1}`] = { part: 'gun', rot: 0, tags: [`${n}.gun`] };
  put(MID + dx, towerTop + 1, `r${i + 1}`);
  put(MID + dx, towerTop + 2, `m${i + 1}`);
});

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
    legend[token] = { part: 'fabbay', tags: [token], makes: 'dart' };
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
// The jammer bays, on the tier behind the tower (it shields them from the front), within 30 m of the core.
bay(MID + JAM[0], BODY + TIER.rows, 'jl', 1, 1);
bay(MID + JAM[1], BODY + TIER.rows, 'jr', 1, 1);

// Recipes: the dart is the stock missile-up with its guide under our name; the pod is one jammer.
const dart = JSON.parse(fs.readFileSync(bp('missile-up.json'), 'utf8'));
dart.name = 'dart';
delete dart.bindings;
dart.scripts = [{ id: 'guide', params: { ...dart.scripts[0].params, fuse: 14 }, source: { file: 'titan-bastion.dart.guide.js' } }];
// The guide: the stock one, except that the robot the base named is followed whatever it weighs (the other
// titan's main robot may be a small pod, lighter than `minMass`).
let guide = fs.readFileSync(bp('missile-up.guide.js'), 'utf8');
const from = "    if (c.side !== 'enemy' || !c.core || c.mass < minMass) continue;\n    if (state.id !== undefined && c.id === state.id) return c;";
const to = "    if (c.side !== 'enemy' || !c.core) continue;\n    if (state.id !== undefined && c.id === state.id) return c; // titan-bastion: the named robot, whatever it weighs\n    if (c.mass < minMass) continue;";
if (!guide.includes(from)) throw new Error('missile-up.guide.js changed: the pick() lines to patch were not found');
guide = guide.replace(from, to);
fs.writeFileSync(bp('titan-bastion.dart.guide.js'), guide);

const out = {
  format: 1,
  name: 'titan-bastion',
  autoControls: false,
  grid: g
    .slice()
    .reverse()
    .map((r) => r.join(' ')),
  legend,
  scripts: [{ id: 'pilot', params: { anchors }, source: { file: 'titan-bastion.pilot.js' } }],
  recipes: {
    dart,
    pod: { format: 1, name: 'pod', autoControls: false, grid: ['J'] },
  },
};
fs.writeFileSync(bp('titan-bastion.json'), JSON.stringify(out, null, 1) + '\n');
const count = g.flat().filter((t) => t !== '.' && t !== '=').length;
console.log(`titan-bastion: ${anchors} anchors, ${count} parts, ${W} wide, ${H} tall; main core at cell (${MID}, ${DEEP}): spawn height ${DEEP + 0.55}`);
