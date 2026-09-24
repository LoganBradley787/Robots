import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { partWorldPose } from '../src/metrics/robotMetrics';
import { buildReplay, runReplay } from '../src/replay/replayFile';
import { resolveScripts } from '../src/blueprint/scripts';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
/** A shipped blueprint with its script files loaded. */
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

function fastest(w: World): number {
  let v = 0;
  for (const r of w.robots) for (const g of r.groups) v = Math.max(v, Math.hypot(w.physics.state(g.bodyId).vx, w.physics.state(g.bodyId).vy));
  return v;
}

describe('M6 and M7 done when', () => {
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

  it('a guided missile (M7): fired flat with F, it wakes, flies its line, and blows a hole in the wall', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const launcher = w.spawnBlueprint(blueprint('launcher'), { x: -100, y: 1.5 });
    const wall = w.spawnBlueprint(blueprint('wall'), { x: -80, y: 5.5 });
    for (let i = 0; i < 60; i++) w.step();
    w.step([{ robot: launcher.id, pressed: ['f'], released: [] }]);
    const missile = w.robots.find((r) => r.brokeFrom === launcher.id) as Robot;
    expect([...missile.parts.keys()]).toEqual(['thruster@5,6', 'gyro@6,6', 'cell@7,6', 'core@8,6', 'warhead@9,6']);
    expect(missile.woke).toBe(true);
    expect(w.scripts(missile.id)).toEqual([{ id: 'guide', enabled: true }]);
    w.step();
    expect(w.channelValue(missile.id, 'thruster@5,6', 'throttle')).toBe(1);
    let lowest = Infinity;
    let fastestSeen = 0;
    for (let i = 0; i < 180; i++) {
      w.step();
      fastestSeen = Math.max(fastestSeen, fastest(w));
      if (w.events.some((e) => e.kind === 'explosion')) continue;
      lowest = Math.min(lowest, w.physics.state(missile.groups[0]?.bodyId as number).y);
    }
    // It sags off the rail, then holds its line well clear of the ground.
    expect(lowest).toBeGreaterThan(2.5);
    const blast = w.events.find((e) => e.kind === 'explosion');
    expect(blast?.robot).toBe(missile.id);
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === wall.id).length).toBeGreaterThanOrEqual(2);
    expect(fastestSeen).toBeLessThan(40);
    w.dispose();
  });

  it('a guided missile flies the angle the turret aimed, even fired while the turret still turns', async () => {
    for (const [hold, fireAt] of [
      [60, 90],
      [60, 50],
    ] as const) {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const launcher = w.spawnBlueprint(blueprint('launcher'), { x: -100, y: 1.5 });
      for (let i = 0; i < 60; i++) w.step();
      w.step([{ robot: launcher.id, pressed: ['z'], released: [] }]);
      let aim = 0;
      for (let i = 1; i <= Math.max(hold, fireAt); i++) {
        // The missile's line is where the turret points when it lets go.
        if (i === fireAt) aim = (w.partOutput(launcher.id, 'rotator@4,4', 'angle') ?? 0) * (Math.PI / 2);
        const input = { robot: launcher.id, pressed: i === fireAt ? ['f'] : [], released: i === hold ? ['z'] : [] };
        w.step(input.pressed.length + input.released.length > 0 ? [input] : []);
      }
      const missile = w.robots.find((r) => r.brokeFrom === launcher.id) as Robot;
      for (let i = 0; i < 180; i++) w.step();
      const s = w.physics.state(missile.groups[0]?.bodyId as number);
      expect(Math.abs(Math.atan2(s.vy, s.vx) - aim)).toBeLessThan(0.1);
      w.dispose();
    }
  });

});
