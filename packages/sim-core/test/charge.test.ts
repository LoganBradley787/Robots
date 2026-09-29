import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World, type WorldEvent } from '../src/world/World';
import { defaultRegistry } from '../src/parts/registry';
import { parsePartDef } from '../src/parts/parsePartDef';

const flat = parseWorldFile(flatJson);
/** No gravity and a far-away ground: things move where they are kicked. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 } });

const ARMED = { Xd: { part: 'charge', armed: true } };
const UNARMED = { Xd: { part: 'charge' } };
const CHARGE = { format: 1, name: 'charge', grid: ['Xd'], legend: ARMED };
const DUD = { format: 1, name: 'unarmed-charge', grid: ['Xd'], legend: UNARMED };
/** A core and a frame: something to drive past a charge. */
const CAR = { format: 1, name: 'car', grid: ['C  F'] };
const kinds = (w: World, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind);
const chargeDestroyed = (w: World): WorldEvent[] => w.events.filter((e) => e.kind === 'partDestroyed' && e.partType === 'charge');

/** Drives a car at 10 m/s along +x from x = -20, `gapY` above a charge at x = 0, for 3 s. */
async function pass(charge: unknown, opts: { team?: number; gapY?: number }): Promise<World> {
  const w = await World.create({ seed: 1, gravityY: 0 }, space);
  w.spawnBlueprint(charge, { x: 0, y: 100 });
  const car = w.spawnBlueprint(CAR, { x: -20, y: 100 + (opts.gapY ?? 0) }, { team: opts.team ?? 1 });
  w.physics.kick(car.groups[0]?.bodyId as number, 10, 0, 0);
  for (let i = 0; i < 180; i++) w.step();
  return w;
}

