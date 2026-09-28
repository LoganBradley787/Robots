import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World, type WorldEvent } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { resolveScripts } from '../src/blueprint/scripts';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
/** A shipped blueprint with its script files loaded; `pilot` overrides the first script's params. */
const blueprint = (name: string, pilot?: Record<string, number>): unknown => {
  const raw = JSON.parse(bpFile(`${name}.json`));
  if (pilot) raw.scripts[0].params = { ...raw.scripts[0].params, ...pilot };
  return resolveScripts(raw, bpFile).raw;
};
const of = (w: World, r: Robot, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind && e.robot === r.id);
/** Parts a robot, or any piece that broke off it, lost (a burnt-out flare or jammer does not count). */
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot) && e.burntOut !== true).length;
}
const at = (w: World, r: Robot): { x: number; y: number } => w.physics.state(r.groups[0]?.bodyId as number);
const hasPart = (r: Robot, type: string): boolean => [...r.parts.values()].some((p) => p.def.id === type);
/** What a robot's sensors and radio show it this tick: ids of the robots in its contacts. */
const seen = (w: World, r: Robot): number[] => w.sensorView(r.id).contacts.map((c) => c.id);

describe('spotter and artillery (Batch), done when', () => {
  it('the artillery has a radio and no radar, the spotter both, with jammers and smoke on racks', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const art = w.spawnBlueprint(blueprint('enemy-artillery'), { x: 300, y: 20 }, { team: 1 });
    const spot = w.spawnBlueprint(blueprint('enemy-spotter'), { x: 250, y: 25 }, { team: 1 });
    expect(hasPart(art, 'radio')).toBe(true);
    expect(hasPart(art, 'radar')).toBe(false);
    expect(hasPart(art, 'seeker')).toBe(false);
    expect(hasPart(spot, 'radio') && hasPart(spot, 'radar')).toBe(true);
    expect([...spot.parts.values()].filter((p) => p.def.id === 'jammer')).toHaveLength(4);
    expect([...spot.parts.values()].filter((p) => p.def.id === 'smoke')).toHaveLength(4);
    w.dispose();
  });

  it('the artillery sees what the spotter sees through the radio, and only then; it fires nothing on its own', { timeout: 60_000 }, async () => {
    // Alone, a target 700 m away is out of anything the artillery could see: it has no sensor of its own.
    const alone = await World.create({ seed: 1, scripts: host }, flat);
    const a1 = alone.spawnBlueprint(blueprint('enemy-artillery'), { x: 300, y: 20 }, { team: 1 });
    const t1 = alone.spawnBlueprint(blueprint('hunter-drone'), { x: -300, y: 20 });
    for (let t = 0; t < 20 * 60; t++) alone.step();
    expect(seen(alone, a1)).not.toContain(t1.id);
    expect(of(alone, a1, 'released')).toHaveLength(0);
    alone.dispose();

    const w = await World.create({ seed: 1, scripts: host }, flat);
    const art = w.spawnBlueprint(blueprint('enemy-artillery'), { x: 300, y: 20 }, { team: 1 });
    w.spawnBlueprint(blueprint('enemy-spotter'), { x: 250, y: 25 }, { team: 1 });
    const target = w.spawnBlueprint(blueprint('hunter-drone'), { x: -300, y: 20 });
    for (let t = 0; t < 2; t++) w.step();
    expect(seen(w, art)).toContain(target.id);
    w.dispose();
  });

  it('the pair wrecks a hovering hunter drone from 500 m or more: every missile is let go from that far', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const art = w.spawnBlueprint(blueprint('enemy-artillery'), { x: 300, y: 20 }, { team: 1 });
    const spot = w.spawnBlueprint(blueprint('enemy-spotter'), { x: 250, y: 25 }, { team: 1 });
    const target = w.spawnBlueprint(blueprint('hunter-drone'), { x: -300, y: 20 });
    let nearest = Infinity;
    let seenReleases = 0;
    for (let t = 0; t < 40 * 60; t++) {
      w.step();
      const r = of(w, art, 'released').length;
      if (r > seenReleases) {
        seenReleases = r;
        const a = at(w, art);
        const b = at(w, target);
        nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(seenReleases).toBeGreaterThanOrEqual(5);
    expect(nearest).toBeGreaterThan(450);
    expect(partsLost(w, target)).toBeGreaterThanOrEqual(30);
    expect(partsLost(w, art) + partsLost(w, spot)).toBeLessThanOrEqual(6);
    w.dispose();
  });

  it('the pair beats an enemy gun drone: it never gets its guns in range, and loses most of itself', { timeout: 90_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const art = w.spawnBlueprint(blueprint('enemy-artillery'), { x: 300, y: 20 }, { team: 1 });
    const spot = w.spawnBlueprint(blueprint('enemy-spotter'), { x: 250, y: 25 }, { team: 1 });
    const gun = w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: -200, y: 20 });
    for (let t = 0; t < 45 * 60; t++) w.step();
    expect(partsLost(w, gun)).toBeGreaterThanOrEqual(25);
    expect(partsLost(w, art)).toBeLessThanOrEqual(3);
    expect(partsLost(w, spot)).toBeLessThanOrEqual(3);
    w.dispose();
  });

  it('the spotter pops smoke at a missile coming at it and outlives the first one (its jammer and radar untouched)', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    // Held 300 m from the fab drone, inside its missile range, on its own.
    const spot = w.spawnBlueprint(blueprint('enemy-spotter', { standoff: 300 }), { x: 100, y: 25 }, { team: 1 });
    w.spawnBlueprint(blueprint('enemy-fab-drone'), { x: -200, y: 20 });
    for (let t = 0; t < 12 * 60; t++) w.step();
    const smoked = of(w, spot, 'smoked');
    expect(smoked.length).toBeGreaterThanOrEqual(1);
    // The first missile leaves the drone at 4.1 s: the pod goes off before it could arrive (a shot 300 m out takes about 3 s).
    expect(smoked[0]?.tick ?? 0).toBeLessThan(9 * 60);
    expect(spot.primaryCoreId).toBeDefined();
    expect(hasPart(spot, 'radar') && hasPart(spot, 'radio')).toBe(true);
    w.dispose();
  });

  it('the spotter drops a jammer when an enemy is within 60 m, and it vanishes from the enemy’s sensors for 5 s', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const spot = w.spawnBlueprint(blueprint('enemy-spotter'), { x: 200, y: 25 }, { team: 1 });
    const enemy = w.spawnBlueprint(blueprint('enemy-drone', { minRange: 5000 }), { x: 150, y: 25 });
    w.step();
    expect(seen(w, enemy)).toContain(spot.id);
    for (let t = 0; t < 30; t++) w.step();
    expect(of(w, spot, 'jamStarted')).toHaveLength(1);
    // Lit at the start: both robots see nothing, whichever way they look, for 5 s.
    expect(seen(w, enemy)).not.toContain(spot.id);
    expect(seen(w, spot)).toEqual([]);
    for (let t = 0; t < 5 * 60; t++) w.step();
    expect(of(w, spot, 'burntOut')).toHaveLength(1);
    w.dispose();
  });

  it('a jammed spotter goes quiet on the radio, and the artillery holds where it is and picks the target up again after (integration: radio, jammer)', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    // The artillery far off with no sensor, the spotter close to a parked car (30 m: inside the jammer's 60 m).
    const art = w.spawnBlueprint(blueprint('enemy-artillery'), { x: 500, y: 20 }, { team: 1 });
    w.spawnBlueprint(blueprint('enemy-spotter', { standoff: 30 }), { x: -70, y: 25 }, { team: 1 });
    const car = w.spawnBlueprint(blueprint('car'), { x: -100, y: 1.45 });
    for (let t = 0; t < 30; t++) w.step();
    expect(seen(w, art)).toEqual([]); // the jammer went off at once: the spotter's radio is inside it
    for (let t = 30; t < 5 * 60 + 20; t++) w.step();
    expect(seen(w, art)).toContain(car.id); // burnt out, and the next one is not due for a second
    w.dispose();
  });
});
