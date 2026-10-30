import { describe, expect, it } from 'vitest';
import carJson from '../../../blueprints/car.json';
import enemyWalkerJson from '../../../blueprints/enemy-walker.json';
import titanJuggernautJson from '../../../blueprints/titan-juggernaut.json';
import titanShatterJson from '../../../blueprints/titan-shatter.json';
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

describe('World.lowestPlace', () => {
  /** The scan the page did before `lowestPlace`: `canPlace` at every height from 0.5 m up in 0.05 m steps. */
  const scan = (w: World, raw: unknown, x: number): number | undefined => {
    for (let y = 0.5; y < 200; y += 0.05) if (w.canPlace(raw, { x, y }).ok) return y;
    return undefined;
  };

  it('gives the same height as asking canPlace at every step', async () => {
    const w = await World.create({ seed: 1 }, flat);
    for (const [raw, x] of [
      [carJson, 0],
      [carJson, 8], // on the 2 m block
      [enemyWalkerJson, -30],
    ] as const) {
      const r = w.lowestPlace(raw, x);
      expect(r.ok).toBe(true);
      expect(r.ok && r.y).toBe(scan(w, raw, x));
    }
    w.dispose();
  });

  it('steps over a robot spawned this tick, before any step', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.spawnBlueprint(carJson, { x: 0, y: 1.5 });
    const r = w.lowestPlace(carJson, 0.5);
    expect(r.ok && r.y).toBe(scan(w, carJson, 0.5));
    expect(r.ok && r.y).toBeGreaterThan(2.5);
    w.dispose();
  });

  it('finds a titan with its core high over its lowest part, quickly', async () => {
    const w = await World.create({ seed: 1 }, flat);
    for (const raw of [titanJuggernautJson, titanShatterJson]) {
      const r = w.lowestPlace(raw, -60);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      // The first height that fits: a step lower does not (a full scan costs one validation per step, too slow here).
      expect(r.y).toBeGreaterThan(5);
      expect(w.canPlace(raw, { x: -60, y: r.y }).ok).toBe(true);
      expect(w.canPlace(raw, { x: -60, y: r.y - 0.05 }).ok).toBe(false);
    }
    w.dispose();
  });

  it('reports why nothing fits', async () => {
    const w = await World.create({ seed: 1 }, flat);
    expect(w.lowestPlace({ format: 1, name: 'bad', grid: ['C . F'] }, 0)).toEqual({ ok: false, reason: 'frame@2,0 has no attached face (its faces N, E, S, W touch nothing)' });
    expect(w.lowestPlace(carJson, 0, { to: 1 })).toEqual({ ok: false, reason: 'below the ground' });
    expect(w.lowestPlace(carJson, 8, { from: 1.5, to: 2.4 })).toEqual({ ok: false, reason: 'overlaps something already in the world' });
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
