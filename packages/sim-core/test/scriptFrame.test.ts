import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import { extrasJson, HEADER, inputToFrame, put, SELF, type ScriptFrame } from '../src/script/frame';
import type { ScriptHost, ScriptInput } from '../src/script/types';
import { ScriptRunner } from '../src/script/runner';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const base = (over: Partial<ScriptInput> = {}): ScriptInput => ({
  frame: 3,
  dt: 1 / 60,
  time: 3 / 60,
  self: { pos: { x: 1, y: 2 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0, mass: 10, energy: { stored: 5, capacity: 6 } },
  parts: [
    { id: 'core@0,0', type: 'core', tags: ['core@0,0'], pos: { x: 1, y: 2 }, angle: 0, mass: 1, in: {}, out: { energy: 5 } },
    { id: 'propeller@0,1', type: 'propeller', tags: ['props', 'propeller@0,1'], pos: { x: 1, y: 3 }, angle: 0.5, mass: 1, in: { throttle: 0.3 }, out: {} },
  ],
  keys: { down: [], pressed: [], released: [] },
  contacts: [],
  inbox: [],
  ...over,
});

function compile(src: string) {
  const r = host.compile(src, { name: 'test.js', seed: 1 });
  if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
  return r.instance;
}

/** The script's first write value, or undefined. */
function run(s: ReturnType<typeof compile>, frame: ScriptFrame): number | undefined {
  const r = s.tick(frame);
  if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
  return r.writes[0]?.value;
}

describe('script frames (M9)', () => {
  it('writes -0 as 0 and reports whether a number is finite', () => {
    const n = new Float64Array(3);
    expect(put(n, 0, -0)).toBe(true);
    expect(Object.is(n[0], 0)).toBe(true);
    expect(put(n, 1, Number.NaN)).toBe(false);
    expect(put(n, 2, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('lays a plain input out as a layout, numbers in order, and no extras when all are empty', () => {
    const f = inputToFrame(base(), 7);
    expect(f.layout.id).toBe(7);
    expect(JSON.parse(f.layout.json)).toEqual([
      ['core@0,0', 'core', ['core@0,0'], 1, [], ['energy']],
      ['propeller@0,1', 'propeller', ['props', 'propeller@0,1'], 1, ['throttle'], []],
    ]);
    expect([...f.numbers]).toEqual([1, 3, 1 / 60, 3 / 60, 1, 2, 0, 0, 0, 0, 10, 5, 6, 1, 2, 0, 5, 1, 3, 0.5, 0.3]);
    expect(f.numbers.length).toBe(HEADER + SELF + 4 + 4);
    expect(f.extras).toBe('');
    expect(extrasJson(base({ keys: { down: ['a'], pressed: [], released: [] } }))).toBe(JSON.stringify([{ down: ['a'], pressed: [], released: [] }, [], []]));
  });

  it('keeps part objects between ticks and updates their numbers in place; parts is a new array each tick', () => {
    const s = compile(`
      function tick() {
        if (frame === 1) { state.p = parts[1]; state.list = parts; state.self = self; return; }
        set('x', 'same', state.p === parts[1] ? 1 : 0);
        set('x', 'angle', state.p.angle);
        set('x', 'newList', state.list !== parts ? 1 : 0);
        set('x', 'newSelf', state.self !== self ? 1 : 0);
      }`);
    const layout = inputToFrame(base(), 1).layout;
    s.setup({ ...inputToFrame(base({ frame: 1 }), 1), layout });
    s.tick({ ...inputToFrame(base({ frame: 1 }), 1), layout });
    const moved = base({ frame: 2, parts: base().parts.map((p, i) => (i === 1 ? { ...p, angle: 0.9 } : p)) });
    const r = s.tick({ ...inputToFrame(moved, 1), layout });
    expect(r.ok && r.writes.map((w) => w.value)).toEqual([1, 0.9, 1, 1]);
  });

  it('a script cannot replace a part field or its tags; its own writes last one tick', () => {
    const s = compile(`
      function tick() {
        var p = parts[1];
        if (frame === 1) { p.pos = { x: 99, y: 99 }; p.type = 'wheel'; p.angle = 42; try { p.tags.push('x'); } catch (e) {} return; }
        set('x', 'y', p.pos.y);
        set('x', 'angle', p.angle);
        set('x', 'type', p.type === 'propeller' ? 1 : 0);
        set('x', 'frozen', Object.isFrozen(p.tags) && p.tags.length === 2 ? 1 : 0);
      }`);
    const f1 = inputToFrame(base({ frame: 1 }), 1);
    s.setup(f1);
    s.tick(f1);
    const r = s.tick({ ...inputToFrame(base({ frame: 2 }), 1), layout: f1.layout });
    expect(r.ok && r.writes.map((w) => w.value)).toEqual([3, 0.5, 1, 1]);
  });

  it('hands over NaN and Infinity as null and -0 as 0, as JSON did', () => {
    const s = compile(`function tick() { var p = parts[1]; set('x', 'a', p.pos.x === null ? 1 : 0); set('x', 'b', p.in.throttle === null ? 1 : 0); set('x', 'c', 1 / p.angle); set('x', 'd', self.vel.x === null ? 1 : 0); }`);
    const odd = base({ self: { ...base().self, vel: { x: Number.POSITIVE_INFINITY, y: 0 } }, parts: base().parts.map((p, i) => (i === 1 ? { ...p, pos: { x: Number.NaN, y: 3 }, angle: -0, in: { throttle: Number.NEGATIVE_INFINITY } } : p)) });
    const f = inputToFrame(odd, 1);
    expect(f.numbers[0]).toBe(0);
    const r = s.tick(f);
    expect(r.ok && r.writes.map((w) => w.value)).toEqual([1, 1, 1]);
    // 1 / 0 is Infinity, which set() drops: the third write is gone because the angle arrived as +0, not -0.
    const neg = compile(`function tick() { set('x', 'c', 1 / parts[1].angle > 0 ? 1 : 0); }`);
    expect(run(neg, f)).toBe(1);
  });

  it('reads a layout only when its id changes, and rebuilds parts when it does', () => {
    const s = compile(`function tick() { set('x', 'n', parts.length); set('x', 'has', 'throttle' in parts[parts.length - 1].in ? 1 : 0); }`);
    const f = inputToFrame(base(), 1);
    expect(run(s, f)).toBe(2);
    // Same id with a different layout text: the script keeps the one it has (it was not sent again).
    const one = inputToFrame(base({ parts: base().parts.slice(0, 1) }), 1);
    expect(run(s, { ...f, layout: one.layout })).toBe(2);
    // A new id: the new layout is read.
    const r = s.tick(inputToFrame(base({ parts: [{ ...base().parts[1]!, in: {} }] }), 2));
    expect(r.ok && r.writes.map((w) => w.value)).toEqual([1, 0]);
  });

  it('get() reads the parts as sent, whatever the script did to its own array', () => {
    const s = compile(`function tick() { parts.length = 0; set('x', 'v', get('props', 'throttle')); }`);
    expect(run(s, inputToFrame(base(), 1))).toBe(0.3);
  });

  it('keys, contacts, and inbox arrive through the extras', () => {
    const s = compile(`function tick() { set('x', 'k', keys.down('a') ? 1 : 0); set('x', 'c', contacts.length); set('x', 'i', inbox[0].data.n); }`);
    const f = inputToFrame(base({ keys: { down: ['a'], pressed: [], released: [] }, contacts: [{ id: 4, side: 'enemy', core: true, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, center: { x: 0, y: 0 }, mass: 1, parts: 1, distance: 1, by: ['radar'] }], inbox: [{ from: 'core@0,0', tick: 2, data: { n: 5 } }] }), 1);
    const r = s.tick(f);
    expect(r.ok && r.writes.map((w) => w.value)).toEqual([1, 1, 5]);
  });

  it('keys a script adds to a part do not last; the part objects cannot grow', () => {
    const s = compile(`
      function tick() {
        var p = parts[1];
        if (frame === 1) { p.in.boost = 7; p.extra = 1; p.pos.z = 1; delete p.angle; return; }
        set('x', 'a', p.in.boost === undefined && p.extra === undefined && p.pos.z === undefined ? 1 : 0);
        set('x', 'b', get('props', 'boost') === undefined ? 1 : 0);
        set('x', 'c', Object.keys(p).join(',') === 'id,type,tags,pos,angle,mass,in,out' ? 1 : 0);
      }`);
    const f1 = inputToFrame(base({ frame: 1 }), 1);
    s.setup(f1);
    s.tick(f1);
    const r = s.tick({ ...inputToFrame(base({ frame: 2 }), 1), layout: f1.layout });
    expect(r.ok && r.writes.map((w) => w.value)).toEqual([1, 1, 1]);
  });

  it('setters a script puts on Object.prototype or Array.prototype never see the refill (as with JSON input)', () => {
    const s = compile(`
      Object.defineProperty(Object.prototype, 'throttle', { set: function () {}, get: function () { return 99; }, configurable: true });
      function tick() { set('x', 'a', parts[1].in.throttle); set('x', 'b', get('props', 'throttle')); }`);
    const r = s.tick(inputToFrame(base(), 1));
    expect(r.ok && r.writes.map((w) => w.value)).toEqual([0.3, 0.3]);
    // An index setter on arrays breaks the script's own output (as it did before M9), but the refill still runs.
    const a = compile(`
      Object.defineProperty(Array.prototype, '0', { set: function () {}, get: function () { return undefined; }, configurable: true });
      function tick() { if (parts.length !== 2 || parts[1].type !== 'propeller') throw new Error('refill broken'); }`);
    expect(a.tick(inputToFrame(base(), 1))).toMatchObject({ ok: true });
  });

  it('a script turned off and on again (a new instance) is sent the layout again', () => {
    const src = `function tick() { set('x', 'n', parts.length); }`;
    const runner = new ScriptRunner([{ id: 'a', enabled: true, params: {}, source: src }], host, () => 1);
    const frame = inputToFrame(base(), 1);
    expect(runner.tick(() => frame).writes.map((w) => w.value)).toEqual([2]);
    runner.toggle('a');
    runner.toggle('a');
    expect(runner.tick(() => frame).writes.map((w) => w.value)).toEqual([2]);
    runner.dispose();
  });

  it('the world rebuilds a layout when the values present on a part change, without the robot changing', async () => {
    const w = await World.create({ seed: 1, scripts: host }, parseWorldFile(flatJson));
    const bp = { format: 1, name: 'probe', grid: ['C P'], scripts: [{ id: 'a', source: "function tick() { set('x', 'y', 1); }" }] };
    const robot = w.spawnBlueprint(bp, { x: -100, y: 1.5 });
    w.step();
    const internals = w as unknown as { scriptFrame(r: typeof robot, k: ScriptInput['keys']): ScriptFrame; channels: Map<number, Map<string, Map<string, number>>> };
    const keys = { down: [], pressed: [], released: [] };
    const before = internals.scriptFrame(robot, keys);
    expect(internals.scriptFrame(robot, keys).layout.id).toBe(before.layout.id);
    const prop = [...(internals.channels.get(robot.id)?.keys() ?? [])].find((id) => id.startsWith('propeller'));
    internals.channels.get(robot.id)?.get(prop ?? '')?.set('extra', 0.5);
    const after = internals.scriptFrame(robot, keys);
    expect(after.layout.id).not.toBe(before.layout.id);
    expect(after.layout.json).toContain('"extra"');
    w.dispose();
  });
});
