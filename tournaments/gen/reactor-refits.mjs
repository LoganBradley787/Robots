// The reactor refits (2026-10-31): stock robots with their dense batteries swapped for reactors, the stock robots left
// as they are, so a stock robot and its refit can be fought against each other. Run from anywhere after any change to
// the stock robots: node tournaments/gen/reactor-refits.mjs
// Writes blueprints/titan-mirage-r.json, titan-anvil-r.json and its pilot, reactor-cannon-drone.json and its scripts,
// and enemy-reactor-cannon-drone.json.
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
  fs.writeFileSync(path.join(out, pilot), text);
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
