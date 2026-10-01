import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import { DEFAULT_LIMITS, type ScriptHost, type ScriptInput, type ScriptInstance } from '../src/script/types';
import { layoutJson, layoutPatch, numberCount, type LayoutPart, type ScriptFrame } from '../src/script/frame';
import { resolveScripts } from '../src/blueprint/scripts';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { Prng } from '../src/rng/Prng';

/**
 * When a robot changes, its scripts are handed the new parts layout as a patch on the one they hold: parts that are
 * as they were keep their objects, only the others are made. These tests hold a script to exactly what it would see
 * after the whole layout was read again: the same parts in the same order with the same tags, inputs, and outputs,
 * and the same answer from every get().
 */

let inner: ScriptHost;
beforeAll(async () => {
  inner = await createQuickJsHost(variant);
});

/**
 * Checks every get() a script could ask (each type and tag, each value name on any part, and a few that are nowhere)
 * against a plain walk over `parts`, and logs how it went.
 */
const CHECK = `
  var own = Object.prototype.hasOwnProperty;
  function slow(target, channel) {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type !== target && p.tags.indexOf(target) < 0) continue;
      if (own.call(p.in, channel)) return p.in[channel];
      if (own.call(p.out, channel)) return p.out[channel];
    }
    return undefined;
  }
  function checkGets() {
    var targets = { nope: 1 };
    var names = { nope: 1 };
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      targets[p.type] = 1;
      for (var j = 0; j < p.tags.length; j++) targets[p.tags[j]] = 1;
      for (var k in p.in) names[k] = 1;
      for (var k in p.out) names[k] = 1;
    }
    var bad = 0;
    var n = 0;
    for (var t in targets) for (var c in names) {
      n++;
      if (get(t, c) !== slow(t, c)) bad++;
    }
    if (get(5, 'a') !== undefined || get(null, 'a') !== undefined || get({}, 'a') !== undefined || get(undefined, 'a') !== undefined) bad++;
    return bad + ' wrong of ' + n;
  }`;
/** Asks from its first tick, so the lists get() keeps are there when a patch comes and must follow it. */
const EAGER = `${CHECK}\n function tick() { log(checkGets()); }`;
/** Asks only from its fourth tick: until then a patch has no lists to keep up. */
const LATE = `${CHECK}\n function tick() { state.n = (state.n || 0) + 1; log(state.n > 3 ? checkGets() : 'not yet'); }`;

const TYPES = ['frame', 'gun', 'gyro', 'core'];
const TAGS = ['left', 'right', 'gun', 'turret1', 'turret1.gun', '__proto__', 'constructor', 'frame'];
const NAMES = ['a', 'b', 'c', 'fire', 'angle', 'toString'];
const pick = <T>(rng: Prng, from: readonly T[]): T => from[Math.floor(rng.next() * from.length)] as T;
const some = (rng: Prng, from: readonly string[], most: number): string[] => {
  const out: string[] = [];
  const n = Math.floor(rng.next() * (most + 1));
  for (let i = 0; i < n; i++) {
    const v = pick(rng, from);
    if (!out.includes(v)) out.push(v);
  }
  return out;
};
let made = 0;
const part = (rng: Prng): LayoutPart => {
  const id = `part${made++}`;
  return { id, type: pick(rng, TYPES), tags: [...some(rng, TAGS, 3), id], mass: 1 + Math.floor(rng.next() * 3), in: some(rng, NAMES, 2), out: some(rng, NAMES, 2) };
};

