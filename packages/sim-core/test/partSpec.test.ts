import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import flatJson from '../../../worlds/flat.json';
import { defaultRegistry } from '../src/parts/registry';
import { inputToFrame, layoutJson, layoutPatch, type LayoutPart, type ScriptFrame } from '../src/script/frame';
import { partSpec, partSpecsJson } from '../src/script/partSpec';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost, ScriptInput } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

const reg = defaultRegistry();

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

function compile(src: string, inspect = false) {
  const r = host.compile(src, { name: 'test.js', seed: 1, inspect });
  if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
  return r.instance;
}

describe('partSpec: a definition\'s static numbers (M16)', () => {
  it('gives each input its range, the behavior\'s numbers, the power draw and the full health', () => {
    expect(partSpec(reg.get('thruster'))).toMatchObject({ in: { throttle: { min: 0, max: 1, default: 0 } }, config: { maxForce: 160 }, powerDraw: reg.get('thruster').powerDraw, maxHealth: reg.get('thruster').health });
    expect(partSpec(reg.get('propeller')).config).toEqual({ maxForce: 120 });
    expect(partSpec(reg.get('gyro'))).toMatchObject({ in: { spin: { min: -1, max: 1, default: 0 }, damp: { min: 0, max: 1, default: 1 } }, config: { maxTorque: 40, dampTorque: 15, dampTime: 0.3 }, powerDraw: 5, maxHealth: 30 });
    expect(partSpec(reg.get('swivelthruster')).config).toEqual({ maxForce: 400, swivel: 15 });
    // A part with no inputs and no behavior still has the four.
    expect(partSpec(reg.get('frame'))).toMatchObject({ in: {}, config: {}, powerDraw: 0, maxHealth: reg.get('frame').health });
  });

  it('adds every other block of numbers under its own name, numbers only', () => {
    expect(partSpec(reg.get('gun')).gun).toEqual({ speed: 300, damage: 5, rate: 10, life: 1, recoil: 2, range: 100, spread: 1.5 });
    // A joint's block has words too (its kind, its mount face): only its numbers come along.
    const wheel = partSpec(reg.get('wheel'));
    expect(wheel.joint).toEqual({ maxTorque: reg.get('wheel').joint?.maxTorque, motorFactor: reg.get('wheel').joint?.motorFactor });
    expect(wheel.config).toEqual({ maxSpeed: 50, coastTorque: 0.3 });
    expect(partSpec(reg.get('battery')).resource).toEqual({ capacity: reg.get('battery').resource?.capacity });
    // Blocks of words, lists, and blocks inside blocks are left out.
    const spec = partSpec(reg.get('warhead'));
    expect(spec.sprite).toBeUndefined();
    expect(spec.onDestroyed).toBeUndefined();
    expect(spec.footprint).toBeUndefined();
    expect(spec.inputs).toBeUndefined();
  });

  it('follows one rule for every part in the registry, in a fixed key order', () => {
    for (const def of reg.list()) {
      const spec = partSpec(def);
      expect(Object.keys(spec).slice(0, 4)).toEqual(['in', 'config', 'powerDraw', 'maxHealth']);
      expect(Object.keys(spec.in)).toEqual(def.inputs.map((c) => c.name));
      for (const c of def.inputs) expect(spec.in[c.name]).toEqual({ min: c.min, max: c.max, default: c.default });
      expect(spec.config).toEqual(def.behaviorConfig ?? {});
      expect(spec.powerDraw).toBe(def.powerDraw);
      expect(spec.maxHealth).toBe(def.health);
      // `acts` (M16) is the one number at the top besides those: the face the part acts along, in degrees.
      expect(spec.acts).toBe(def.acts === undefined ? undefined : { E: 0, N: 90, W: 180, S: 270 }[def.acts]);
      for (const key of Object.keys(spec).slice(4)) {
        if (key === 'acts' || key === 'tip') continue;
        const block = spec[key] as Record<string, unknown>;
        const from = (def as unknown as Record<string, Record<string, unknown>>)[key];
        expect(Object.keys(block).length).toBeGreaterThan(0);
        for (const [name, v] of Object.entries(block)) {
          expect(typeof v).toBe('number');
          expect(v).toBe(from?.[name]);
        }
      }
      // Plain data all the way down: the text a script is sent says exactly this.
      expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    }
    const all = JSON.parse(partSpecsJson(reg)) as Record<string, unknown>;
    expect(Object.keys(all)).toEqual(reg.ids());
    expect(all.gyro).toEqual(partSpec(reg.get('gyro')));
  });
});

