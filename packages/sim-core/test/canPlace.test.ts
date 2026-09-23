import { describe, expect, it } from 'vitest';
import carJson from '../../../blueprints/car.json';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

const flat = parseWorldFile(flatJson);

describe('World.canPlace', () => {
  it('allows the car in open air and refuses it inside the ground', async () => {
    const w = await World.create({ seed: 1 }, flat);
    expect(w.canPlace(carJson, { x: 0, y: 3 })).toEqual({ ok: true });
    expect(w.canPlace(carJson, { x: 0, y: 0.5 })).toEqual({ ok: false, reason: 'below the ground' });
    // The block at x 8 is 2 m tall; a body resting 0.2 m into it overlaps.
    expect(w.canPlace(carJson, { x: 8, y: 2.3 })).toEqual({ ok: false, reason: 'overlaps something already in the world' });
    expect(w.canPlace(carJson, { x: 8, y: 2.6 }).ok).toBe(true);
    w.dispose();
  });

  it('refuses anything below the ground surface, even under the physics slab', async () => {
    const w = await World.create({ seed: 1 }, flat);
    expect(w.canPlace(carJson, { x: 0, y: -5 })).toEqual({ ok: false, reason: 'below the ground' });
    w.dispose();
  });

  it('allows resting exactly on the ground', async () => {
    const w = await World.create({ seed: 1 }, flat);
    expect(w.canPlace(carJson, { x: 0, y: 1.45 }).ok).toBe(true);
    w.dispose();
  });

  it('refuses a spot taken by a robot spawned this tick, before any step', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.spawnBlueprint(carJson, { x: 0, y: 3 });
    expect(w.canPlace(carJson, { x: 1, y: 3 }).ok).toBe(false);
    expect(w.canPlace(carJson, { x: 10, y: 3 }).ok).toBe(false); // the box at x 8 is in the way of the wheel
    expect(w.canPlace(carJson, { x: 0, y: 6 }).ok).toBe(true);
    w.dispose();
  });

  it('sees robots after they move', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.spawnBlueprint(carJson, { x: 0, y: 3 });
    for (let i = 0; i < 120; i++) w.step();
    expect(w.canPlace(carJson, { x: 0, y: 1.5 }).ok).toBe(false);
    expect(w.canPlace(carJson, { x: 0, y: 3.6 }).ok).toBe(true);
    w.dispose();
  });

  it('reports validation errors as the reason', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.canPlace({ format: 1, name: 'bad', grid: ['C . F'] }, { x: 0, y: 3 });
    expect(r).toEqual({ ok: false, reason: 'frame@2,0 has no attached face (its faces N, E, S, W touch nothing)' });
    w.dispose();
  });
});

describe('World.spawnLog', () => {
  it('records each spawn with its tick and position', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.step();
    w.spawnBlueprint(carJson, { x: 0, y: 3 });
    expect(w.spawnLog).toHaveLength(1);
    expect(w.spawnLog[0]).toMatchObject({ tick: 1, name: 'car', at: { x: 0, y: 3 } });
    expect(w.spawnLog[0]?.blueprint).toBe(carJson);
    w.dispose();
  });
});
