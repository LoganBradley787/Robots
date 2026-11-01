// The reactor refits (2026-10-31): stock robots with their dense batteries swapped for reactors, the stock robots left
// as they are, so a stock robot and its refit can be fought against each other. Run from anywhere after any change to
// the stock robots: node tournaments/gen/reactor-refits.mjs
// Writes blueprints/titan-<name>-r.json for all eight titans and the pilots they patch, reactor-cannon-drone.json and its
// scripts, and enemy-reactor-cannon-drone.json.
//
// Titans swap by mass: a reactor is 100 kg, so it takes the place of about 33 dense batteries, 9 under it and the rest
// left as holes, and the refit weighs what the stock robot weighs. A hole is cheaper than a frame, and the rows between
// are left whole so nothing comes loose. Drones keep all their batteries (Logan): a reactor is added, not swapped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../blueprints');
const read = (name) => JSON.parse(fs.readFileSync(path.join(out, `${name}.json`), 'utf8'));
const write = (bp) => fs.writeFileSync(path.join(out, `${bp.name}.json`), `${JSON.stringify(bp, null, 1)}\n`);
const DENSE = 3; // kg
const REACTOR = 100; // kg
const SMALL = 20; // kg, a small reactor
const FRAME = 1; // kg
const ARMOR = 20; // kg

/** The grid as cells, row 0 on top. */
const cellsOf = (bp) => bp.grid.map((r) => r.trim().split(/\s+/));
const gridOf = (cells) => cells.map((r) => r.join(' '));

/** A 3 by 3 reactor with its top left cell at `row`, `col`. The token sits on the bottom left cell, the others are `=`. */
function putReactor(cells, row, col) {
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      if (cells[row + y][col + x] !== 'Z') throw new Error(`reactor at ${row},${col}: cell ${row + y},${col + x} is ${cells[row + y][col + x]}, not a dense battery`);
      cells[row + y][col + x] = y === 2 && x === 0 ? 'Rc' : '=';
    }
  }
}

/** The same over any cells that hold what `over` allows, for a titan with no 3 by 3 of batteries to stand in. */
function putReactorOver(cells, row, col, over) {
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      if (!over.includes(cells[row + y][col + x])) throw new Error(`reactor at ${row},${col}: cell ${row + y},${col + x} is ${cells[row + y][col + x]}, not one of ${over}`);
      cells[row + y][col + x] = y === 2 && x === 0 ? 'Rc' : '=';
    }
  }
}

/** Dense batteries that go, as holes, from these cells in the order given, until `count` have gone. */
function hollow(cells, spots, count) {
  let left = count;
  for (const [row, col] of spots) {
    if (left === 0) break;
    if (cells[row][col] !== 'Z') continue;
    cells[row][col] = '.';
    left--;
  }
  if (left > 0) throw new Error(`${left} dense batteries left to take out`);
}

/** The key that sets every reactor on the robot to 3 times its rating, and back. */
const PUSH_KEY = { key: 'p', mode: 'toggle', target: 'reactor', channel: 'push', value: 3 };

/** A patch to a stock script's text that must apply, so a stock change that moves it stops here instead of going quiet. */
function patch(text, from, to) {
  if (!text.includes(from)) throw new Error(`stock script changed, no longer has: ${from}`);
  return text.replace(from, to);
}

// ---- titan-mirage-r: 3 reactors, 4.5 kW against 3.3 kW of hover. The helm has no energy budget, so it stands. ----
{
  const bp = read('titan-mirage');
  const cells = cellsOf(bp);
  // In the keep, behind its plates: the top right, bottom right and bottom left corners of the batteries round the
  // core box. Its helm trims the lift for where the weight is.
  for (const [row, col] of [
    [4, 8],
    [10, 8],
    [10, 2],
  ]) {
    putReactor(cells, row, col);
  }
  const REACTORS = 3;
  const take = Math.round((REACTORS * REACTOR) / DENSE) - REACTORS * 9;
  // The upper battery row of the spar, evenly from the keep to the bow: the row under it is unbroken, and the frames
  // between its batteries still hold the deck.
  const row = 8;
  const spots = [];
  for (let col = 12; col < cells[row].length; col++) if (cells[row][col] === 'Z') spots.push([row, col]);
  const every = spots.length / take;
  hollow(cells, Array.from({ length: take }, (_, i) => spots[Math.floor(i * every)]), take);
  write({ ...bp, name: 'titan-mirage-r', grid: gridOf(cells), bindings: [...(bp.bindings ?? []), PUSH_KEY] });
}

