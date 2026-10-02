import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
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
const press = (robot: number, ...keys: string[]) => [{ robot, pressed: keys, released: [] as string[] }];
const lift = (robot: number, ...keys: string[]) => [{ robot, pressed: [] as string[], released: keys }];

/** Parts a robot, or any piece that broke off it, lost; its own flares burning out do not count. */
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot) && e.burntOut !== true).length;
}
const coreOf = (w: World, r: Robot): { x: number; y: number } => w.physics.state(r.groups[0]?.bodyId as number);
/** The grapple under the middle: its id in the blueprint's grid. */
const DOWN = 'grapple@7,0';

describe('grapple drone (Batch), done when', () => {
  it('the enemy grapple drone hooks a hovering drone, reels it in to 6 m under itself, carries it 40 m up, and lets it go', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    // Guns off (range 1) so the drone it holds is not shot to pieces first.
    const me = w.spawnBlueprint(blueprint('enemy-grapple-drone', { guns: { range: 1 } }), { x: 60, y: 40 }, { team: 1 });
    const target = w.spawnBlueprint(blueprint('drone'), { x: -30, y: 20 });
    let hookedAt = -1;
    let shortAt = -1;
    let releasedAt = -1;
    let hookY = 0;
    let releaseY = 0;
    let heldY = 0;
    for (let t = 0; t < 45 * 60; t++) {
      const n = w.events.length;
      w.step();
      for (const e of w.events.slice(n)) {
        if (e.kind === 'hooked' && e.robot === me.id && hookedAt < 0) {
          hookedAt = t / 60;
          hookY = coreOf(w, me).y;
          expect(e.to).toBe(target.id);
          expect(e.part).toBe(DOWN);
        }
        if (e.kind === 'unhooked' && e.robot === me.id && e.why === 'released' && releasedAt < 0) {
          releasedAt = t / 60;
          releaseY = coreOf(w, me).y;
          heldY = coreOf(w, target).y;
        }
      }
      if (hookedAt >= 0 && shortAt < 0 && (w.partOutput(me.id, DOWN, 'length') ?? 99) <= 7.5) shortAt = t / 60;
    }
    expect(hookedAt).toBeGreaterThan(0);
    expect(hookedAt).toBeLessThan(20);
    // Reeled in to about 6 m (5 m/s), then held 3 s before it climbs.
    expect(shortAt).toBeGreaterThan(hookedAt);
    expect(shortAt - hookedAt).toBeLessThan(10);
    expect(releasedAt).toBeGreaterThan(shortAt + 3);
    // Let go about 40 m above where the rope came in.
    expect(releaseY - hookY).toBeGreaterThan(30);
    // What it held went up with it (it started at 20 m), the rope 6 m long.
    expect(heldY).toBeGreaterThan(45);
    expect(releaseY - heldY).toBeLessThan(16); // its core is 5.5 m over the grapple, the rope 6 m, then the top of the drone
    w.dispose();
  });

  it('with its guns on, what hangs under it is shot: it wrecks a hunter drone and loses next to nothing itself', { timeout: 90_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const me = w.spawnBlueprint(blueprint('enemy-grapple-drone'), { x: 60, y: 40 }, { team: 1 });
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: -60, y: 40 });
    for (let t = 0; t < 40 * 60; t++) w.step();
    expect(w.events.some((e) => e.kind === 'hooked' && e.robot === me.id && e.to === hunter.id)).toBe(true);
    expect(partsLost(w, hunter)).toBeGreaterThanOrEqual(20);
    expect(w.events.some((e) => e.kind === 'coreLost' && e.robot === hunter.id)).toBe(true);
    expect(partsLost(w, me)).toBeLessThanOrEqual(5);
    // Its guns did it: they are the only thing of ours that shoots.
    expect(w.shotsBy(me.id)).toBeGreaterThan(20);
    w.dispose();
  });

  it('its guns fire only at enemies: a friendly drone hanging under its sights is never hit', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const me = w.spawnBlueprint(blueprint('enemy-grapple-drone'), { x: 0, y: 40 }, { team: 1 });
    const friend = w.spawnBlueprint(blueprint('drone'), { x: 0, y: 25 }, { team: 1 });
    for (let t = 0; t < 10 * 60; t++) w.step();
    expect(w.events.filter((e) => e.kind === 'shellHit' && e.robot === friend.id)).toEqual([]);
    expect(w.events.some((e) => e.kind === 'hooked' && e.robot === me.id)).toBe(false);
    expect(partsLost(w, friend)).toBe(0);
    w.dispose();
  });

  it('the player version: F hooks what is straight under it, R reels it in, T pays out, X lets go', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const me = w.spawnBlueprint(blueprint('grapple-drone'), { x: -50, y: 30 });
    const target = w.spawnBlueprint(blueprint('drone'), { x: -50, y: 15 }, { team: 1 });
    for (let t = 0; t < 180; t++) w.step();
    expect(w.partOutput(me.id, DOWN, 'hooked')).toBe(0);
    w.step(press(me.id, 'f'));
    for (let t = 0; t < 5; t++) w.step();
    expect(w.partOutput(me.id, DOWN, 'hooked')).toBe(1);
    expect(w.events.filter((e) => e.kind === 'hooked')).toMatchObject([{ robot: me.id, part: DOWN, to: target.id }]);
    const before = w.partOutput(me.id, DOWN, 'length') ?? 0;
    expect(before).toBeGreaterThan(6);
    w.step(press(me.id, 'r'));
    for (let t = 0; t < 120; t++) w.step();
    w.step(lift(me.id, 'r'));
    const reeled = w.partOutput(me.id, DOWN, 'length') ?? 0;
    expect(reeled).toBeLessThan(before - 2);
    w.step(press(me.id, 't'));
    for (let t = 0; t < 60; t++) w.step();
    w.step(lift(me.id, 't'));
    expect(w.partOutput(me.id, DOWN, 'length') ?? 0).toBeGreaterThan(reeled + 3);
    w.step(press(me.id, 'x'));
    expect(w.partOutput(me.id, DOWN, 'hooked')).toBe(0);
    expect(w.events.filter((e) => e.kind === 'unhooked')).toMatchObject([{ why: 'released' }]);
    w.dispose();
  });

  it('the player version: a side grapple hooks what lines up level with it, and F with nothing lined up does nothing', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const me = w.spawnBlueprint(blueprint('grapple-drone'), { x: -10, y: 30 });
    w.spawnBlueprint(blueprint('drone'), { x: -40, y: 30 }, { team: 1 });
    for (let t = 0; t < 120; t++) w.step();
    // The left grapple sits 4 m under the core's row; nothing of the drone's is there, so nothing lines up.
    w.step(press(me.id, 'f'));
    for (let t = 0; t < 5; t++) w.step();
    expect(w.events.filter((e) => e.kind === 'hooked')).toEqual([]);
    w.dispose();
    const w2 = await World.create({ seed: 1, scripts: host }, flat);
    const me2 = w2.spawnBlueprint(blueprint('grapple-drone'), { x: -10, y: 30 });
    // The left grapple is at cell (2, 3) of the grid: 4 m left of the core's column and 3 m under its row.
    const target2 = w2.spawnBlueprint(blueprint('drone'), { x: -40, y: 27 }, { team: 1 });
    for (let t = 0; t < 120; t++) w2.step();
    w2.step(press(me2.id, 'f'));
    for (let t = 0; t < 5; t++) w2.step();
    const hooks = w2.events.filter((e) => e.kind === 'hooked');
    expect(hooks).toMatchObject([{ robot: me2.id, to: target2.id }]);
    w2.dispose();
  });

  // Logan flying it by hand: "it fights S" and "its keys are unclear".
  it('the player version: S sinks it and W lifts it with nothing on its ropes', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const me = w.spawnBlueprint(blueprint('grapple-drone'), { x: -150, y: 60 });
    for (let t = 0; t < 120; t++) w.step();
    expect(Math.abs(coreOf(w, me).y - 60)).toBeLessThan(0.3);
    w.step(press(me.id, 's'));
    for (let t = 0; t < 180; t++) w.step();
    w.step(lift(me.id, 's'));
    for (let t = 0; t < 180; t++) w.step();
    const low = coreOf(w, me).y;
    expect(low).toBeLessThan(35);
    // Let go, it stays down there.
    for (let t = 0; t < 120; t++) w.step();
    expect(Math.abs(coreOf(w, me).y - low)).toBeLessThan(0.3);
    w.step(press(me.id, 'w'));
    for (let t = 0; t < 120; t++) w.step();
    w.step(lift(me.id, 'w'));
    expect(coreOf(w, me).y).toBeGreaterThan(low + 15);
    w.dispose();
  });

  it('the player version: S sinks it with a robot on its rope that flies itself and pushes up under it', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const me = w.spawnBlueprint(blueprint('grapple-drone'), { x: -150, y: 50 });
    // The enemy drone wants a spot above what it tracks, and its 14 propellers lift more than the grapple drone weighs.
    const target = w.spawnBlueprint(blueprint('enemy-drone'), { x: -150, y: 32 }, { team: 1 });
    // Guns off, so what it holds stays whole.
    w.step(press(me.id, 'g'));
    w.step(lift(me.id, 'g'));
    for (let t = 0; t < 120; t++) w.step();
    w.step(press(me.id, 'f'));
    w.step(lift(me.id, 'f'));
    w.step(press(me.id, 'r'));
    for (let t = 0; t < 240; t++) w.step();
    w.step(lift(me.id, 'r'));
    expect(w.partOutput(me.id, DOWN, 'hooked')).toBe(1);
    expect(w.events.filter((e) => e.kind === 'hooked')).toMatchObject([{ robot: me.id, part: DOWN, to: target.id }]);
    expect(w.partOutput(me.id, DOWN, 'length') ?? 99).toBeLessThan(8);
    // Hands off it holds its height (it was carried up at 9 m/s and more, with nothing that pushes down).
    for (let t = 0; t < 180; t++) w.step();
    const held = coreOf(w, me).y;
    expect(Math.abs(held - 50)).toBeLessThan(4);
    // S takes both down.
    w.step(press(me.id, 's'));
    for (let t = 0; t < 240; t++) w.step();
    w.step(lift(me.id, 's'));
    expect(coreOf(w, me).y).toBeLessThan(held - 15);
    expect(coreOf(w, target).y).toBeLessThan(held - 15);
    expect(w.partOutput(me.id, DOWN, 'hooked')).toBe(1);
    w.dispose();
  });

  it('the player version: its status lists the keys, and F with nothing lined up says so', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const me = w.spawnBlueprint(blueprint('grapple-drone'), { x: -150, y: 50 });
    w.step();
    const status = (): string[] => w.scriptLogs.filter((l) => l.robot === me.id).map((l) => l.text);
    expect(status().join(' ')).toMatch(/W up, S down, A left, D right/);
    expect(status().join(' ')).toMatch(/F throw a hook.*R reel in, T pay out, X let go/);
    for (let t = 0; t < 60; t++) w.step();
    w.step(press(me.id, 'f'));
    w.step(lift(me.id, 'f'));
    expect(status().at(-1)).toMatch(/nothing lines up/);
    expect(w.events.filter((e) => e.kind === 'hooked')).toEqual([]);
    // The enemy version flies itself and writes no key list.
    const ai = w.spawnBlueprint(blueprint('enemy-grapple-drone'), { x: 300, y: 50 }, { team: 1 });
    for (let t = 0; t < 5; t++) w.step();
    expect(w.scriptLogs.filter((l) => l.robot === ai.id && /keys|ropes/.test(l.text))).toEqual([]);
    w.dispose();
  });

  it('deterministic: the same fight gives the same hash', { timeout: 120_000 }, async () => {
    const run = async (): Promise<string> => {
      const w = await World.create({ seed: 3, scripts: host }, flat);
      w.spawnBlueprint(blueprint('enemy-grapple-drone'), { x: 60, y: 40 }, { team: 1 });
      w.spawnBlueprint(blueprint('drone'), { x: -30, y: 20 });
      for (let t = 0; t < 20 * 60; t++) w.step();
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });
});
