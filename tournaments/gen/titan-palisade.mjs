// titan-palisade (titans tournament, builder 5, theme: gun wall).
// Run: node tournaments/gen/titan-palisade.mjs
// Writes blueprints/titan-palisade.json and a copy of blueprints/titan-palisade.keep.js for every panel
// (titan-palisade.p<N>.panel.js: the validator wants one file per script). Edit the keep's file, then run this again:
// the keep and the panels fly the same code, told apart by the `role` param.
//
// The titan is one column of modules bolted through a link column (x 3), each held by the decoupler on top of the one
// below: BELOW gun panels (none: the keep is at the bottom so nothing rests on it), the keep (the main core), then
// ABOVE gun panels. On the first tick the keep fires every
// link, each panel's own core wakes, and the panels fly as a ring of guns around the enemy's main robot.
// A panel: three decks of propellers, a front wall with three batteries (one rotator swinging a bar of five guns),
// one single gun at the back, thrusters in the link column for moving sideways without leaning.
import { copyFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'titan-palisade';
const BELOW = Number(process.env.BELOW ?? 0);
const ABOVE = Number(process.env.ABOVE ?? 10);
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../blueprints');

const cells = new Map(); // "x,y" -> token
const legend = {};
const cores = {};
let top = 0; // the next free row

function put(x, y, token) {
  const k = x + ',' + y;
  if (cells.has(k)) throw new Error('two parts at ' + k);
  cells.set(k, token);
}

/** A legend token for `part` in module `scope` ('' for the keep, whose parts keep plain tags). */
function tok(scope, key, part, rot, tags, extra) {
  const name = key + scope;
  if (!legend[name]) {
    const all = scope === '' ? tags : [scope, ...tags.map((t) => scope + '.' + t)];
    legend[name] = { part, rot, ...(all.length > 0 ? { tags: all } : {}), ...extra };
  }
  return name;
}

const T = (scope) => ({
  f: tok(scope, 'f', 'frame', 0, []),
  a: tok(scope, 'a', 'armorplate', 0, []),
  z: tok(scope, 'z', 'densebattery', 0, []),
  c: tok(scope, 'c', 'core', 0, []),
  o: tok(scope, 'o', 'radar', 0, []),
  d: tok(scope, 'd', 'decoupler', 0, ['link']),
  ta: tok(scope, 'ta', 'thruster', 270, ['ta'], { auto: false }),
  tb: tok(scope, 'tb', 'thruster', 90, ['tb'], { auto: false }),
  prop: (g) => tok(scope, g, 'propeller', 0, [g], { auto: false }),
  // A turret `n`: rotator and gun facing right (270), left (90), or down (180).
  rot: (n, r) => tok(scope, 'r' + n + '_', 'rotator', r, ['t' + n + '.rot'], { auto: false }),
  gun: (n, r) => tok(scope, 'g' + n + '_', 'gun', r, ['t' + n + '.gun']),
});

/**
 * A gun panel with its bottom row at `y0`: three batteries on its front wall, a single gun on its back.
 * Returns its height (the link decoupler's row included).
 */
function panel(index, y0, link) {
  const scope = 'p' + (index + 1);
  const t = T(scope);
  const H = 18;
  // The link column: frames and thrusters (three pushing forward, three back).
  const fwd = new Set([1, 7, 13]);
  const back = new Set([3, 9, 15]);
  for (let y = 0; y < H; y++) put(3, y0 + y, fwd.has(y) ? t.ta : back.has(y) ? t.tb : t.f);
  // Three decks, ten propellers on each.
  for (const dy of [4, 10, 16]) {
    for (let x = 4; x <= 13; x++) {
      let token = t.f;
      if (dy === 10 && x === 8) token = t.c;
      else if (dy === 10 && x === 9) token = t.o;
      else if (dy === 10 && (x === 4 || x === 5 || x === 6 || x === 7)) token = t.z;
      else if (dy !== 10 && (x === 4 || x === 5)) token = t.z;
      put(x, y0 + dy, token);
    }
    for (let x = 5; x <= 13; x++) put(x, y0 + dy + 1, t.prop(x <= 9 ? 'pa' : 'pb'));
  }
  // The front wall and its three batteries (t1 to t3).
  for (let y = 0; y <= 16; y++) put(14, y0 + y, t.f);
  [2, 8, 14].forEach((r, i) => {
    put(15, y0 + r, t.rot(i + 1, 270));
    for (let k = -2; k <= 2; k++) {
      put(16, y0 + r + k, t.f);
      put(17, y0 + r + k, t.gun(i + 1, 270));
    }
  });
  // One single gun facing back (t4). Two-faced panels were tried in round 2: half the guns never bore on the enemy.
  put(2, y0 + 8, t.rot(4, 90));
  put(1, y0 + 8, t.gun(4, 90));
  if (link) put(3, y0 + H, t.d);
  cores['core@8,' + (y0 + 10)] = {
    scope,
    scripts: [{ id: 'panel', params: { role: 0, slot: index, count: BELOW + ABOVE, debug: Number(process.env.DEBUG ?? 0) }, source: { file: NAME + '.' + scope + '.panel.js' } }],
  };
  return H + 1;
}

/**
 * The keep (round 2): the main core over a belly of armor, four decks of propellers pushing up and three rows
 * pushing down (`pd`) so it can step out of a ram's way either way, eight thrusters each way, six single guns.
 */
function keep(y0, link) {
  const t = T('');
  const pd = tok('', 'pd', 'propeller', 180, ['pd'], { auto: false });
  const mounts = new Set([1, 3, 6, 9, 12]);
  const fwd = new Set([0, 4, 7, 10]);
  for (let y = 0; y <= 12; y++) {
    const token = mounts.has(y) ? t.f : fwd.has(y) ? t.ta : t.tb;
    put(3, y0 + y, token);
    put(15, y0 + y, token);
  }
  const rows = {
    0: 'a a a a a a a a a a a',
    1: 'z z z z a c a z z z o',
    2: 'z z z z f a f z z z f',
  };
  for (const [dy, row] of Object.entries(rows)) row.split(' ').forEach((k, i) => put(4 + i, y0 + Number(dy), t[k]));
  for (const dy of [3, 6, 9, 12]) {
    for (let x = 4; x <= 14; x++) {
      put(x, y0 + dy, t.f);
      put(x, y0 + dy + 1, t.prop(x <= 9 ? 'pa' : 'pb'));
      if (dy > 3 && x >= 6 && x <= 12) put(x, y0 + dy - 1, pd);
    }
  }
  [1, 6, 12].forEach((r, i) => {
    put(16, y0 + r, t.rot(2 * i + 1, 270));
    put(17, y0 + r, t.gun(2 * i + 1, 270));
    put(2, y0 + r, t.rot(2 * i + 2, 90));
    put(1, y0 + r, t.gun(2 * i + 2, 90));
  });
  if (link) put(3, y0 + 13, t.d);
  return { height: 14, core: 'core@9,' + (y0 + 1) };
}

let slot = 0;
for (let i = 0; i < BELOW; i++) top += panel(slot++, top, true);
const k = keep(top, ABOVE > 0);
top += k.height;
for (let i = 0; i < ABOVE; i++) top += panel(slot++, top, i < ABOVE - 1);

const width = 18;
const grid = [];
for (let y = top - 1; y >= 0; y--) {
  const row = [];
  for (let x = 0; x < width; x++) row.push(cells.get(x + ',' + y) ?? '.');
  if (row.some((c) => c !== '.') || grid.length > 0) grid.push(row.join(' '));
}

const blueprint = {
  format: 1,
  name: NAME,
  grid,
  legend,
  primaryCore: k.core,
  autoControls: false,
  bindings: [],
  scripts: [{ id: 'keep', params: { role: 1, slot: 0, count: BELOW + ABOVE }, source: { file: NAME + '.keep.js' } }],
  cores,
};
writeFileSync(resolve(OUT, NAME + '.json'), JSON.stringify(blueprint, null, 1) + '\n');
for (const c of Object.values(cores)) copyFileSync(resolve(OUT, NAME + '.keep.js'), resolve(OUT, c.scripts[0].source.file));
console.log(`${NAME}: ${cells.size} parts, ${BELOW + ABOVE} panels, main core ${k.core} (${top} rows tall)`);
