import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import type { RobotInput } from '../src/control/types';
import { resolveScripts } from '../src/blueprint/scripts';
import { orientRaw } from '../src/blueprint/orient';
import { buildReplay, runReplay } from '../src/replay/replayFile';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

/** Parts a robot, or any piece that broke off it, lost. */
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot)).length;
}
const blasts = (w: World, r: Robot): number => w.events.filter((e) => e.kind === 'explosion' && e.robot === r.id).length;

function run(w: World, ticks: number, inputs: (tick: number) => RobotInput[] = () => []): void {
  for (let tick = 0; tick < ticks; tick++) w.step(inputs(tick));
}

describe('M10 drone bomb, done when', () => {
  it('deployed as Enemy, it flies to a parked car of yours 60 m away and blows parts off it', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const car = w.spawnBlueprint(blueprint('car'), { x: -40, y: 1.45 });
    const bomb = w.spawnBlueprint(blueprint('drone-bomb'), { x: -100, y: 3 }, { team: 1 });
    run(w, 8 * 60);
    expect(blasts(w, bomb)).toBe(1);
    expect(partsLost(w, car)).toBeGreaterThan(0);
    w.dispose();
  });

  it('catches a drone hovering 20 m up, deployed flipped too', async () => {
    for (const flip of [false, true]) {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const drone = w.spawnBlueprint(blueprint('missile-drone-10prop'), { x: -30, y: 20 }, { team: 1 });
      const bomb = w.spawnBlueprint(orientRaw(blueprint('drone-bomb'), { flip }, w.registry), { x: -100, y: 3 });
      run(w, 8 * 60);
      expect(blasts(w, bomb)).toBe(1);
      expect(partsLost(w, drone)).toBeGreaterThan(0);
      w.dispose();
    }
  });

  it('a drone that flies away flat out escapes (no drag: it keeps speeding up); a short dash does not', async () => {
    const chase = async (seconds: number): Promise<{ hit: number; lost: number }> => {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -100, y: 15 });
      const bomb = w.spawnBlueprint(blueprint('drone-bomb'), { x: -160, y: 5 }, { team: 1 });
      const d = { robot: hunter.id, pressed: ['d'], released: [] };
      const up = { robot: hunter.id, pressed: [], released: ['d'] };
      run(w, 10 * 60, (t) => (t === 30 ? [d] : t === 30 + seconds * 60 ? [up] : []));
      const out = { hit: blasts(w, bomb), lost: partsLost(w, hunter) };
      w.dispose();
      return out;
    };
    expect(await chase(10)).toEqual({ hit: 0, lost: 0 });
    const caught = await chase(1);
    expect(caught.hit).toBe(1);
    expect(caught.lost).toBeGreaterThan(0);
  });

  it('two drone bombs on different sides meet and both go off (they used to climb forever, each keeping above the other)', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const a = w.spawnBlueprint(blueprint('drone-bomb'), { x: -100, y: 5 });
    const b = w.spawnBlueprint(blueprint('drone-bomb'), { x: -40, y: 5 }, { team: 1 });
    let highest = 0;
    for (let t = 0; t < 10 * 60; t++) {
      w.step();
      // Until they meet: after the blasts their pieces fly anywhere.
      if (blasts(w, a) + blasts(w, b) === 0) for (const r of [a, b]) if (r.groups[0]) highest = Math.max(highest, w.physics.state(r.groups[0].bodyId).y);
    }
    expect(blasts(w, a) + blasts(w, b)).toBe(2);
    expect(highest).toBeLessThan(5 + 40 + 5);
    w.dispose();
  });

  it('goes off when its side touches a big robot, not only its warhead', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const silo = w.spawnBlueprint(blueprint('flying-silo'), { x: -40, y: 0.5 }, { team: 1 });
    const bomb = w.spawnBlueprint(blueprint('drone-bomb'), { x: -100, y: 5 });
    run(w, 8 * 60);
    expect(blasts(w, bomb)).toBe(1);
    expect(partsLost(w, silo)).toBeGreaterThan(0);
    w.dispose();
  });

  it('with nothing to chase it climbs clear and waits there, its warhead safe until it has a target', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const bomb = w.spawnBlueprint(blueprint('drone-bomb'), { x: -100, y: 5 });
    run(w, 5 * 60);
    const s = w.physics.state(bomb.groups[0]?.bodyId as number);
    expect(Math.hypot(s.x - -98.5, s.y - 20)).toBeLessThan(2); // 15 m (clearDist) over where it was deployed
    expect(w.partOutput(bomb.id, 'heavywarhead@1,0', 'armed')).toBe(0);
    w.dispose();
  });

  it('replays exactly', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    w.spawnBlueprint(blueprint('missile-drone-10prop'), { x: -30, y: 20 }, { team: 1 });
    w.spawnBlueprint(blueprint('drone-bomb'), { x: -100, y: 3 });
    run(w, 6 * 60);
    const r = await runReplay(buildReplay(w), undefined, host);
    expect(r.matches).toBe(true);
    w.dispose();
  });
});
