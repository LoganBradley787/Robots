// titan-anvil: a solid flying brick of heavy armor plates that only rams.
// Run from the repo root: node tournaments/gen/titan-anvil.mjs [width] [height]
// Writes blueprints/titan-anvil.json (the pilot script blueprints/titan-anvil.pilot.js is written by hand).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const W = Number(process.argv[2]) || 60; // brick width in cells (guns stand one cell outside it)
const H = Number(process.argv[3]) || 36; // brick height
const LIFT_ROWS = Math.max(3, Math.round(H / 6)); // rows of lift boosters above the double floor
const CELL_ROWS = Math.max(3, Math.round(H / 5) + 3); // rows of dense batteries above the lift rows
const PUSH_COLS = 6; // columns of push boosters inside each side wall
const SKIN = 2; // armor layers on every face

const MASS = { A: 5, l: 1.5, r: 1.5, p: 1.5, q: 1.5, Z: 3, C: 2, O: 1 };
const g = [];
for (let y = 0; y < H; y++) g.push(new Array(W).fill('A'));

// Lift boosters (left half l, right half r) with an armor rib every 8 columns so the floor stays tied on.
const liftLo = SKIN;
const liftHi = SKIN + LIFT_ROWS - 1;
for (let y = liftLo; y <= liftHi; y++) {
  for (let x = SKIN; x < W - SKIN; x++) {
    const fromMid = x < W / 2 ? W / 2 - 1 - x : x - W / 2;
    if (fromMid % 8 === 7) continue; // rib
    g[y][x] = x < W / 2 ? 'l' : 'r';
  }
}
// Dense batteries in the middle, clear of the push columns.
const cellLo = liftHi + 1;
const cellHi = cellLo + CELL_ROWS - 1;
const inner = SKIN + PUSH_COLS + 2;
for (let y = cellLo; y <= cellHi; y++) for (let x = inner; x < W - inner; x++) g[y][x] = 'Z';

const com = () => {
  let m = 0;
  let sy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = MASS[g[y][x]]; m += k; sy += k * y; }
  return { m, y: sy / m };
};
// Push boosters: p on the left pushing right, q on the right pushing left, centered on the center of mass row
// so a hard push does not turn the brick. An armor rib every 6th row ties the side walls on.
const mid = Math.round(com().y);
const pushHalf = Math.min(Math.floor(H / 4), mid - cellLo, H - SKIN - 1 - mid);
for (let y = mid - pushHalf; y <= mid + pushHalf; y++) {
  if ((y - mid + 60) % 6 === 3) continue; // rib
  for (let i = 0; i < PUSH_COLS; i++) {
    g[y][SKIN + i] = 'p';
    g[y][W - 1 - SKIN - i] = 'q';
  }
}
// Core in the very middle at the center of mass row, a radar on each side of it.
const cx = W / 2;
const coreRow = Math.max(cellHi + 2, mid);
g[coreRow][cx] = 'C';
g[coreRow][cx - 1] = 'O';
g[coreRow][cx + 1] = 'O';

// Guns stand one cell outside the skin: every second row on the sides, every third column on the top and the floor.
// They blast what they see and their sights find robots the radar cannot.
const rows = [];
const top = ['.'];
const bottom = ['.'];
for (let x = 0; x < W; x++) {
  top.push(x % 3 === 1 ? 'M^' : '.');
  bottom.push(x % 3 === 1 ? 'Mv' : '.');
}
top.push('.');
bottom.push('.');
rows.push(top);
for (let y = H - 1; y >= 0; y--) rows.push([y % 2 === 1 ? 'M<' : '.', ...g[y], y % 2 === 1 ? 'M>' : '.']);
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
console.log(`titan-anvil: ${W} by ${H}, about ${Math.round(c.m)} kg without guns, center of mass row ${c.y.toFixed(2)}, core row ${coreRow}`);
