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

/** Parts a robot, or any piece that broke off it, lost; its own flares burning out do not count. */
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot) && e.partType !== 'flare').length;
}
const press = (robot: number, key: string): RobotInput => ({ robot, pressed: [key], released: [] });
const lift = (robot: number, key: string): RobotInput => ({ robot, pressed: [], released: [key] });

/**
 * A hunter drone hovers; something of the other side comes for it. `flareAt` is the tick it presses V (one pair of
 * flares), if any. Returns what it lost and the first blast: when, and how far from the hunter.
 */
async function attack(make: (w: World) => Robot, at: { x: number; y: number }, flareAt: number | undefined, ticks: number, fire?: number): Promise<{ lost: number; tick: number; distance: number }> {
  const w = await World.create({ seed: 1, scripts: host }, flat);
  const hunter = w.spawnBlueprint(blueprint('hunter-drone'), at);
  const enemy = make(w);
  let tick = -1;
  let distance = Infinity;
  for (let t = 0; t < ticks; t++) {
    const inputs: RobotInput[] = [];
    if (t === fire) inputs.push(press(enemy.id, 'f'));
    if (t === (fire ?? -9) + 1) inputs.push(lift(enemy.id, 'f'));
    if (t === flareAt) inputs.push(press(hunter.id, 'v'));
    if (t === (flareAt ?? -9) + 1) inputs.push(lift(hunter.id, 'v'));
    const n = w.events.length;
    w.step(inputs);
    for (const e of w.events.slice(n)) {
      if (e.kind !== 'explosion' || tick >= 0) continue;
      const s = w.physics.state(hunter.groups[0]?.bodyId as number);
      tick = t;
      distance = Math.hypot(e.x - s.x, e.y - s.y);
    }
  }
  const lost = partsLost(w, hunter);
  w.dispose();
  return { lost, tick, distance };
}

describe('M11 flares, done when', () => {
  it('a seeker missile is pulled off by a pair lit about a second before it arrives; 4 s early or 0.2 s late, it hits', { timeout: 60_000 }, async () => {
    const shot = (flareAt?: number) => attack((w) => w.spawnBlueprint(blueprint('launcher-seeker'), { x: -350, y: 1.5 }, { team: 1 }), { x: -40, y: 40 }, flareAt, 480, 60);
    const none = await shot();
    expect(none.lost).toBeGreaterThan(0);
    expect(none.distance).toBeLessThan(10);
    const right = await shot(none.tick - 60);
    expect(right.lost).toBe(0);
    expect(right.distance).toBeGreaterThan(12); // it went off at the flare
    expect((await shot(none.tick - 240)).lost).toBeGreaterThan(0); // burnt out before it got there
    expect((await shot(none.tick - 12)).lost).toBeGreaterThan(0); // already on it
  });

  it('a drone bomb chasing the drone goes off at a well-timed pair instead', { timeout: 60_000 }, async () => {
    const chase = (flareAt?: number) => attack((w) => w.spawnBlueprint(blueprint('drone-bomb'), { x: -200, y: 2 }, { team: 1 }), { x: -40, y: 40 }, flareAt, 720);
    const none = await chase();
    expect(none.distance).toBeLessThan(10); // on the drone's side rack
    const right = await chase(none.tick - 60);
    expect(right.lost).toBe(0);
    expect(right.distance).toBeGreaterThan(8); // at the flare, clear of the drone (its blast reaches 4 m)
  });

  it("an enemy drone's own flares (popped by itself) save it from a hunter's volley that takes it apart without them", { timeout: 60_000 }, async () => {
    const volley = async (auto: number): Promise<{ lost: number; lit: number }> => {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -130, y: 15 });
      // It holds its own fire here (minRange), so only its flares and its dodging are tested.
      const enemy = w.spawnBlueprint(blueprint('enemy-drone', { flares: { auto }, pilot: { minRange: 2000 } }), { x: -50, y: 27 }, { team: 1 });
      // All four of the hunter's missiles, 1.5 s apart.
      const shots = [60, 150, 240, 330];
      for (let t = 0; t < 900; t++) w.step(shots.includes(t) ? [press(hunter.id, 'f')] : shots.includes(t - 1) ? [lift(hunter.id, 'f')] : []);
      const out = { lost: partsLost(w, enemy), lit: w.events.filter((e) => e.kind === 'lit' && e.robot === enemy.id).length };
      w.dispose();
      return out;
    };
    const without = await volley(0);
    const withFlares = await volley(1);
    expect(without.lit).toBe(0);
    expect(without.lost).toBeGreaterThan(10);
    expect(withFlares.lit).toBeGreaterThan(0);
    expect(withFlares.lost).toBeLessThan(without.lost / 2);
  });
});