const drone = (): ScriptInput => ({
  frame: 1,
  dt: 1 / 60,
  time: 1 / 60,
  self: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0, mass: 10, energy: { stored: 5, capacity: 6 } },
  parts: [
    { id: 'core@1,0', type: 'core', tags: ['core@1,0'], pos: { x: 1, y: 0 }, angle: 0, mass: 1, in: {}, out: {}, spec: partSpec(reg.get('core')) },
    { id: 'propeller@0,0', type: 'propeller', tags: ['lift', 'propeller@0,0'], pos: { x: 0, y: 0 }, angle: 0, mass: 1, in: { throttle: 0 }, out: {}, spec: partSpec(reg.get('propeller')) },
    { id: 'propeller@2,0', type: 'propeller', tags: ['lift', 'propeller@2,0'], pos: { x: 2, y: 0 }, angle: 0, mass: 1, in: { throttle: 0 }, out: {}, spec: partSpec(reg.get('propeller')) },
    { id: 'thruster@1,1', type: 'thruster', tags: ['lift', 'thruster@1,1'], pos: { x: 1, y: 1 }, angle: 0, mass: 1, in: { throttle: 0 }, out: {}, spec: partSpec(reg.get('thruster')) },
  ],
  keys: { down: [], pressed: [], released: [] },
  contacts: [],
  inbox: [],
});

/** The values a script wrote, in order. */
function writes(s: ReturnType<typeof compile>, frame: ScriptFrame): number[] {
  const r = s.tick(frame);
  if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
  return r.writes.map((w) => w.value);
}

