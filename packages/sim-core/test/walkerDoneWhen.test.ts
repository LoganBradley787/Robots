import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import type { RobotInput } from '../src/control/types';
import { resolveScripts } from '../src/blueprint/scripts';
import { orientRaw } from '../src/blueprint/orient';
import { defaultRegistry } from '../src/parts/registry';
import { partWorldPose } from '../src/metrics/robotMetrics';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
/** A shipped blueprint with its script files loaded; `params` overrides script params by script id. */
const blueprint = (name: string, params: Record<string, Record<string, number>> = {}): unknown => {
  const raw = JSON.parse(bpFile(`${name}.json`));
  for (const s of raw.scripts ?? []) if (params[s.id]) s.params = { ...s.params, ...params[s.id] };
  return resolveScripts(raw, bpFile).raw;
};
const press = (robot: number, key: string): RobotInput => ({ robot, pressed: [key], released: [] });
const lift = (robot: number, key: string): RobotInput => ({ robot, pressed: [], released: [key] });
/** The core's world pose. */
const core = (w: World, r: Robot): { x: number; y: number; angle: number } => partWorldPose(w, r, r.primaryCoreId as string);
/** Parts the robot itself lost (not what it let go, not its own flares burning out). */
const ownLost = (w: World, r: Robot): number => w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === r.id && e.burntOut !== true).length;
/** Where a walker stands on the flat world: its core, 7.6 m up (the feet rest on the ground). */
const SPAWN_Y = 7.6;