// ---- titan-anvil-r: 17 reactors, 25.5 kW against 25 kW of hover and fight. Its pilot counts them. ----
{
  const bp = read('titan-anvil');
  const cells = cellsOf(bp);
  const placed = [];
  // Three bands through the battery block, 6, 5 and 6 reactors, even about the middle so it flies as it did. Each
  // reactor hangs off the batteries above it.
  for (const [row, first, count] of [
    [15, 19, 6],
    [20, 22, 5],
    [25, 19, 6],
  ]) {
    for (let i = 0; i < count; i++) {
      putReactor(cells, row, first + 7 * i);
      placed.push([row, first + 7 * i]);
    }
  }
  // The top row stays whole, tying the columns' tops together: that leaves it 21 batteries, 63 kg, heavier than stock.
  const take = Math.round((placed.length * REACTOR) / DENSE) - placed.length * 9 - 21;
  // Odd columns go first, top to bottom, so the even columns stay whole: every reactor hangs off them. A checkerboard
  // would touch only at corners, which is no joint at all. Then, in a band, the second even column of each gap.
  const spots = [];
  const bands = [15, 16, 17, 20, 21, 22, 25, 26, 27];
  for (let row = 14; row <= 35; row++) for (let col = 17; col <= 57; col += 2) spots.push([row, col]);
  for (const row of bands) for (let col = 20; col <= 57; col += 2) if (cells[row][col] === 'Z' && cells[row][col - 2] === 'Z') spots.push([row, col]);
  hollow(cells, spots, take);
  const pilot = 'titan-anvil-r.pilot.js';
  write({ ...bp, name: 'titan-anvil-r', grid: gridOf(cells), scripts: bp.scripts.map((s) => (s.id === 'pilot' ? { ...s, source: { file: pilot } } : s)), bindings: [...(bp.bindings ?? []), PUSH_KEY] });

  // The pilot's energy budget: what is stored is no longer all it has. `spare` and `spareB` said how much of the store
  // hovering to the match's end leaves; now hovering to the end is what its reactors do not cover.
  let text = fs.readFileSync(path.join(out, 'titan-anvil.pilot.js'), 'utf8');
  text = patch(text, '  const charge = self.energy.capacity > 0 ? self.energy.stored / self.energy.capacity : 1;\n', `  const charge = self.energy.capacity > 0 ? self.energy.stored / self.energy.capacity : 1;
  // Reactors (titan-anvil-r): steady power comes off what hovering costs. What is stored is no longer all it has.
  if (time - (state.steadyAt ?? -1) >= 1) {
    state.steadyAt = time;
    state.steady = 0;
    for (const p of parts) if (p.spec.reactor) state.steady += p.spec.reactor.power;
  }
`);
  text = patch(text, '    const spare = self.energy.stored - zapKeep * hoverPower * timeLeft;\n', '    const spare = self.energy.stored - (zapKeep * hoverPower - state.steady) * timeLeft;\n');
  text = patch(text, '    const spareB = self.energy.stored - hoverPower * timeLeft;\n', '    const spareB = self.energy.stored - (hoverPower - state.steady) * timeLeft;\n');
  // Down on its reserve it rises again, power coming in, but only with something to fight with: taking off at the reserve
  // spent what had come in, and it lay there going up and down on the throttle for the rest of the match.
  text = patch(text, "const reserve = param('reserve', 0.05, { min: 0, max: 0.5 }); // share of energy kept for landing\n", `const reserve = param('reserve', 0.05, { min: 0, max: 0.5 }); // share of energy kept for landing
const restTo = param('restTo', 0.25, { min: 0, max: 1 }); // share of energy it waits for on the ground before rising again
`);
  text = patch(text, "  } else if (charge < reserve) {\n    plan('low energy: landing');\n", `  } else if (charge < (state.resting ? restTo : reserve)) {
    state.resting = true;
    plan('low energy: landing');
`);
  text = patch(text, '  const timeLeft = arena ? Math.max(0, match - self.age) : hold; // s of hovering it must keep in hand\n', `  if (charge >= restTo) state.resting = false;
  const timeLeft = arena ? Math.max(0, match - self.age) : hold; // s of hovering it must keep in hand
`);
  fs.writeFileSync(path.join(out, pilot), text);
}

