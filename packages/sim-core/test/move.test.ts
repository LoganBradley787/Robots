import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { buildReplay, parseReplay, runReplay } from '../src/replay/replayFile';

/** The sandbox's Move (`World.moveRobot`): a robot picked up and put down as it is. */
const flat = parseWorldFile(flatJson);
const car = (): unknown => JSON.parse(readFileSync(new URL('../../../blueprints/armored-car.json', import.meta.url), 'utf8'));

const steps = (w: World, n: number): void => {
  for (let i = 0; i < n; i++) w.step();
};
const health = (r: Robot): number => [...r.parts.values()].reduce((n, p) => n + p.health, 0);
/** Each body's place and angle in the core body's frame: what a rigid move must keep. */
function shape(w: World, r: Robot): { x: number; y: number; angle: number }[] {
  const core = r.parts.get(r.primaryCoreId as string);
  const ref = w.physics.state(r.groups[core?.group ?? 0]!.bodyId);
  const c = Math.cos(-ref.angle);
  const n = Math.sin(-ref.angle);
  return r.groups.map((g) => {
    const s = w.physics.state(g.bodyId);
    return { x: c * (s.x - ref.x) - n * (s.y - ref.y), y: n * (s.x - ref.x) + c * (s.y - ref.y), angle: s.angle - ref.angle };
  });
}
const coreAngle = (w: World, r: Robot): number => w.physics.state(r.groups[r.parts.get(r.primaryCoreId as string)?.group ?? 0]!.bodyId).angle;

describe('Move: a robot picked up and put down as it is', () => {
  it('puts a robot on its back upright again, its wheels with it, and it takes no crash for it', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(car(), { x: 0, y: 3 });
    expect(r.groups.length).toBeGreaterThan(1);
    steps(w, 60);
    expect(w.moveRobot(r.id, 0, 6, Math.PI)).toBe(true);
    steps(w, 180);
    expect(Math.abs(Math.cos(coreAngle(w, r)) + 1)).toBeLessThan(0.1);
    const before = shape(w, r);
    const hp = health(r);
    const parts = r.parts.size;
    expect(w.moveRobot(r.id, 20, 3, 0)).toBe(true);
    const after = shape(w, r);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!.x).toBeCloseTo(before[i]!.x, 3);
      expect(after[i]!.y).toBeCloseTo(before[i]!.y, 3);
      expect(Math.cos(after[i]!.angle - before[i]!.angle)).toBeCloseTo(1, 4);
    }
    steps(w, 180);
    expect(Math.abs(coreAngle(w, r))).toBeLessThan(0.15);
    expect(r.parts.size).toBe(parts);
    expect(health(r)).toBeCloseTo(hp, 6);
    w.dispose();
  });

  it('is in the replay: the same moves on the same ticks give the same world', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(car(), { x: 0, y: 3 });
    steps(w, 30);
    w.moveRobot(r.id, 10, 8, 2);
    steps(w, 90);
    w.moveRobot(r.id, -15, 3, 0);
    steps(w, 60);
    const replay = parseReplay(JSON.parse(JSON.stringify(buildReplay(w))));
    expect(replay.inputs.filter((t) => t.world?.move !== undefined).map((t) => t.world?.move?.length)).toEqual([1, 1]);
    const again = await runReplay(replay);
    expect(again.matches).toBe(true);
    w.dispose();
    again.world.dispose();
  });

  it('says whether a place is clear of the ground and of other robots, not of itself', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(car(), { x: 0, y: 3 });
    const other = w.spawnBlueprint(car(), { x: 30, y: 3 });
    steps(w, 60);
    const here = w.physics.state(r.groups[0]!.bodyId);
    expect(w.movePlan(r.id, here.x + 0.3, here.y + 0.3, here.angle)?.fits).toBe(true);
    expect(w.movePlan(r.id, 0, 12, 0)?.fits).toBe(true);
    expect(w.movePlan(r.id, 0, -2, 0)?.fits).toBe(false);
    const there = w.physics.state(other.groups[0]!.bodyId);
    expect(w.movePlan(r.id, there.x, there.y, 0)?.fits).toBe(false);
    expect(w.movePlan(r.id, 0, 12, 0)?.bodies).toHaveLength(r.groups.length);
    w.removeRobots([other.id]);
    expect(w.movePlan(other.id, 0, 12, 0)).toBeUndefined();
    expect(w.moveRobot(other.id, 0, 12, 0)).toBe(false);
    w.dispose();
  });
});
