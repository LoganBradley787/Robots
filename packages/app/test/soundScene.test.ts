import { describe, expect, it } from 'vitest';
import { World, parseWorldFile, type WorldEvent } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import { LoopBank } from '../src/audio/loops';
import { soundsFor } from '../src/audio/SoundScene';
import { ONE_SHOTS } from '../src/audio/oneShots';

const flat = parseWorldFile(flatJson);
const metal = (): string => 'metal';

describe('what an event sounds like (M15)', () => {
  const base = { tick: 1, robot: 1 };

  it('a blast by its size, and it always plays', () => {
    const small = soundsFor({ ...base, kind: 'explosion', x: 0, y: 0, radius: 2.5 }, metal);
    const large = soundsFor({ ...base, kind: 'explosion', x: 0, y: 0, radius: 8 }, metal);
    expect(small).toEqual([{ name: 'explosion.small', gain: expect.any(Number), rate: 1, must: true }]);
    expect(large[0]?.name).toBe('explosion.large');
    expect(large[0]?.gain).toBeGreaterThan(small[0]?.gain ?? 0);
  });

  it('a part breaking and a shell landing, by the part\'s material', () => {
    const broke: WorldEvent = { ...base, kind: 'partDestroyed', part: 'a', partType: 'armorplate', x: 0, y: 0, exploded: false };
    expect(soundsFor(broke, () => 'armor').map((s) => s.name)).toEqual(['break.armor']);
    expect(soundsFor({ ...base, kind: 'shellHit', part: 'a', partType: 'battery', by: 2, x: 0, y: 0, damage: 5 }, () => 'soft').map((s) => s.name)).toEqual(['hit.soft']);
  });

  it('a part that exploded or burnt out makes no breaking sound', () => {
    const broke = { ...base, kind: 'partDestroyed' as const, part: 'a', partType: 'warhead', x: 0, y: 0 };
    expect(soundsFor({ ...broke, exploded: true }, metal)).toEqual([]);
    expect(soundsFor({ ...broke, exploded: false, burntOut: true }, metal)).toEqual([]);
  });

  it('a hit thuds: louder when harder, lower when heavier, with a rattle when hard', () => {
    const hit = (dv: number, mass: number) => soundsFor({ ...base, kind: 'impact', x: 0, y: 0, dv, mass }, metal);
    expect(hit(3, 10).map((s) => s.name)).toEqual(['thud']);
    expect(hit(12, 10).map((s) => s.name)).toEqual(['thud', 'rattle']);
    expect(hit(12, 10)[0]?.gain).toBeGreaterThan(hit(3, 10)[0]?.gain ?? 0);
    expect(hit(5, 400)[0]?.rate).toBeLessThan(hit(5, 2)[0]?.rate ?? 0);
    expect(hit(5, 400)[0]?.gain).toBeGreaterThan(hit(5, 2)[0]?.gain ?? 0);
  });

  it('events with no sound make none, and every sound named exists', () => {
    expect(soundsFor({ ...base, kind: 'coreLost' }, metal)).toEqual([]);
    const all = [
      ...soundsFor({ ...base, kind: 'explosion', x: 0, y: 0, radius: 1 }, metal),
      ...soundsFor({ ...base, kind: 'explosion', x: 0, y: 0, radius: 3 }, metal),
      ...soundsFor({ ...base, kind: 'explosion', x: 0, y: 0, radius: 9 }, metal),
      ...soundsFor({ ...base, kind: 'decoupled', part: 'd', x: 0, y: 0 }, metal),
      ...soundsFor({ ...base, kind: 'impact', x: 0, y: 0, dv: 20, mass: 5 }, metal),
      ...['metal', 'armor', 'soft'].flatMap((m) => soundsFor({ ...base, kind: 'shellHit', part: 'a', partType: 'x', by: 2, x: 0, y: 0, damage: 5 }, () => m)),
      ...['metal', 'armor', 'soft'].flatMap((m) => soundsFor({ ...base, kind: 'partDestroyed', part: 'a', partType: 'x', x: 0, y: 0, exploded: false }, () => m)),
    ];
    for (const s of all) expect(Object.keys(ONE_SHOTS)).toContain(s.name);
  });
});

describe('what a robot\'s parts sound like (M15)', () => {
  const CAR = { format: 1, name: 'car', grid: ['F  C  B  F', 'W  .  .  W'] };

  it('a parked car is silent; driving, its wheels are one group that touches the ground', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(CAR, { x: -300, y: 1.5 });
    const bank = new LoopBank();
    for (let i = 0; i < 60; i++) w.step();
    expect(bank.groupsOf(w)).toEqual([]);
    for (let i = 0; i < 120; i++) w.step(i === 0 ? [{ robot: car.id, pressed: ['a'], released: [] }] : []);
    const groups = bank.groupsOf(w);
    expect(groups.map((g) => g.key)).toEqual([`${car.id}:wheel`]);
    expect(groups[0]?.on).toBe(2);
    expect(groups[0]?.sum).toBeGreaterThan(0.2);
    expect(groups[0]?.grip).toBe(2);
    expect(groups[0]?.x).toBeLessThan(-300);
    w.dispose();
  });

  it('propellers sound by their throttle, and not once the energy is gone', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const drone = w.spawnBlueprint({ format: 1, name: 'drone', grid: ['P  P  P', 'F  C  F'] }, { x: -300, y: 1 });
    const bank = new LoopBank();
    w.setUnlimitedEnergy(true);
    w.step([{ robot: drone.id, pressed: ['w'], released: [] }]);
    w.step();
    const groups = bank.groupsOf(w);
    expect(groups.map((g) => `${g.key} ${g.on} ${g.sum}`)).toEqual([`${drone.id}:propeller 3 3`]);
    // The core's own little store runs dry: with the sandbox switch off there is then nothing to spin them.
    w.setUnlimitedEnergy(false);
    for (let i = 0; i < 60 * 30 && (w.energy(drone.id)?.stored ?? 0) > 0; i++) w.step();
    expect(w.energy(drone.id)?.stored).toBe(0);
    expect(bank.groupsOf(w)).toEqual([]);
    w.dispose();
  });

  it('a part lost is no longer heard', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const drone = w.spawnBlueprint({ format: 1, name: 'drone', grid: ['P  P  P', 'F  C  F'] }, { x: -300, y: 1 });
    const bank = new LoopBank();
    w.setUnlimitedEnergy(true);
    w.step([{ robot: drone.id, pressed: ['w'], released: [] }]);
    w.step();
    expect(bank.groupsOf(w)[0]?.on).toBe(3);
    const first = [...drone.parts.values()].find((p) => p.def.id === 'propeller');
    if (first) first.health = 0;
    w.step();
    w.step();
    expect(bank.groupsOf(w)[0]?.on).toBe(2);
    w.dispose();
  });
});
