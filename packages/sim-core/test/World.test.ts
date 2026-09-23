import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

const flat = parseWorldFile(flatJson);
const BOX = { format: 1, name: 'box', grid: ['F'] };
const CAR = {
  format: 1,
  name: 'test car',
  grid: ['F  C  F', 'W  .  W'],
  legend: { W: { part: 'wheel', tags: ['wheels'] } },
  bindings: [
    { key: 'd', mode: 'hold', target: 'wheels', channel: 'speed', value: 1 },
    { key: 'a', mode: 'hold', target: 'wheels', channel: 'speed', value: -1 },
  ],
};

describe('World', () => {
  it('builds the world file and advances tick and time', async () => {
    const w = await World.create({ seed: 1 }, flat);
    expect(w.physics.bodyIds).toHaveLength(4);
    expect(w.tick).toBe(0);
    w.step();
    w.step();
    expect(w.tick).toBe(2);
    expect(w.time).toBeCloseTo(2 / 60, 9);
    w.dispose();
  });

  it('a one-frame blueprint drops and lands on the ground', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const box = w.spawnBlueprint(BOX, flat.spawn).groups[0]?.bodyId ?? 0;
    for (let i = 0; i < 240; i++) w.step();
    expect(w.physics.state(box).y).toBeCloseTo(0.5, 1);
    w.dispose();
  });

  it('records key edges into the log', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(CAR, flat.spawn);
    w.step([{ robot: car.id, pressed: ['d'], released: [] }]);
    w.step();
    expect(w.inputLog.length).toBe(1);
    expect(w.inputLog.inputsAt(0)[0]?.pressed).toEqual(['d']);
    w.dispose();
  });

  it('rejects inputs for robots that never existed and drops inputs for ones it cannot control', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const box = w.spawnBlueprint(BOX, flat.spawn);
    expect(() => w.step([{ robot: 99, pressed: ['d'], released: [] }])).toThrow('robot 99');
    expect(w.tick).toBe(0);
    // A core-less robot (or one whose core was just destroyed) cannot be controlled: the input is dropped, unlogged.
    w.step([{ robot: box.id, pressed: ['d'], released: [] }]);
    expect(w.tick).toBe(1);
    expect(w.inputLog.length).toBe(0);
    expect(w.canControl(box.id)).toBe(false);
    w.dispose();
  });

  it('a robot with no inputs keeps its held keys (latching)', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(CAR, flat.spawn);
    w.step([{ robot: car.id, pressed: ['d'], released: [] }]);
    for (let i = 0; i < 100; i++) w.step();
    expect(w.controller(car.id)?.isHeld('d')).toBe(true);
    expect(w.channelValue(car.id, 'wheel@0,0', 'speed')).toBe(1);
    w.step([{ robot: car.id, pressed: [], released: ['d'] }]);
    expect(w.channelValue(car.id, 'wheel@0,0', 'speed')).toBe(0);
    w.dispose();
  });

  it('auto controls drive a blueprint with no bindings, and a custom binding sums with them', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const plain = w.spawnBlueprint({ format: 1, name: 'plain', grid: ['F  C  F', 'W  .  W'] }, flat.spawn);
    expect(w.controller(plain.id)?.keys).toEqual(['d', 'a']);
    w.step([{ robot: plain.id, pressed: ['d'], released: [] }]);
    expect(w.channelValue(plain.id, 'wheel@0,0', 'speed')).toBe(1);
    const off = w.spawnBlueprint({ format: 1, name: 'off', grid: ['F  C  F', 'W  .  W'], autoControls: false }, { x: 20, y: 3 });
    expect(w.controller(off.id)?.keys).toEqual([]);
    w.dispose();
  });

  it('held keys feed the hash', async () => {
    const a = await World.create({ seed: 1 }, flat);
    const b = await World.create({ seed: 1 }, flat);
    const ca = a.spawnBlueprint(CAR, flat.spawn);
    b.spawnBlueprint(CAR, flat.spawn);
    a.step([{ robot: ca.id, pressed: ['q'], released: [] }]);
    b.step();
    expect(a.hash()).not.toBe(b.hash());
    a.dispose();
    b.dispose();
  });

  it('exposes a seeded rng', async () => {
    const a = await World.create({ seed: 9 }, flat);
    const b = await World.create({ seed: 9 }, flat);
    expect(a.rng.nextU32()).toBe(b.rng.nextU32());
    a.dispose();
    b.dispose();
  });
});
