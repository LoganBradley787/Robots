// The reactor refits (2026-10-31): stock robots with their dense batteries swapped for reactors, the stock robots left
// as they are, so a stock robot and its refit can be fought against each other. Run from anywhere after any change to
// the stock robots: node tournaments/gen/reactor-refits.mjs
// Writes blueprints/titan-<name>-r.json for all eight titans and the pilots they patch, titan-mirage-rw.json,
// reactor-cannon-drone.json and its scripts, and enemy-reactor-cannon-drone.json.
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

// ---- titan-mirage-rw: titan-mirage-r with a second script that repairs it, paid in parts. Nothing else differs. ----
{
  const bp = read('titan-mirage-r');
  const repair = { id: 'repair', params: { repair: 1 }, source: { file: 'titan-mirage-rw.repair.js' } };
  write({ ...bp, name: 'titan-mirage-rw', scripts: [...bp.scripts, repair] });
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
  // And beams, three new turrets on the top of the middle block, over the bays and the core: what ends a Hive is darts
  // digging down to its core, with most of the ship unhurt. On the shoulders' roofs they could not see over the bays.
  [51, 57, 63].forEach((col, i) => {
    const name = `tur${13 + i}`;
    legend[`q${13 + i}`] = { part: 'rotator', rot: 0, tags: [name, `${name}.rot`], auto: false };
    legend[`m${13 + i}`] = { part: 'laser', rot: 0, tags: [name, `${name}.gun`] };
    cells[2][col] = `q${13 + i}`;
    cells[1][col] = `m${13 + i}`;
    cells[0][col] = '=';
  });
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
  // The turrets take lasers as they do guns: a beam arrives at once, and holds fire with the darts under that floor.
  text = patch(text, "    } else if (type === 'gun' || type === 'rotator') {\n", "    } else if (type === 'gun' || type === 'laser' || type === 'rotator') {\n");
  text = patch(text, "        if (type === 'gun') {\n          e.gun = p;\n", "        if (type !== 'rotator') {\n          e.gun = p;\n");
  text = patch(text, '    const l = lead(c, fx, fy);\n', "    const l = lead(c, fx, fy, t.gun.type === 'laser' ? 1e7 : shell);\n");
  text = patch(text, 'function lead(c, fx, fy) {\n', 'function lead(c, fx, fy, speed) {\n');
  text = patch(text, '  let t = Math.sqrt(rx * rx + ry * ry) / shell;\n', '  let t = Math.sqrt(rx * rx + ry * ry) / speed;\n');
  text = patch(text, '    t = Math.sqrt(px * px + py * py) / shell;\n', '    t = Math.sqrt(px * px + py * py) / speed;\n');
  text = patch(text, '  state.saving = !spare;\n', "  state.saving = !spare;\n  state.beams = stored >= least;\n");
  text = patch(text, "  set(gunTag, 'fire', st.firing ? 1 : 0);\n}\n", "  set(gunTag, 'fire', st.firing && (state.beams || t.gun.type !== 'laser') ? 1 : 0);\n}\n");
  fs.writeFileSync(path.join(out, pilot), text);
}

