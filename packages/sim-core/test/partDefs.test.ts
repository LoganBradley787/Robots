import { describe, expect, it } from 'vitest';
import { defaultRegistry, PartRegistry } from '../src/parts/registry';
import { parsePartDef, PartDefError } from '../src/parts/parsePartDef';

const minimal = {
  id: 'thing',
  name: 'Thing',
  footprint: [{ x: 0, y: 0, faces: ['N', 'E', 'S', 'W'] }],
  mass: 1,
  health: 1,
  symmetry: 1,
  inputs: [],
  outputs: [],
  powerDraw: 0,
  sprite: { frame: 'part.thing' },
};

describe('default part defs', () => {
  it('lists the shipped parts in palette order', () => {
    expect(defaultRegistry().list().map((d) => d.id)).toEqual([
      'core',
      'frame',
      'battery',
      'wheel',
      'thruster',
      'propeller',
      'decoupler',
      'warhead',
      'gyro',
    ]);
  });

  it('every def has health 1 and a part sprite frame', () => {
    for (const d of defaultRegistry().list()) {
      expect(d.health).toBe(1);
      expect(d.sprite.frame.startsWith('part.')).toBe(true);
    }
  });

  it('the wheel is a jointed ball that mounts on its north face', () => {
    const w = defaultRegistry().get('wheel');
    expect(w.joint).toEqual({ kind: 'revolute', mountFace: 'N', motor: 'velocity', maxTorque: expect.any(Number), motorFactor: expect.any(Number) });
    expect(w.collider).toEqual({ shape: 'ball', radius: 0.45, friction: 1.5 });
    expect(w.footprint[0]?.faces).toEqual(['N']);
    expect(w.sprite.mountFrame).toBe('part.wheel.mount');
  });

  it('the thruster does not attach on its nozzle face', () => {
    expect(defaultRegistry().get('thruster').footprint[0]?.faces).toEqual(['N', 'E', 'W']);
  });

  it('only the core has the core role', () => {
    expect(defaultRegistry().list().filter((d) => d.role === 'core').map((d) => d.id)).toEqual(['core']);
  });

  it('the battery holds energy', () => {
    expect(defaultRegistry().get('battery').resource).toEqual({ kind: 'energy', capacity: 1500 });
    expect(defaultRegistry().get('core').resource).toEqual({ kind: 'energy', capacity: 600 });
  });
});

describe('parsePartDef', () => {
  it('accepts a minimal def', () => {
    expect(parsePartDef(minimal, 'thing.json').id).toBe('thing');
  });

  it('names a missing field', () => {
    const { mass: _mass, ...noMass } = minimal;
    expect(() => parsePartDef(noMass, 'thing.json')).toThrow(PartDefError);
    expect(() => parsePartDef(noMass, 'thing.json')).toThrow('thing.json: mass is required');
  });

  it('rejects unknown keys', () => {
    expect(() => parsePartDef({ ...minimal, weight: 3 }, 'thing.json')).toThrow('thing.json: weight is not a known field');
  });

  it('rejects a channel default outside its range', () => {
    const bad = { ...minimal, inputs: [{ name: 'x', min: 0, max: 1, default: 2 }] };
    expect(() => parsePartDef(bad, 'thing.json')).toThrow('thing.json: inputs[0].default must be between min and max');
  });

  it('rejects a joint mount face that is not attachable', () => {
    const bad = { ...minimal, footprint: [{ x: 0, y: 0, faces: ['S'] }], joint: { kind: 'revolute', mountFace: 'N', motor: 'velocity' } };
    expect(() => parsePartDef(bad, 'thing.json')).toThrow('thing.json: joint.mountFace N is not an attachable face');
  });

  it('a joint part attaches only through its mount face', () => {
    const bad = { ...minimal, joint: { kind: 'revolute', mountFace: 'N', motor: 'velocity', maxTorque: 1, motorFactor: 1 } };
    expect(() => parsePartDef(bad, 'thing.json')).toThrow('thing.json: footprint[0].faces must be exactly [N]');
  });

  it('rejects position motors until the rotator exists', () => {
    const bad = { ...minimal, footprint: [{ x: 0, y: 0, faces: ['N'] }], joint: { kind: 'revolute', mountFace: 'N', motor: 'position' } };
    expect(() => parsePartDef(bad, 'thing.json')).toThrow('not supported yet');
  });

  it('requires a radius for ball colliders', () => {
    const bad = { ...minimal, collider: { shape: 'ball' } };
    expect(() => parsePartDef(bad, 'thing.json')).toThrow('thing.json: collider.radius');
  });
});

describe('PartRegistry', () => {
  it('get of an unknown id lists the known ids', () => {
    const r = new PartRegistry([parsePartDef(minimal, 'thing.json')]);
    expect(() => r.get('nope')).toThrow('unknown part "nope" (known: thing)');
    expect(r.has('thing')).toBe(true);
  });

  it('rejects duplicate ids', () => {
    const d = parsePartDef(minimal, 'thing.json');
    expect(() => new PartRegistry([d, d])).toThrow('duplicate part id "thing"');
  });
});
