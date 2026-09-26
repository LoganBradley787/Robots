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

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

/** Parts the robot itself lost (its drone bombs leaving are splits, not losses). */
const ownLost = (w: World, r: Robot): number => w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === r.id).length;
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot)).length;
}

describe('carrier (six drone bombs on a deck), done when', () => {
  it('F lets one go, G the rest; they spread over three targets and hit each, and none hits the carrier', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const carrier = w.spawnBlueprint(blueprint('carrier'), { x: -100, y: 1.55 });
    const car = w.spawnBlueprint(blueprint('car'), { x: -250, y: 1.45 }, { team: 1 });
    const drone = w.spawnBlueprint(blueprint('missile-drone-10prop'), { x: -220, y: 25 }, { team: 1 });
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -300, y: 20 }, { team: 1 });
    const key = (k: string, down: boolean): RobotInput[] => [{ robot: carrier.id, pressed: down ? [k] : [], released: down ? [] : [k] }];
    for (let t = 0; t < 25 * 60; t++) {
      w.step(t === 30 ? key('w', true) : t === 150 ? key('w', false) : t === 300 ? key('f', true) : t === 301 ? key('f', false) : t === 420 ? key('g', true) : t === 421 ? key('g', false) : []);
    }
    expect(w.events.filter((e) => e.kind === 'coreWoke' && e.from === carrier.id)).toHaveLength(6);
    expect(partsLost(w, car)).toBeGreaterThan(0);
    expect(partsLost(w, drone)).toBeGreaterThan(0);
    expect(partsLost(w, hunter)).toBeGreaterThan(0);
    expect(ownLost(w, carrier)).toBe(0);
    w.dispose();
  });

  it('the enemy carrier flies itself and sends drone bombs at a hunter drone one by one, none hitting itself', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -280, y: 15 });
    const enemy = w.spawnBlueprint(blueprint('enemy-carrier'), { x: -100, y: 1.55 }, { team: 1 });
    for (let t = 0; t < 25 * 60; t++) w.step();
    expect(partsLost(w, hunter)).toBeGreaterThan(10);
    expect(ownLost(w, enemy)).toBe(0);
    expect(w.canControl(enemy.id)).toBe(true);
    w.dispose();
  });
});