/** The next layout: some parts gone, some with other values present, some new ones, sometimes moved about. */
function change(rng: Prng, rows: readonly LayoutPart[]): LayoutPart[] {
  const kind = Math.floor(rng.next() * 8);
  let out = rows.map((r) => ({ ...r }));
  // Parts gone (every kind but one that only adds).
  if (kind !== 3) out = out.filter(() => rng.next() > 0.2);
  // Other values present on a few (a value appearing or going away).
  if (kind === 1 || kind === 4 || kind === 6) out = out.map((r) => (rng.next() < 0.2 ? { ...r, in: some(rng, NAMES, 2), out: some(rng, NAMES, 3) } : r));
  // New parts after the rest (a bay's copy).
  if (kind === 2 || kind === 3 || kind === 4) for (let i = Math.floor(rng.next() * 4); i >= 0; i--) out.push(part(rng));
  // A new part in the middle, a part with other tags, two parts changing places, a part heavier.
  if (kind === 5 && out.length > 0) out.splice(Math.floor(rng.next() * out.length), 0, part(rng));
  if (kind === 6 && out.length > 0) {
    const i = Math.floor(rng.next() * out.length);
    out[i] = { ...(out[i] as LayoutPart), tags: [...some(rng, TAGS, 3), (out[i] as LayoutPart).id] };
  }
  if (kind === 7 && out.length > 1) {
    const i = Math.floor(rng.next() * (out.length - 1));
    [out[i], out[i + 1]] = [out[i + 1] as LayoutPart, out[i] as LayoutPart];
    if (rng.next() < 0.5) out[0] = { ...(out[0] as LayoutPart), mass: 9 };
  }
  return out;
}

/** A frame for the layout with every number its own, so a value landing on the wrong part or name shows. */
function frameOf(id: number, rows: readonly LayoutPart[], salt: number, last?: { id: number; rows: readonly LayoutPart[] }): ScriptFrame {
  const numbers = new Float64Array(numberCount(rows));
  for (let i = 1; i < numbers.length; i++) numbers[i] = i * 1.25 + salt;
  numbers[0] = 1;
  const patch = last ? layoutPatch(last.rows, rows) : undefined;
  return { layout: { id, json: layoutJson(rows), ...(last && patch !== undefined ? { patch: { from: last.id, json: patch } } : {}) }, numbers, extras: '' };
}

function compile(source: string, budget = DEFAULT_LIMITS.budgetPerTick): ScriptInstance {
  const r = inner.compile(source, { name: 't.js', seed: 1, inspect: true, limits: { ...DEFAULT_LIMITS, budgetPerTick: budget } });
  if (!r.ok) throw new Error(r.error.message);
  return r.instance;
}

describe('layoutPatch: the new layout as a patch on the old', () => {
  const rows = (...ids: string[]): LayoutPart[] => ids.map((id) => ({ id, type: 'frame', tags: [id], mass: 1, in: [], out: ['x'] }));

  it('only parts gone: the gaps', () => {
    expect(layoutPatch(rows('a', 'b', 'c', 'd', 'e'), rows('a', 'c', 'd'))).toBe('[3,2,[[1,2],[4,5]]]');
    expect(layoutPatch(rows('a', 'b', 'c'), rows('b', 'c'))).toBe('[2,2,[[0,1]]]');
  });

  it('a part with other values present stands where it stood; new parts after the rest keep the order', () => {
    const now = rows('a', 'b', 'c', 'n');
    (now[1] as LayoutPart).out = ['x', 'y'];
    expect(layoutPatch(rows('a', 'b', 'c'), now)).toBe('[4,1,[[0,1],["b","frame",["b"],1,[],["x","y"],1],[2,3],["n","frame",["n"],1,[],["x"]]]]');
  });

  it('a new part before a kept one, or a part that moved, says the order is not kept', () => {
    expect(layoutPatch(rows('a', 'b'), rows('a', 'n', 'b'))).toBe('[3,0,[[0,1],["n","frame",["n"],1,[],["x"]],[1,2]]]');
    // b moved in front of a: a is found first, so b is behind the walk and made anew.
    expect(layoutPatch(rows('a', 'b', 'c'), rows('b', 'a', 'c'))).toBe('[3,0,[[1,2],["a","frame",["a"],1,[],["x"]],[2,3]]]');
  });

  it('a part with another mass stands where it stood too; one with another type or other tags is a new part', () => {
    const heavier = rows('a', 'b');
    (heavier[0] as LayoutPart).mass = 2;
    expect(layoutPatch(rows('a', 'b'), heavier)).toBe('[2,1,[["a","frame",["a"],2,[],["x"],0],[1,2]]]');
    const tagged = rows('a', 'b');
    (tagged[0] as LayoutPart).tags = ['a', 'left'];
    expect(layoutPatch(rows('a', 'b'), tagged)).toBe('[2,0,[["a","frame",["a","left"],1,[],["x"]],[1,2]]]');
    const typed = rows('a', 'b');
    (typed[0] as LayoutPart).type = 'gun';
    expect(layoutPatch(rows('a', 'b'), typed)).toBe('[2,0,[["a","gun",["a"],1,[],["x"]],[1,2]]]');
  });

  it('nothing kept: no patch', () => {
    expect(layoutPatch(rows('a', 'b'), rows('c'))).toBeUndefined();
    expect(layoutPatch([], rows('c'))).toBeUndefined();
    expect(layoutPatch(rows('a'), [])).toBeUndefined();
  });

  it('a part far down a long layout is found (past the short look ahead)', () => {
    const old = rows(...Array.from({ length: 200 }, (_, i) => `p${i}`));
    expect(layoutPatch(old, [...old.slice(0, 3), ...old.slice(150)])).toBe('[53,2,[[3,150]]]');
  });
});