describe('walker (Batch: pistons, armor, rotators under load), done when', () => {
  it('walks right on D and left on A, upright, with every part still on it', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(blueprint('walker'), { x: -150, y: SPAWN_Y });
    const parts = r.parts.size;
    let tilt = 0;
    const run = (seconds: number): void => {
      for (let t = 0; t < seconds * 60; t++) {
        w.step();
        tilt = Math.max(tilt, Math.abs(core(w, r).angle));
      }
    };
    // It stands up first (four pistons take the weight, a few seconds), then a step is 2 m every 2.6 s or so.
    run(4);
    const start = core(w, r);
    expect(start.y).toBeGreaterThan(8);
    w.step([press(r.id, 'd')]);
    run(24);
    w.step([lift(r.id, 'd')]);
    const east = core(w, r).x - start.x;
    expect(east).toBeGreaterThan(10);
    // Let go: it finishes its half step and stops.
    run(6);
    const stopped = core(w, r).x;
    run(3);
    expect(Math.abs(core(w, r).x - stopped)).toBeLessThan(0.2);
    // And back, the other way.
    w.step([press(r.id, 'a')]);
    run(24);
    w.step([lift(r.id, 'a')]);
    expect(core(w, r).x).toBeLessThan(stopped - 8);
    // Upright the whole time (the body bobs a few degrees as the legs swap), on its feet (a foot's plate is 1 m tall), nothing broken.
    expect((tilt * 180) / Math.PI).toBeLessThan(8);
    expect(core(w, r).y).toBeGreaterThan(7.5);
    expect(ownLost(w, r)).toBe(0);
    expect(r.parts.size).toBe(parts);
    w.dispose();
  });

  it('W and S raise and lower the body', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(blueprint('walker'), { x: -150, y: SPAWN_Y });
    for (let t = 0; t < 5 * 60; t++) w.step();
    const normal = core(w, r).y;
    w.step([press(r.id, 'w')]);
    for (let t = 0; t < 90; t++) w.step();
    w.step([lift(r.id, 'w')]);
    for (let t = 0; t < 90; t++) w.step();
    expect(core(w, r).y).toBeGreaterThan(normal + 0.5);
    w.step([press(r.id, 's')]);
    for (let t = 0; t < 240; t++) w.step();
    w.step([lift(r.id, 's')]);
    for (let t = 0; t < 90; t++) w.step();
    expect(core(w, r).y).toBeLessThan(normal - 0.5);
    w.dispose();
  });

  // Logan walking it by hand: "W, S and G seem to do nothing". W and S moved the body 0.6 m, and G said nothing.
  it('W stands it a meter taller and S crouches it, it walks at both heights, and its status lists the keys and says how tall it stands', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(blueprint('walker'), { x: -150, y: SPAWN_Y });
    const status = (): string[] => w.scriptLogs.filter((l) => l.robot === r.id).map((l) => l.text);
    let tilt = 0;
    const run = (seconds: number): void => {
      for (let t = 0; t < seconds * 60; t++) {
        w.step();
        tilt = Math.max(tilt, Math.abs(core(w, r).angle));
      }
    };
    const hold = (key: string, seconds: number): void => {
      w.step([press(r.id, key)]);
      run(seconds);
      w.step([lift(r.id, key)]);
    };
    run(5);
    expect(status().join(' ')).toMatch(/D walk right, A walk left, W stand taller, S crouch, G turrets on or off/);
    const normal = core(w, r).y;
    // W: up the whole stroke of its lift pistons, a meter, in under two seconds.
    hold('w', 2);
    run(2);
    expect(core(w, r).y).toBeGreaterThan(normal + 0.9);
    expect(status().at(-1)).toMatch(/legs out 2\.0 of 2 m, as tall as it goes/);
    const x0 = core(w, r).x;
    hold('d', 12);
    run(4);
    expect(core(w, r).x).toBeGreaterThan(x0 + 5);
    expect(core(w, r).y).toBeGreaterThan(normal + 0.7);
    // S: down to where a foot can still lift for a step.
    hold('s', 3);
    run(2);
    expect(core(w, r).y).toBeLessThan(normal - 0.5);
    expect(status().at(-1)).toMatch(/as low as it can still step/);
    const x1 = core(w, r).x;
    hold('a', 12);
    run(4);
    expect(core(w, r).x).toBeLessThan(x1 - 5);
    expect((tilt * 180) / Math.PI).toBeLessThan(8);
    expect(ownLost(w, r)).toBe(0);
    w.dispose();
  });

  it('G switches its turrets off and on, and says so: nothing is fired while they are off', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(blueprint('walker'), { x: -150, y: SPAWN_Y });
    const status = (): string[] => w.scriptLogs.filter((l) => l.robot === r.id).map((l) => l.text);
    w.step([press(r.id, 'g')]);
    w.step([lift(r.id, 'g')]);
    expect(status().at(-1)).toMatch(/turrets off/);
    // A hunter drone hovering in reach of its guns: left alone.
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -30, y: 40 }, { team: 1 });
    for (let t = 0; t < 6 * 60; t++) w.step();
    expect(w.shotsBy(r.id)).toBe(0);
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === hunter.id)).toEqual([]);
    w.step([press(r.id, 'g')]);
    w.step([lift(r.id, 'g')]);
    expect(status().at(-1)).toMatch(/turrets on/);
    for (let t = 0; t < 6 * 60; t++) w.step();
    expect(w.shotsBy(r.id)).toBeGreaterThan(20);
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === hunter.id).length).toBeGreaterThan(0);
    w.dispose();
  });

  it('the enemy walker walks toward the nearest enemy, deployed either way round, and stops `range` meters short', { timeout: 120_000 }, async () => {
    for (const flip of [false, true]) {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const at = flip ? 100 : -100;
      const walker = w.spawnBlueprint(orientRaw(blueprint('enemy-walker', { pilot: { range: 40 } }), { flip }, defaultRegistry()), { x: at, y: SPAWN_Y }, { team: 1 });
      // A parked car for it to walk to, 80 m off.
      w.spawnBlueprint(blueprint('car'), { x: at + (flip ? -80 : 80), y: 1.45 });
      for (let t = 0; t < 110 * 60; t++) w.step();
      const gap = Math.abs(core(w, walker).x - (at + (flip ? -80 : 80)));
      // 80 m to 40 m: 40 m at about 0.7 m/s is a minute; then it stands (it was told 40, it may stop a step past).
      expect(gap, `flip ${flip}`).toBeGreaterThan(30);
      expect(gap, `flip ${flip}`).toBeLessThan(44);
      const there = core(w, walker).x;
      for (let t = 0; t < 8 * 60; t++) w.step();
      expect(Math.abs(core(w, walker).x - there), `flip ${flip}`).toBeLessThan(0.5);
      expect(ownLost(w, walker)).toBe(0);
      w.dispose();
    }
  });

  it('the enemy walker shoots down an enemy drone that flies at it, and loses no part while its armor holds', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const walker = w.spawnBlueprint(orientRaw(blueprint('enemy-walker'), { flip: true }, defaultRegistry()), { x: 60, y: SPAWN_Y }, { team: 1 });
    const drone = w.spawnBlueprint(blueprint('enemy-drone'), { x: -100, y: 40 });
    for (let t = 0; t < 60 * 60; t++) w.step();
    // Its four turrets fire, hit the drone or its missiles, and the drone's core goes.
    expect(w.shotsBy(walker.id)).toBeGreaterThan(50);
    expect(w.events.some((e) => e.kind === 'coreLost' && e.robot === drone.id)).toBe(true);
    expect(ownLost(w, walker)).toBeLessThanOrEqual(3);
    // Still standing on all four legs, upright.
    expect(core(w, walker).y).toBeGreaterThan(7.5);
    expect(Math.abs(core(w, walker).angle)).toBeLessThan(0.1);
    w.dispose();
  });

  it('its turrets shoot down an enemy fab drone\'s missiles: no leg is lost to what it fires (with the guns off, a heavy warhead breaks a piston)', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const walker = w.spawnBlueprint(orientRaw(blueprint('enemy-walker'), { flip: true }, defaultRegistry()), { x: 0, y: SPAWN_Y }, { team: 1 });
    const drone = w.spawnBlueprint(blueprint('enemy-fab-drone'), { x: -160, y: 30 });
    for (let t = 0; t < 60 * 60; t++) w.step();
    expect(w.events.filter((e) => e.kind === 'released' && e.robot === drone.id).length).toBeGreaterThanOrEqual(3);
    // All four lift pistons and all four drive pistons are still on it, and it is made mostly of armor.
    const legs = [...walker.parts.values()].filter((p) => p.tags.includes('lift') || p.tags.includes('drive'));
    expect(legs.length).toBe(8);
    expect([...walker.parts.values()].filter((p) => p.def.id === 'armorplate').length).toBeGreaterThanOrEqual(30);
    expect(ownLost(w, walker)).toBe(0);
    w.dispose();
  });

  it('is deterministic: the same fight twice ends in the same state', { timeout: 120_000 }, async () => {
    const hashes: string[] = [];
    for (let i = 0; i < 2; i++) {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      w.spawnBlueprint(orientRaw(blueprint('enemy-walker'), { flip: true }, defaultRegistry()), { x: 60, y: SPAWN_Y }, { team: 1 });
      w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: -100, y: 40 });
      for (let t = 0; t < 20 * 60; t++) w.step();
      hashes.push(w.hash());
      w.dispose();
    }
    expect(hashes[0]).toBe(hashes[1]);
  });
});
