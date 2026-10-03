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

/** A robot and every piece that broke off it (pieces come after the robot they broke from). */
function family(w: World, r: Robot): Set<number> {
  const ids = new Set([r.id]);
  for (const x of w.robots) if (x.brokeFrom !== undefined && ids.has(x.brokeFrom)) ids.add(x.id);
  return ids;
}

/** Parts a robot, or any piece that broke off it, lost; its own flares burning out do not count. */
function partsLost(w: World, r: Robot): number {
  const ids = family(w, r);
  return w.events.filter((e) => e.kind === 'partDestroyed' && ids.has(e.robot) && e.burntOut !== true).length;
}

const coreLostAt = (w: World, r: Robot): number | undefined => {
  const e = w.events.find((x) => x.kind === 'coreLost' && x.robot === r.id);
  return e ? e.tick * w.dt : undefined;
};

describe('M14 lasers, done when', () => {
  it('a laser tower burns down a seeker missile fired at it from past its reach, short of the tower', { timeout: 60_000 }, async () => {
    for (const [at, from, seed] of [
      // From past the beam's 300 m: closer, the tower burns the launcher before it fires.
      [{ x: -60, y: 0.6 }, { x: -470, y: 1.5 }, 1],
      [{ x: -60, y: 0.6 }, { x: -420, y: 1.5 }, 2],
      [{ x: -40, y: 0.6 }, { x: -480, y: 1.5 }, 3],
    ] as const) {
      const w = await World.create({ seed, scripts: host }, flat);
      const tower = w.spawnBlueprint(blueprint('enemy-laser-tower'), at, { team: 1 });
      const launcher = w.spawnBlueprint(blueprint('launcher-seeker'), from);
      for (let t = 0; t < 600; t++) w.step(t === 60 ? [press(launcher.id, 'f')] : t === 61 ? [lift(launcher.id, 'f')] : []);
      const burned = w.events.filter((e) => e.kind === 'laserBurn' && e.by === tower.id && e.robot !== launcher.id);
      expect(burned.length, JSON.stringify(at)).toBeGreaterThan(0);
      expect(partsLost(w, tower), JSON.stringify(at)).toBe(0);
      w.dispose();
    }
  });

  it('a laser tower takes a hovering hunter apart from 150 m: its core is gone within 10 s', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const tower = w.spawnBlueprint(blueprint('enemy-laser-tower'), { x: -150, y: 0.6 }, { team: 1 });
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: 0, y: 30 });
    for (let t = 0; t < 600; t++) w.step();
    expect(coreLostAt(w, hunter)).toBeLessThan(10);
    expect(partsLost(w, tower)).toBe(0);
    w.dispose();
  });

  it('a beam burns through armor: a core behind three heavy plates is gone in about 5 to 8 s', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const tower = w.spawnBlueprint(blueprint('enemy-laser-tower'), { x: -60, y: 0.6 }, { team: 1 });
    // A core with three plates on its right, facing the tower (on frames so the plates are in the turret's line).
    const brick = w.spawnBlueprint({ format: 1, name: 'brick', grid: ['C A A A', 'F F F F'] }, { x: -150, y: 4.5 });
    for (let t = 0; t < 900; t++) w.step();
    const lost = coreLostAt(w, brick);
    // 3 x 250 + 50 health at 150 a second is 5.3 s of beam, plus the turret swinging over.
    expect(lost).toBeGreaterThan(5);
    expect(lost).toBeLessThan(8);
    expect(tower.parts.size).toBe(41);
    w.dispose();
  });

  it('an enemy laser drone beats an enemy gun drone from outside its reach', { timeout: 120_000 }, async () => {
    let wins = 0;
    for (const seed of [1, 2, 3]) {
      const w = await World.create({ seed, scripts: host }, flat);
      const laser = w.spawnBlueprint(blueprint('enemy-laser-drone'), { x: 150, y: 20 }, { team: 1 });
      const gun = w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: -150, y: 20 });
      for (let t = 0; t < 1800; t++) w.step();
      if (coreLostAt(w, gun) !== undefined && coreLostAt(w, laser) === undefined) wins++;
      w.dispose();
    }
    expect(wins).toBeGreaterThanOrEqual(2);
  });

  it('the laser drone keeps a reserve: low on energy it stops burning and stays up', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const drone = w.spawnBlueprint(blueprint('enemy-laser-drone'), { x: 100, y: 20 }, { team: 1 });
    // Start it at 40 percent: about 4 s of beam above the 30 percent it keeps, less than a hunter takes to burn down.
    for (const p of drone.parts.values()) if (p.stored !== undefined && p.def.resource) p.stored = 0.4 * p.def.resource.capacity;
    w.spawnBlueprint(blueprint('hunter-drone'), { x: -60, y: 30 });
    let low = false;
    for (let t = 0; t < 60 * 30; t++) {
      w.step();
      low ||= w.scriptLogs.some((l) => l.robot === drone.id && l.text.includes('lasers low on energy'));
    }
    const e = w.energy(drone.id);
    expect(low).toBe(true);
    expect((e?.stored ?? 0) / (e?.capacity ?? 1)).toBeGreaterThan(0.2);
    expect(coreLostAt(w, drone)).toBeUndefined();
    const core = drone.groups[drone.parts.get(drone.primaryCoreId ?? '')?.group ?? 0];
    expect(w.physics.state(core?.bodyId ?? 0).y).toBeGreaterThan(10);
    w.dispose();
  });

  it('no friendly fire: in a 2v2 of laser and gun drones no beam burns its own side', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const a = [w.spawnBlueprint(blueprint('enemy-laser-drone'), { x: 150, y: 20 }, { team: 1 }), w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: 120, y: 40 }, { team: 1 })];
    const b = [w.spawnBlueprint(blueprint('enemy-laser-drone'), { x: -150, y: 20 }), w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: -120, y: 40 })];
    for (let t = 0; t < 1800; t++) w.step();
    const side = (id: number): number => {
      for (const r of a) if (family(w, r).has(id)) return 1;
      for (const r of b) if (family(w, r).has(id)) return 0;
      return -1;
    };
    const burns = w.events.filter((e) => e.kind === 'laserBurn');
    expect(burns.length).toBeGreaterThan(5);
    expect(burns.filter((e) => e.kind === 'laserBurn' && side(e.robot) === side(e.by))).toEqual([]);
    w.dispose();
  });
});