// ---- titan-hive-r: 5 reactors, 6 kW against 2.7 kW of hover and 3.2 kW of darts from 14 bays. Its pilot counts them. ----
{
  const bp = read('titan-hive');
  const cells = cellsOf(bp);
  // Measured with stock's 10 bays and 4 reactors its pool stayed full all fight: bays, not energy, set how fast it could
  // throw darts. So what power buys is more bays: two more each side, on the shoulders beside the old ones, each making
  // the same dart. They take the shoulder's propellers there, 10 of 346, and move the inner turret out of their way.
  const legend = { ...bp.legend };
  const [floor, roof, top] = [7, 6, 1]; // rows of the bay floors, the shoulder's roof, and the walls' top
  const addBay = (x, n) => {
    const name = 'ABCDEFGHIJKLMN'[n];
    const tok = `b${name.toLowerCase()}`;
    legend[tok] = { ...legend.ba, tags: [`bay${name}`] };
    [x, x + 2, x + 3].forEach((col) => (cells[floor][col] = '='));
    cells[floor][x + 1] = tok;
    for (const col of [x + 1, x + 2]) cells[roof][col] = '.';
    for (let row = top; row <= roof; row++) for (const col of [x, x + 3]) cells[row][col] = '=';
  };
  // The turret is the rotator on the roof and its gun over it.
  const moveTurret = (from, to) => {
    for (const row of [roof - 1, roof - 2]) {
      if (cells[row][from] === '.') throw new Error(`no turret at ${from}`);
      cells[row][to] = cells[row][from];
      cells[row][from] = '.';
    }
  };
  moveTurret(26, 20);
  moveTurret(88, 94);
  [22, 26, 85, 89].forEach((x, i) => addBay(x, 10 + i));
  // The battery band is two rows tall, so each reactor takes its skin row too, under the band. Pairs either side of the
  // middle, 17 and 43 m from the core, and one more outside the near pair on the left, 30 m out: a hot blast reaches
  // 5 m, and its helm trims for where the weight is. Even about the middle but for that one, so it flies as it did.
  const [row, mid] = [9, 57];
  const placed = [];
  for (const col of [mid - 18, mid + 16, mid - 44, mid + 42, mid - 31]) {
    putReactorOver(cells, row, col, ['Z', 'F']);
    placed.push(col);
  }
  // 40 batteries stay, 240 kJ, to carry a volley past what comes in. That leaves it heavier than a swap by mass would.
  const take = 184 - 6 * placed.length - 40;
  // The top row of the band goes first, the bottom row after it, each from the ends in, both sides in turn. One column
  // in eight stays whole: the band is all that ties the skins over and under it together.
  const spots = [];
  for (const r of [row, row + 1]) {
    for (let d = 52; d >= 8; d--) {
      if (d % 8 === 1) continue;
      spots.push([r, mid - d], [r, mid + d]);
    }
  }
  hollow(cells, spots, take);
  const pilot = 'titan-hive-r.pilot.js';
  write({ ...bp, name: 'titan-hive-r', grid: gridOf(cells), legend, scripts: bp.scripts.map((s) => (s.id === 'pilot' ? { ...s, source: { file: pilot } } : s)), bindings: [...(bp.bindings ?? []), PUSH_KEY] });

  // What it plans its energy on. Stock holds its darts so the hover reaches the match's end, and with no arena lands to
  // save it. Steady power comes off both, as for the Anvil: with its reactors whole it never needs to land, and it
  // holds darts only under `floor` s of hover in the pool, so the darts go as fast as what comes in pays for them and
  // the bays cannot run the pool flat and fry its batteries. A reactor shot off gives the old plan back, in part.
  let text = fs.readFileSync(path.join(out, 'titan-hive.pilot.js'), 'utf8');
  text = patch(text, "const floorShare = param('floorShare', 0.15, { min: 0, max: 1 }); // share of the reserve it keeps sitting (sensors and turrets)\n", `const floorShare = param('floorShare', 0.15, { min: 0, max: 1 }); // share of the reserve it keeps sitting (sensors and turrets)
const floor = param('floor', 15, { min: 0, max: 600 }); // s of hover left in the pool under which darts wait for what the reactors make (titan-hive-r)
`);
  text = patch(text, `  const hoverDraw = ((self.mass * g) / lift) * propDraw;
  const stored = self.energy.stored;
  const reserve = reserveS * hoverDraw;
`, `  const hoverDraw = ((self.mass * g) / lift) * propDraw;
  const stored = self.energy.stored;
  // Reactors (titan-hive-r): steady power comes off what the hover costs.
  if (time - (state.steadyAt ?? -1) >= 1) {
    state.steadyAt = time;
    state.steady = 0;
    for (const p of parts) if (p.spec.reactor) state.steady += p.spec.reactor.power;
  }
  const reserve = reserveS * Math.max(0, hoverDraw - state.steady);
`);
  text = patch(text, '  const wantRest = !arena && (time - state.busyAt > restAfter || stored < reserve);\n', '  const wantRest = !arena && state.steady < hoverDraw && (time - state.busyAt > restAfter || stored < reserve);\n');
  text = patch(text, '  if (arena) spare = stored >= keep * hoverDraw * Math.max(0, match - self.age);\n  else spare = stored >= (state.sitting ? floorShare * reserve : reserve);\n', `  const least = floor * hoverDraw;
  if (arena) spare = stored >= Math.max(least, (keep * hoverDraw - state.steady) * Math.max(0, match - self.age));
  else spare = stored >= Math.max(least, state.sitting ? floorShare * reserve : reserve);
`);
  fs.writeFileSync(path.join(out, pilot), text);
}