describe('a script handed a patch sees what it would after the whole layout', () => {
  for (const [name, source] of [['asking get() every tick', EAGER], ['asking get() only later', LATE]] as const) {
    it(`over 60 runs of changes (parts gone, values coming and going, new parts, parts moved), ${name}`, () => {
      const rng = new Prng(7);
      let patches = 0;
      let modes = '';
      for (let run = 0; run < 60; run++) {
        const patched = compile(source);
        const whole = compile(source);
        let rows: LayoutPart[] = Array.from({ length: Math.floor(rng.next() * 25) }, () => part(rng));
        let id = run * 100 + 1;
        let last: { id: number; rows: readonly LayoutPart[] } | undefined;
        for (let step = 0; step < 8; step++) {
          const frame = frameOf(id, rows, step, last);
          if (frame.layout.patch) {
            patches++;
            modes += (JSON.parse(frame.layout.patch.json) as number[])[1];
          }
          const a = patched.tick(frame);
          const b = whole.tick({ ...frame, layout: { id, json: frame.layout.json } });
          if (!a.ok || !b.ok) throw new Error(`a script stopped: ${JSON.stringify([a, b])}`);
          // The same parts, tags, inputs, and outputs in the same order, and the frame's own reading of them.
          expect(patched.inspect?.()).toBe(whole.inspect?.());
          expect((JSON.parse(patched.inspect?.() ?? '{}') as ScriptInput).parts.map((p) => p.id)).toEqual(rows.map((r) => r.id));
          expect(a.logs).toEqual(b.logs);
          expect(a.logs[0]).toMatch(/^(0 wrong of \d+|not yet)$/);
          last = { id, rows };
          // Sometimes a tick or two on the same layout before the next change.
          if (rng.next() < 0.6) {
            id++;
            rows = change(rng, rows);
          }
        }
        patched.dispose();
        whole.dispose();
      }
      // The runs went through every kind of patch.
      expect(patches).toBeGreaterThan(150);
      for (const mode of '012') expect(modes).toContain(mode);
    });
  }

  it('a script that holds another layout than the patch is on reads the whole layout', () => {
    const rng = new Prng(3);
    const a = Array.from({ length: 10 }, () => part(rng));
    const b = a.slice(2);
    const c = b.slice(0, 5);
    const i = compile(EAGER);
    expect(i.tick(frameOf(1, a, 0)).ok).toBe(true);
    // It never saw layout 2: the patch from 2 to 3 is not for it.
    const r = i.tick(frameOf(3, c, 0, { id: 2, rows: b }));
    expect(r.ok && r.logs[0]).toMatch(/^0 wrong/);
    expect((JSON.parse(i.inspect?.() ?? '{}') as ScriptInput).parts.map((p) => p.id)).toEqual(c.map((p) => p.id));
    i.dispose();
  });

  it('a kept part object stays the same object and stays live; a part with other values present is a new object', () => {
    const rows: LayoutPart[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'frame', tags: [id], mass: 1, in: [], out: ['x'] }));
    const KEEP = `function tick() {
      if (!state.kept) state.kept = parts.slice();
      log(parts.map(function (p) { return p.id + (state.kept.indexOf(p) >= 0 ? '=' : '!') + p.out.x; }).join(' '));
      log(state.kept.map(function (p) { return p.id + ':' + p.pos.x; }).join(' '));
    }`;
    const i = compile(KEEP);
    i.tick(frameOf(1, rows, 0));
    const now = [rows[0], { ...(rows[2] as LayoutPart), out: ['x', 'y'] }, rows[3]] as LayoutPart[];
    const r = i.tick(frameOf(2, now, 100, { id: 1, rows }));
    // a and d are the objects it kept, with this tick's numbers; c was made anew; b is gone and keeps its last numbers.
    expect(r.ok && r.logs).toEqual(['a=120 c!125 d=131.25', 'a:116.25 b:21.25 c:26.25 d:127.5']);
    i.dispose();
  });

  it('costs a small part of the budget the whole layout does, and get() no longer walks every part', () => {
    const rows: LayoutPart[] = Array.from({ length: 3000 }, (_, k) => ({ id: `frame@${k}`, type: 'frame', tags: [`frame@${k}`], mass: 1, in: [], out: [] }));
    const GETS = `function tick() { for (var i = 0; i < 40; i++) get('frame@' + (i * 70), 'nothing'); }`;
    // With 6 calls a tick (60,000 steps) the whole layout of 3000 parts cannot be read.
    const whole = compile(GETS, 6);
    expect(whole.tick(frameOf(1, rows, 0))).toMatchObject({ ok: false, error: { kind: 'budget' } });
    // Handed the same parts 500 at a time, as patches, the same script gets there, 40 get()s a tick and all.
    const patched = compile(GETS, 6);
    let at: LayoutPart[] = [];
    let id = 0;
    for (let n = 500; n <= 3000; n += 500) {
      const next = rows.slice(0, n);
      expect(patched.tick(frameOf(id + 1, next, 0, id === 0 ? undefined : { id, rows: at })).ok).toBe(true);
      at = next;
      id++;
    }
    // Then it loses three parts: the patch is the three gaps, and that tick fits too.
    const fewer = rows.filter((_, k) => k !== 7 && k !== 1500 && k !== 2999);
    const frame = frameOf(id + 1, fewer, 0, { id, rows: at });
    expect(JSON.parse(frame.layout.patch?.json ?? '[]')).toEqual([2997, 2, [[7, 8], [1500, 1501], [2999, 3000]]]);
    expect(patched.tick(frame).ok).toBe(true);
    expect(patched.tick(frame).ok).toBe(true);
    expect((JSON.parse(patched.inspect?.() ?? '{}') as ScriptInput).parts).toHaveLength(2997);
    whole.dispose();
    patched.dispose();
  });
});