describe('distance charge (Batch)', () => {
  it('the def: health 60, a quarter of a shell, the heavy warhead blast, no impact fuze, radius 1.5 (Logan: at 3 m the nearest part took a quarter of a hit)', () => {
    const d = defaultRegistry().get('charge');
    expect(d).toMatchObject({ health: 60, shellDamage: 0.25, arming: true, charge: { radius: 1.5 } });
    expect(d.onDestroyed?.explode).toMatchObject({ radius: 4, damage: 250 });
    expect(d.impact).toBeUndefined();
  });

  it('armed, it goes off when an enemy drives within 1.5 m: one blast, at the radius, and the charge is gone', async () => {
    const w = await pass(CHARGE, {});
    expect(kinds(w, 'explosion')).toHaveLength(1);
    const gone = chargeDestroyed(w);
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ exploded: true });
    // The car's frame leads its core by 1 m and starts 19 m out at 10 m/s: 1.5 m out is about 1.75 s (tick 105), well before 3 s.
    expect((gone[0] as { tick: number }).tick).toBeLessThan(120);
    expect((gone[0] as { tick: number }).tick).toBeGreaterThan(40);
    w.dispose();
  });

  it('an enemy passing 5 m off does not set it off', async () => {
    const w = await pass(CHARGE, { gapY: 5 });
    expect(kinds(w, 'explosion')).toHaveLength(0);
    expect(chargeDestroyed(w)).toHaveLength(0);
    w.dispose();
  });

  it('a friend (its own team) driving over it does not set it off', async () => {
    const w = await pass(CHARGE, { team: 0 });
    expect(kinds(w, 'explosion')).toHaveLength(0);
    expect(chargeDestroyed(w)).toHaveLength(0);
    w.dispose();
  });

  it('unarmed, it never goes off', async () => {
    const w = await pass(DUD, {});
    expect(kinds(w, 'explosion')).toHaveLength(0);
    expect(chargeDestroyed(w)).toHaveLength(0);
    w.dispose();
  });

  it('arming it (the arm input) lets it go off on the next enemy that comes near', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    // The charge on the side the car comes from: behind the core it would never get within 1.5 m of it.
    const bp = { format: 1, name: 'charge', grid: ['Xd C'], legend: UNARMED, bindings: [{ key: 'a', mode: 'pulse', target: 'charge', channel: 'arm', value: 1 }] };
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
      const bp = { format: 1, name: 'charge', grid: ['C  Xd'], legend, bindings: [{ key: 'x', mode: 'pulse', target: 'charge', channel: 'detonate', value: 1 }] };
      const m = w.spawnBlueprint(bp, { x: 0, y: 100 });
      w.step([{ robot: m.id, pressed: ['x'], released: [] }]);
      const n = kinds(w, 'explosion').length;
      w.dispose();
      return n;
    };
    expect(await run(ARMED)).toBe(1);
    expect(await run(UNARMED)).toBe(0);
  });

  it('shot to pieces, an armed charge breaks without a blast', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const gun = w.spawnBlueprint(
      { format: 1, name: 'gun-car', grid: ['C  M>'], bindings: [{ key: 'f', mode: 'hold', target: 'gun', channel: 'fire', value: 1 }] },
      { x: -100, y: 0.5 },
    );
    // On the front of a car, so the shells' pushes do not skid it out of the line of fire.
    const charge = w.spawnBlueprint({ format: 1, name: 'charge-car', grid: ['Xd  C'], legend: ARMED }, { x: -80, y: 0.5 }, { team: 1 });
    for (let i = 0; i < 10; i++) w.step();
    w.step([{ robot: gun.id, pressed: ['f'], released: [] }]);
    for (let i = 0; i < 480; i++) w.step();
    const hits = w.events.filter((e) => e.kind === 'shellHit' && e.robot === charge.id);
    expect(hits.length).toBeGreaterThan(10);
    expect(hits[0]).toMatchObject({ partType: 'charge', damage: 1.25 });
    expect(chargeDestroyed(w)).toHaveLength(1);
    expect(chargeDestroyed(w)[0]).toMatchObject({ exploded: false });
    expect(kinds(w, 'explosion')).toHaveLength(0);
    w.dispose();
  });

  it('a blast next to an armed charge breaks it without setting it off (no chain)', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const bomb = w.spawnBlueprint(
      { format: 1, name: 'bomb', grid: ['C  X'], legend: { X: { part: 'warhead', armed: true } }, bindings: [{ key: 'x', mode: 'pulse', target: 'warhead', channel: 'detonate', value: 1 }] },
      { x: -100, y: 0.5 },
    );
    w.spawnBlueprint(CHARGE, { x: -97.5, y: 0.5 });
    for (let i = 0; i < 5; i++) w.step();
    w.step([{ robot: bomb.id, pressed: ['x'], released: [] }]);
    for (let i = 0; i < 5; i++) w.step();
    expect(kinds(w, 'explosion')).toHaveLength(1);
    for (const e of chargeDestroyed(w)) expect(e).toMatchObject({ exploded: false });
    w.dispose();
  });

  it('armed, a hard hit sets it off (a ram, over 10 m/s); a soft one does not, and unarmed nothing does (Logan: rammed missiles broke their charge as a dud)', async () => {
    // Dropped onto the ground: from 12 m it lands at about 15 m/s, from 2 m at about 6 m/s. The ground is no enemy, so
    // only the crash fuze can set it off.
    const drop = async (legend: Record<string, unknown>, height: number): Promise<{ blasts: number; fired: boolean }> => {
      const w = await World.create({ seed: 1 }, flat);
      w.spawnBlueprint({ format: 1, name: 'charge', grid: ['Xd C'], legend }, { x: -100, y: height });
      for (let i = 0; i < 180; i++) w.step();
      const out = { blasts: kinds(w, 'explosion').length, fired: chargeDestroyed(w).some((e) => (e as { exploded?: boolean }).exploded === true) };
      w.dispose();
      return out;
    };
    expect(await drop(ARMED, 12)).toEqual({ blasts: 1, fired: true });
    expect(await drop(ARMED, 2)).toEqual({ blasts: 0, fired: false });
    expect(await drop(UNARMED, 12)).toEqual({ blasts: 0, fired: false });
  });

  it('a "charge" block needs arming, an explosion, and a positive radius', () => {
    const raw = JSON.parse(JSON.stringify(defaultRegistry().get('charge'))) as Record<string, unknown>;
    expect(parsePartDef(raw, 'm.json').charge).toEqual({ radius: 1.5, crash: 10 });
    expect(() => parsePartDef({ ...raw, charge: { radius: 1.5, crash: 0 } }, 'm.json')).toThrow();
    expect(() => parsePartDef({ ...raw, arming: undefined }, 'm.json')).toThrow('charge');
    expect(() => parsePartDef({ ...raw, onDestroyed: undefined }, 'm.json')).toThrow('charge');
    expect(() => parsePartDef({ ...raw, charge: { radius: 0 } }, 'm.json')).toThrow();
    expect(() => parsePartDef({ ...raw, charge: { radius: 3, extra: 1 } }, 'm.json')).toThrow();
  });
});
