import { describe, expect, it } from 'vitest';
import carJson from '../../../blueprints/car.json';
import showcaseJson from '../../../blueprints/showcase.json';
import flatJson from '../../../worlds/flat.json';
import { BlueprintError } from '../src/blueprint/validate';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';

const flat = parseWorldFile(flatJson);

function atRest(w: World, r: Robot): boolean {
  return r.groups.every((g) => {
    const s = w.physics.state(g.bodyId);
    return Math.hypot(s.vx, s.vy) < 0.05 && Math.abs(s.w) < 0.05;
  });
}

describe('spawnBlueprint', () => {
  it('builds the car as a main body and two jointed wheels', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(carJson, { x: 0, y: 3 });
    expect(w.robots).toEqual([car]);
    expect(car.name).toBe('car');
    expect(car.parts.size).toBe(8);
    expect(car.groups).toHaveLength(3);
    expect(car.groups.filter((g) => g.joint)).toHaveLength(2);
    expect(car.primaryCoreId).toBe('core@2,1');
    expect(car.chunks).toEqual([{ partIds: [...car.parts.keys()], groups: [0, 1, 2], coreId: 'core@2,1' }]);
    // The main body's origin is the core, placed at the spawn point.
    const main = w.physics.state(car.groups[0]?.bodyId ?? 0);
    expect(main.x).toBe(0);
    expect(main.y).toBe(3);
    const wheel = car.parts.get('wheel@5,0');
    expect(wheel?.group).toBe(2);
    expect(car.parts.get('frame@0,1')).toMatchObject({ group: 0, localX: -2, localY: 0 });
    expect(car.groups[2]?.joint).toMatchObject({ partId: 'wheel@5,0', parentGroup: 0, anchorParentX: 3, anchorParentY: -1 });
    w.dispose();
  });

  it('the car comes to rest level on its wheels', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(carJson, { x: 0, y: 3 });
    for (let i = 0; i < 240; i++) w.step();
    expect(atRest(w, car)).toBe(true);
    const main = w.physics.state(car.groups[0]?.bodyId ?? 0);
    expect(Math.abs(main.angle)).toBeLessThan(0.01);
    expect(main.y).toBeCloseTo(1.45, 1);
    expect(Math.abs(main.y - 1.45)).toBeLessThan(0.02);
    for (const g of car.groups.slice(1)) expect(Math.abs(w.physics.state(g.bodyId).y - 0.45)).toBeLessThan(0.02);
    w.dispose();
  });

  it('robot mass equals the sum of its part defs', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(carJson, { x: 0, y: 3 });
    const mass = car.groups.reduce((m, g) => m + w.physics.massProperties(g.bodyId).mass, 0);
    expect(mass).toBeCloseTo(12, 3);
    w.dispose();
  });

  it('rejects an invalid blueprint without creating bodies', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const before = w.physics.bodyIds.length;
    expect(() => w.spawnBlueprint({ format: 1, name: 'bad', grid: ['C . F'] }, { x: 0, y: 3 })).toThrow(BlueprintError);
    expect(w.physics.bodyIds).toHaveLength(before);
    expect(w.robots).toEqual([]);
    w.dispose();
  });

  it('the showcase validates and rests upright', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const sc = w.spawnBlueprint(showcaseJson, { x: 0, y: 4 });
    for (let i = 0; i < 300; i++) w.step();
    expect(atRest(w, sc)).toBe(true);
    expect(Math.abs(w.physics.state(sc.groups[0]?.bodyId ?? 0).angle)).toBeLessThan(0.05);
    w.dispose();
  });

  it('the chunk core honors primaryCore', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint({ format: 1, name: 't', grid: ['C F C'], primaryCore: 'core@2,0' }, { x: 0, y: 3 });
    expect(r.primaryCoreId).toBe('core@2,0');
    expect(r.chunks[0]?.coreId).toBe('core@2,0');
    w.dispose();
  });

  it('a core-less blueprint spawns rooted at its first part', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const bomb = w.spawnBlueprint({ format: 1, name: 'bomb', grid: ['X'] }, { x: 5, y: 5 });
    expect(bomb.primaryCoreId).toBeUndefined();
    expect(bomb.chunks[0]?.coreId).toBeUndefined();
    expect(w.physics.state(bomb.groups[0]?.bodyId ?? 0).x).toBe(5);
    w.dispose();
  });
});