/** A host that notes what each script saw on each call, and how its layouts came (whole or as a patch). */
function watching(): { host: ScriptHost; seen: string[]; counts: { whole: number; patched: number } } {
  const seen: string[] = [];
  const counts = { whole: 0, patched: 0 };
  const ids = new WeakMap<object, number>();
  return {
    seen,
    counts,
    host: {
      compile(source, opts) {
        const r = inner.compile(source, { ...opts, inspect: true });
        if (!r.ok) return r;
        const i = r.instance;
        const note = (frame: ScriptFrame): void => {
          const held = ids.get(i);
          if (held !== frame.layout.id) {
            if (frame.layout.patch && frame.layout.patch.from === held) counts.patched++;
            else counts.whole++;
            ids.set(i, frame.layout.id);
          }
        };
        return {
          ok: true,
          instance: {
            params: i.params,
            setup: (frame, services) => i.setup(frame, services),
            tick: (frame, services) => {
              note(frame);
              const out = i.tick(frame, services);
              // Re-printed by Node (the sandbox prints a few doubles with more digits); key order still counts.
              const raw = i.inspect?.() ?? '';
              seen.push(`${opts.name} ${out.ok ? JSON.stringify(JSON.parse(raw)) : `stopped: ${out.error.message}`}`);
              return out;
            },
            dispose: () => i.dispose(),
          },
        };
      },
    },
  };
}

