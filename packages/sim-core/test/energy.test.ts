import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { sampleRobot } from '../src/metrics/robotMetrics';
import { buildReplay, runReplay } from '../src/replay/replayFile';

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
// Core (600) and two upward thrusters (20/s each at full throttle): 15 s of thrust.
const LIFTER = { format: 1, name: 'lifter', grid: ['F  T^ C  T^ F'] };
const CAR = { format: 1, name: 'car', grid: ['F  F  C  B  F  F', 'W  .  .  .  .  W'] };

async function world(): Promise<World> {
  return World.create({ seed: 1 }, open);
}

describe('energy', () => {
  it('a robot starts with its core and batteries full', async () => {
    const w = await world();
    const car = w.spawnBlueprint(CAR, { x: 0, y: 1.45 });
    expect(w.energy(car.id)).toEqual({ stored: 2100, capacity: 2100, used: 0 });
    w.dispose();
  });

  it('thrusting drains the pool at powerDraw per second and the robot falls when it runs dry', async () => {
    const w = await world();
    const r = w.spawnBlueprint(LIFTER, { x: 0, y: 1 });
    w.step([{ robot: r.id, pressed: ['w'], released: [] }]);
    for (let i = 0; i < 60 * 5 - 1; i++) w.step();
    expect(w.energy(r.id)?.stored).toBeCloseTo(600 - 40 * 5, 6);
    const up = sampleRobot(w, r).coreY;
    expect(up).toBeGreaterThan(20);
    for (let i = 0; i < 60 * 10; i++) w.step();
    expect(w.energy(r.id)?.stored).toBe(0);
    expect(w.events.filter((e) => e.kind === 'energyEmpty')).toEqual([{ tick: 899, robot: r.id, kind: 'energyEmpty', chunk: 0 }]);
    // W is still held but there is nothing to burn: gravity and air drag slow it now.
    const body = r.groups[0]?.bodyId ?? 0;
    const vy0 = w.physics.state(body).vy;
    for (let i = 0; i < 60; i++) w.step();
    expect(w.physics.state(body).vy - vy0).toBeLessThan(-9.81);
    w.dispose();
  });

  it('coasting draws nothing; driving draws by throttle', async () => {
    const w = await world();
    const car = w.spawnBlueprint(CAR, { x: 0, y: 1.45 });
    for (let i = 0; i < 120; i++) w.step();
    expect(w.energy(car.id)?.stored).toBe(2100);
    w.step([{ robot: car.id, pressed: ['d'], released: [] }]);
    for (let i = 0; i < 59; i++) w.step();
    expect(w.energy(car.id)?.stored).toBeCloseTo(2100 - 10, 6); // two wheels at 5/s for 1 s
    w.dispose();
  });

  it('a brownout scales every consumer by the same share', async () => {
    const w = await world();
    const r = w.spawnBlueprint(LIFTER, { x: 0, y: 1 });
    const core = r.parts.get('core@2,0');
    if (!core) throw new Error('no core');
    core.stored = 0.2; // less than one tick of full thrust (40/s * 1/60 = 0.667)
    w.step([{ robot: r.id, pressed: ['w'], released: [] }]);
    expect(w.energy(r.id)?.stored).toBe(0);
    expect(w.energy(r.id)?.used).toBeCloseTo(0.2, 9);
    w.dispose();
  });

  it('unlimited energy never drains, is logged, and replays', async () => {
    const w = await world();
    const r = w.spawnBlueprint(LIFTER, { x: 0, y: 1 });
    w.setUnlimitedEnergy(true);
    w.step([{ robot: r.id, pressed: ['w'], released: [] }]);
    for (let i = 0; i < 1200; i++) w.step();
    expect(w.energy(r.id)?.stored).toBe(600);
    w.setUnlimitedEnergy(false);
    for (let i = 0; i < 60; i++) w.step();
    expect(w.energy(r.id)?.stored).toBeCloseTo(560, 6);
    const replay = JSON.parse(JSON.stringify(buildReplay(w)));
    const again = await runReplay(replay);
    expect(again.matches).toBe(true);
    again.world.dispose();
    w.dispose();
  });

  it('energy feeds the hash', async () => {
    const a = await world();
    const b = await world();
    const ra = a.spawnBlueprint(LIFTER, { x: 0, y: 1 });
    b.spawnBlueprint(LIFTER, { x: 0, y: 1 });
    const core = ra.parts.get('core@2,0');
    if (core) core.stored = 599;
    expect(a.hash()).not.toBe(b.hash());
    a.dispose();
    b.dispose();
  });

  it('batteries report their charge; the core reports its pool', async () => {
    const w = await world();
    const car = w.spawnBlueprint(CAR, { x: 0, y: 1.45 });
    w.step([{ robot: car.id, pressed: ['d'], released: [] }]);
    for (let i = 0; i < 599; i++) w.step(); // 10 s of two wheels: 100 drawn, shared by what each holds
    expect(w.partOutput(car.id, 'battery@3,1', 'charge')).toBeCloseTo((1500 - 100 * (1500 / 2100)) / 1500, 6);
    expect(w.partOutput(car.id, 'core@2,1', 'energy')).toBeCloseTo(2000, 6);
    expect(w.partOutput(car.id, 'core@2,1', 'energyCapacity')).toBe(2100);
    expect(w.partOutput(car.id, 'frame@0,1', 'charge')).toBeUndefined();
    w.dispose();
  });

  it('a robot that never held energy never runs out of it', async () => {
    const w = await world();
    const r = w.spawnBlueprint({ format: 1, name: 'loose gyro', grid: ['F  G  F'] }, { x: 0, y: 4 });
    for (let i = 0; i < 240; i++) w.step(); // it tumbles on landing, so the gyro asks to damp
    expect(w.energy(r.id)).toEqual({ stored: 0, capacity: 0, used: 0 });
    // Its landing is logged (M15); nothing about energy is.
    expect(w.events.filter((e) => e.kind !== 'impact')).toEqual([]);
    w.dispose();
  });
});
