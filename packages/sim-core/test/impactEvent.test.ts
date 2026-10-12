import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { IMPACT_HEARD, World, type WorldEvent } from '../src/world/World';

const flat = parseWorldFile(flatJson);
type Impact = Extract<WorldEvent, { kind: 'impact' }>;
const impacts = (w: World): Impact[] => w.events.filter((e): e is Impact => e.kind === 'impact');

const BOX = { format: 1, name: 'box', grid: ['F  C  F'] };
const CAR = { format: 1, name: 'car', grid: ['F  C  F', 'W  .  W'] };

async function world(): Promise<World> {
  return World.create({ seed: 1 }, flat);
}

describe('impact events (M15)', () => {
  it('a robot dropped 5 m logs its landing: where, how hard, how heavy', async () => {
    const w = await world();
    const robot = w.spawnBlueprint(BOX as never, { x: -100, y: 5.5 });
    for (let i = 0; i < 180; i++) w.step();
    const hits = impacts(w);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const first = hits[0] as Impact;
    expect(first.robot).toBe(robot.id);
    // 5 m of fall is 9.9 m/s; the landing takes most of it in one step.
    expect(first.dv).toBeGreaterThan(6);
    expect(first.dv).toBeLessThan(11);
    expect(first.mass).toBeGreaterThan(0);
    expect(first.x).toBeCloseTo(-100, 0);
    expect(first.y).toBeLessThan(1.5);
    // A landing, then at most a bounce or two: not a stream.
    expect(hits.length).toBeLessThanOrEqual(4);
    for (const h of hits) expect(h.dv).toBeGreaterThan(IMPACT_HEARD);
  });

  it('at most one a tick for a robot', async () => {
    const w = await world();
    w.spawnBlueprint(CAR as never, { x: -100, y: 6 });
    for (let i = 0; i < 180; i++) w.step();
    const ticks = impacts(w).map((e) => `${e.robot}:${e.tick}`);
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it('a robot at rest and a car driving on the flat log none', async () => {
    const w = await world();
    w.spawnBlueprint(BOX as never, { x: -100, y: 0.5 });
    // Left of the resting robot and of the flat world's boxes (at -8, 8 and 15), driving left.
    const car = w.spawnBlueprint(CAR as never, { x: -300, y: 1.5 });
    for (let i = 0; i < 60; i++) w.step();
    const settled = w.events.length;
    for (let i = 0; i < 600; i++) w.step(i === 0 ? [{ robot: car.id, pressed: ['a'], released: [] }] : []);
    expect(w.physics.state(car.groups[0]?.bodyId ?? 0).x).toBeLessThan(-400);
    expect(w.events.slice(settled).filter((e) => e.kind === 'impact')).toEqual([]);
  });

  it('a car driving into a box logs the crash', async () => {
    const w = await world();
    const car = w.spawnBlueprint(CAR as never, { x: -40, y: 1.5 });
    for (let i = 0; i < 60; i++) w.step();
    const settled = w.events.length;
    for (let i = 0; i < 400; i++) w.step(i === 0 ? [{ robot: car.id, pressed: ['d'], released: [] }] : []);
    const hits = w.events.slice(settled).filter((e): e is Impact => e.kind === 'impact');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.x).toBeGreaterThan(-12);
    expect(hits[0]?.dv).toBeGreaterThan(8);
  });

  it('hard thrust in free flight is not a hit', async () => {
    const w = await world();
    // 5 kg on 800 N: 160 m/s^2, more than 2 m/s a step with nothing touched.
    const rocket = w.spawnBlueprint({ format: 1, name: 'rocket', grid: ['K^ C  K^'] } as never, { x: -100, y: 0.5 });
    w.setUnlimitedEnergy(true);
    for (let i = 0; i < 30; i++) w.step();
    const settled = w.events.length;
    for (let i = 0; i < 60; i++) w.step(i === 0 ? [{ robot: rocket.id, pressed: ['w'], released: [] }] : []);
    expect(w.physics.state(rocket.groups[0]?.bodyId ?? 0).y).toBeGreaterThan(30);
    // Leaving the ground it still touches for a step or two; in the air, nothing.
    const flying = w.events.slice(settled).filter((e): e is Impact => e.kind === 'impact' && e.y > 3);
    expect(flying).toEqual([]);
  });

  it('a kick is not a hit', async () => {
    const w = await world();
    const robot = w.spawnBlueprint(BOX as never, { x: -100, y: 40 });
    w.step();
    w.kickRobot(robot, 30, 0);
    for (let i = 0; i < 5; i++) w.step();
    expect(impacts(w)).toEqual([]);
  });
});