const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 300 } });
const flat = parseWorldFile(flatJson);
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');

interface Told {
  seen: string[];
  /** What each script should have seen, from the world's plain reading of the robot (`scriptProbe`), per robot call. */
  wrong: string[];
  logs: string[];
  hash: string;
  counts: { whole: number; patched: number };
  events: string[];
}

/** Runs `scene` in a world whose scripts get patches (or, with `fullLayouts`, whole layouts every time). */
async function tell(fullLayouts: boolean, file: ReturnType<typeof parseWorldFile>, gravityY: number | undefined, scene: (w: World) => void): Promise<Told> {
  const { host, seen, counts } = watching();
  const wrong: string[] = [];
  let expected = '';
  let from = 0;
  const w = await World.create(
    {
      seed: 1,
      scripts: host,
      fullLayouts,
      ...(gravityY !== undefined ? { gravityY } : {}),
      // Before a robot's scripts run: check the calls of the robot before it, then note what this one should see.
      scriptProbe: (_robot: number, reference: () => ScriptInput) => {
        for (const s of seen.slice(from)) if (s.slice(s.indexOf(' ') + 1) !== expected && wrong.length < 3) wrong.push(`saw ${s.slice(0, 400)}\nnot ${expected.slice(0, 400)}`);
        from = seen.length;
        expected = JSON.stringify(reference());
      },
    },
    file,
  );
  scene(w);
  const logs = w.scriptLogs.map((l) => `${l.tick} ${l.robot} ${l.script} ${l.text}`);
  const out = { seen, wrong, logs, hash: w.hash(), counts, events: w.events.map((e) => e.kind) };
  w.dispose();
  return out;
}

/** Logs a line only when a get() is wrong, and a count now and then to show it is checking. */
const WATCH = `${CHECK}\n function tick() { var r = checkGets(); if (r.indexOf('0 wrong') !== 0) log(r); else if (frame % 40 === 0) log('ok ' + r); }`;

