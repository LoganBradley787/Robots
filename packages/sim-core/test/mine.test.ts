import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World, type WorldEvent } from '../src/world/World';
import { defaultRegistry } from '../src/parts/registry';
import { parsePartDef } from '../src/parts/parsePartDef';

const flat = parseWorldFile(flatJson);
/** No gravity and a far-away ground: things move where they are kicked. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 } });

const ARMED = { Xm: { part: 'mine', armed: true } };
const UNARMED = { Xm: { part: 'mine' } };
const MINE = { format: 1, name: 'mine', grid: ['Xm'], legend: ARMED };
const DUD = { format: 1, name: 'unarmed-mine', grid: ['Xm'], legend: UNARMED };
/** A core and a frame: something to drive past a mine. */
const CAR = { format: 1, name: 'car', grid: ['C  F'] };
const kinds = (w: World, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind);
const mineDestroyed = (w: World): WorldEvent[] => w.events.filter((e) => e.kind === 'partDestroyed' && e.partType === 'mine');

/** Drives a car at 10 m/s along +x from x = -20, `gapY` above a mine at x = 0, for 3 s. */
async function pass(mine: unknown, opts: { team?: number; gapY?: number }): Promise<World> {
  const w = await World.create({ seed: 1, gravityY: 0 }, space);
  w.spawnBlueprint(mine, { x: 0, y: 100 });
  const car = w.spawnBlueprint(CAR, { x: -20, y: 100 + (opts.gapY ?? 0) }, { team: opts.team ?? 1 });
  w.physics.kick(car.groups[0]?.bodyId as number, 10, 0, 0);
  for (let i = 0; i < 180; i++) w.step();
  return w;
}

