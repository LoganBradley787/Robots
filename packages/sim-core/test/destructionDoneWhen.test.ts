import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { partWorldPose } from '../src/metrics/robotMetrics';
import { buildReplay, runReplay } from '../src/replay/replayFile';

const flat = parseWorldFile(flatJson);
const blueprint = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../blueprints/${name}.json`, import.meta.url), 'utf8'));

function fastest(w: World): number {
  let v = 0;
  for (const r of w.robots) for (const g of r.groups) v = Math.max(v, Math.hypot(w.physics.state(g.bodyId).vx, w.physics.state(g.bodyId).vy));
  return v;
}

describe('M6 done when', () => {
  it("Logan's bomb test: a bomb dropped on the driving longcar breaks it in two; the core-less half drives on", async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(blueprint('longcar'), { x: -100, y: 1.5 });
    w.step([{ robot: car.id, pressed: ['d'], released: [] }]);
    for (let i = 1; i < 120; i++) w.step();
    // Lead the moving car: the bomb falls 2.5 m (0.71 s) onto the middle of its roof, at 7 m/s.
    const mid = (partWorldPose(w, car, 'frame@2,1').x + partWorldPose(w, car, 'frame@3,1').x) / 2;
    const vx = w.physics.state(car.groups[0]?.bodyId as number).vx;
    w.spawnBlueprint(blueprint('bomb'), { x: mid + vx * 0.714, y: 4.95 });
    let fastestSeen = 0;
    for (let i = 0; i < 60; i++) {
      w.step();
      fastestSeen = Math.max(fastestSeen, fastest(w));
    }
    expect(w.events.filter((e) => e.kind === 'explosion')).toHaveLength(1);
    const pieces = w.robots.filter((r) => r.id === car.id || r.brokeFrom === car.id);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(w.canControl(car.id)).toBe(true);
    const half = pieces.find((r) => r.parts.has('wheel@5,0') && r.primaryCoreId === undefined) as Robot;
    expect(half).toBeDefined();
    expect(w.channelValue(half.id, 'wheel@5,0', 'speed')).toBe(1);
    for (let i = 0; i < 120; i++) {
      w.step();
      fastestSeen = Math.max(fastestSeen, fastest(w));
    }
    expect(w.physics.state(half.groups[0]?.bodyId as number).vx).toBeGreaterThan(2);
    expect(fastestSeen).toBeLessThan(40);
    // And the whole thing replays exactly.
    const again = await runReplay(buildReplay(w));
    expect(again.matches).toBe(true);
    again.world.dispose();
    w.dispose();
  });

  it('a dumb missile: aimed with Z, fired with F, decoupled, flies straight, and blows a hole in the wall', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const launcher = w.spawnBlueprint(blueprint('launcher'), { x: -100, y: 1.5 });
    const wall = w.spawnBlueprint(blueprint('wall'), { x: -80, y: 5.5 });
    for (let i = 0; i < 60; i++) w.step();
    // Aim up about 0.47 rad (14 ticks at 2 rad/s): the missile's thrust then just beats gravity over 20 m.
    w.step([{ robot: launcher.id, pressed: ['z'], released: [] }]);
    for (let i = 1; i < 14; i++) w.step();
    w.step([{ robot: launcher.id, pressed: [], released: ['z'] }]);
    for (let i = 0; i < 40; i++) w.step();
    const rotator = launcher.parts.get('rotator@2,2');
    const aim = w.physics.state(launcher.groups[rotator?.group ?? 0]?.bodyId as number).angle;
    expect(aim).toBeGreaterThan(0.4);
    w.step([{ robot: launcher.id, pressed: ['f'], released: [] }]);
    const missile = w.robots.find((r) => r.brokeFrom === launcher.id) as Robot;
    expect([...missile.parts.keys()]).toEqual(['thruster@3,3', 'battery@4,3', 'warhead@5,3']);
    expect(w.channelValue(missile.id, 'thruster@3,3', 'throttle')).toBe(1);
    let maxTurn = 0;
    let fastestSeen = 0;
    for (let i = 0; i < 180; i++) {
      w.step();
      fastestSeen = Math.max(fastestSeen, fastest(w));
      if (w.events.some((e) => e.kind === 'explosion')) continue;
      maxTurn = Math.max(maxTurn, Math.abs(w.physics.state(missile.groups[0]?.bodyId as number).angle - aim));
    }
    // Straight: its heading stays within 5 degrees of the aim until it hits.
    expect(maxTurn).toBeLessThan((5 * Math.PI) / 180);
    const blast = w.events.find((e) => e.kind === 'explosion');
    expect(blast?.robot).toBe(missile.id);
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === wall.id).length).toBeGreaterThanOrEqual(2);
    expect(fastestSeen).toBeLessThan(40);
    w.dispose();
  });
});