describe('in the world: a patched layout against the whole layout every time', () => {
  it('through losses, a split, a decoupled piece, and a value going away and coming back', async () => {
    const press = [{ key: 'v', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }];
    const bp = {
      format: 1,
      name: 'bot',
      grid: ['.  .  .  F  F  F  .  .  .', 'G  F  F  B  C  O  D> F  E', '.  .  .  F  M> F  .  .  .'],
      bindings: press,
      scripts: [
        { id: 'watch', source: WATCH },
        { id: 'second', source: 'function tick() {}' },
      ],
    };
    let bot: Robot | undefined;
    const scene = (w: World): void => {
      const r = w.spawnBlueprint(bp, { x: 0, y: 300 });
      bot = r;
      w.kickRobot(r, 2, 1, 0.1);
      const lose = (id: string): void => {
        const p = r.parts.get(id);
        if (!p) throw new Error(`no ${id}`);
        p.health = 0;
      };
      const battery = r.parts.get('battery@3,1');
      if (!battery) throw new Error('no battery');
      const stored = battery.stored;
      for (let t = 0; t < 70; t++) {
        // Losses that leave it whole: a corner of each row, then two on one tick.
        if (t === 5) lose('frame@3,2');
        if (t === 9) lose('frame@5,0');
        if (t === 10) {
          lose('frame@5,2');
          lose('gun@4,0');
        }
        // A value going away (the battery's charge output is gone while it holds nothing to read), then coming back.
        if (t === 16) delete battery.stored;
        if (t === 22 && stored !== undefined) battery.stored = stored;
        // A split: the frame that holds the gyro's arm on.
        if (t === 30) lose('frame@2,1');
        // A decoupled piece: the frame and the cell on its far side.
        w.step(t === 40 ? [{ robot: r.id, pressed: ['v'], released: [] }] : []);
      }
    };
    const patched = await tell(false, space, 0, scene);
    const whole = await tell(true, space, 0, scene);
    // The scene did what it was built for.
    expect(patched.events.filter((e) => e === 'split').length).toBeGreaterThanOrEqual(2);
    expect(patched.events).toContain('decoupled');
    expect(bot?.parts.size).toBe(6);
    // What every script saw on every call: the same text either way, and what the world's plain reading says.
    expect(patched.seen.length).toBeGreaterThan(130);
    expect(patched.seen).toEqual(whole.seen);
    expect(patched.wrong).toEqual([]);
    expect(whole.wrong).toEqual([]);
    expect(patched.logs).toEqual(whole.logs);
    expect(patched.logs.length).toBeGreaterThan(0);
    for (const l of patched.logs) expect(l).toMatch(/ ok 0 wrong of \d+$/);
    expect(patched.hash).toBe(whole.hash);
    // Seven changes (three ticks of losses, the value gone, the value back, the split, the piece let go) for each of
    // the two scripts: all patches in one world, all whole layouts in the other.
    expect(patched.counts).toEqual({ whole: 2, patched: 14 });
    expect(whole.counts).toEqual({ whole: 16, patched: 0 });
  });

  it('through a bay finishing a copy and letting it go (the copy wakes and runs its own script)', async () => {
    const missileUp = resolveScripts(JSON.parse(bpFile('missile-up.json')), bpFile).raw;
    const bp = {
      format: 1,
      name: 'bay-bot',
      parts: [
        { part: 'core', x: 0, y: 0 },
        { part: 'densebattery', x: -1, y: 0 },
        { part: 'densebattery', x: 1, y: 0 },
        { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' },
      ],
      recipes: { item: missileUp },
      bindings: [{ key: 'r', mode: 'pulse', target: 'bay', channel: 'release', value: 1 }],
      scripts: [{ id: 'watch', source: WATCH }],
    };
    const scene = (w: World): void => {
      const r = w.spawnBlueprint(bp, { x: -100, y: 0.5 });
      for (let t = 0; t < 320; t++) w.step(t === 270 ? [{ robot: r.id, pressed: ['r'], released: [] }] : t === 271 ? [{ robot: r.id, pressed: [], released: ['r'] }] : []);
    };
    const patched = await tell(false, flat, undefined, scene);
    const whole = await tell(true, flat, undefined, scene);
    expect(patched.events).toContain('built');
    expect(patched.events).toContain('released');
    expect(patched.events).toContain('coreWoke');
    expect(patched.seen.length).toBeGreaterThan(330);
    expect(patched.seen).toEqual(whole.seen);
    expect(patched.wrong).toEqual([]);
    expect(whole.wrong).toEqual([]);
    expect(patched.logs).toEqual(whole.logs);
    for (const l of patched.logs.filter((x) => x.includes(' watch '))) expect(l).toMatch(/ ok 0 wrong of \d+$/);
    expect(patched.hash).toBe(whole.hash);
    // The copy's parts joining and leaving came to the bay's script as patches.
    expect(patched.counts.patched).toBeGreaterThanOrEqual(2);
    expect(whole.counts.patched).toBe(0);
  });
});
