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
//
// Round 9 (2026-10-30): an armored lid under each pop-out laser, dropped with two decouplers when the finish begins
// (see ZAP), and a keel 5 rows deep. 3096 parts, 12.92 t.
//
// Righting (2026-10-30, Logan: "anvil flipped over and got stuck upside down"): every booster it had pushes it down or
// along the ground when it lies on its back, so a roll ended the match for it. Now the frames in each end pad are
// boosters pushing the other way (see RIGHT), 231 an end: no more parts, 0.5 kg more each. 3096 parts, 13.15 t.
//
// Round 10 (2026-10-30, Logan: "it's just all boosters, the top of the anvil looks very weak", and Mirage's missiles broke
// its side): armor back in (see ROOF_ARMOR). 194 righting boosters an end, 37 fewer, are enough to get up at this mass;
// the rest are frames again. Plate teeth over the roof guns, a plate behind the skin on every gun row, and the slab pays
// for them with frames in two rows of its tooth columns. The lid decouplers now fall with the lids.
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
const KEEL = opt('keel', LOWD ? 5 : 0);
// Righting boosters (2026-10-30): `RIGHT` rows of the end pad's frames, from the top down, and `RIGHT_TOP` columns of
// two rows of the top pad, pushing toward the floor (the opposite of the lift rows). Lying on its back it is
// tipped by one end: a corner lifts once they give its weight times the half width over the brick's length, 12.9 t
// needs 169 of them (68 kN) at the end's 71 m. Only those at the far end do it, so both ends carry them. With the lift
// half at the other end they make a pure turn in the air too: nothing left over pushing it at the ground.
const RIGHT = opt('right', LOWD ? 37 : 0);
const RIGHT_COLS = opt('rightCols', 5);
const RIGHT_TOP = opt('rightTop', 18);
// Armor back in (anvil r10, 2026-10-30, Logan: "it's just all boosters, the top of the anvil looks very weak"): the flip
// fix had turned 462 frames into boosters, and nothing armored stood in the top half. `ROOF_ARMOR` 'teeth': the frame
// teeth over the roof guns are plates; 'row' as well: a row of plates under the guns over the lift rows. `SIDE_IN`: a
// plate behind the skin on every gun row, the rows a shell or a blast reaches the end boosters through. Paid for by
// `STRIPE`: on the columns with a plate tooth under them the slab's third row is a frame (see lowLayout).
const ROOF_ARMOR = optStr('roofArmor', LOWD ? 'teeth' : 'none');
const SIDE_IN = opt('sideIn', LOWD ? 1 : 0);
const SIDE_EVEN = opt('sideEven', 0);
const STRIPE = opt('stripe', LOWD ? 4 : 0); // columns clear of it each side of the core (0: no stripe)
const STRIPE_LOW = opt('stripeLow', LOWD ? 1 : 0);
const TEETH = FACES === 'teeth';

