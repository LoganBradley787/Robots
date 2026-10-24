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
// - Burners (round 5): three on each side between the rack and the keep, and two burner bays on each end inside the
//   dart bays. A burner is a small flier with a laser on a rotator under it (titan-woodpecker.burner.js): it hovers
//   off the target and burns a tunnel to its core. The keep's plates are tagged `keep` for the brain's parts list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bp = (f) => path.join(root, 'blueprints', f);
const NAME = 'titan-woodpecker';

const PAIRS = Number(process.argv[2] ?? 10); // dart pairs on each side of the middle (24 in round 1: half the volley keeps the tick time under the rule; 10 since round 5, two pairs gave their room to burners)
// Burners (titans round 5, 2026-10) on each side, between the rack and the keep: a flier with a laser on a rotator
// under it, which hovers off the target and burns a tunnel to its core (see titan-woodpecker.burner.js).
const BURN = Number(process.argv[5] ?? 3); // burners on the rack on each side
const BAYS = Number(process.argv[3] ?? 3); // dart bays on each end (8 in round 1: fewer darts in the air at once keeps the tick time down; 5 until round 5)
// Burner bays (titans round 5, 2026-10) on each end, inside the dart bays: each builds a burner (2 wide, 9 tall) out of
// the base's energy, about one every 50 s (its batteries are most of what a build pays for).
const CBAYS = Number(process.argv[6] ?? 2);
const BAYCOLS = BAYS * 3 + CBAYS * 4;
const DART = ['booster', 'heavygyro', 'radio', 'cell', 'core', 'heavywarhead', 'heavywarhead']; // bottom to top
const DH = DART.length;
// A bay's dart (titans v2, 2026-10) has a seeker on its nose: within 150 m it sees through a jammer's bubble, so the
// darts that come later in the fight find a hidden core themselves. The rack's darts go in the first seconds, at what
// the keep's radar sees, and have none (the parts are spent on flares instead).
const BAY_DART = [...DART, 'seeker'];
const BAY_H = BAY_DART.length;
// The keep (titans v2, 2026-10): 19 wide and 13 tall with the main core on the ground row: nine plates to each side
// and twelve over it, none under it. It was 15 wide with four plates under the core, where nothing can come from (the
// ground), and darts came in from the side at the core's height through seven; and a dart aimed low at a core on the
// ground meets the ground first.
const MID_HALF = 9;
const CORE_Y = 0;
const ANCHOR_EVERY = 8; // one anchor in the floor every this many columns
const END = 2; // columns of base beyond the bays: the flare columns stand on them
const W = 2 * (END + BAYCOLS + PAIRS * 5 + BURN * 4) + 2 * MID_HALF + 1;
const CX = (W - 1) / 2;
const ROOF = 2;
const H = ROOF + 1 + BAY_H + 1;

const KEEP_H = 13; // twelve plates over the main core
const FLARE_TOP = Number(process.argv[4] ?? 26); // the end columns of flares reach up to this row (titans v2)
const g = Array.from({ length: Math.max(KEEP_H, FLARE_TOP) }, () => Array.from({ length: W }, () => '.'));
const put = (x, y, t) => {
  if (g[y][x] !== '.') throw new Error(`cell ${x},${y} taken by ${g[y][x]} (placing ${t})`);
  g[y][x] = t;
};
// The keep's plates carry a tag (titans round 5): the brain's parts list names it, so its frame carries the keep it
// counts for hurt, not the base's floor.
const legend = { K: { part: 'armorplate', tags: ['keep'] } };
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
      else if (y === CORE_Y && (x === CX - 2 || x === CX + 2 || x === CX + 3)) put(x, y, 'Z');
      else put(x, y, 'K');
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
// The burner bays: a hollow 2 wide and 9 tall, walls at x0 and x0 + 3. Tags `c<n>x`.
const BURNER_H = 9;
let cbay = 0;
const addBurnerBay = (x0) => {
  cbay++;
  const t = `w${cbay}`;
  legend[t] = { part: 'fabbay', tags: [`c${cbay}x`], makes: 'burner', size: [2, BURNER_H] };
  put(x0 + 1, ROOF + 1, t);
  put(x0 + 2, ROOF + 1, '=');
  put(x0, ROOF + 1, '=');
  put(x0 + 3, ROOF + 1, '=');
  for (let y = ROOF + 2; y <= ROOF + 1 + BURNER_H; y++) {
    put(x0, y, '=');
    put(x0 + 3, y, '=');
  }
};
for (let j = 0; j < CBAYS; j++) {
  addBurnerBay(END + BAYS * 3 + j * 4);
  addBurnerBay(W - END - BAYS * 3 - (j + 1) * 4);
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
  for (const x0 of [END + BAYCOLS + i * 5, CX + MID_HALF + 1 + BURN * 4 + i * 5]) {
    addDart(x0 + 1, x0);
    addDart(x0 + 3, x0 + 4);
  }
}

