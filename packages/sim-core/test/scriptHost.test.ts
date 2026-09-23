import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost, ScriptInput } from '../src/script/types';

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const input = (over: Partial<ScriptInput> = {}): ScriptInput => ({
  frame: 1,
  dt: 1 / 60,
  time: 1 / 60,
  self: { pos: { x: 0, y: 5 }, vel: { x: 0, y: -1 }, angle: 0, angVel: 0, mass: 10, energy: { stored: 600, capacity: 600 } },
  parts: [{ id: 'propeller@0,1', type: 'propeller', tags: ['props', 'propeller@0,1'], pos: { x: -1, y: 5 }, angle: 0, in: { throttle: 0.3 }, out: {} }],
  keys: { down: ['a'], pressed: [], released: [] },
  ...over,
});

function compile(src: string, params?: Record<string, number>) {
  const r = host.compile(src, { name: 'test.js', seed: 7, ...(params ? { params } : {}) });
  if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
  return r.instance;
}

describe('QuickJS script host', () => {
  it('runs tick, reads sensors and keys, and returns writes and logs', () => {
    const s = compile(`function tick() { set('props', 'throttle', self.vel.y < 0 ? 1 : 0); if (keys.down('a')) log('a held', frame); }`);
    const r = s.tick(input());
    expect(r).toEqual({ ok: true, writes: [{ target: 'props', channel: 'throttle', value: 1 }], logs: ['a held 1'] });
    s.dispose();
  });

  it('get reads a part channel; state persists across ticks and resets on setup', () => {
    const s = compile(`function setup() { state.n = 10; } function tick() { state.n = (state.n || 0) + 1; set('props', 'throttle', get('props', 'throttle') + state.n); }`);
    expect(s.setup(input())).toMatchObject({ ok: true });
    expect(s.tick(input())).toMatchObject({ writes: [{ value: 11.3 }] });
    expect(s.tick(input())).toMatchObject({ writes: [{ value: 12.3 }] });
    s.setup(input());
    expect(s.tick(input())).toMatchObject({ writes: [{ value: 11.3 }] });
    s.dispose();
  });

  it('an endless loop is stopped by the budget, and the host keeps working', () => {
    const a = compile(`var n = 0; function tick() { while (true) { n++; } }`);
    expect(a.tick(input())).toEqual({ ok: false, error: { kind: 'budget', message: 'ran too long for one tick (an endless loop?)' } });
    a.dispose();
    const c = compile(`function tick() { set('a', 'b', 1); }`);
    expect(c.tick(input())).toMatchObject({ ok: true, writes: [{ value: 1 }] });
    c.dispose();
  });

  it('the budget counts work, not time: a loop that fits runs the same every time', () => {
    const src = `function tick() { var n = 0; for (var i = 0; i < 100000; i++) n += i; set('a', 'n', n); }`;
    const a = compile(src).tick(input());
    const b = compile(src).tick(input());
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true });
  });

  it('try/catch cannot swallow the budget', () => {
    const s = compile(`function tick() { try { while (true) {} } catch (e) { set('x', 'y', 1); } }`);
    expect(s.tick(input())).toMatchObject({ ok: false, error: { kind: 'budget' } });
    s.dispose();
  });

  it('reports throws, memory, and stack errors', () => {
    const t = compile(`function tick() { throw new Error('boom'); }`);
    expect(t.tick(input())).toMatchObject({ ok: false, error: { kind: 'throw', message: expect.stringContaining('boom') } });
    t.dispose();
    const m = compile(`function tick() { var a = new Array(1e7).fill(1); }`);
    expect(m.tick(input())).toMatchObject({ ok: false, error: { kind: 'memory' } });
    m.dispose();
    const st = compile(`function f(n) { return f(n + 1) + 1; } function tick() { f(0); }`);
    expect(st.tick(input())).toMatchObject({ ok: false, error: { kind: 'stack' } });
    st.dispose();
  });

  it('a syntax error is a compile error with a line; a script without tick is refused', () => {
    const r = host.compile(`function tick() {\n  let = ;\n}`, { name: 'bad.js', seed: 1 });
    expect(r).toMatchObject({ ok: false, error: { kind: 'compile', message: expect.stringContaining('SyntaxError') } });
    expect(host.compile(`var x = 1;`, { name: 'none.js', seed: 1 })).toMatchObject({ ok: false, error: { kind: 'compile', message: 'none.js does not define function tick()' } });
  });

  it('random is seeded, Date and fetch are absent', () => {
    const src = `function tick() { set('r', 'a', Math.random()); set('r', 'b', random()); set('r', 'date', typeof Date === 'undefined' ? 1 : 0); set('r', 'fetch', typeof fetch === 'undefined' ? 1 : 0); }`;
    const a = compile(src).tick(input());
    const b = compile(src).tick(input());
    expect(a).toEqual(b);
    expect(a).toMatchObject({ writes: [{}, {}, { value: 1 }, { value: 1 }] });
    const other = host.compile(src, { name: 'x.js', seed: 8 });
    if (!other.ok) throw new Error('compile');
    expect(other.instance.tick(input())).not.toEqual(a);
  });

  it('params come back from compile and take given values', () => {
    const s = compile(`const target = param('height', 5, { min: 1, max: 20 }); function tick() { set('x', 'h', target); }`, { height: 8 });
    expect(s.params).toEqual({ height: { default: 5, min: 1, max: 20 } });
    expect(s.tick(input())).toMatchObject({ writes: [{ value: 8 }] });
    s.dispose();
  });
});

describe('a script cannot break the host (M5 review)', () => {
  it('reassigning globals and JSON only affects the script', () => {
    const s = compile(`JSON.stringify = function () { return '{'; }; var __writes = 5; function tick() { set('a', 'b', 1); __tick = null; }`);
    expect(s.tick(input())).toEqual({ ok: true, writes: [{ target: 'a', channel: 'b', value: 1 }], logs: [] });
    expect(s.tick(input())).toMatchObject({ ok: true });
    s.dispose();
  });

  it('output it cannot read is the script’s error, not the host’s', () => {
    const s = compile(`function tick() { Object.prototype.toJSON = function () { return 7; }; }`);
    expect(s.tick(input())).toMatchObject({ ok: false, error: { kind: 'throw' } });
    s.dispose();
  });

  it('logs and writes are capped', () => {
    const s = compile(`function tick() { for (var i = 0; i < 20; i++) log('x'.repeat(10000)); for (var j = 0; j < 5000; j++) set('a', 'b', j); }`);
    const r = s.tick(input());
    expect(r.ok && r.logs.length).toBe(5);
    expect(r.ok && r.logs[0]?.length).toBe(300);
    expect(r.ok && r.writes.length).toBe(1000);
    s.dispose();
  });

  it('a stack overflow inside a built-in is a crash, and cleaning up never throws', () => {
    const src = `function tick() { var a = []; for (var i = 0; i < 100000; i++) a = [a]; JSON.stringify(a); }`;
    const s = compile(src);
    const r = s.tick(input());
    expect(r.ok).toBe(false);
    expect(() => s.dispose()).not.toThrow();
    const top = host.compile(`var a = []; for (var i = 0; i < 100000; i++) a = [a]; String(a); function tick() {}`, { name: 'top.js', seed: 1 });
    expect(top.ok).toBe(false);
    const after = compile(`function tick() { set('ok', 'x', 1); }`);
    expect(after.tick(input())).toMatchObject({ ok: true });
    after.dispose();
  });
});
