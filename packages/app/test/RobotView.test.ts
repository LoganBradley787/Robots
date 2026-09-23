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

  it('describes flame overlays at the nozzle and propeller animations, driven by the first input channel', async () => {
    const w = await World.create({ seed: 1 }, parseWorldFile(flatJson));
    const r = w.spawnBlueprint({ format: 1, name: 't', grid: ['P  C  T<', '.  T^ .'] }, { x: 0, y: 3 });
    const sprites = layoutRobot(r).flatMap((b) => b.sprites);
    const up = sprites.find((s) => s.partId === 'thruster@1,0');
    expect(up?.overlay).toEqual({ name: 'fx.flame', x: 0, y: -1.5 });
    expect(up?.channel).toBe('throttle');
    // T< pushes left, so its flame comes out of its right side.
    const left = sprites.find((s) => s.partId === 'thruster@2,1');
    expect(left?.overlay?.x).toBeCloseTo(1.5, 12);
    expect(left?.overlay?.y).toBeCloseTo(0, 12);
    expect(sprites.find((s) => s.partId === 'propeller@0,1')?.animation).toBe('fx.propeller');
    expect(sprites.find((s) => s.partId === 'core@1,1')?.channel).toBeUndefined();
    w.dispose();
  });
});