describe('part.spec in a script (M16)', () => {
  it('lets a script add up its engines and hover whatever their number', () => {
    // Full lift is read off the parts: two propellers and a thruster here, with no "120 per propeller" in the code.
    const s = compile(`
      function tick() {
        let lift = 0;
        for (const p of parts) if (p.tags.includes('lift')) lift += p.spec.config.maxForce * p.spec.in.throttle.max;
        set('lift', 'throttle', clamp(self.mass * 9.81 / lift, 0, 1));
        set('x', 'total', lift);
      }`);
    const got = writes(s, inputToFrame(drone(), 1));
    expect(got[1]).toBe(120 + 120 + 160);
    expect(got[0]).toBeCloseTo((10 * 9.81) / 400, 12);
    // One propeller fewer: the same code asks the rest for more.
    const fewer = drone();
    fewer.parts.splice(2, 1);
    expect(writes(s, inputToFrame(fewer, 2))[0]).toBeCloseTo((10 * 9.81) / 280, 12);
  });

  it('is one frozen object per part type, the last key of a part, and read-only', () => {
    const s = compile(`
      function tick() {
        var a = parts[1], b = parts[2];
        set('x', 'shared', a.spec === b.spec ? 1 : 0);
        set('x', 'keys', Object.keys(a).join(',') === 'id,type,tags,pos,angle,mass,in,out,spec' ? 1 : 0);
        a.spec.config.maxForce = 5; a.spec.in.throttle.max = 9; a.spec.powerDraw = 0; a.spec.extra = 1; a.spec = null;
        set('x', 'force', a.spec.config.maxForce);
        set('x', 'max', b.spec.in.throttle.max);
        set('x', 'frozen', Object.isFrozen(a.spec) && Object.isFrozen(a.spec.in) && Object.isFrozen(a.spec.in.throttle) && Object.isFrozen(a.spec.config) && a.spec.extra === undefined ? 1 : 0);
        set('x', 'health', parts[0].spec.maxHealth);
        set('x', 'draw', parts[3].spec.powerDraw);
        set('x', 'state', state.first === undefined || state.first === a.spec ? 1 : 0);
        state.first = a.spec;
      }`);
    const f = inputToFrame(drone(), 1);
    const expected = [1, 1, 120, 1, 1, reg.get('core').health, reg.get('thruster').powerDraw, 1];
    expect(writes(s, f)).toEqual(expected);
    // The next tick, on the same layout: the same objects, still as the definition says.
    expect(writes(s, { ...inputToFrame({ ...drone(), frame: 2 }, 1), layout: f.layout })).toEqual(expected);
  });

  it('a script sees it exactly as JSON would give it, on every part', () => {
    const s = compile('function tick() {}', true);
    const input = drone();
    s.tick(inputToFrame(input, 1));
    expect(JSON.stringify(JSON.parse(s.inspect?.() ?? ''))).toBe(JSON.stringify(input));
  });

  it('a part of a layout sent without specs has no spec, as before M16', () => {
    const s = compile(`function tick() { set('x', 'none', parts[1].spec === undefined && !('spec' in parts[1]) ? 1 : 0); set('x', 'keys', Object.keys(parts[1]).length); }`);
    const input = drone();
    for (const p of input.parts) delete p.spec;
    const f = inputToFrame(input, 1);
    expect(f.layout.specs).toBeUndefined();
    expect(writes(s, f)).toEqual([1, 8]);
  });

  it('parts made by a layout patch get their spec too, and kept parts keep theirs', () => {
    const rows = (input: ScriptInput): LayoutPart[] => input.parts.map((p) => ({ id: p.id, type: p.type, tags: p.tags, mass: p.mass, in: Object.keys(p.in), out: Object.keys(p.out) }));
    const before = drone();
    const after = drone();
    // A propeller is lost and a gyro appears (a rebuilt robot): the patch keeps three parts and makes one.
    after.parts.splice(2, 1);
    after.parts.push({ id: 'gyro@1,2', type: 'gyro', tags: ['gyro@1,2'], pos: { x: 1, y: 2 }, angle: 0, mass: 1, in: { spin: 0, damp: 1 }, out: {}, spec: partSpec(reg.get('gyro')) });
    const specs = partSpecsJson(reg);
    const patch = layoutPatch(rows(before), rows(after));
    expect(patch).toBeDefined();
    const s = compile(
      `function tick() {
        if (frame === 1) { state.prop = parts[1].spec; return; }
        set('x', 'kept', parts[1].spec === state.prop ? 1 : 0);
        set('x', 'torque', parts[3].spec.config.maxTorque);
        set('x', 'n', parts.length);
      }`,
      true,
    );
    const f1 = inputToFrame(before, 1);
    s.tick({ ...f1, layout: { id: 1, json: layoutJson(rows(before)), specs } });
    const f2 = inputToFrame({ ...after, frame: 2 }, 2);
    expect(writes(s, { ...f2, layout: { id: 2, json: layoutJson(rows(after)), patch: { from: 1, json: patch as string }, specs } })).toEqual([1, 40, 4]);
    expect(JSON.stringify(JSON.parse(s.inspect?.() ?? ''))).toBe(JSON.stringify({ ...after, frame: 2 }));
  });

  it('the world hands every layout the same specs text, so a script is sent it once', async () => {
    const w = await World.create({ seed: 1, scripts: host }, parseWorldFile(flatJson));
    const code = `
      function tick() {
        if (frame !== 2) return;
        var lift = 0, n = 0;
        for (const p of parts) if (p.type === 'propeller') { lift += p.spec.config.maxForce; n++; }
        log(n + ' propellers, ' + lift + ' N, core health ' + parts.find((p) => p.type === 'core').spec.maxHealth + ', battery ' + get('battery', 'charge') + ' of ' + parts.find((p) => p.type === 'battery').spec.resource.capacity);
      }`;
    const bp = { format: 1, name: 'probe', grid: ['P  C  P', '.  B  .'], scripts: [{ id: 'a', source: code }] };
    const robot = w.spawnBlueprint(bp, { x: -100, y: 2.5 });
    const other = w.spawnBlueprint({ ...bp, name: 'other' }, { x: -80, y: 2.5 });
    w.step();
    w.step();
    w.step();
    const battery = reg.get('battery').resource?.capacity;
    const said = w.scriptLogs.filter((l) => l.robot === robot.id).map((l) => l.text);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(new RegExp(`^2 propellers, 240 N, core health ${reg.get('core').health}, battery [0-9.]+ of ${battery}$`));
    const internals = w as unknown as { scriptFrame(r: typeof robot, k: ScriptInput['keys']): ScriptFrame };
    const keys = { down: [], pressed: [], released: [] };
    const a = internals.scriptFrame(robot, keys).layout;
    const b = internals.scriptFrame(other, keys).layout;
    expect(a.specs).toBe(partSpecsJson(reg));
    expect(b.specs).toBe(a.specs);
    // Not in the layout itself, and not in the numbers sent every tick.
    expect(a.json).not.toContain('maxForce');
    w.dispose();
  });
});
