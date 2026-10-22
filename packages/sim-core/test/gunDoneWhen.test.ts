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
import { SIGHT } from '../src/weapons/shells';

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

/** Parts a robot, or any piece that broke off it, lost; its own flares burning out do not count. */
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot) && e.burntOut !== true).length;
}

/**
 * A gun drone hovers at `at`; an enemy `launcher-seeker` at `from` fires one missile at it (F at 1 s). Returns what the
 * drone lost, the missile's blast (how far from the drone), and the hits the missile took.
 */
async function missileAt(at: { x: number; y: number }, from: { x: number; y: number }): Promise<{ lost: number; distance: number; hits: number }> {
  const w = await World.create({ seed: 1, scripts: host }, flat);
  const drone = w.spawnBlueprint(blueprint('gun-drone'), at);
  const launcher = w.spawnBlueprint(blueprint('launcher-seeker'), from, { team: 1 });
  let distance = Infinity;
  for (let t = 0; t < 540; t++) {
    const n = w.events.length;
    w.step(t === 60 ? [press(launcher.id, 'f')] : t === 61 ? [lift(launcher.id, 'f')] : []);
    for (const e of w.events.slice(n)) {
      if (e.kind !== 'explosion' || distance < Infinity) continue;
      const s = w.physics.state(drone.groups[0]?.bodyId as number);
      distance = Math.hypot(e.x - s.x, e.y - s.y);
    }
  }
  const hits = w.events.filter((e) => e.kind === 'shellHit' && e.by === drone.id && e.robot !== launcher.id).length;
  const lost = partsLost(w, drone);
  w.dispose();
  return { lost, distance, hits };
}

