// titan-anvil: a solid flying brick of heavy armor plates that only rams.
// Run from the repo root: node tournaments/gen/titan-anvil.mjs [width] [height]
// Writes blueprints/titan-anvil.json (the pilot script blueprints/titan-anvil.pilot.js is written by hand).
//
// Round 2: a crash now only hurts what is within about 6 m of the contact, so every face is six plates deep (a hard
// hit costs skin, never the boosters behind it), an armor band runs through the core's rows from wall to wall (darts
// dug along that row in round 1), and it carries enough dense batteries to stay in the air a whole match.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const W = Number(process.argv[2]) || 64; // brick width in cells (guns stand one cell outside it)
const H = Number(process.argv[3]) || 42; // brick height
const SKIN = 6; // armor layers on the sides and the roof
const FLOOR = 4; // armor layers under the lift boosters (the floor never rams)
const LIFT_ROWS = 7; // rows of lift boosters above the floor
const PUSH_COLS = 8; // columns of push boosters inside each side wall
const CELL_ROWS = 20; // rows of dense batteries
const BAND = 1; // armor rows above and below the core's row
const JAMMERS = 56; // jammer pods (5 s each)

const MASS = { A: 5, F: 1, J: 0.5, l: 1.5, r: 1.5, p: 1.5, q: 1.5, Z: 3, C: 2, O: 1 };
const g = [];
for (let y = 0; y < H; y++) g.push(new Array(W).fill('A'));
// Inside the skin everything starts as light frames.
for (let y = FLOOR; y < H - SKIN; y++) for (let x = SKIN; x < W - SKIN; x++) g[y][x] = 'F';

// Lift boosters (left half l, right half r) with an armor rib every 8 columns so the floor stays tied on.
const liftLo = FLOOR;
const liftHi = FLOOR + LIFT_ROWS - 1;
for (let y = liftLo; y <= liftHi; y++) {
  for (let x = SKIN; x < W - SKIN; x++) {
    const fromMid = x < W / 2 ? W / 2 - 1 - x : x - W / 2;
    g[y][x] = fromMid % 8 === 7 ? 'A' : x < W / 2 ? 'l' : 'r';
  }
}
// The block above the lift rows: dense batteries, with the core in its middle row inside an armor band.
const blockLo = liftHi + 1;
const blockHi = blockLo + CELL_ROWS + 2 * BAND; // CELL_ROWS battery rows plus the band's rows
const coreRow = Math.round((blockLo + blockHi) / 2);
const inner = SKIN + PUSH_COLS + 1;
for (let y = blockLo; y <= blockHi; y++) {
  const band = Math.abs(y - coreRow) <= BAND;
  for (let x = SKIN; x < W - SKIN; x++) {
    if (band) g[y][x] = 'A';
    else if (x >= inner && x < W - inner) g[y][x] = 'Z';
  }
}
const cx = W / 2;
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
// Push boosters: p on the left pushing right, q on the right pushing left, beside the battery block on every row
// but the armor band. The block is centered near the center of mass row, so a hard push hardly turns the brick
// (the pilot cancels the rest).
for (let y = blockLo; y <= blockHi; y++) {
  if (Math.abs(y - coreRow) <= BAND) continue;
  for (let i = 0; i < PUSH_COLS; i++) {
    g[y][SKIN + i] = 'p';
    g[y][W - 1 - SKIN - i] = 'q';
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
