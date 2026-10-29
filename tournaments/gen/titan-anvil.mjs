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
//
// Round 6 (2026-10-25): the low layout is the default (`--layout brick` still writes the one above). Plates and frames
// break alike under a hit, so the plates moved where they count: a floor slab 4 rows deep with the core in its top
// row (from the side it sits behind half the brick's width of plates, under it 3 plates and the floor guns), a box
// of plates 4 rows deep over the core (Logan's idea: layers on every line to the core, which a laser that looks for
// the thinnest line meets), one plate on each side face, none on the roof. Its center of mass went from 21 m over its
// bottom to 12, so a hit low on its face (a ground base) spins it far less. 395 plates, 1008 batteries, 350 push
// boosters, 432 lift boosters; 13.0 t. Tried and dropped: the core 10 rows up in a 9 by 9 box (lasers from the side
// went through 5 plates: Woodpecker's burners ended it in 30 to 38 s), a wide low box and a 5 row slab (worse
// against Woodpecker).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const posArg = (i) => (process.argv[i] && !process.argv[i].startsWith('--') ? Number(process.argv[i]) : 0);
const W = posArg(2) || 72; // brick width in cells (guns stand one cell outside it)
const H = (posArg(2) && posArg(3)) || 41; // brick height
const opt = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 ? Number(process.argv[i + 1]) : d; };
const optStr = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : d; };
const LAYOUT = optStr('layout', 'low'); // 'low' (titans round 6, see lowLayout) or 'brick' (the layout before it)
const LOWD = LAYOUT === 'low';
const SIDE_A = opt('side', LOWD ? 1 : 2); // armor plates on each side face (the faces that ram)
const ROOF_A = opt('roof', LOWD ? 0 : 1); // armor plates on the roof (it rams upward, slower)
const FLOOR_A = opt('floor', 1); // armor plates under the lift boosters (ground guns blast up at it)
const PAD = 6; // cells from a ramming face to the first booster or battery: a crash hurts nothing deeper than that
const LIFT_ROWS = opt('lift', 8); // rows of lift boosters above the floor
const PUSH_COLS = opt('push', LOWD ? 7 : 6); // columns of push boosters inside each side wall
const CELL_ROWS = opt('cells', 22); // rows of dense batteries
const BAND = opt('band', LOWD ? 4 : 1); // armor rows above and below the core's row
const BOX = opt('box', LOWD ? 4 : 6); // armor columns each side of the core in those rows
const JAMMERS = 56; // jammer pods (5 s each)
const SLAB = opt('slab', 4); // low layout: rows of plates in the floor
const TOP_PAD = opt('topPad', 4); // low layout: frame rows over the lift rows
// Floor guns (titans round 7): 'hang' puts them under the floor every third column, as before; 'flush' sets them into
// the slab's bottom row every `floorEvery` columns, between plates, so only a shot from straight below meets them.
const FLOOR_GUNS = optStr('floorGuns', LOWD ? 'flush' : 'hang');
const FLOOR_EVERY = opt('floorEvery', 2);
// Ram faces (anvil-hard, 2026-10-29): 'teeth' gives every face it rams with a hard front, so a crash rule that asks
// what touched what meets plate, not a gun. Each side face gets a column of plate teeth on every second row (corners
// included), the side guns sit one cell back in the notches between them (one every second row, 20 a side, was 41),
// with a plate behind each tooth and the side skin plate behind each gun; the floor guns move up one row so the
// slab's bottom row is plate teeth with an empty notch under each gun; the roof guns sit in the roof row with a frame
// tooth over every other column (plates up there would lift its center of mass). 'studs' is the layout before it:
// guns stand one cell outside every face.
const FACES = optStr('faces', LOWD ? 'teeth' : 'studs');
const TEETH = FACES === 'teeth';

const MASS = { A: 20, F: 1, J: 0.5, l: 1.5, r: 1.5, p: 1.5, q: 1.5, Z: 3, C: 2, O: 1, Mv: 1, 'M^': 1, '.': 0 };
const g = [];
if (LAYOUT === 'low') lowLayout();
else {
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
var blockLo = liftHi + 1;
var blockHi = blockLo + CELL_ROWS + 2 * BAND; // CELL_ROWS battery rows plus the band's rows
var coreRow = opt('coreUp', -1) >= 0 ? blockLo + opt('coreUp', -1) : Math.round((blockLo + blockHi) / 2);
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
}