describe('M13 guns, done when', () => {
  it('a gun drone shoots down a seeker missile fired at it, far enough out that it loses nothing', { timeout: 60_000 }, async () => {
    for (const [at, from] of [
      [{ x: -60, y: 40 }, { x: -300, y: 1.5 }],
      [{ x: -60, y: 120 }, { x: -300, y: 1.5 }],
      [{ x: -40, y: 40 }, { x: -350, y: 1.5 }],
    ] as const) {
      const r = await missileAt(at, from);
      expect(r.hits, JSON.stringify(at)).toBeGreaterThanOrEqual(4);
      expect(r.lost, JSON.stringify(at)).toBe(0);
      expect(r.distance, JSON.stringify(at)).toBeGreaterThan(10);
    }
  });

  it('a drone bomb chasing it is shot down short of it', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const drone = w.spawnBlueprint(blueprint('gun-drone'), { x: -40, y: 40 });
    const bomb = w.spawnBlueprint(blueprint('drone-bomb'), { x: -200, y: 2 }, { team: 1 });
    for (let t = 0; t < 600; t++) w.step();
    expect(w.events.some((e) => e.kind === 'coreLost' && e.robot === bomb.id)).toBe(true);
    expect(partsLost(w, drone)).toBe(0);
    w.dispose();
  });

  it('an enemy gun drone disarms a hovering hunter first: the missiles on its rack are broken, then it is worn down', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -40, y: 40 });
    w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: 40, y: 40 }, { team: 1 });
    for (let t = 0; t < 900; t++) w.step();
    const lost = w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === hunter.id);
    // Worth the most per shell: the warheads of the four missiles standing on it (and their cores).
    expect(lost.filter((e) => e.kind === 'partDestroyed' && e.partType === 'heavywarhead').length).toBeGreaterThanOrEqual(3);
    expect(lost.length).toBeGreaterThanOrEqual(8);
    w.dispose();
  });

  it('twelve turrets on a big target stay within the script time budget (Logan: "turrets stopped, ran too long")', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const guns = w.spawnBlueprint(blueprint('enemy-many-gun-drone'), { x: -60, y: 40 }, { team: 1 });
    w.spawnBlueprint(blueprint('enemy-flying-silo'), { x: 60, y: 1.5 });
    for (let t = 0; t < 300; t++) w.step();
    expect(w.events.filter((e) => e.kind === 'scriptCrashed')).toEqual([]);
    expect(w.shotsBy(guns.id)).toBeGreaterThan(20);
    w.dispose();
  });

  it('in a 2v2 with fab drones, no shell hits its own side, and a turret never shoots its own robot', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: -60, y: 30 });
    w.spawnBlueprint(blueprint('enemy-fab-drone'), { x: -90, y: 30 });
    w.spawnBlueprint(blueprint('enemy-fab-drone'), { x: 60, y: 30 }, { team: 1 });
    w.spawnBlueprint(blueprint('enemy-fab-drone'), { x: 90, y: 40 }, { team: 1 });
    const team = new Map<number, number>();
    let own = 0;
    let friendly = 0;
    let hits = 0;
    for (let t = 0; t < 1800; t++) {
      const n = w.events.length;
      w.step();
      for (const r of w.robots) team.set(r.id, r.team);
      for (const e of w.events.slice(n)) {
        if (e.kind !== 'shellHit') continue;
        hits++;
        if (e.robot === e.by) own++;
        else if (team.get(e.robot) === team.get(e.by)) friendly++;
      }
    }
    expect(hits).toBeGreaterThan(40);
    expect(own).toBe(0);
    // Shells spread up to 0.5 degrees (Logan): a stray now and then may clip a friend near the line. Batch: and a shell
    // already in flight may meet a friend that moved into its path (the sight only sees now): at least one allowed.
    expect(friendly).toBeLessThanOrEqual(Math.max(1, Math.ceil(hits / 20)));
    w.dispose();
  });

  it('G switches the player gun drone\'s turrets off and on', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const drone = w.spawnBlueprint(blueprint('gun-drone'), { x: -40, y: 40 });
    w.spawnBlueprint({ format: 1, name: 'target', grid: ['C F'] }, { x: 0, y: 40.5 }, { team: 1 });
    // Batch: the target falls 40 m and shatters on landing (crash damage) at about 2.9 s: the windows end before that.
    w.step([press(drone.id, 'g')]);
    w.step([lift(drone.id, 'g')]);
    for (let t = 0; t < 75; t++) w.step();
    expect(w.shotsBy(drone.id)).toBe(0);
    w.step([press(drone.id, 'g')]);
    w.step([lift(drone.id, 'g')]);
    for (let t = 0; t < 75; t++) w.step();
    expect(w.shotsBy(drone.id)).toBeGreaterThan(5);
    w.dispose();
  });

  it('a burning flare on the sight line reads as the robot that let it go', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const rack = w.spawnBlueprint(
      {
        format: 1,
        name: 'rack',
        grid: ['C  D>  Q>'],
        bindings: [
          { key: 'v', mode: 'pulse', target: 'flare', channel: 'ignite', value: 1 },
          { key: 'v', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 },
        ],
      },
      { x: -100, y: 60 },
      { team: 1 },
    );
    const gun = w.spawnBlueprint({ format: 1, name: 'gun', grid: ['M< C'] }, { x: -80, y: 60 });
    w.step();
    expect(w.partOutput(gun.id, 'gun@0,0', 'sightId')).toBe(rack.id);
    w.step([press(rack.id, 'v')]);
    w.step([lift(rack.id, 'v')]);
    // The flare flies right toward the gun, burning: the sight sees it first, as the rack.
    let asRack = 0;
    for (let t = 0; t < 20; t++) {
      w.step();
      const flare = w.robots.find((r) => r.id !== rack.id && r.id !== gun.id);
      if (flare && w.partOutput(gun.id, 'gun@0,0', 'sightId') === rack.id && (w.partOutput(gun.id, 'gun@0,0', 'sight') ?? 99) < 16) asRack++;
      expect(w.partOutput(gun.id, 'gun@0,0', 'sightSide')).toBe(SIGHT.enemy);
    }
    expect(asRack).toBeGreaterThan(0);
    w.dispose();
  });
});