// ---- titan-bastion-r: 4 reactors, 4.8 kW against the 4.5 kW all its bays draw. The pilot has no energy plan to change. ----
{
  const bp = read('titan-bastion');
  const cells = cellsOf(bp);
  // In the battery banks under the dart bays, between the anchors, under five rows of plate and with a floor under
  // them, more than 20 m from the core. Banks are in rows 27 to 29, an anchor every 5 columns in the last.
  const placed = [];
  for (const col of [16, 36, 102, 122]) {
    putReactor(cells, 27, col);
    placed.push(col);
  }
  const take = Math.round((placed.length * REACTOR) / DENSE) - placed.length * 9;
  // The middle row of the banks first, then the top. The column over each anchor stays whole, because it hangs from
  // there, and so does one between each two anchors, which holds up that stretch of floor. The bottom row stays,
  // but for its ends outside the anchors.
  const spots = [];
  for (const row of [28, 27]) {
    for (let col = 4; col <= 48; col++) {
      if (col % 5 === 0 || col % 5 === 2) continue;
      spots.push([row, col], [row, 140 - col]);
    }
  }
  for (let col = 5; col <= 9; col++) spots.push([29, col], [29, 140 - col]);
  hollow(cells, spots, take);
  write({ ...bp, name: 'titan-bastion-r', grid: gridOf(cells), bindings: [...(bp.bindings ?? []), PUSH_KEY] });
}

// ---- titan-woodpecker-r: 4 reactors, 4.8 kW against the 4.7 kW all its bays draw. Every battery kept. ----
{
  const bp = read('titan-woodpecker');
  const cells = cellsOf(bp);
  // In the keep, not the base: the base is three rows thin, a reactor in it would stand on all three, and one shot-out
  // reactor would cut off that end with its bays. The keep's two top corners, clear of the core by 12 m and more, and
  // a line down to the core still meets 12 plates. Nine plates are 180 kg, a reactor 100: the 320 kg saved stays saved,
  // because a ground titan pays nothing for it, and the batteries can stay: the rack and the bays spend them first.
  const keep = ['K'];
  for (const col of [81, 84, 94, 97]) putReactorOver(cells, 13, col, keep);
  write({ ...bp, name: 'titan-woodpecker-r', grid: gridOf(cells), bindings: [...(bp.bindings ?? []), PUSH_KEY] });
}

