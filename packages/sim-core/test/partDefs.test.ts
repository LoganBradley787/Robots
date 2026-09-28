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
      'rotator',
      'cell',
      'seeker',
      'radar',
      'booster',
      'heavywarhead',
      'heavygyro',
      'densebattery',
      'flare',
      'fabbay',
      'gun',
    ]);
  });

  it('every def has a part sprite frame', () => {
    for (const d of defaultRegistry().list()) expect(d.sprite.frame.startsWith('part.')).toBe(true);
  });

  it('health (M6): frames are armor, propellers are fragile', () => {
    const health = Object.fromEntries(defaultRegistry().list().map((d) => [d.id, d.health]));
    expect(health).toEqual({ core: 50, frame: 60, battery: 30, wheel: 25, thruster: 25, propeller: 15, decoupler: 30, warhead: 20, gyro: 30, rotator: 40, cell: 10, seeker: 20, radar: 40, booster: 25, heavywarhead: 20, heavygyro: 30, densebattery: 30, flare: 5, fabbay: 150, gun: 25 });
  });

  it('the warhead explodes when destroyed and breaks on a hard hit', () => {
    const w = defaultRegistry().get('warhead');
    expect(w.onDestroyed?.explode).toEqual({ radius: 3, damage: 120, pushRadius: 5, push: 40, lift: 1.5 });
    expect(w.impact).toEqual({ speed: 5 });
  });

  it('the rotator mounts below and carries parts on its other faces', () => {
    const r = defaultRegistry().get('rotator');
    expect(r.joint).toMatchObject({ motor: 'position', mountFace: 'S' });
    expect(r.footprint[0]?.faces).toEqual(['N', 'E', 'S', 'W']);
    expect(r.autoControl).toMatchObject({ channel: 'turn', keys: ['z', 'x'] });
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

  it('arming (M10): needs an arm input and an armed output, and a boolean; the sprite may name an armedFrame', () => {
    const arm = { name: 'arm', min: 0, max: 1, default: 0 };
    const armed = { name: 'armed', min: 0, max: 1, default: 0 };
    const ok = parsePartDef({ ...minimal, inputs: [arm], outputs: [armed], arming: true, sprite: { frame: 'part.x', armedFrame: 'part.x.armed' } }, 'thing.json');
    expect(ok.arming).toBe(true);
    expect(ok.sprite.armedFrame).toBe('part.x.armed');
    expect(parsePartDef({ ...minimal, arming: false }, 'thing.json').arming).toBeUndefined();
    expect(() => parsePartDef({ ...minimal, outputs: [armed], arming: true }, 'thing.json')).toThrow('must have an "arm" input');
    expect(() => parsePartDef({ ...minimal, inputs: [arm], arming: true }, 'thing.json')).toThrow('must have an "armed" output');
    expect(() => parsePartDef({ ...minimal, arming: 'yes' }, 'thing.json')).toThrow('arming must be true or false');
    expect(defaultRegistry().list().filter((d) => d.arming === true).map((d) => d.id).sort()).toEqual(['heavywarhead', 'warhead']);
  });

  it('decoy (M11): needs an ignite input, a burning output, and a burn time; the sprite may name a litFrame', () => {
    const ignite = { name: 'ignite', min: 0, max: 1, default: 0 };
    const burning = { name: 'burning', min: 0, max: 1, default: 0 };
    const ok = parsePartDef({ ...minimal, inputs: [ignite], outputs: [burning], decoy: { burn: 2 }, sprite: { frame: 'part.x', litFrame: 'part.x.lit' } }, 'thing.json');
    expect(ok.decoy).toEqual({ burn: 2 });
    expect(ok.sprite.litFrame).toBe('part.x.lit');
    expect(() => parsePartDef({ ...minimal, outputs: [burning], decoy: { burn: 2 } }, 'thing.json')).toThrow('must have an "ignite" input');
    expect(() => parsePartDef({ ...minimal, inputs: [ignite], decoy: { burn: 2 } }, 'thing.json')).toThrow('must have a "burning" output');
    expect(() => parsePartDef({ ...minimal, inputs: [ignite], outputs: [burning], decoy: { burn: 0 } }, 'thing.json')).toThrow(PartDefError);
    expect(defaultRegistry().list().filter((d) => d.decoy !== undefined).map((d) => d.id)).toEqual(['flare']);
    expect(defaultRegistry().get('flare')).toMatchObject({ mass: 0.2, health: 5, decoy: { burn: 2 } });
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

  it('a velocity joint part attaches only through its mount face', () => {
    const bad = { ...minimal, joint: { kind: 'revolute', mountFace: 'N', motor: 'velocity', maxTorque: 1, motorFactor: 1 } };
    expect(() => parsePartDef(bad, 'thing.json')).toThrow('thing.json: footprint[0].faces must be exactly [N]');
  });

  it('a position joint part carries parts on its other faces and takes no motorFactor', () => {
    const ok = { ...minimal, joint: { kind: 'revolute', mountFace: 'S', motor: 'position', maxTorque: 5 } };
    expect(parsePartDef(ok, 'thing.json').joint).toEqual({ kind: 'revolute', mountFace: 'S', motor: 'position', maxTorque: 5, motorFactor: 0 });
    const bad = { ...minimal, joint: { kind: 'revolute', mountFace: 'S', motor: 'position', maxTorque: 5, motorFactor: 1 } };
    expect(() => parsePartDef(bad, 'thing.json')).toThrow('joint.motorFactor');
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
