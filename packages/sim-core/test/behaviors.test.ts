import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { BEHAVIORS } from '../src/behaviors/registry';
import { defaultRegistry } from '../src/parts/registry';
import { sampleRobot } from '../src/metrics/robotMetrics';
import type { Robot } from '../src/world/Robot';

const flat = parseWorldFile(flatJson);
const CAR = {
  format: 1,
  name: 'test car',
  grid: ['F  F  C  F  F', 'W  .  .  .  W'],
  legend: { W: { part: 'wheel', tags: ['wheels'] } },
  bindings: [
    { key: 'd', mode: 'hold', target: 'wheels', channel: 'speed', value: 1 },
    { key: 'a', mode: 'hold', target: 'wheels', channel: 'speed', value: -1 },
  ],
};

async function drive(bp: unknown, script: { at: number; press?: string; release?: string }[], seconds: number) {
  const w = await World.create({ seed: 1 }, flat);
  const robot = w.spawnBlueprint(bp, { x: 0, y: 1.5 });
  for (let i = 0; i < 60; i++) w.step(); // settle
  const x0 = sampleRobot(w, robot).coreX;
  const ticks = Math.round(seconds * 60);
  let maxY = -Infinity;
  for (let i = 0; i < ticks; i++) {
    const inputs = script.filter((s) => s.at === i).map((s) => ({ robot: robot.id, pressed: s.press ? [s.press] : [], released: s.release ? [s.release] : [] }));
    w.step(inputs);
    maxY = Math.max(maxY, sampleRobot(w, robot).coreY);
  }
  const s = sampleRobot(w, robot);
  const vx = w.physics.state(robot.groups[robot.parts.get(robot.primaryCoreId ?? robot.rootId)?.group ?? 0]?.bodyId ?? 0).vx;
  w.dispose();
  return { dx: s.coreX - x0, vx, maxY, tilt: s.tiltDeg };
}

describe('behaviors', () => {
  it('every def that names a known behavior has the config and structure it needs', () => {
    for (const def of defaultRegistry().list()) {
      const b = def.behavior === undefined ? undefined : BEHAVIORS.get(def.behavior);
      if (!b) continue;
      for (const key of b.config) expect(def.behaviorConfig?.[key], `${def.id}.behaviorConfig.${key}`).toBeTypeOf('number');
      if (b.needsJoint) expect(def.joint, `${def.id}.joint`).toBeDefined();
      if (b.needsActs) expect(def.acts, `${def.id}.acts`).toBeDefined();
    }
  });

  it('holding D drives the car right, holding A drives it left', async () => {
    const right = await drive(CAR, [{ at: 0, press: 'd' }], 2);
    const left = await drive(CAR, [{ at: 0, press: 'a' }], 2);
    expect(right.dx).toBeGreaterThan(2);
    expect(left.dx).toBeLessThan(-2);
  });

  it('forward is toward +x whatever the wheel rotation', async () => {
    const sideWheels = { ...CAR, grid: ['W<  F  C  F  W>', '.   W  .  W  .'] };
    const r = await drive(sideWheels, [{ at: 0, press: 'd' }], 2);
    expect(r.dx).toBeGreaterThan(1);
  });

  it('letting go coasts instead of braking', async () => {
    const r = await drive(CAR, [{ at: 0, press: 'd' }, { at: 120, release: 'd' }], 3);
    const held = await drive(CAR, [{ at: 0, press: 'd' }], 2);
    expect(r.vx).toBeGreaterThan(held.vx * 0.6);
  });

  it('a heavier robot accelerates slower', async () => {
    const heavy = { ...CAR, grid: ['F  F  F  F  F', 'F  F  F  F  F', 'F  F  C  F  F', 'W  .  .  .  W'] };
    const light = await drive(CAR, [{ at: 0, press: 'd' }], 1);
    const slow = await drive(heavy, [{ at: 0, press: 'd' }], 1);
    expect(slow.vx).toBeLessThan(light.vx * 0.75);
  });

  it('a thruster pushing up lifts a light robot', async () => {
    const hopper = { format: 1, name: 'hopper', grid: ['C', 'T^'], bindings: [{ key: 'w', mode: 'hold', target: 'thruster', channel: 'throttle', value: 1 }] };
    const r = await drive(hopper, [{ at: 0, press: 'w' }], 1);
    expect(r.maxY).toBeGreaterThan(3);
  });

  it('an off-center thruster spins the robot', async () => {
    const pushed = { format: 1, name: 'lopsided', grid: ['T^  F  F  F  C'], bindings: [{ key: 'w', mode: 'hold', target: 'thruster', channel: 'throttle', value: 1 }] };
    const r = await drive(pushed, [{ at: 0, press: 'w' }], 0.5);
    expect(Math.abs(r.tilt)).toBeGreaterThan(10);
  });

  it('a recorded drive replays to the same hash', async () => {
    const record = async (): Promise<{ hashes: string[]; log: ReturnType<World['inputLog']['toJSON']> }> => {
      const w = await World.create({ seed: 1 }, flat);
      const car: Robot = w.spawnBlueprint(CAR, { x: 0, y: 1.5 });
      const hashes: string[] = [];
      for (let i = 0; i < 300; i++) {
        const inputs = i === 10 ? [{ robot: car.id, pressed: ['d'], released: [] }] : i === 200 ? [{ robot: car.id, pressed: ['a'], released: ['d'] }] : [];
        w.step(inputs);
        if (w.tick % 60 === 0) hashes.push(w.hash());
      }
      const log = w.inputLog.toJSON();
      w.dispose();
      return { hashes, log };
    };
    const a = await record();
    const w = await World.create({ seed: 1 }, flat);
    w.spawnBlueprint(CAR, { x: 0, y: 1.5 });
    const byTick = new Map(a.log.map((e) => [e.tick, e.inputs]));
    const hashes: string[] = [];
    for (let i = 0; i < 300; i++) {
      w.step(byTick.get(i) ?? []);
      if (w.tick % 60 === 0) hashes.push(w.hash());
    }
    w.dispose();
    expect(hashes).toEqual(a.hashes);
  });
});

describe('PhysicsWorld.dynamicBodyAt', () => {
  it('finds a just-spawned robot body under a point and ignores terrain', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(CAR, { x: 0, y: 1.5 });
    const core = car.groups[car.parts.get('core@2,1')?.group ?? -1]?.bodyId;
    expect(w.physics.dynamicBodyAt(0, 1.5)).toBe(core);
    expect(w.physics.dynamicBodyAt(0, -0.5)).toBeUndefined();
    expect(w.physics.dynamicBodyAt(30, 20)).toBeUndefined();
    w.dispose();
  });
});
