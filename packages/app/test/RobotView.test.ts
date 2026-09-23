import { describe, expect, it } from 'vitest';
import { World, parseWorldFile } from '@robots/sim-core';
import carJson from '../../../blueprints/car.json';
import flatJson from '../../../worlds/flat.json';
import { layoutRobot } from '../src/render/robotLayout';

describe('layoutRobot', () => {
  it('lays out the car as three bodies with part and mount sprites', async () => {
    const w = await World.create({ seed: 1 }, parseWorldFile(flatJson));
    const car = w.spawnBlueprint(carJson, { x: 0, y: 3 });
    const bodies = layoutRobot(car);
    expect(bodies).toHaveLength(3);
    // Wheel bodies draw first so the main body and its axle brackets sit on top.
    expect(bodies.map((b) => b.group)).toEqual([1, 2, 0]);
    const main = bodies[2];
    expect(main?.sprites.filter((s) => s.kind === 'part')).toHaveLength(6);
    expect(main?.sprites.filter((s) => s.kind === 'mount')).toEqual([
      { kind: 'mount', partId: 'wheel@0,0', frame: 'part.wheel.mount', x: -2, y: -1, rotation: 0 },
      { kind: 'mount', partId: 'wheel@5,0', frame: 'part.wheel.mount', x: 3, y: -1, rotation: 0 },
    ]);
    expect(main?.sprites.find((s) => s.partId === 'frame@0,1')).toMatchObject({ x: -2, y: 0 });
    expect(bodies[0]?.sprites).toEqual([{ kind: 'part', partId: 'wheel@0,0', frame: 'part.wheel', x: 0, y: 0, rotation: 0 }]);
    w.dispose();
  });

  it('rotates sprites with their part', async () => {
    const w = await World.create({ seed: 1 }, parseWorldFile(flatJson));
    const r = w.spawnBlueprint({ format: 1, name: 't', grid: ['T> C'] }, { x: 0, y: 3 });
    const t = layoutRobot(r)[0]?.sprites.find((s) => s.partId === 'thruster@0,0');
    expect(t?.rotation).toBeCloseTo((3 * Math.PI) / 2, 12);
    w.dispose();
  });
});