// ---- titan-bastion-r: 8 reactors, 9.6 kW against 4.5 kW of bays, and six beam turrets in place of its six guns. ----
{
  const bp = read('titan-bastion');
  const cells = cellsOf(bp);
  // All its bays together draw less than 4 reactors make, and across a match it used a third of its pool: power was
  // never what held it back, and a swap by mass would change nothing but how long it can go on. What a fortress could
  // not do was hit what stands off from it: a gun's shell scratches and gunships hang at 270 m. So the power buys beams,
  // which burn what they touch at 300 m, a dart in a tick and a gunship's core in a few. In the battery banks under the
  // dart bays, between the anchors, with five rows of plate over them and a floor under them, 25 m and more from the
  // core. 182 of 254 batteries stay, 1.1 MJ, because six beams take 14.4 kW. It is 600 kg heavier, 1.5 percent of 40 t,
  // and a fortress pays nothing for that.
  for (const col of [11, 21, 31, 41, 97, 107, 117, 127]) putReactor(cells, 27, col);
  const legend = { ...bp.legend };
  for (let i = 1; i <= 6; i++) legend[`m${i}`] = { ...legend[`m${i}`], part: 'laser' };
  // A laser stands two cells tall where a gun stood one: one more row on top.
  cells.unshift(cells[0].map((t) => (t in legend ? '=' : '.')));
  const pilot = 'titan-bastion-r.pilot.js';
  write({ ...bp, name: 'titan-bastion-r', grid: gridOf(cells), legend, scripts: bp.scripts.map((s) => (s.id === 'pilot' ? { ...s, parts: s.parts?.map((t) => (t === 'gun' ? 'laser' : t)), params: { ...s.params, reach: 295 }, source: { file: pilot } } : s)), bindings: [...(bp.bindings ?? []), PUSH_KEY] });

  // The turrets aim the same way but for what a beam does not need: no lead for the shell's flight, no drop. It fires
  // only on a sight that reads an enemy, because a beam on nothing costs what a beam on something does.
  let text = fs.readFileSync(path.join(out, 'titan-bastion.pilot.js'), 'utf8');
  text = patch(text, "    } else if (p.type === 'gun') {\n", "    } else if (p.type === 'laser') {\n");
  text = patch(text, '    const flight = d / 300;\n', '    const flight = 0; // a beam arrives at once\n');
  text = patch(text, '    const ok = d < reach && Math.abs(err) < Math.max(0.012, 1.2 / d) && side !== 1 && side !== 2;\n', '    const ok = d < reach && Math.abs(err) < Math.max(0.012, 1.2 / d) && side === 3;\n');
  fs.writeFileSync(path.join(out, pilot), text);
}

