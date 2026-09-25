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
import { buildReplay, runReplay } from '../src/replay/replayFile';

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

/** Parts a robot, or any piece that broke off it, lost. */
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot)).length;
}

function run(w: World, ticks: number, inputs: (tick: number) => RobotInput[] = () => [], each?: () => void): void {
  for (let tick = 0; tick < ticks; tick++) {
    w.step(inputs(tick));
    each?.();
  }
}

describe('M8 enemy drone, done when', () => {
  it('flies to its spot beside a parked car of yours, launches at it, and hits it', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const car = w.spawnBlueprint(blueprint('car'), { x: -100, y: 1.45 });
    const enemy = w.spawnBlueprint(blueprint('enemy-drone'), { x: -20, y: 15 }, { team: 1 });
    let nearest = Infinity;
    run(w, 600, undefined, () => {
      const s = w.physics.state(enemy.groups[0]?.bodyId as number);
      nearest = Math.min(nearest, Math.abs(s.x - -50));
    });
    expect(nearest).toBeLessThan(5); // got to 50 m beside the car
    expect(w.events.some((e) => e.kind === 'decoupled' && e.robot === enemy.id)).toBe(true);
    expect(partsLost(w, car)).toBeGreaterThan(0);
    w.dispose();
  });

  it('dodges a straight missile that would have hit it', async () => {
    const shot = async (dodge: number): Promise<number> => {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const launcher = w.spawnBlueprint(blueprint('launcher'), { x: -100, y: 1.5 });
      // It never fires here (minRange), so only the dodge is tested.
      const enemy = w.spawnBlueprint(blueprint('enemy-drone', { minRange: 2000, dodge }), { x: -50, y: 10 }, { team: 1 });
      run(w, 480, (tick) => {
        if (tick === 12) return [{ robot: launcher.id, pressed: ['z'], released: [] }];
        if (tick === 36) return [{ robot: launcher.id, pressed: [], released: ['z'] }];
        if (tick === 180) return [{ robot: launcher.id, pressed: ['f'], released: [] }];
        return [];
      });
      const lost = partsLost(w, enemy);
      w.dispose();
      return lost;
    };
    expect(await shot(0)).toBeGreaterThan(0);
    expect(await shot(1)).toBe(0);
  });

  it("the hunter drone's missile goes after the enemy drone, and the duel replays exactly", async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -130, y: 15 });
    const enemy = w.spawnBlueprint(blueprint('enemy-drone'), { x: -50, y: 27 }, { team: 1 });
    let closest = Infinity;
    run(
      w,
      600,
      (tick) => (tick === 180 ? [{ robot: hunter.id, pressed: ['f'], released: [] }] : []),
      () => {
        const m = w.robots.find((r) => r.brokeFrom === hunter.id && r.woke === true && r.primaryCoreId !== undefined);
        if (!m || !w.robots.includes(enemy)) return;
        const a = w.physics.state(m.groups[0]?.bodyId as number);
        const b = w.physics.state(enemy.groups[0]?.bodyId as number);
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      },
    );
    expect(closest).toBeLessThan(15);
    const again = await runReplay(buildReplay(w), undefined, host);
    expect(again.matches).toBe(true);
    again.world.dispose();
    w.dispose();
  });
});
