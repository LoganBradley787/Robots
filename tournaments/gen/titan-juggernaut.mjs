// Makes blueprints/titan-juggernaut.json: an armored sled on wheels, pushed by two banks of boosters, with a mast
// as tall as the arena's ceiling. It rams, pushes what is on the ground out of the arena, and sweeps the air.
// Run: node tournaments/gen/titan-juggernaut.mjs   (the pilot, blueprints/titan-juggernaut.pilot.js, is written by hand)
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = Number(process.env.JUG_W ?? 130); // hull width, cells. The tail is x 0, the nose x W - 1 (it faces right as built).
const H = Number(process.env.JUG_H ?? 26); // hull height, rows 1..H (row 0 is the wheels)
const SHELF = 14; // a gun shelf hanging off the tail at roof height, so the guns reach the corner behind it
const MAST = Number(process.env.JUG_MAST ?? 80); // cells of armored mast over the roof, up to the gun deck
const MAST_X = [114, 115, 116, 117, 118, 119]; // the armored mast, six wide so a few blasts do not cut it
const DECK = { x0: 104, x1: 135 }; // the gun deck, two plates thick: its sights look 150 m higher than the roof's
const SPAR_X = [115, 116, 117, 118]; // the frame spar above the deck
const SPAR_TOP = Number(process.env.JUG_TOP ?? 251); // its top row: the arena's ceiling for a main core is 250 m
const WHEEL_FROM = 8, WHEEL_STEP = 6; // wheels start well inside the ends, out of reach of a blast beside the hull
// Soft parts sit in the tail, behind the core: guided copies come in from the other side and tunnel in level from
// the nose, so the nose is 79 plates of solid armor (W - 1 - CORE.x), with nothing soft in it. A crash only breaks
// what is within 6 m of the contact, so the core also sits 7 m over the belly, which touches things too.
const WING = { x0: 6, x1: 27 }; // both booster banks: a sled that cannot brake slides out of the arena
const FWD_Y = { y0: 2, y1: 13 }; // low: pushes toward the nose
const REV_Y = { y0: 14, y1: 25 }; // high: pushes toward the tail
const CELLS = { x0: 28, x1: 39, y0: 2, y1: 25 }; // dense batteries
const CORE = { x: 50, y: 8 };
const RADARS = [{ x: 49, y: 8 }, { x: 51, y: 10 }];
// Standing back from a roped base, the copies come down on the roof over the core instead: a hump of extra plates.
const HUMP = { x0: 40, x1: 59, h: Number(process.env.JUG_HUMP ?? 24) };
const BIN = 4; // guns per fire group

const legend = {
  k: { part: 'booster', rot: 270, tags: ['fwd'], auto: false },
  j: { part: 'booster', rot: 90, tags: ['rev'], auto: false },
};
const OX = SHELF; // grid column of hull x 0
const GW = OX + Math.max(W, DECK.x1 + 1);
const rows = []; // rows[y][x + OX], y 0 at the bottom
for (let y = 0; y <= SPAR_TOP; y++) rows.push(new Array(GW).fill('.'));
const put = (x, y, t) => {
  rows[y][x + OX] = t;
};
for (let x = WHEEL_FROM; x <= W - 1 - WHEEL_FROM; x += WHEEL_STEP) put(x, 0, 'W');
let boosters = 0;
for (let y = 1; y <= H; y++) {
  for (let x = 0; x < W; x++) {
    let t = 'A';
    const wing = x >= WING.x0 && x <= WING.x1;
    if (wing && y >= FWD_Y.y0 && y <= FWD_Y.y1) {
      t = 'k';
      boosters++;
    } else if (wing && y >= REV_Y.y0 && y <= REV_Y.y1) t = 'j';
    else if (x >= CELLS.x0 && x <= CELLS.x1 && y >= CELLS.y0 && y <= CELLS.y1) t = 'Z';
    if (x === CORE.x && y === CORE.y) t = 'C';
    if (RADARS.some((r) => r.x === x && r.y === y)) t = 'O';
    put(x, y, t);
  }
}
let bins = 0;
function gun(x, y) {
  const b = Math.floor((x + OX) / BIN);
  const token = 'm' + String.fromCharCode(97 + Math.floor(b / 26)) + String.fromCharCode(97 + (b % 26));
  legend[token] = { part: 'gun', rot: 0, tags: ['roof', 'bin' + b], auto: false };
  put(x, y, token);
  bins = Math.max(bins, b + 1);
}
for (let x = -SHELF; x < 0; x++) {
  put(x, H - 1, 'A');
  put(x, H, 'A');
  gun(x, H + 1);
}
for (const x of MAST_X) for (let y = H + 1; y < H + MAST - 1; y++) put(x, y, 'A');
for (let x = DECK.x0; x <= DECK.x1; x++) {
  put(x, H + MAST - 1, 'A');
  put(x, H + MAST, 'A');
  if (!SPAR_X.includes(x)) gun(x, H + MAST + 1);
}
for (const x of SPAR_X) for (let y = H + MAST + 1; y <= SPAR_TOP; y++) put(x, y, 'F');
for (let x = 0; x < Math.min(W, DECK.x0); x++) {
  // nothing fires up into the deck
  const hump = x >= HUMP.x0 && x <= HUMP.x1 ? HUMP.h : 0;
  for (let y = H + 1; y <= H + hump; y++) put(x, y, 'A');
  gun(x, H + hump + 1);
}

const width = Math.max(...Object.keys(legend).map((k) => k.length), 2);
const grid = rows.map((r) => r.map((t) => t.padEnd(width)).join(' ').trimEnd()).reverse();
const mid = (a) => (a[0] + a[a.length - 1]) / 2;

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
        roof: H + 1.5 - CORE.y, // core to the roof guns' muzzles
        deckTop: H + MAST + 1.5 - CORE.y, // core to the deck guns' muzzles
        reach: SPAR_TOP + 0.5 - CORE.y, // core to the spar's top
        deck: (DECK.x0 + DECK.x1) / 2 - CORE.x, // core to the deck's middle, along the hull
        mast: mid(MAST_X) - CORE.x, // core to the mast, along the hull
        bins,
      },
      source: { file: 'titan-juggernaut.pilot.js' },
    },
  ],
};
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../blueprints/titan-juggernaut.json');
writeFileSync(out, JSON.stringify(blueprint, null, 1) + '\n');
console.log(`wrote ${out}: ${W} by ${H} hull, ${boosters} boosters a bank, ${bins} gun groups, core at (${CORE.x}, ${CORE.y}), spar to row ${SPAR_TOP}`);