describe('proximity mine (Batch)', () => {
  it('the def: health 60, a quarter of a shell, the heavy warhead blast, no impact fuze, radius 3', () => {
    const d = defaultRegistry().get('mine');
    expect(d).toMatchObject({ health: 60, shellDamage: 0.25, arming: true, mine: { radius: 3 } });
    expect(d.onDestroyed?.explode).toMatchObject({ radius: 4, damage: 250 });
    expect(d.impact).toBeUndefined();
  });

  it('armed, it goes off when an enemy drives within 3 m: one blast, at the radius, and the mine is gone', async () => {
    const w = await pass(MINE, {});
    expect(kinds(w, 'explosion')).toHaveLength(1);
    const gone = mineDestroyed(w);
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ exploded: true });
    // The car's frame leads its core by 1 m and starts 19 m out at 10 m/s: 3 m out is about 1.6 s (tick 96), well before 3 s.
    expect((gone[0] as { tick: number }).tick).toBeLessThan(120);
    expect((gone[0] as { tick: number }).tick).toBeGreaterThan(40);
    w.dispose();
  });

  it('an enemy passing 5 m off does not set it off', async () => {
    const w = await pass(MINE, { gapY: 5 });
    expect(kinds(w, 'explosion')).toHaveLength(0);
    expect(mineDestroyed(w)).toHaveLength(0);
    w.dispose();
  });

  it('a friend (its own team) driving over it does not set it off', async () => {
    const w = await pass(MINE, { team: 0 });
    expect(kinds(w, 'explosion')).toHaveLength(0);
    expect(mineDestroyed(w)).toHaveLength(0);
    w.dispose();
  });

  it('unarmed, it never goes off', async () => {
    const w = await pass(DUD, {});
    expect(kinds(w, 'explosion')).toHaveLength(0);
    expect(mineDestroyed(w)).toHaveLength(0);
    w.dispose();
  });

  it('arming it (the arm input) lets it go off on the next enemy that comes near', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const bp = { format: 1, name: 'mine', grid: ['C  Xm'], legend: UNARMED, bindings: [{ key: 'a', mode: 'pulse', target: 'mine', channel: 'arm', value: 1 }] };
    const m = w.spawnBlueprint(bp, { x: 0, y: 130 });
    const car = w.spawnBlueprint(CAR, { x: -20, y: 130 }, { team: 1 });
    w.physics.kick(car.groups[0]?.bodyId as number, 10, 0, 0);
    w.step([{ robot: m.id, pressed: ['a'], released: [] }]);
    for (let i = 0; i < 180; i++) w.step();
    expect(kinds(w, 'armed')).toHaveLength(1);
    expect(kinds(w, 'explosion')).toHaveLength(1);
    w.dispose();
  });

  it('detonate sets it off (armed only)', async () => {
    const run = async (legend: Record<string, unknown>): Promise<number> => {
      const w = await World.create({ seed: 1, gravityY: 0 }, space);
      const bp = { format: 1, name: 'mine', grid: ['C  Xm'], legend, bindings: [{ key: 'x', mode: 'pulse', target: 'mine', channel: 'detonate', value: 1 }] };
      const m = w.spawnBlueprint(bp, { x: 0, y: 100 });
      w.step([{ robot: m.id, pressed: ['x'], released: [] }]);
      const n = kinds(w, 'explosion').length;
      w.dispose();
      return n;
    };
    expect(await run(ARMED)).toBe(1);
    expect(await run(UNARMED)).toBe(0);
  });

  it('shot to pieces, an armed mine breaks without a blast', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const gun = w.spawnBlueprint(
      { format: 1, name: 'gun-car', grid: ['C  M>'], bindings: [{ key: 'f', mode: 'hold', target: 'gun', channel: 'fire', value: 1 }] },
      { x: -100, y: 0.5 },
    );
    // On the front of a car, so the shells' pushes do not skid it out of the line of fire.
    const mine = w.spawnBlueprint({ format: 1, name: 'mine-car', grid: ['Xm  C'], legend: ARMED }, { x: -80, y: 0.5 }, { team: 1 });
    for (let i = 0; i < 10; i++) w.step();
    w.step([{ robot: gun.id, pressed: ['f'], released: [] }]);
    for (let i = 0; i < 480; i++) w.step();
    const hits = w.events.filter((e) => e.kind === 'shellHit' && e.robot === mine.id);
    expect(hits.length).toBeGreaterThan(10);
    expect(hits[0]).toMatchObject({ partType: 'mine', damage: 1.25 });
    expect(mineDestroyed(w)).toHaveLength(1);
    expect(mineDestroyed(w)[0]).toMatchObject({ exploded: false });
    expect(kinds(w, 'explosion')).toHaveLength(0);
    w.dispose();
  });

  it('a blast next to an armed mine breaks it without setting it off (no chain)', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const bomb = w.spawnBlueprint(
      { format: 1, name: 'bomb', grid: ['C  X'], legend: { X: { part: 'warhead', armed: true } }, bindings: [{ key: 'x', mode: 'pulse', target: 'warhead', channel: 'detonate', value: 1 }] },
      { x: -100, y: 0.5 },
    );
    w.spawnBlueprint(MINE, { x: -97.5, y: 0.5 });
    for (let i = 0; i < 5; i++) w.step();
    w.step([{ robot: bomb.id, pressed: ['x'], released: [] }]);
    for (let i = 0; i < 5; i++) w.step();
    expect(kinds(w, 'explosion')).toHaveLength(1);
    for (const e of mineDestroyed(w)) expect(e).toMatchObject({ exploded: false });
    w.dispose();
  });

  it('a "mine" block needs arming, an explosion, and a positive radius', () => {
    const raw = JSON.parse(JSON.stringify(defaultRegistry().get('mine'))) as Record<string, unknown>;
    expect(parsePartDef(raw, 'm.json').mine).toEqual({ radius: 3 });
    expect(() => parsePartDef({ ...raw, arming: undefined }, 'm.json')).toThrow('mine');
    expect(() => parsePartDef({ ...raw, onDestroyed: undefined }, 'm.json')).toThrow('mine');
    expect(() => parsePartDef({ ...raw, mine: { radius: 0 } }, 'm.json')).toThrow();
    expect(() => parsePartDef({ ...raw, mine: { radius: 3, extra: 1 } }, 'm.json')).toThrow();
  });
});
