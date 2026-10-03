// titan-anvil: a solid flying brick of heavy armor plates that only rams.
// Run from the repo root: node tournaments/gen/titan-anvil.mjs [width] [height]
// Writes blueprints/titan-anvil.json (the pilot script blueprints/titan-anvil.pilot.js is written by hand).
//
// Round 3 (2026-10-02): the heavy armor plate went from 5 kg to 20 kg, so the old brick (1215 plates, six deep on
// every face, 27.6 t at the new weight) could not leave the ground. Now armor is only where it earns its lift:
// two plates deep on the two side faces that ram, one on the roof (it rams upward, slower) and one on the floor
// (ground guns blast up at it), and a small box round the core: 336 plates, 6.7 t of a 12 t brick. Behind each
// face light frames fill out the 6 m a crash reaches, so a hit costs skin and frames, never the boosters or
// batteries. Frames stop a crash's reach but not shells or blasts (a quarter of a plate's health, five times a
// plate's damage from a shell): the brick is honestly much thinner skinned than it was.
// The rest is what 12 t in the air costs: 432 lift boosters (push to weight 1.46), 300 push boosters, and 1111
// dense batteries (hovering alone draws 17.7 kJ a second, 4.2 MJ over a 240 s match, of 6.7 MJ).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const W = Number(process.argv[2]) || 72; // brick width in cells (guns stand one cell outside it)
const H = Number(process.argv[3]) || 41; // brick height
const opt = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 ? Number(process.argv[i + 1]) : d; };
const SIDE_A = opt('side', 2); // armor plates on each side face (the faces that ram)
const ROOF_A = opt('roof', 1); // armor plates on the roof (it rams upward, slower)
const FLOOR_A = opt('floor', 1); // armor plates under the lift boosters (ground guns blast up at it)
const PAD = 6; // cells from a ramming face to the first booster or battery: a crash hurts nothing deeper than that
const LIFT_ROWS = opt('lift', 8); // rows of lift boosters above the floor
const PUSH_COLS = opt('push', 6); // columns of push boosters inside each side wall
const CELL_ROWS = opt('cells', 22); // rows of dense batteries
const BAND = 1; // armor rows above and below the core's row
const BOX = opt('box', 6); // armor columns each side of the core in those rows
const JAMMERS = 56; // jammer pods (5 s each)

const MASS = { A: 20, F: 1, J: 0.5, l: 1.5, r: 1.5, p: 1.5, q: 1.5, Z: 3, C: 2, O: 1 };
const g = [];
// Light frames everywhere, then the armor: the outside of each side face, the roof, and the floor.
for (let y = 0; y < H; y++) g.push(new Array(W).fill('F'));
for (let y = 0; y < H; y++) for (let i = 0; i < SIDE_A; i++) { g[y][i] = 'A'; g[y][W - 1 - i] = 'A'; }
for (let x = 0; x < W; x++) {
  for (let i = 0; i < ROOF_A; i++) g[H - 1 - i][x] = 'A';
  for (let i = 0; i < FLOOR_A; i++) g[i][x] = 'A';
}

// Lift boosters (left half l, right half r) with a frame rib every 8 columns so the floor stays tied on.
const liftLo = FLOOR_A;
const liftHi = FLOOR_A + LIFT_ROWS - 1;
for (let y = liftLo; y <= liftHi; y++) {
  for (let x = PAD; x < W - PAD; x++) {
    const fromMid = x < W / 2 ? W / 2 - 1 - x : x - W / 2;
    g[y][x] = fromMid % 8 === 7 ? 'F' : x < W / 2 ? 'l' : 'r';
  }
}
// The block above the lift rows: dense batteries, with the core in its middle row inside an armor box.
const blockLo = liftHi + 1;
const blockHi = blockLo + CELL_ROWS + 2 * BAND; // CELL_ROWS battery rows plus the band's rows
const coreRow = Math.round((blockLo + blockHi) / 2);
const inner = PAD + PUSH_COLS + 1;
const cx = W / 2;
for (let y = blockLo; y <= blockHi; y++) {
  const band = Math.abs(y - coreRow) <= BAND;
  for (let x = inner; x < W - inner; x++) {
    if (band && Math.abs(x - cx) <= BOX) g[y][x] = 'A';
    else g[y][x] = 'Z';
  }
}
g[coreRow][cx] = 'C';
g[coreRow][cx - 1] = 'O';
g[coreRow][cx + 1] = 'O';

// Jammer pods in the frame row over the battery block, within 30 m of the core: lit one after another they hide
// the brick from every sensor while it waits out an enemy it cannot break.
for (let i = 0; i < JAMMERS; i++) g[blockHi + 1][cx - Math.floor(JAMMERS / 2) + i] = 'J';

const com = () => {
  let m = 0;
  let sy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = MASS[g[y][x]]; m += k; sy += k * y; }
  return { m, y: sy / m };
};
// Push boosters: p on the left pushing right, q on the right pushing left, beside the battery block on every row.
// The block is centered near the center of mass row, so a hard push hardly turns the brick (the pilot cancels
// the rest).
for (let y = blockLo; y <= blockHi; y++) {
  for (let i = 0; i < PUSH_COLS; i++) {
    g[y][PAD + i] = 'p';
    g[y][W - 1 - PAD - i] = 'q';
  }
}

// Guns stand one cell outside the skin: every row on the sides, every second column on the roof, every third on
// the floor. They blast what they see, and their sights find robots the radar cannot.
const rows = [];
const top = ['.'];
const bottom = ['.'];
for (let x = 0; x < W; x++) {
  top.push(x % 2 === 0 ? 'M^' : '.');
  bottom.push(x % 3 === 1 ? 'Mv' : '.');
}
top.push('.');
bottom.push('.');
rows.push(top);
for (let y = H - 1; y >= 0; y--) rows.push(['M<', ...g[y], 'M>']);
rows.push(bottom);
const wide = (t) => t.padEnd(3, ' ');
const grid = rows.map((r) => r.map(wide).join('').trimEnd());

const blueprint = {
  format: 1,
  name: 'titan-anvil',
  grid,
  legend: {
    l: { part: 'booster', rot: 0, tags: ['la'], auto: false },
    r: { part: 'booster', rot: 0, tags: ['lb'], auto: false },
    p: { part: 'booster', rot: 270, tags: ['pa'], auto: false },
    q: { part: 'booster', rot: 90, tags: ['pb'], auto: false },
  },
  autoControls: false,
  scripts: [{ id: 'pilot', source: { file: 'titan-anvil.pilot.js' } }],
};
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', '..', 'blueprints', 'titan-anvil.json');
fs.writeFileSync(out, JSON.stringify(blueprint, null, 1) + '\n');
const c = com();
const count = {};
for (const r of g) for (const t of r) count[t] = (count[t] || 0) + 1;
console.log(`titan-anvil: ${W} by ${H}, about ${Math.round(c.m)} kg without guns, center of mass row ${c.y.toFixed(2)}, core row ${coreRow}`, JSON.stringify(count));
