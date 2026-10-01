import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { resolveScripts } from '../src/blueprint/scripts';
import { orientRaw } from '../src/blueprint/orient';
import { defaultRegistry } from '../src/parts/registry';
import { partWorldPose } from '../src/metrics/robotMetrics';
import type { Robot } from '../src/world/Robot';
import type { RobotInput } from '../src/control/types';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;
const press = (robot: number, key: string): RobotInput => ({ robot, pressed: [key], released: [] });
const lift = (robot: number, key: string): RobotInput => ({ robot, pressed: [], released: [key] });
/** The core's world pose. */
const core = (w: World, r: Robot): { x: number; y: number; angle: number } => partWorldPose(w, r, r.primaryCoreId as string);
/** The robot's status lines (its scripts' `log()`), oldest first. */
const status = (w: World, r: Robot): string[] => w.scriptLogs.filter((l) => l.robot === r.id).map((l) => l.text);

describe('tech fab drone, done when', () => {
  it('its tech missiles fly to a hovering hunter drone, blast it with their nose guns on the way in, and set off their distance charges beside it', { timeout: 90_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -100, y: 40 });
    const d = w.spawnBlueprint(orientRaw(blueprint('enemy-tech-fab-drone'), { flip: true, rot: 0 }, defaultRegistry()), { x: 300, y: 40 }, { team: 1 });
    // Its missiles are gone by the end (blown up): note what broke off it while they fly (its flares too, harmless here).
    const missiles = new Set<number>();
    for (let t = 0; t < 25 * 60; t++) {
      w.step();
      for (const r of w.robots) if (r.brokeFrom === d.id) missiles.add(r.id);
    }
    expect(w.events.filter((e) => e.kind === 'released' && e.robot === d.id).length).toBeGreaterThanOrEqual(3);
    // Nose guns hit the hunter.
    const gunHits = w.events.filter((e) => e.kind === 'shellHit' && missiles.has(e.by) && e.robot === hunter.id).length;
    expect(gunHits).toBeGreaterThanOrEqual(5);
    // Charges armed and went off near it.
    expect(w.events.filter((e) => e.kind === 'armed' && missiles.has(e.robot)).length).toBeGreaterThanOrEqual(3);
    const hs = w.physics.state(hunter.groups[0]?.bodyId as number);
    const near = w.events.filter((e) => e.kind === 'explosion' && Math.hypot(e.x - hs.x, e.y - hs.y) < 30).length;
    expect(near).toBeGreaterThanOrEqual(2);
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === hunter.id).length).toBeGreaterThanOrEqual(8);
    // Nothing of its own lost to its own missiles.
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === d.id).length).toBe(0);
    w.dispose();
  });
});

// Logan flying them by hand: "it sinks while W is held" and "nothing tracked". Both heavy fab drones (105 kg with a
// missile in the bay) leaned 60 degrees on A and D, where their propellers hold 86 kg.
describe.each(['tech-fab-drone', 'gun-missile-fab-drone'])('%s by hand, done when', (name) => {
  it('holds its height hands off, climbs on W, sinks on S, and flies left and right on A and D without losing height', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(blueprint(name), { x: -1000, y: 60 });
    let low = Infinity;
    const run = (seconds: number): void => {
      for (let t = 0; t < seconds * 60; t++) {
        w.step();
        low = Math.min(low, core(w, r).y);
      }
    };
    const hold = (key: string, seconds: number): void => {
      w.step([press(r.id, key)]);
      run(seconds);
      w.step([lift(r.id, key)]);
    };
    // Hands off, through the bay finishing its first missile (8 kg more to carry).
    run(8);
    expect(Math.abs(core(w, r).y - 60)).toBeLessThan(0.5);
    // W climbs, S sinks, and let go it stops.
    hold('w', 3);
    run(3);
    const high = core(w, r).y;
    expect(high).toBeGreaterThan(80);
    hold('s', 2);
    run(4);
    const down = core(w, r).y;
    expect(down).toBeLessThan(high - 10);
    run(2);
    expect(Math.abs(core(w, r).y - down)).toBeLessThan(0.5);
    // D flies right and A back left, and neither costs it its height.
    low = Infinity;
    const x0 = core(w, r).x;
    hold('d', 5);
    expect(core(w, r).x).toBeGreaterThan(x0 + 30);
    hold('a', 14);
    expect(core(w, r).x).toBeLessThan(x0 - 30);
    // (At 60 degrees of lean it sank 30 m and more, and each swing from one lean to the other cost it 4 to 9 m.)
    expect(low).toBeGreaterThan(down - 3);
    // Let go, it brakes to a stop by itself. Then W and D together: it climbs while it flies.
    run(12);
    expect(Math.abs(w.physics.state(r.groups[0]?.bodyId as number).vx)).toBeLessThan(2);
    const y1 = core(w, r).y;
    const x1 = core(w, r).x;
    w.step([{ robot: r.id, pressed: ['w', 'd'], released: [] }]);
    run(5);
    w.step([{ robot: r.id, pressed: [], released: ['w', 'd'] }]);
    expect(core(w, r).y).toBeGreaterThan(y1 + 20);
    expect(core(w, r).x).toBeGreaterThan(x1 + 20);
    expect(low).toBeGreaterThan(down - 3);
    w.dispose();
  });

  it('F sends the built missile at the enemy the radar tracks, and says so', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(blueprint(name), { x: -300, y: 30 });
    const car = w.spawnBlueprint(blueprint('car'), { x: -200, y: 1.45 }, { team: 1 });
    // Pressed before the bay is done: a status line, nothing let go.
    for (let t = 0; t < 2 * 60; t++) w.step();
    w.step([press(r.id, 'f')]);
    w.step([lift(r.id, 'f')]);
    expect(status(w, r).at(-1)).toMatch(/bay still building/);
    for (let t = 0; t < 5 * 60; t++) w.step();
    w.step([press(r.id, 'f')]);
    w.step([lift(r.id, 'f')]);
    expect(w.events.filter((e) => e.kind === 'released' && e.robot === r.id).length).toBe(1);
    expect(status(w, r).at(-1)).toMatch(/fired at an enemy/);
    for (let t = 0; t < 8 * 60; t++) w.step();
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === car.id).length).toBeGreaterThanOrEqual(1);
    w.dispose();
  });

  it('with nothing on the other side it says why, and a fresh press of F still sends one at a wall', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(blueprint(name), { x: -300, y: 30 });
    // A car on its own side: tracked, never fired at.
    w.spawnBlueprint(blueprint('car'), { x: -250, y: 1.45 });
    for (let t = 0; t < 7 * 60; t++) w.step();
    w.step([press(r.id, 'f')]);
    for (let t = 0; t < 60; t++) w.step();
    w.step([lift(r.id, 'f')]);
    expect(w.events.filter((e) => e.kind === 'released' && e.robot === r.id).length).toBe(0);
    expect(status(w, r).at(-1)).toMatch(/nothing tracked: the radar sees only your own side/);
    // A wall has no core, so it is on nobody's side: held, F leaves it alone; pressed again, the missile goes to it.
    const wall = w.spawnBlueprint(blueprint('wall'), { x: -200, y: 5.5 }, { team: 1 });
    w.step([press(r.id, 'f')]);
    for (let t = 0; t < 10 * 60; t++) w.step();
    w.step([lift(r.id, 'f')]);
    expect(w.events.filter((e) => e.kind === 'released' && e.robot === r.id).length).toBe(1);
    expect(status(w, r).at(-1)).toMatch(/fired at a target/);
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === wall.id).length).toBeGreaterThanOrEqual(1);
    w.dispose();
  });
});
