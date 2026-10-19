import { beforeAll, describe, expect, it } from 'vitest';
import nodeBuild from '@jitl/quickjs-wasmfile-release-sync';
import browserBuild from '@jitl/quickjs-singlefile-browser-release-sync';
import type { QuickJSSyncVariant } from 'quickjs-emscripten-core';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost, ScriptInput, ScriptServices } from '../src/script/types';
import { inputToFrame, type ScriptFrame } from '../src/script/frame';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

/**
 * Review D2: a stack overflow always stops the script, whoever notices it first (QuickJS's own check or the host's
 * stack), whether the script catches the error or not, and however deep the host's own stack already is. The app
 * runs the single-file browser build and Node the wasm-file build: both are checked here, in Node.
 */
const NODE = 'wasm-file build (Node)';
const builds: [string, QuickJSSyncVariant][] = [
  [NODE, nodeBuild],
  ['single-file build (browser)', browserBuild],
];
const hosts = new Map<string, ScriptHost>();
beforeAll(async () => {
  for (const [name, build] of builds) hosts.set(name, await createQuickJsHost(build));
});
const hostOf = (name: string): ScriptHost => {
  const h = hosts.get(name);
  if (!h) throw new Error(`no host ${name}`);
  return h;
};

let layouts = 0;
const plain = (): ScriptInput => ({
  frame: 1,
  dt: 1 / 60,
  time: 1 / 60,
  self: { pos: { x: 0, y: 5 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0, mass: 10, energy: { stored: 600, capacity: 600 } },
  parts: [],
  keys: { down: [], pressed: [], released: [] },
  contacts: [],
  inbox: [],
});
const input = (): ScriptFrame => inputToFrame(plain(), ++layouts);

/** Calls `fn` from `n` host frames down. Not a tail call: each level keeps its frame. */
function deep<T>(n: number, fn: () => T): T {
  if (n <= 0) return fn();
  const r = deep(n - 1, fn);
  return r;
}

/** How many `deep` frames this thread's stack holds, measured the same way it is used. */
function hostFrames(): number {
  let lo = 0;
  let hi = 1 << 20;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    let fits = true;
    try {
      deep(mid, () => 0);
    } catch {
      fits = false;
    }
    if (fits) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const STACK = { kind: 'stack', message: 'recursed too deep (stack overflow)' };

/** Ways deep recursion can go, each inside a try/catch that tries to carry on and write. */
const shapes: Record<string, string> = {
  plain: `function f() { f(); } f();`,
  'many locals': `function f(a, b, c, d) { var x1 = a, x2 = b, x3 = c, x4 = d, x5, x6, x7, x8; f(x1, x2, x3, x4); } f(1, 2, 3, 4);`,
  'through map': `function f() { [1].map(f); } f();`,
  'through call': `function f() { f.call(null); } f();`,
  'a getter': `var o = {}; Object.defineProperty(o, 'x', { get: function () { return o.x; } }); o.x;`,
  valueOf: `var o = { valueOf: function () { return o + 1; } }; o + 1;`,
  'a proxy': `var p = new Proxy({}, { get: function (t, k) { return p[k]; } }); p.x;`,
  'a constructor': `function F() { new F(); } new F();`,
  'a generator': `function* g() { yield* g(); } g().next();`,
  toJSON: `var o = { toJSON: function () { return JSON.stringify(o); } }; JSON.stringify(o);`,
  'a sort comparator': `function f() { [2, 1].sort(function () { f(); return 0; }); } f();`,
  'nested arrays to text': `var a = []; for (var i = 0; i < 20000; i++) a = [a]; String(a);`,
  'nested arrays to JSON': `var a = []; for (var i = 0; i < 20000; i++) a = [a]; JSON.stringify(a);`,
  'deeply nested source': `eval('('.repeat(20000) + '1' + ')'.repeat(20000));`,
  'deeply nested JSON text': `JSON.parse('['.repeat(20000) + ']'.repeat(20000));`,
  'a deeply nested regex': `new RegExp('(?:'.repeat(5000) + 'a' + ')'.repeat(5000)).exec('a');`,
};

describe.each(builds)('a stack overflow is always fatal: %s', (name) => {
  const compile = (src: string) => {
    const r = hostOf(name).compile(src, { name: 'test.js', seed: 7 });
    if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
    return r.instance;
  };

  it('endless recursion stops the script', () => {
    const s = compile(`function f(n) { return f(n + 1) + 1; } function tick() { f(0); }`);
    expect(s.tick(input())).toEqual({ ok: false, error: STACK });
    s.dispose();
  });

  it('endless recursion inside try/catch still stops the script, and nothing it does after reaches the world', () => {
    const sent: string[] = [];
    const services: ScriptServices = { scan: () => [], send: (to) => (sent.push(to), true) };
    const s = compile(`function f() { f(); } function tick() { try { f(); } catch (e) { log('caught ' + e.message); } set('a', 'b', 1); send('child', { hi: 1 }); }`);
    expect(s.tick(input(), services)).toEqual({ ok: false, error: STACK });
    expect(sent).toEqual([]);
    s.dispose();
  });

  it('a script that catches the overflow and keeps recursing is stopped for its stack, not its budget', () => {
    const s = compile(`function f() { f(); } function tick() { while (true) { try { f(); } catch (e) {} } }`);
    expect(s.tick(input())).toEqual({ ok: false, error: STACK });
    s.dispose();
  });

  it('a finally that returns cannot swallow it either', () => {
    const s = compile(`function f() { try { f(); } finally { return 1; } } function tick() { f(); set('a', 'b', 1); }`);
    expect(s.tick(input())).toEqual({ ok: false, error: STACK });
    s.dispose();
  });

  it('an overflow caught by the prelude (send of a value whose toJSON recurses) is fatal too', () => {
    const s = compile(`var o = { toJSON: function () { return JSON.stringify(o); } }; function tick() { send('x', o); set('a', 'b', 1); }`);
    expect(s.tick(input(), { scan: () => [], send: () => true })).toEqual({ ok: false, error: STACK });
    s.dispose();
  });

  it('recursion in top-level code stops the compile', () => {
    const r = hostOf(name).compile(`function f() { f(); } try { f(); } catch (e) {} function tick() {}`, { name: 'top.js', seed: 1 });
    expect(r).toEqual({ ok: false, error: STACK });
  });

  for (const [shape, src] of Object.entries(shapes)) {
    it(`caught, through ${shape}`, () => {
      const s = compile(`function tick() { try { ${src} } catch (e) { log(e.name + ': ' + e.message); } set('a', 'b', 1); }`);
      expect(s.tick(input())).toEqual({ ok: false, error: STACK });
      expect(() => s.dispose()).not.toThrow();
    });
  }

  it('moderate recursion keeps working, every tick', () => {
    const s = compile(`
      function depth(n) { return n === 0 ? 0 : 1 + depth(n - 1); }
      function walk(node) { var n = 1; for (var i = 0; i < node.kids.length; i++) n += walk(node.kids[i]); return n; }
      function chain(n) { var root = { kids: [] }, at = root; for (var i = 0; i < n; i++) { var k = { kids: [] }; at.kids.push(k); at = k; } return root; }
      var a = []; for (var i = 0; i < 100; i++) a = [a];
      function tick() { set('r', 'depth', depth(200)); set('r', 'walk', walk(chain(100))); set('r', 'json', JSON.stringify(a).length); set('r', 'parse', JSON.parse(JSON.stringify(a)).length); }`);
    for (let i = 0; i < 3; i++) {
      expect(s.tick(input())).toMatchObject({ ok: true, writes: [{ value: 200 }, { value: 101 }, { value: 202 }, { value: 1 }] });
    }
    s.dispose();
  });

  it('after a crash, even one that ran the host out of stack, other scripts keep their full stack', () => {
    // How deep a script gets before it is stopped, in steps of 10 calls: the last tick that still ran.
    const counter = `var n = 0; function down(k) { if (k > 0) down(k - 1); } function tick() { n += 10; down(n); set('r', 'n', n); }`;
    const reach = (s: ReturnType<typeof compile>): number => {
      let reached = 0;
      for (let i = 0; i < 1000; i++) {
        const r = s.tick(input());
        if (!r.ok) break;
        reached = r.writes[0]?.value ?? 0;
      }
      s.dispose();
      return reached;
    };
    // Compiled before the crashes, run after them.
    const later = compile(counter);
    const before = reach(compile(counter));
    expect(before).toBeGreaterThan(300);
    // Deeply nested source runs the parser through the host's own stack before QuickJS's check notices.
    for (const src of [`function d() { d(); } function tick() { d(); }`, `function tick() { eval('['.repeat(200000)); }`, `function tick() { var a = []; for (var i = 0; i < 200000; i++) a = [a]; JSON.stringify(a); }`]) {
      const bad = compile(src);
      expect(bad.tick(input())).toEqual({ ok: false, error: STACK });
      expect(() => bad.dispose()).not.toThrow();
    }
    expect(reach(later)).toBe(before);
    expect(reach(compile(counter))).toBe(before);
  });
});

describe('a host whose stack keeps running out', () => {
  it('stops running scripts once those crashes have used up a megabyte of the wasm stack', async () => {
    const own = await createQuickJsHost(nodeBuild);
    const refused = { ok: false, error: { kind: 'stack', message: 'too many scripts ran the stack out in this session: reload to run scripts again' } };
    let crashes = 0;
    for (; crashes < 500; crashes++) {
      const r = own.compile(`function tick() { eval('['.repeat(200000)); }`, { name: 'bad.js', seed: 1 });
      if (!r.ok) {
        expect(r).toEqual(refused);
        break;
      }
      expect(r.instance.tick(input())).toEqual({ ok: false, error: STACK });
      r.instance.dispose();
    }
    // Each crash leaves the wasm stack pointer at most 72 KB lower (`stackBytes` plus the guard).
    expect(crashes).toBeGreaterThan(1024 / 72);
    expect(own.compile(`function tick() {}`, { name: 'ok.js', seed: 1 })).toEqual(refused);
  });
});

describe('the outcome does not depend on the host', () => {
  const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
  const lifter = (source: string) => ({ format: 1, name: 'lifter', grid: ['F  T^ C  T^ F'], scripts: [{ id: 'lift', source }] });
  // A script that recurses a little every tick, then at frame 40 recurses forever inside a try/catch and, if it got
  // away with it, would write a different throttle from then on. Another robot recurses moderately all along.
  const greedy = `function d(n) { return n === 0 ? 0 : 1 + d(n - 1); }
    function f() { f(); }
    function tick() {
      var t = d(100) / 400;
      if (frame >= 40) { try { f(); } catch (e) { t = 1; } }
      set('thruster', 'throttle', t);
    }`;
  const steady = `function d(n) { return n === 0 ? 0 : 1 + d(n - 1); } function tick() { set('thruster', 'throttle', d(150) / 300); }`;

  async function play(name: string): Promise<{ hash: string; scripts: unknown }> {
    const w = await World.create({ seed: 3, scripts: hostOf(name) }, open);
    const a = w.spawnBlueprint(lifter(greedy), { x: 0, y: 1 });
    const b = w.spawnBlueprint(lifter(steady), { x: 20, y: 1 });
    for (let i = 0; i < 90; i++) w.step();
    const out = { hash: w.hash(), scripts: [w.scripts(a.id), w.scripts(b.id)] };
    w.dispose();
    return out;
  }

  it('the greedy script crashes for its stack and the steady one keeps running', async () => {
    const r = await play(NODE);
    expect(r.scripts).toEqual([[{ id: 'lift', enabled: false, crashed: STACK }], [{ id: 'lift', enabled: true }]]);
  });

  it('the same hash from a shallow host stack, a deep one, and either QuickJS build', async () => {
    const shallow = await play(NODE);
    const frames = hostFrames();
    for (const [name] of builds) {
      expect(await play(name)).toEqual(shallow);
      // Each world step runs from far down the host's stack: about 60% of it already used.
      const w = await World.create({ seed: 3, scripts: hostOf(name) }, open);
      const a = w.spawnBlueprint(lifter(greedy), { x: 0, y: 1 });
      const b = w.spawnBlueprint(lifter(steady), { x: 20, y: 1 });
      for (let i = 0; i < 90; i++) deep(Math.floor(frames * 0.6), () => w.step());
      expect({ hash: w.hash(), scripts: [w.scripts(a.id), w.scripts(b.id)] }).toEqual(shallow);
      w.dispose();
    }
  });
});