// ---- titan-palisade-r: a small reactor on every panel, 240 W against 130 W of hover, and two on the keep. ----
{
  const bp = read('titan-palisade');
  const cells = cellsOf(bp);
  const SMALL_KEY = { ...PUSH_KEY, target: 'smallreactor' };
  const where = (token) => {
    const found = [];
    cells.forEach((r, row) => r.forEach((t, col) => t === token && found.push([row, col])));
    return found;
  };
  // A panel's eight batteries lie along its link column: its top deck, the middle deck up to its core, the bottom deck.
  // The reactor goes at the top deck's outer end, 7 m from the core, out of a hot blast's reach. Two batteries stay on
  // the bottom deck to carry a burst and balance it; the rest turn to frames, because the decks are what tie the link
  // column to the gun wall. +5 kg a panel: a frame where a battery was (the decks must stay whole).
  for (let n = 1; n <= 10; n++) {
    const [top1, top2, m1, m2, m3, m4, bot1, bot2] = where(`zp${n}`).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    if (!bot2) throw new Error(`panel ${n} moved`);
    cells[top1[0]][top1[1]] = 'rc';
    for (const [row, col] of [top2, m1, m2, m3, m4]) cells[row][col] = `fp${n}`;
  }
  // The keep: at both ends of its top deck, 12 m from its core. Its 14 belly batteries turn to frames but one each
  // side of the core box stays out, for the 8 left on the decks.
  const zs = where('z').sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const [left, right] = zs; // the top deck's ends
  cells[left[0]][left[1]] = 'rc';
  cells[right[0]][right[1]] = 'rc';
  const belly = zs.filter(([row]) => row >= zs[zs.length - 1][0] - 1);
  for (const [row, col] of belly.slice(0, 11)) cells[row][col] = 'f';
  const cores = Object.fromEntries(Object.entries(bp.cores).map(([k, c]) => [k, { ...c, bindings: [...(c.bindings ?? []), SMALL_KEY] }]));
  write({ ...bp, name: 'titan-palisade-r', grid: gridOf(cells), cores, bindings: [...(bp.bindings ?? []), SMALL_KEY] });
}

// ---- titan-shatter-r: a small reactor on every gunship, 240 W against 75 W of flying, two on the king. ----
{
  const bp = read('titan-shatter');
  const cells = cellsOf(bp);
  const SMALL_KEY = { ...PUSH_KEY, target: 'smallreactor' };
  const dense = (t) => bp.legend[t]?.part === 'densebattery';
  // A gunship: batteries in its body row either side of the core and a shelf of seven under them. The reactor takes
  // the shelf two cells left of the core, where the ship has four propellers to the right side's three, and 2.2 m from
  // the core, past a cold blast. A hot one reaches the core, but a gunship's pilot never pushes. Further out it flew
  // badly: at the shelf's right end, 3 m from the core, a third of the ships tipped over. The shelf stays whole in
  // frames: with holes in it the ships lock together as they come apart, and most of them fell. Five batteries stay of
  // 11, on the right to balance the reactor, and the body's two inner batteries go as holes: the shelf holds what they
  // held. +5 kg a ship, 150 kg in all: with the king's reactors that is 9.7 percent heavier, just inside the 10 allowed.
  const shipCols = [4, 18, 32]; // each column's left laser mount
  let ships = 0;
  for (let row = 7; row < cells.length; row += 4) {
    for (const x0 of shipCols) {
      for (let dx = 2; dx <= 8; dx++) if (!dense(cells[row][x0 + dx])) throw new Error(`the shelf at row ${row} moved`);
      if (!dense(cells[row - 1][x0 + 3]) || !dense(cells[row - 1][x0 + 7])) throw new Error(`the body at row ${row - 1} moved`);
      cells[row][x0 + 3] = 'rc';
      for (const dx of [2, 4, 6]) cells[row][x0 + dx] = 'F';
      cells[row - 1][x0 + 3] = '.';
      cells[row - 1][x0 + 7] = '.';
      ships++;
    }
  }
  if (ships !== 30) throw new Error(`${ships} gunships`);
  // The king: both ends of its battery row, 6 m from its core. Its hover is about 170 W, so one reactor holds it up and
  // the other is a spare. Its eight other batteries stay: taking six out for mass left the core bare, a dart's blast
  // halves for each part in its way, and the king died 17 s sooner against the Woodpecker.
  const kingRow = 2;
  for (const col of [16, 28]) {
    if (!dense(cells[kingRow][col])) throw new Error('the king moved');
    cells[kingRow][col] = 'rc';
  }
  // Flying is paid for: all that is kept back is `spare`, so a gunship spends its pool on beams at once and then burns
  // what comes in. flyDraw is what flying costs over its reactor.
  const cores = Object.fromEntries(
    Object.entries(bp.cores).map(([k, c]) => [k, { ...c, bindings: [...(c.bindings ?? []), SMALL_KEY], scripts: c.scripts.map((s) => ({ ...s, params: { ...s.params, flyDraw: 0, keepOpen: 3000 } })) }]),
  );
  write({ ...bp, name: 'titan-shatter-r', grid: gridOf(cells), cores, bindings: [...(bp.bindings ?? []), SMALL_KEY] });
}

