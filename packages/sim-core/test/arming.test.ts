import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World, type WorldEvent } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { expandBlueprint } from '../src/blueprint/expand';
import { validateBlueprint } from '../src/blueprint/validate';
import { toFileJson } from '../src/blueprint/serialize';
import { mirrorBlueprint } from '../src/blueprint/mirror';
import { orientBlueprint } from '../src/blueprint/orient';
import { placeBlueprint } from '../src/blueprint/place';
import { setPartsArmed } from '../src/blueprint/edit';
import { defaultRegistry } from '../src/parts/registry';
import { resolveScripts } from '../src/blueprint/scripts';

const flat = parseWorldFile(flatJson);
const registry = defaultRegistry();
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const shipped = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;
const count = (w: World, kind: WorldEvent['kind']): number => w.events.filter((e) => e.kind === kind).length;
const LIVE = { X: { part: 'warhead', armed: true } };
/** A car with one warhead on its nose: X arms it (pulse), Z sets it off (pulse). */
const BOMB_CAR = {
  format: 1,
  name: 'bomb-car',
  grid: ['C  F  X'],
  bindings: [
    { key: 'x', mode: 'pulse', target: 'warhead', channel: 'arm', value: 1 },
    { key: 'z', mode: 'pulse', target: 'warhead', channel: 'detonate', value: 1 },
  ],
};
const tap = (robot: number, key: string) => [{ robot, pressed: [key], released: [] }];
const release = (robot: number, key: string) => [{ robot, pressed: [], released: [key] }];

