import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

const flat = parseWorldFile(flatJson);

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

  it('spawnBox drops a box that lands on the ground', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const box = w.spawnBox(flat.spawn.x, flat.spawn.y);
    for (let i = 0; i < 240; i++) w.step();
    expect(w.physics.state(box).y).toBeCloseTo(0.5, 1);
    w.dispose();
  });

  it('records input frames into the log', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.step([{ sourceId: 'keyboard', down: ['a'], pressed: ['a'], released: [] }]);
    w.step();
    expect(w.inputLog.length).toBe(1);
    expect(w.inputLog.framesAt(0)[0]?.down).toEqual(['a']);
    w.dispose();
  });

  it('exposes a seeded rng', async () => {
    const a = await World.create({ seed: 9 }, flat);
    const b = await World.create({ seed: 9 }, flat);
    expect(a.rng.nextU32()).toBe(b.rng.nextU32());
    a.dispose();
    b.dispose();
  });
});
