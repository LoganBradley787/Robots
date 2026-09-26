import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World, type WorldEvent } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const count = (w: World, kind: WorldEvent['kind']): number => w.events.filter((e) => e.kind === kind).length;
const tap = (robot: number, key: string) => [{ robot, pressed: [key], released: [] }];
const release = (robot: number, key: string) => [{ robot, pressed: [], released: [key] }];
/** A core with a flare standing on it: V lights it (a pulse). */
const FLARE_CAR = {
  format: 1,
  name: 'flare-car',
  grid: ['Q^', 'C'],
  bindings: [{ key: 'v', mode: 'pulse', target: 'flare', channel: 'ignite', value: 1 }],
};
/** A flare on a decoupler that lets go to the right: V lights it and lets it go on the same tick. */
const RACK = {
  format: 1,
  name: 'rack',
  grid: ['C  D>  Q>'],
  bindings: [
    { key: 'v', mode: 'pulse', target: 'flare', channel: 'ignite', value: 1 },
    { key: 'v', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 },
  ],
};
const BURN_TICKS = 120;

describe('flares (M11)', () => {
  it('a key lights it: it burns for 2 s, then is gone without a blast', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(FLARE_CAR, { x: -100, y: 0.5 });
    for (let i = 0; i < 10; i++) w.step();
    expect(w.partOutput(car.id, 'flare@0,1', 'burning')).toBe(0);
    w.step(tap(car.id, 'v'));
    w.step(release(car.id, 'v'));
    expect(w.partOutput(car.id, 'flare@0,1', 'burning')).toBe(1);
    expect(w.events.filter((e) => e.kind === 'lit')).toMatchObject([{ robot: car.id, part: 'flare@0,1', of: car.id }]);
    // Lit on the tick V went down; it burns 120 ticks in all (the tick it was lit is the first).
    for (let i = 0; i < BURN_TICKS - 2; i++) w.step();
    expect(w.partOutput(car.id, 'flare@0,1', 'burning')).toBe(1);
    w.step();
    expect(car.parts.has('flare@0,1')).toBe(false);
    expect(w.events.filter((e) => e.kind === 'burntOut')).toMatchObject([{ robot: car.id, part: 'flare@0,1' }]);
    expect(w.events.filter((e) => e.kind === 'partDestroyed')).toMatchObject([{ part: 'flare@0,1', exploded: false, burntOut: true }]);
    expect(count(w, 'explosion')).toBe(0);
    // The car is fine.
    expect(car.parts.size).toBe(1);
    w.dispose();
  });

  it('a script lights it with set(), and it stays lit when the script stops asking', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const src = "function tick() { if (frame === 3) set('flare', 'ignite', 1); else set('flare', 'ignite', 0); }";
    const car = w.spawnBlueprint({ ...FLARE_CAR, bindings: [], scripts: [{ id: 'f', source: src }] }, { x: -100, y: 0.5 });
    for (let i = 0; i < 3; i++) w.step();
    expect(w.partOutput(car.id, 'flare@0,1', 'burning')).toBe(0);
    for (let i = 0; i < 20; i++) w.step();
    expect(w.partOutput(car.id, 'flare@0,1', 'burning')).toBe(1);
    expect(count(w, 'lit')).toBe(1);
    w.dispose();
  });

  it('let go burning, it keeps burning on its own and still stands in for the robot that lit it', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const rack = w.spawnBlueprint(RACK, { x: -100, y: 0.5 });
    for (let i = 0; i < 5; i++) w.step();
    w.step(tap(rack.id, 'v'));
    w.step(release(rack.id, 'v'));
    const split = w.events.find((e) => e.kind === 'split');
    expect(split).toBeDefined();
    const pieceId = split?.kind === 'split' ? split.pieces[0] : undefined;
    const piece = w.robots.find((r) => r.id === pieceId);
    const flare = piece?.parts.get('flare@2,0');
    expect(flare?.decoyOf).toBe(rack.id);
    expect(w.partOutput(pieceId ?? 0, 'flare@2,0', 'burning')).toBe(1);
    // It moves away at several meters a second.
    for (let i = 0; i < 30; i++) w.step();
    expect(w.partOutput(pieceId ?? 0, 'flare@2,0', 'burning')).toBe(1);
    for (let i = 0; i < BURN_TICKS; i++) w.step();
    expect(w.robots.some((r) => r.id === pieceId)).toBe(false);
    expect(count(w, 'explosion')).toBe(0);
    w.dispose();
  });

  it('let go unlit, it never lights', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const rack = w.spawnBlueprint({ ...RACK, bindings: [RACK.bindings[1]] }, { x: -100, y: 0.5 });
    w.step(tap(rack.id, 'v'));
    w.step(release(rack.id, 'v'));
    for (let i = 0; i < 200; i++) w.step();
    expect(count(w, 'lit')).toBe(0);
    expect(w.robots.some((r) => r.parts.has('flare@2,0'))).toBe(true);
    w.dispose();
  });

  it('its burn and the robot it stands in for are part of the world hash; other parts add nothing', async () => {
    const run = async (light: boolean): Promise<string[]> => {
      const w = await World.create({ seed: 1 }, flat);
      const car = w.spawnBlueprint(FLARE_CAR, { x: -100, y: 0.5 });
      const hashes: string[] = [];
      for (let i = 0; i < 5; i++) {
        w.step(light && i === 1 ? tap(car.id, 'v') : []);
        hashes.push(w.hash());
      }
      const flare = car.parts.get('flare@0,1');
      if (light) expect(flare?.burn).toBe(BURN_TICKS - 3);
      else expect(flare?.burn).toBeUndefined();
      w.dispose();
      return hashes;
    };
    const lit = await run(true);
    const dark = await run(false);
    expect(lit[0]).toBe(dark[0]);
    expect(lit[1]).not.toBe(dark[1]);
  });

  it('shot while unlit, it breaks like any part and never lights', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(FLARE_CAR, { x: -100, y: 0.5 });
    const flare = car.parts.get('flare@0,1');
    if (flare) flare.health = 0;
    w.step();
    expect(car.parts.has('flare@0,1')).toBe(false);
    expect(w.events.filter((e) => e.kind === 'partDestroyed')).toMatchObject([{ part: 'flare@0,1', exploded: false }]);
    expect(w.events.find((e) => e.kind === 'partDestroyed' && 'burntOut' in e)).toBeUndefined();
    w.dispose();
  });
});
