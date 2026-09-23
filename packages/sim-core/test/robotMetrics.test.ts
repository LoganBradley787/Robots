import { describe, expect, it } from 'vitest';
import carJson from '../../../blueprints/car.json';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { partWorldPose, sampleRobot } from '../src/metrics/robotMetrics';
import type { Robot } from '../src/world/Robot';

const flat = parseWorldFile(flatJson);

describe('sampleRobot', () => {
  it('reports the car at spawn, then at rest', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(carJson, { x: 0, y: 3 });
    const s0 = sampleRobot(w, car);
    expect(s0).toMatchObject({ tick: 0, coreX: 0, coreY: 3, tiltDeg: 0, bodies: 3, parts: 8, chunks: 1, resting: true });
    expect(s0.massKg).toBeCloseTo(12, 3);
    for (let i = 0; i < 240; i++) w.step();
    const s = sampleRobot(w, car);
    expect(s.resting).toBe(true);
    expect(Math.abs(s.coreY - 1.45)).toBeLessThan(0.02);
    expect(Math.abs(s.tiltDeg)).toBeLessThan(0.5);
    expect(s.comY).toBeLessThan(s.coreY);
    w.dispose();
  });

  it('is not resting while falling', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(carJson, { x: 0, y: 3 });
    for (let i = 0; i < 10; i++) w.step();
    expect(sampleRobot(w, car).resting).toBe(false);
    w.dispose();
  });

  it('partWorldPose rotates the local offset with the body', () => {
    const fakeWorld = { physics: { state: () => ({ x: 1, y: 2, angle: Math.PI / 2, vx: 0, vy: 0, w: 0 }) } } as unknown as World;
    const robot = { name: 'r', parts: new Map([['p', { group: 0, localX: 1, localY: 0 }]]), groups: [{ bodyId: 1 }] } as unknown as Robot;
    const p = partWorldPose(fakeWorld, robot, 'p');
    expect(p.x).toBeCloseTo(1, 12);
    expect(p.y).toBeCloseTo(3, 12);
  });

  it('partWorldPose applies the body transform to the local offset', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(carJson, { x: 0, y: 3 });
    expect(partWorldPose(w, car, 'frame@0,1')).toEqual({ x: -2, y: 3, angle: 0 });
    expect(partWorldPose(w, car, 'wheel@5,0')).toEqual({ x: 3, y: 2, angle: 0 });
    w.dispose();
  });
});
