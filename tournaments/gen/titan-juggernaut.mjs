// Makes blueprints/titan-juggernaut.json: an armored sled on wheels, pushed by two banks of boosters, that rams.
// Run: node tournaments/gen/titan-juggernaut.mjs   (the pilot, blueprints/titan-juggernaut.pilot.js, is written by hand)
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = Number(process.env.JUG_W ?? 120); // hull width, cells. The tail is x 0, the nose x W - 1 (it faces right as built).
const H = Number(process.env.JUG_H ?? 28); // hull height, rows 1..H (row 0 is the wheels)
const MAST = Number(process.env.JUG_MAST ?? 80); // cells of mast over the roof
const MAST_X = [106, 107, 108, 109, 110, 111]; // mast columns, near the nose: six wide, so a few blasts do not cut it
const DECK = { x0: 92, x1: 125 }; // a gun deck two plates thick on the mast's top: its sights look 150 m higher than the roof's
const WHEEL_FROM = 8, WHEEL_STEP = 4; // wheels start well inside the ends, out of reach of a blast beside the hull
const BANK = { x0: 6, w: 12, h: 12 }; // each booster bank: 12 by 12, the forward bank under the reverse one
const CELLS = { x0: 18, x1: 47, y0: 2, y1: 11 }; // dense batteries, with the core and radars inside
const CORE = { x: 28, y: 6 };
const RADARS = [{ x: 29, y: 6 }, { x: 40, y: 8 }];
const BIN = 4; // roof guns per fire group

const legend = {
  k: { part: 'booster', rot: 270, tags: ['fwd'], auto: false },
  j: { part: 'booster', rot: 90, tags: ['rev'], auto: false },
};
const rows = []; // rows[y][x], y 0 at the bottom
const GW = Math.max(W, DECK.x1 + 1); // grid width
const top = H + MAST + 2;
for (let y = 0; y < top; y++) rows.push(new Array(GW).fill('.'));
for (let x = WHEEL_FROM; x <= W - 1 - WHEEL_FROM; x += WHEEL_STEP) rows[0][x] = 'W';
for (let y = 1; y <= H; y++) {
  for (let x = 0; x < W; x++) {
    let t = 'A';
    if (x >= BANK.x0 && x < BANK.x0 + BANK.w && y >= 2 && y < 2 + BANK.h) t = 'k';
    else if (x >= BANK.x0 && x < BANK.x0 + BANK.w && y >= 2 + BANK.h && y < 2 + 2 * BANK.h) t = 'j';
    else if (x >= CELLS.x0 && x <= CELLS.x1 && y >= CELLS.y0 && y <= CELLS.y1) t = 'Z';
    if (x === CORE.x && y === CORE.y) t = 'C';
    if (RADARS.some((r) => r.x === x && r.y === y)) t = 'O';
    rows[y][x] = t;
  }
}
let bins = 0;
function gun(x, y) {
  const b = Math.floor(x / BIN);
  const token = 'm' + String.fromCharCode(97 + Math.floor(b / 26)) + String.fromCharCode(97 + (b % 26));
  legend[token] = { part: 'gun', rot: 0, tags: ['roof', 'bin' + b], auto: false };
  rows[y][x] = token;
  bins = Math.max(bins, b + 1);
}
for (const x of MAST_X) for (let y = H + 1; y < H + MAST - 1; y++) rows[y][x] = 'A';
for (let x = DECK.x0; x <= DECK.x1; x++) {
  rows[H + MAST - 1][x] = 'A';
  rows[H + MAST][x] = 'A';
  gun(x, H + MAST + 1);
}
for (let x = 0; x < Math.min(W, DECK.x0); x++) gun(x, H + 1); // nothing fires up into the deck
const width = Math.max(...Object.keys(legend).map((k) => k.length), 2);
const grid = rows.map((r) => r.map((t) => t.padEnd(width)).join(' ').trimEnd()).reverse();

const boosters = BANK.w * BANK.h;
const blueprint = {
  format: 1,
  name: 'titan-juggernaut',
  grid,
  legend,
  scripts: [
    {
      id: 'pilot',
      params: {
        front: W - 1 - CORE.x + 0.5, // core to the nose's face, m
        back: CORE.x + 0.5, // core to the tail's face
        roof: H + 1.5 - CORE.y, // core to the gun muzzles
        reach: H + MAST + 1.5 - CORE.y, // core to the deck's top
        deck: (DECK.x0 + DECK.x1) / 2 - CORE.x, // core to the deck's middle, along the hull
        push: boosters * 400, // one bank's full push, N
        bins,
      },
      source: { file: 'titan-juggernaut.pilot.js' },
    },
  ],
};
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../blueprints/titan-juggernaut.json');
writeFileSync(out, JSON.stringify(blueprint, null, 1) + '\n');
console.log(`wrote ${out}: ${W} by ${H} hull, ${boosters} boosters a bank, ${bins} gun groups, core at (${CORE.x}, ${CORE.y})`);