// ---- titan-juggernaut-r: 12 reactors, 14.4 kW against the 16 kW a bank and its beams take flat out and 7 to 12 kW across a fight. ----
{
  const bp = read('titan-juggernaut');
  const cells = cellsOf(bp);
  // Stock ran dry at 160 s against the Anvil and went out of the arena coasting, so this one is not a swap by mass: all
  // 288 batteries would buy under 9 reactors, and a bank alone wants 13. In the battery block behind the core, 11 m and
  // more from it, three across and four up with a battery row or column between any two, so a reactor shot out takes
  // little with it. 180 of the 288 batteries stay to pay for a sprint. It is 876 kg heavier, 1.2 percent of 74.6 t.
  for (const row of [228, 234, 240, 246]) for (const col of [44, 48, 52]) putReactor(cells, row, col);
  // The pilot works in shares of its pool, and stops driving at `low`. With reactors running it has no reason to stop
  // short of anything: past what they make it overdraws, frying the batteries it has emptied, and goes on. Guesses for
  // the beams wait under `spare`, far lower now the pool fills, and it patrols at a speed that used to cost too much.
  const scripts = bp.scripts.map((s) => (s.id === 'pilot' ? { ...s, params: { ...s.params, low: 0, reserve: 0, spare: 0.15, patrolTop: 30 } } : s));
  write({ ...bp, name: 'titan-juggernaut-r', grid: gridOf(cells), scripts, bindings: [...(bp.bindings ?? []), PUSH_KEY] });
}

// ---- the cannon drones: a small reactor at the top of the mast, every battery kept. ----
{
  const bp = read('enemy-cannon-drone');
  const cells = cellsOf(bp);
  const [row, col] = [2, 8];
  if (cells[row][col] !== 'F') throw new Error('the mast moved');
  cells[row][col] = 'rc';
  const grid = gridOf(cells);
  write({ ...bp, name: 'enemy-reactor-cannon-drone', grid });

  // Yours: flown like the gun drone, W S A D, the turret aiming by itself. Its stock turret script is patient: it waits
  // for a shot's worth on top of its reserve. G tells it not to wait, and P pushes the reactor.
  const turrets = 'reactor-cannon-drone.turrets.js';
  const hover = 'reactor-cannon-drone.hover.js';
  let text = fs.readFileSync(path.join(out, 'enemy-cannon-drone.turrets.js'), 'utf8');
  text = patch(text, '  const powered = cap <= 0 || self.energy.stored >= need;\n', `  if (keys.pressed('g')) {
    state.greedy = !state.greedy;
    log(state.greedy ? 'not waiting for the pool' : 'waiting for the pool');
  }
  const powered = state.greedy || cap <= 0 || self.energy.stored >= need;
`);
  fs.writeFileSync(path.join(out, turrets), text);
  fs.copyFileSync(path.join(out, 'gun-drone.hover.js'), path.join(out, hover));
  write({
    ...bp,
    name: 'reactor-cannon-drone',
    kind: 'yours',
    grid,
    scripts: [
      { id: 'hover', params: { lean: 50 }, source: { file: hover } },
      { id: 'turrets', params: bp.scripts.find((s) => s.id === 'turrets').params, source: { file: turrets } },
    ],
    bindings: [{ key: 'p', mode: 'toggle', target: 'smallreactor', channel: 'push', value: 3 }],
  });
}