const MASS = { A: 20, F: 1, J: 0.5, l: 1.5, r: 1.5, p: 1.5, q: 1.5, u: 1.5, v: 1.5, Z: 3, C: 2, O: 1, Mv: 1, 'M^': 1, x: 2, y: 1.5, z: 4, d: 1, '=': 0, '.': 0 };
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
  // The slab pays for the roof and the sides (anvil r10): a shell from below meets at most 2 plates on a column with a
  // floor gun in it and 4 on a column with a tooth. On the tooth columns away from the core the third row is a frame (and
  // with `STRIPE_LOW` the second too): the weak lines keep what they had, the strong ones give a plate each to the roof.
  if (STRIPE > 0) {
    for (let x = SIDE_A + 1; x < W - SIDE_A - 1; x++) {
      if (x % 2 !== 0 || Math.abs(x - cx) <= STRIPE) continue;
      g[2][x] = 'F';
      if (STRIPE_LOW) g[1][x] = 'F';
    }
  }
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
  // Righting boosters in the end pads: column 0 stays skin, the spine that ties the rows together (a booster has no
  // face on its nozzle, so a column of them holds to nothing above it, and the two rows under the roof guns stay frames).
  for (let y = H - 3; y >= Math.max(SLAB, H - RIGHT); y--) {
    for (let i = 1; i <= RIGHT_COLS; i++) {
      g[y][i] = 'u';
      g[y][W - 1 - i] = 'v';
    }
  }
  if (RIGHT > 0) {
    for (let y = H - 4; y < H - 2; y++) {
      for (let i = RIGHT_COLS + 1; i <= RIGHT_COLS + RIGHT_TOP; i++) {
        g[y][i] = 'u';
        g[y][W - 1 - i] = 'v';
      }
    }
  }
  // Roof and side plates (anvil r10, see ROOF_ARMOR).
  if (ROOF_ARMOR === 'row') for (let x = SIDE_A; x < W - SIDE_A; x++) g[H - 2][x] = 'A';
  for (let y = SLAB; y < H; y++) {
    if (y % 2 === 1 && SIDE_IN > 0) for (let i = 0; i < SIDE_IN; i++) { g[y][SIDE_A + i] = 'A'; g[y][W - 1 - SIDE_A - i] = 'A'; }
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
// Pop-out lasers (anvil r8, 2026-10-29, Logan: "once it's taken out what seems to be a threat, it pops a laser out and
// finishes the job"): `ZAP` turrets in the floor slab, `zapAt` columns either side of the core (even columns, between
// the floor guns). Each is a piston pushing down (row 3, hung from the battery over it), a rotator hanging from it
// (row 2) and a laser pointing down (rows 1 and 0, its barrel flush with the slab's bottom). Stowed, it sits in a notch
// of the slab, met only from straight below. Pushed out (2 m), the barrel's end hangs 2 m under the slab and the
// rotator swings it to the enemy's core. A piston or a rotator carries whatever touches its sides, so the cells beside
// them stay empty, and so do the floor guns beside the laser (they would hang from those cells): plates instead.
// `zapLow` 1 is the first try (anvil r8): the barrel flush with the slab's bottom; Bastion's darts, coming up from
// straight below, took all four in the first bombing pass. Now (`zapLow` 0) each turret sits one row higher, its
// barrel over an empty notch in the bottom row, like the floor guns beside it (which stay). A plate under the barrel
// does not work: a robot's own bodies touch, and the piston stalled against it at 14% of its stroke. Out, the barrel's
// end hangs 1 m under the slab, so it swings up to about 50 degrees before its beam would meet the slab. The floor
// guns beside each laser are gone (`zapClear`, below): 25 floor guns, was 33.
const ZAP = opt('zap', LOWD && TEETH ? 1 : 0);
const ZAP_AT = optStr('zapAt', '8,16').split(',').map(Number);
const ZAP_LOW = opt('zapLow', 0);
const ZAP_CLEAR = opt('zapClear', 1);
// Armored lids (anvil r9, 2026-10-30, Logan: the lasers were "literally just exposed at the bottom, which is where most
// people aim anyway"; the Juggernaut's one beam took all four as the brick charged in, Bastion's darts three): a lid of
// plates under each bay, hung below the slab from two decouplers releasing down (the slab's bottom row, 2 columns
// either side of the laser), `lidRows` deep: 5 plates wide on the first row, the middle 3 on the next. A 1 m gap (the
// open notch row) keeps the barrel off it, since a robot's own bodies touch. When the finish begins the pilot fires the
// decouplers and the lid drops away (a one-shot deploy, like a missile leaving its rail), then the pistons push out.
const LID_ROWS = ZAP && TEETH ? opt('lidRows', 2) : 0;
// The decouplers fall with the lid (anvil r10): their release faces point up, into the slab. Left in the slab's bottom
// row, their corners stopped a swinging barrel at 32 degrees, not the 50 the notch was made for, and a rotator pressed
// against one winds up its integral term and stays there for seconds.
const LID_FALLS = opt('lidFalls', 1);
const lidCells = []; // [x, depth under the slab (1 is the row just under it)]
if (ZAP) {
  const cxz = W / 2;
  const b = ZAP_LOW ? 0 : 1; // the barrel's row
  for (const d of ZAP_AT) {
    for (const x of [cxz - d, cxz + d]) {
      g[b + 3][x] = 'x';
      g[b + 2][x] = 'y';
      g[b + 1][x] = 'z';
      g[b][x] = '=';
      if (!ZAP_LOW) g[0][x] = '.';
      for (const e of [x - 1, x + 1]) {
        g[b + 3][e] = '.';
        g[b + 2][e] = '.';
        if (ZAP_LOW) g[1][e] = 'A'; // the floor guns beside it would hang from the empty cells
        // Nothing beside the laser either: a robot's own bodies touch, and a laser between a plate and a floor gun
        // shook against them, changing speed by 5 m/s every tick (414 impacts in 8 s at rest; its aim shook too). The
        // two floor guns beside it go with them.
        if (ZAP_CLEAR) {
          g[b + 1][e] = '.';
          g[b][e] = '.';
        }
      }
      if (LID_ROWS > 0) {
        g[0][x - 2] = 'd';
        g[0][x + 2] = 'd';
        for (let k = 1; k <= LID_ROWS; k++) for (let e = x - 2; e <= x + 2; e++) if (k === 1 || Math.abs(e - x) <= 1) lidCells.push([e, k]);
      }
    }
  }
}
if (TEETH) {
  // Side faces: a plate tooth on every even row (row 0 and the roof row are corners), a gun in the notch on every odd
  // row, a plate behind each tooth; the skin plate stays behind each gun and becomes a frame behind each tooth's plate
  // (outside the slab), so every line in from the side still meets a plate and the weight stays near today's.
  const skin = (c, y) => (y >= SLAB && c === 'A' && !SIDE_EVEN ? 'F' : c);
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
    roofTeeth.push(x % 2 === 1 ? (ROOF_ARMOR === 'none' ? 'F' : 'A') : '.');
  }
  roofTeeth.push('.', '.');
  rows.push(roofTeeth);
  for (let y = H - 1; y >= 0; y--) rows.push(sideRow(y, g[y]));
  // A keel (anvil r8): `keel` rows of plates under the core, 5 wide (the floor guns 3 either side stay clear). Under the
  // core the slab held 2 plates and a radar on the steepest lines from below, and crossing over a juggernaut its two
  // beams burnt through them in under 2 s.
  // Round 9: 5 rows (300 kg more); crossing over a juggernaut its beams still burnt up through 2 rows. The lids hang in
  // the same rows under the lasers.
  for (let k = 0; k < Math.max(KEEL, LID_ROWS); k++) {
    const row = new Array(W + 4).fill('.');
    if (k < KEEL) for (let x = W / 2 - 2; x <= W / 2 + 2; x++) row[x + 2] = 'A';
    for (const [x, d] of lidCells) if (d === k + 1) row[x + 2] = 'A';
    rows.push(row);
  }
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
    ...(RIGHT > 0 ? {
      u: { part: 'booster', rot: 180, tags: ['ra'], auto: false },
      v: { part: 'booster', rot: 180, tags: ['rb'], auto: false },
    } : {}),
    ...(ZAP ? {
      x: { part: 'piston', rot: 180, tags: ['zpush'], auto: false },
      y: { part: 'rotator', rot: 180, tags: ['zrot'], auto: false },
      z: { part: 'laser', rot: 180, tags: ['zap'], auto: false },
    } : {}),
    ...(LID_ROWS > 0 ? { d: { part: 'decoupler', rot: LID_FALLS ? 0 : 180, tags: ['zlid'], auto: false } } : {}),
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
