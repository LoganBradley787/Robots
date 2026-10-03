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
      // The missile (gone from the world by the end) lost its core to the beam, more than 100 m short of the tower.
      const burnedIds = new Set(burned.map((e) => e.robot));
      const lost = w.events.find((e) => e.kind === 'partDestroyed' && burnedIds.has(e.robot) && e.partType === 'core');
      expect(lost, JSON.stringify(at)).toBeDefined();
      expect(Math.abs((lost?.kind === 'partDestroyed' ? lost.x : at.x) - at.x), JSON.stringify(at)).toBeGreaterThan(100);
      expect(partsLost(w, tower), JSON.stringify(at)).toBe(0);
      w.dispose();
    }
  });

  it('a laser tower takes a hovering hunter out of the fight from 150 m within 10 s: its core or every propeller gone', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const tower = w.spawnBlueprint(blueprint('enemy-laser-tower'), { x: -150, y: 0.6 }, { team: 1 });
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: 0, y: 30 });
    for (let t = 0; t < 600; t++) w.step();
    // Burnt off its propellers first, it falls, and its core can end up on the ground behind the flat world's box.
    const propellers = [...hunter.parts.values()].filter((p) => p.def.id === 'propeller').length;
    expect(coreLostAt(w, hunter) !== undefined || propellers === 0).toBe(true);
    // Its missiles were burnt first (at 600 a second the hunter can be gone before the last one).
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && family(w, hunter).has(e.robot) && e.partType === 'heavywarhead').length).toBeGreaterThanOrEqual(3);
    expect(partsLost(w, tower)).toBe(0);
    w.dispose();
  });

  it('a beam burns through armor: a core behind three heavy plates is gone in under 3 s', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const tower = w.spawnBlueprint(blueprint('enemy-laser-tower'), { x: -60, y: 0.6 }, { team: 1 });
    // A core with three plates on its right, facing the tower (on frames so the plates are in the turret's line).
    const brick = w.spawnBlueprint({ format: 1, name: 'brick', grid: ['C A A A', 'F F F F'] }, { x: -150, y: 4.5 });
    for (let t = 0; t < 900; t++) w.step();
    const lost = coreLostAt(w, brick);
    // 3 x 250 + 50 health at 600 a second is 1.3 s of beam, plus the turret swinging over.
    expect(lost).toBeGreaterThan(1.3);
    expect(lost).toBeLessThan(3);
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

  it('no friendly fire: in a 2v2 of laser and gun drones no beam burns a live robot of its own side', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const a = [w.spawnBlueprint(blueprint('enemy-laser-drone'), { x: 150, y: 20 }, { team: 1 }), w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: 120, y: 40 }, { team: 1 })];
    const b = [w.spawnBlueprint(blueprint('enemy-laser-drone'), { x: -150, y: 20 }), w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: -120, y: 40 })];
    const team = (id: number): number | undefined => w.robotById(id)?.team;
    let burns = 0;
    const friendly: unknown[] = [];
    for (let t = 0; t < 1800; t++) {
      const n = w.events.length;
      w.step();
      for (const e of w.events.slice(n)) {
        if (e.kind !== 'laserBurn') continue;
        burns++;
        // A live friend: a robot of the burner's side with a core in charge. A friend's wreck falling through the beam
        // (nobody's by then, and the sight is a tick old) is debris, not friendly fire.
        if (team(e.robot) === team(e.by) && w.canControl(e.robot)) friendly.push(e);
      }
    }
    expect(a.length + b.length).toBe(4);
    expect(burns).toBeGreaterThan(5);
    expect(friendly).toEqual([]);
    w.dispose();
  });

});