// The low layout (titans round 6, 2026-10): the plates where they count. Under a hit, a plate and a frame break
// alike (both shrug off 24 m/s), so plates on a ramming face buy nothing against a crash, only depth does; their
// weight high up on the faces was what made each low hit spin the brick (its center of mass sat 21 m over its
// bottom, and a ground base is struck 4 to 12 m up). So the floor is a slab of plates `SLAB` rows deep with the core
// buried in it (from the side it sits behind half the brick's width of plates; the slab is also what lands on a
// target it drops on), each side face has `SIDE_A` plates against shells and blasts, a box of plates stands over the
// core, the batteries sit on the slab, the lift rows over them, and light frames on top keep a crash from above off
// the lift rows.
function lowLayout() {
  for (let y = 0; y < H; y++) g.push(new Array(W).fill('F'));
  for (let y = 0; y < H; y++) for (let i = 0; i < SIDE_A; i++) { g[y][i] = 'A'; g[y][W - 1 - i] = 'A'; }
  for (let y = 0; y < SLAB; y++) for (let x = 0; x < W; x++) g[y][x] = 'A';
  for (let x = 0; x < W; x++) for (let i = 0; i < ROOF_A; i++) g[H - 1 - i][x] = 'A';
  const cx = W / 2;
  // The core in the slab (`coreUp` under `SLAB`), or higher up in the battery block inside a box of plates `BOX`
  // either side and `BAND` over and under it, out of reach of a blast on any face.
  const coreRow = opt('coreUp', 3);
  // Batteries on the slab, push boosters beside them inside the side pad, the box over the core.
  const cellLo = SLAB;
  const cellHi = H - 1 - TOP_PAD - LIFT_ROWS; // the last battery row
  const inner = PAD + PUSH_COLS + 1;
  for (let y = cellLo; y <= cellHi; y++) {
    const boxed = coreRow < SLAB ? y < SLAB + BAND : Math.abs(y - coreRow) <= BAND;
    for (let x = inner; x < W - inner; x++) g[y][x] = boxed && Math.abs(x - cx) <= BOX ? 'A' : 'Z';
    for (let i = 0; i < PUSH_COLS; i++) {
      g[y][PAD + i] = 'p';
      g[y][W - 1 - PAD - i] = 'q';
    }
  }
  g[coreRow][cx] = 'C';
  g[coreRow][cx - 1] = 'O';
  g[coreRow][cx + 1] = 'O';
  // Jammer pods in two rows of the battery block over the box, within 30 m of the core.
  const jamRow = (coreRow < SLAB ? cellLo : coreRow + 1) + BAND + 1;
  const half = Math.ceil(JAMMERS / 2);
  for (let i = 0; i < JAMMERS; i++) g[jamRow + Math.floor(i / half)][cx - Math.floor(half / 2) + (i % half)] = 'J';
  // Lift boosters over the batteries, a frame rib every 8 columns.
  for (let y = cellHi + 1; y <= cellHi + LIFT_ROWS; y++) {
    for (let x = PAD; x < W - PAD; x++) {
      const fromMid = x < W / 2 ? W / 2 - 1 - x : x - W / 2;
      g[y][x] = fromMid % 8 === 7 ? 'F' : x < W / 2 ? 'l' : 'r';
    }
  }
}

const com = () => {
  let m = 0;
  let sy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = MASS[g[y][x]]; m += k; sy += k * y; }
  return { m, y: sy / m };
};
// Push boosters: p on the left pushing right, q on the right pushing left, beside the battery block on every row.
// The block is centered near the center of mass row, so a hard push hardly turns the brick (the pilot cancels
// the rest).
if (LAYOUT !== 'low') {
  for (let y = blockLo; y <= blockHi; y++) {
    for (let i = 0; i < PUSH_COLS; i++) {
      g[y][PAD + i] = 'p';
      g[y][W - 1 - PAD - i] = 'q';
    }
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
if (FLOOR_GUNS === 'flush') {
  // Into the bottom row, never under the core's column (a laser from below meets the plates there). With teeth, one
  // row up, over an empty notch in the bottom row.
  const cxg = W / 2;
  for (let x = SIDE_A; x < W - SIDE_A; x++) {
    if (x % FLOOR_EVERY !== 1 || Math.abs(x - cxg) <= 1) continue;
    if (TEETH) {
      g[1][x] = 'Mv';
      g[0][x] = '.';
    } else g[0][x] = 'Mv';
  }
}
if (TEETH) {
  // Side faces: a plate tooth on every even row (row 0 and the roof row are corners), a gun in the notch on every odd
  // row, a plate behind each tooth; the skin plate stays behind each gun and becomes a frame behind each tooth's plate
  // (outside the slab), so every line in from the side still meets a plate and the weight stays near today's.
  const skin = (c, y) => (y >= SLAB && c === 'A' ? 'F' : c);
  const sideRow = (y, cells) => {
    if (y % 2 === 1) return ['.', 'M<', ...cells, 'M>', '.'];
    const mid = cells.slice();
    for (let i = 0; i < SIDE_A; i++) {
      mid[i] = skin(mid[i], y);
      mid[W - 1 - i] = skin(mid[W - 1 - i], y);
    }
    return ['A', 'A', ...mid, 'A', 'A'];
  };
  // Roof: guns in the roof row on even columns (as before, one row lower), a frame tooth over each odd column.
  const roofTeeth = ['.', '.'];
  for (let x = 0; x < W; x++) {
    if (x % 2 === 0) g[H - 1][x] = x < SIDE_A || x >= W - SIDE_A ? g[H - 1][x] : 'M^';
    roofTeeth.push(x % 2 === 1 ? 'F' : '.');
  }
  roofTeeth.push('.', '.');
  rows.push(roofTeeth);
  for (let y = H - 1; y >= 0; y--) rows.push(sideRow(y, g[y]));
} else {
  rows.push(top);
  for (let y = H - 1; y >= 0; y--) rows.push(['M<', ...g[y], 'M>']);
  if (FLOOR_GUNS !== 'flush') rows.push(bottom);
}
const wide = (t) => t.padEnd(3, ' ');
const grid = rows.map((r) => r.map(wide).join('').trimEnd());

const blueprint = {
  format: 1,
  name: 'titan-anvil',
  kind: 'yours',
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
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? process.argv[outArg + 1] : path.join(here, '..', '..', 'blueprints', 'titan-anvil.json');
fs.writeFileSync(out, JSON.stringify(blueprint, null, 1) + '\n');
const c = com();
const count = {};
for (const r of g) for (const t of r) count[t] = (count[t] || 0) + 1;
console.log(`titan-anvil: ${W} by ${H}, about ${Math.round(c.m)} kg without guns, center of mass row ${c.y.toFixed(2)}, core row ${g.findIndex((r) => r.includes('C'))}`, JSON.stringify(count));