// The burners (titans round 5, 2026-10), two columns each, nearest the keep. The main column, bottom to top: booster,
// dense battery, heavy gyro, two dense batteries, core, radio; it stands two rows over the roof. Beside it: a rotator
// mounted on the booster's side, and the laser pointing down from it (its lower cell sits on the roof and touches
// nothing), so only the laser turns with it and swings under the main column without meeting it (hung beside the gyro,
// a beam aimed back under the burner ran into its own booster); and a second booster over the rotator (it has no face
// down, so it holds on by its side to the battery beside it and never touches the rotator): twice the push. 18 kJ:
// some 7 s of beam. Grip `ug<n>` holds burner `u<n>` by its booster's outer side, on a post of two frames.
const burnerScript = { id: 'burner', source: fs.readFileSync(bp(`${NAME}.burner.js`), 'utf8') };
const BURNER = ['booster', 'densebattery', 'heavygyro', 'densebattery', 'densebattery', 'core', 'radio'];
const BURN_UP = 2; // rows between the roof and the main column
let burners = 0;
const addBurner = (x0, flip) => {
  burners++;
  const n = burners;
  // Left of the keep: grip, main column, laser column, gap. Right of it the same mirrored.
  const gx = flip ? x0 + 3 : x0;
  const mx = flip ? x0 + 2 : x0 + 1;
  const lx = flip ? x0 + 1 : x0 + 2;
  const y0 = ROOF + 1 + BURN_UP;
  for (let y = ROOF + 1; y < y0; y++) put(gx, y, 'F');
  legend[`ug${n}`] = { part: 'decoupler', rot: gx < mx ? 270 : 90, tags: [`ug${n}`] };
  put(gx, y0, `ug${n}`);
  BURNER.forEach((part, i) => {
    const t = `u${i}_${n}`;
    legend[t] = { part, rot: 0, tags: [`u${n}`], ...(part === 'booster' || part === 'heavygyro' ? { auto: false } : {}) };
    put(mx, y0 + i, t);
    if (part === 'core') cores[`core@${mx},${y0 + i}`] = { scope: `u${n}`, autoControls: false, bindings: [], scripts: [burnerScript] };
  });
  // The rotator mounts on its S face: turned so that face meets the booster beside it.
  legend[`ur${n}`] = { part: 'rotator', rot: lx > mx ? 270 : 90, tags: [`u${n}`], auto: false };
  put(lx, y0, `ur${n}`);
  legend[`uk${n}`] = { part: 'booster', rot: 0, tags: [`u${n}`], auto: false };
  put(lx, y0 + 1, `uk${n}`);
  legend[`ul${n}`] = { part: 'laser', rot: 180, tags: [`u${n}`], auto: false };
  put(lx, y0 - 1, `ul${n}`);
  put(lx, y0 - 2, '=');
};
for (let j = 0; j < BURN; j++) {
  addBurner(END + BAYCOLS + PAIRS * 5 + j * 4, false);
  addBurner(CX + MID_HALF + 1 + j * 4, true);
}

// The burner a burner bay builds: the rack's burner, the main column on the left (held by the bay's left wall).
const burnerBlueprint = (file) => ({
  format: 1,
  name: `${NAME}-burner`,
  autoControls: false,
  grid: ['n .', 'c .', 'z .', 'z .', 'y .', 'z k', 'k r', '. l', '. ='],
  legend: {
    n: { part: 'radio' },
    c: { part: 'core' },
    z: { part: 'densebattery' },
    y: { part: 'heavygyro', auto: false },
    k: { part: 'booster', rot: 0, auto: false },
    r: { part: 'rotator', rot: 270, auto: false },
    l: { part: 'laser', rot: 180, auto: false },
  },
  scripts: [{ id: 'burner', source: { file } }],
});

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
  // The brain's parts list (titans round 5): only what it reads (grips, flares, bays, anchors, the keep), so its frame
  // is a third of the robot.
  scripts: [{ id: 'brain', parts: ['decoupler', 'flare', 'fabbay', 'grapple', 'keep'], source: { file: `${NAME}.brain.js` }, params: { anchors } }],
  cores,
  recipes: { dart: dartBlueprint(`${NAME}.dart.guide.js`), burner: burnerBlueprint(`${NAME}.burner.js`) },
};
fs.writeFileSync(bp(`${NAME}.json`), JSON.stringify(blueprint, null, 1) + '\n');
// The saved copy is stamped as one of yours (the builder's library kind); the bay's recipe is not.
const { format: dartFormat, name: dartName, ...dartRest } = dartBlueprint(`${NAME}-dart.guide.js`);
fs.writeFileSync(bp(`${NAME}-dart.json`), JSON.stringify({ format: dartFormat, name: dartName, kind: 'yours', ...dartRest }, null, 1) + '\n');
if (fs.existsSync(bp(`${NAME}.dart.guide.js`))) fs.copyFileSync(bp(`${NAME}.dart.guide.js`), bp(`${NAME}-dart.guide.js`));
console.log(`${NAME}: ${W} wide, ${dart} darts, ${burners} burners, ${bay} dart bays, ${cbay} burner bays, ${anchors} anchors, ${flares} flares`);