describe('arming (M10)', () => {
  it('an unarmed warhead ignores detonate; arming by a key, then detonate, sets it off; it stays armed', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(BOMB_CAR, { x: -100, y: 0.5 });
    w.step(tap(car.id, 'z'));
    w.step(release(car.id, 'z'));
    for (let i = 0; i < 10; i++) w.step();
    expect(count(w, 'explosion')).toBe(0);
    expect(w.partOutput(car.id, 'warhead@2,0', 'armed')).toBe(0);
    w.step(tap(car.id, 'x'));
    w.step(release(car.id, 'x'));
    for (let i = 0; i < 10; i++) w.step();
    // Armed for good: the arm key was let go ten ticks ago.
    expect(w.partOutput(car.id, 'warhead@2,0', 'armed')).toBe(1);
    expect(w.events.filter((e) => e.kind === 'armed')).toMatchObject([{ robot: car.id, part: 'warhead@2,0' }]);
    w.step(tap(car.id, 'z'));
    for (let i = 0; i < 5; i++) w.step();
    expect(count(w, 'explosion')).toBe(1);
    w.dispose();
  });

  it('arm and detonate on the same tick go off', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(BOMB_CAR, { x: -100, y: 0.5 });
    w.step([{ robot: car.id, pressed: ['x', 'z'], released: [] }]);
    for (let i = 0; i < 5; i++) w.step();
    expect(count(w, 'explosion')).toBe(1);
    w.dispose();
  });

  it('a script arms it with set()', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const car = w.spawnBlueprint({ ...BOMB_CAR, scripts: [{ id: 'a', source: "function setup() { set('warhead', 'arm', 1); } function tick() {}" }] }, { x: -100, y: 0.5 });
    w.step();
    expect(w.partOutput(car.id, 'warhead@2,0', 'armed')).toBe(1);
    w.dispose();
  });

  it('unarmed, a blast destroys it without a second blast, and a hard hit leaves it whole', async () => {
    const w = await World.create({ seed: 1 }, flat);
    // An unarmed warhead next to a live bomb set off by its own key.
    const pair = w.spawnBlueprint(
      { format: 1, name: 'pair', grid: ['C  F  Y  X'], legend: { ...LIVE, Y: { part: 'warhead' } }, bindings: [{ key: 'z', mode: 'pulse', target: 'warhead@3,0', channel: 'detonate', value: 1 }] },
      { x: -100, y: 0.5 },
    );
    w.step(tap(pair.id, 'z'));
    for (let i = 0; i < 10; i++) w.step();
    expect(w.events.flatMap((e) => (e.kind === 'partDestroyed' ? [e.part] : []))).toContain('warhead@2,0');
    expect(count(w, 'explosion')).toBe(1);
    w.dispose();

    const wall = parseWorldFile({ name: 'wall', ground: { width: 50, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [{ x: 6, y: 20, w: 1, h: 10 }] });
    const w2 = await World.create({ seed: 1, gravityY: 0 }, wall);
    const ram = w2.spawnBlueprint({ format: 1, name: 'ram', grid: ['F  F  C  X'] }, { x: 0, y: 20 });
    w2.physics.kick(ram.groups[0]?.bodyId as number, 10, 0, 0);
    for (let i = 0; i < 180; i++) w2.step();
    expect(count(w2, 'explosion')).toBe(0);
    expect(count(w2, 'partDestroyed')).toBe(0);
    w2.dispose();
  });

  it("a bomb on a parked drone sets off only itself: the drone's missiles are not armed", async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    w.spawnBlueprint(shipped('missile-drone-10prop'), { x: -100, y: 3 });
    for (let i = 0; i < 60; i++) w.step();
    w.spawnBlueprint(shipped('bomb'), { x: -97, y: 8 });
    for (let i = 0; i < 120; i++) w.step();
    expect(count(w, 'explosion')).toBe(1);
    w.dispose();
  });

  it('stays armed through a split, and a piece that breaks off keeps it', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(
      {
        format: 1,
        name: 'dropper',
        grid: ['C  F', '.  D', '.  X'],
        legend: { D: { part: 'decoupler', rot: 180 } },
        bindings: [
          { key: 'x', mode: 'pulse', target: 'warhead', channel: 'arm', value: 1 },
          { key: 'g', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 },
        ],
      },
      { x: -100, y: 6 },
    );
    w.step(tap(r.id, 'x'));
    w.step(release(r.id, 'x'));
    w.step(tap(r.id, 'g'));
    for (let i = 0; i < 3; i++) w.step();
    const piece = w.robots.find((p) => p.parts.has('warhead@1,0') && p !== r);
    expect(piece?.parts.get('warhead@1,0')?.armed).toBe(true);
    // Dropped 4 m, the armed piece goes off on the ground.
    for (let i = 0; i < 120; i++) w.step();
    expect(count(w, 'explosion')).toBe(1);
    w.dispose();
  });

  it('armed: true in a blueprint starts it armed, and the hash tells armed from unarmed', async () => {
    const hashOf = async (armed: boolean): Promise<string> => {
      const w = await World.create({ seed: 1 }, flat);
      const r = w.spawnBlueprint({ format: 1, name: 'b', grid: ['C  X'], ...(armed ? { legend: LIVE } : {}) }, { x: -100, y: 0.5 });
      expect(w.partOutput(r.id, 'warhead@1,0', 'armed')).toBe(armed ? 1 : 0);
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await hashOf(true)).not.toBe(await hashOf(false));
  });

  it('the validator refuses armed on a part that is never armed', () => {
    const v = validateBlueprint({ format: 1, name: 'x', grid: ['C  F'], legend: { F: { part: 'frame', armed: true } } }, registry);
    expect(v.ok).toBe(false);
    expect(v.issues[0]).toMatchObject({ code: 'BAD_ARMED' });
    expect(v.issues[0]?.message).toContain('warhead');
  });

  it('armed survives the file form, the grid form, placing, mirroring, turning, and the builder switch', () => {
    const bp = expandBlueprint({ format: 1, name: 'b', grid: ['C  X  X'], legend: LIVE }).blueprint;
    if (!bp) throw new Error('bad blueprint');
    const armedIds = (b: { parts: { id: string; armed?: true }[] }): string[] => b.parts.filter((p) => p.armed === true).map((p) => p.id);
    expect(armedIds(bp)).toEqual(['warhead@1,0', 'warhead@2,0']);
    const back = expandBlueprint(toFileJson(bp, registry)).blueprint;
    expect(armedIds(back ?? { parts: [] })).toEqual(['warhead@1,0', 'warhead@2,0']);
    expect(armedIds(mirrorBlueprint(bp, 4, registry))).toHaveLength(2);
    expect(armedIds(orientBlueprint(bp, { flip: true, rot: 90 }, registry))).toHaveLength(2);
    const target = expandBlueprint({ format: 1, name: 't', grid: ['C  F  F  F  F'] }).blueprint;
    if (!target) throw new Error('bad target');
    const placed = placeBlueprint(target, bp, { x: 0, y: 1 }, registry);
    expect(placed.ok ? armedIds(placed.blueprint) : [placed.error]).toHaveLength(2);
    const off = setPartsArmed(bp, ['warhead@1,0'], false);
    expect(armedIds(off)).toEqual(['warhead@2,0']);
    expect(armedIds(setPartsArmed(off, ['warhead@1,0'], true))).toEqual(['warhead@1,0', 'warhead@2,0']);
  });
});