// ---- titan-woodpecker-r: 24 small reactors, 5.8 kW against up to 6.3 kW of bays with 2 more burner bays. ----
{
  const bp = read('titan-woodpecker');
  const cells = cellsOf(bp);
  // Small ones, in the base's battery row, one in six along it so none chains. A big one will not do: the base is three
  // rows thin, so one would stand on all three and cut off that end when shot out; and in the keep they are the way in.
  // Tried with 6 in the keep's top corners: the burners of the other side went through them, 3 plates of line for 300
  // health, and it lost to stock with 12 to 27 percent of its parts left. 137 of 161 batteries stay. It is heavier by
  // what those reactors weigh over the batteries they replace, about 400 kg, 4 percent of 9 t, and a ground titan pays
  // nothing for that.
  const zs = [];
  for (let col = 1; col < 81; col++) if (cells[24][col] === 'Z') zs.push(col);
  zs.filter((_, i) => i % 6 === 3).forEach((col) => {
    if (cells[24][180 - col] !== 'Z') throw new Error('the base is not even');
    cells[24][col] = 'rc';
    cells[24][180 - col] = 'rc';
  });
  // What the power buys is more of what it is: burners. Across a match the rack's darts are spent in seconds and a
  // burner bay goes on for good, so the two pairs of darts at the rack's outer ends make way for a burner bay each.
  const legend = { ...bp.legend };
  const cores = { ...bp.cores };
  [19, 158].forEach((x0, i) => {
    if (bp.legend[cells[22][i ? x0 - 1 : x0]]?.part !== 'decoupler') throw new Error('the rack moved');
    for (let col = x0 - (i ? 1 : 0); col <= x0 + (i ? 3 : 4); col++) {
      for (let row = 16; row <= 22; row++) cells[row][col] = '.';
      delete cores[`core@${col},7`];
    }
    const tok = `w${5 + i}`;
    legend[tok] = { ...legend.w1, tags: [`c${5 + i}x`] };
    cells[22][x0 + 1] = tok;
    cells[22][x0 + 2] = '=';
    for (let row = 13; row <= 22; row++) for (const col of [x0, x0 + 3]) cells[row][col] = '=';
  });
  write({ ...bp, name: 'titan-woodpecker-r', grid: gridOf(cells), legend, cores, bindings: [...(bp.bindings ?? []), { ...PUSH_KEY, target: 'smallreactor' }] });
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
  // The reactor hangs off the back of the link column, above the back gun: a panel turns its guns to the enemy, so
  // that is the side least shot at, 6 m from the core, and nothing near it but the column. On the top deck's end, among
  // the propellers, a shot-out reactor took the deck with it, and a panel lost one every 40 s. Four batteries stay on
  // the two lower decks, 24 kJ, two minutes in the air if the reactor goes; the other four turn to frames, because the
  // decks are what tie the link column to the gun wall. +12 kg a panel.
  for (const [key, core] of Object.entries(bp.cores)) {
    const y = Number(key.split(',')[1]); // the panel's core row, up from the bottom
    const n = core.scope.slice(1);
    const [top1, top2, m1, m2, m3, m4, bot1, bot2] = where(`zp${n}`).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    if (!bot2) throw new Error(`panel ${n} moved`);
    const spot = [cells.length - 1 - (y + 2), 2];
    if (cells[spot[0]][spot[1]] !== '.' || cells[spot[0]][3] !== `fp${n}`) throw new Error(`panel ${n} has no room for its reactor`);
    cells[spot[0]][spot[1]] = 'rc';
    for (const [row, col] of [top1, top2, m3, m4]) cells[row][col] = `fp${n}`;
  }
  // The keep: at both ends of its top deck, 12 m from its core, 480 W against about 400 W of flying. Eleven of its 14
  // belly batteries turn to frames, tougher than batteries that close to the core, and nine stay, 54 kJ.
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
  // badly: at the shelf's right end, 3 m from the core, a third of the ships tipped over. Every cell stays filled, in
  // frames: holes in the shelf lock the ships together as they come apart, and most of them fell; holes in the body
  // leave a blast fewer parts to halve through, and they went down faster to the Woodpecker's darts. Three batteries
  // stay of 11, next to the core and at the shelf's right end to balance the reactor. That is 19 kJ against 67, because
  // weight decides the first 30 s and energy does not: a ship spends about 5 kJ in that time, and with six batteries,
  // +5 kg a ship, it lost to stock 1-1-4. This is +3 kg, 5 percent in all.
  const shipCols = [4, 18, 32]; // each column's left laser mount
  let ships = 0;
  for (let row = 7; row < cells.length; row += 4) {
    for (const x0 of shipCols) {
      for (let dx = 2; dx <= 8; dx++) if (!dense(cells[row][x0 + dx])) throw new Error(`the shelf at row ${row} moved`);
      if (!dense(cells[row - 1][x0 + 3]) || !dense(cells[row - 1][x0 + 7])) throw new Error(`the body at row ${row - 1} moved`);
      cells[row][x0 + 3] = 'rc';
      for (const dx of [2, 4, 5, 6, 7]) cells[row][x0 + dx] = 'F';
      cells[row - 1][x0 + 2] = 'F';
      cells[row - 1][x0 + 8] = 'F';
      ships++;
    }
  }
  if (ships !== 30) throw new Error(`${ships} gunships`);
  // The king: one reactor at the left end of its battery row, 6 m from its core: its hover is about 170 W, and its fall
  // is what ends a match. Five batteries from the far ends of the row make its weight, 4 stay beside the core, 24 kJ.
  // It has to weigh what stock does. Tried with a reactor at each end and all ten batteries, 34 kg heavier: with even
  // gunships it fell to the Woodpecker 0-1-5, stock 3-0-3. Tried with the same two and the batteries by the core gone:
  // a dart's blast halves for each part in its way, and it fell 17 s sooner.
  const kingRow = 2;
  if (!dense(cells[kingRow][16])) throw new Error('the king moved');
  cells[kingRow][16] = 'rc';
  for (const col of [17, 18, 26, 27, 28]) {
    if (!dense(cells[kingRow][col])) throw new Error('the king moved');
    cells[kingRow][col] = '.';
  }
  // Flying is paid for: all that is kept back is `spare`, a tenth of what stock keeps, so a gunship spends its pool on
  // beams at once and then burns what comes in. flyDraw is what flying costs over its reactor.
  const cores = Object.fromEntries(
    Object.entries(bp.cores).map(([k, c]) => [k, { ...c, bindings: [...(c.bindings ?? []), SMALL_KEY], scripts: c.scripts.map((s) => ({ ...s, params: { ...s.params, flyDraw: 0, spare: 1000, keepOpen: 1000 } })) }]),
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
