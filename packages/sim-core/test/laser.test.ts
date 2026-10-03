import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { parsePartDef } from '../src/parts/parsePartDef';
import { defaultRegistry } from '../src/parts/registry';
import { DEFAULT_LEGEND } from '../src/blueprint/legend';
import { SIGHT } from '../src/weapons/shells';

/** No gravity, a small ground far below, so nothing moves on its own. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 } });
const flat = parseWorldFile(flatJson);
const FIRE = [{ key: 'f', mode: 'hold', target: 'laser', channel: 'fire', value: 1 }];
/** A dense battery, a core, and a laser pointing right (base at +1, barrel at +2): F fires. */
const RIG = { format: 1, name: 'laser-rig', grid: ['Z C Lz> ='], bindings: FIRE };
/** One armor plate, nobody's. */
const PLATE = { format: 1, name: 'plate', grid: ['A'] };
const hold = (robot: number) => [{ robot, pressed: ['f'], released: [] }];
const letGo = (robot: number) => [{ robot, pressed: [], released: ['f'] }];

async function space0(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0 }, space);
}

describe('laser (M14)', () => {
  it('is a shipped part: 1 by 2, 4 kg, health 40, 600 W, legend Lz, explodes when destroyed', () => {
    const d = defaultRegistry().get('laser');
    expect(d).toMatchObject({ mass: 4, health: 40, powerDraw: 600, acts: 'N', laser: { dps: 150, range: 300 } });
    expect(d.footprint).toEqual([
      { x: 0, y: 0, faces: ['S'] },
      { x: 0, y: 1, faces: [] },
    ]);
    expect(d.onDestroyed?.explode).toEqual({ radius: 2.5, damage: 80, pushRadius: 4, push: 25, lift: 1 });
    expect(d.arming).toBeUndefined();
    expect(DEFAULT_LEGEND['Lz^']).toEqual({ part: 'laser', rot: 0 });
    expect(DEFAULT_LEGEND['Lz>']).toEqual({ part: 'laser', rot: 270 });
  });

  it('the parser wants acts, a fire input, the sight outputs, sight max = range, and the laser behavior', () => {
    const raw = JSON.parse(JSON.stringify(defaultRegistry().get('laser')));
    expect(() => parsePartDef({ ...raw, inputs: [] }, 'x.json')).toThrow('must have a "fire" input');
    expect(() => parsePartDef({ ...raw, outputs: raw.outputs.filter((o: { name: string }) => o.name !== 'sightSide') }, 'x.json')).toThrow('"sightSide" output');
    expect(() => parsePartDef({ ...raw, laser: { dps: 150, range: 200 } }, 'x.json')).toThrow('max must be its range');
    expect(() => parsePartDef({ ...raw, behavior: undefined }, 'x.json')).toThrow('"behavior": "laser"');
    expect(() => parsePartDef({ ...raw, laser: { dps: 0, range: 300 } }, 'x.json')).toThrow();
    expect(() => parsePartDef({ ...raw, laser: { dps: 150, range: 300, x: 1 } }, 'x.json')).toThrow();
  });

  it('burns the first part on its line at 150 a second, only while fire is held; armor takes it in full', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(RIG, { x: 0, y: 100 });
    const plate = w.spawnBlueprint(PLATE, { x: 50, y: 100 });
    for (let i = 0; i < 5; i++) w.step();
    expect(plate.parts.get('armorplate@0,0')?.health).toBe(250);
    expect(w.liveBeams()).toEqual([]);
    w.step(hold(rig.id));
    for (let i = 0; i < 29; i++) w.step();
    // 30 ticks of 150 / 60 = 2.5: no shell multiplier (armor plates take a tenth of a shell).
    expect(plate.parts.get('armorplate@0,0')?.health).toBeCloseTo(250 - 30 * 2.5, 6);
    const beam = w.liveBeams()[0];
    // From the barrel's end (the base at +1, the barrel at +2, its end at +2.5) to the plate's near face (+49.5).
    expect(beam).toMatchObject({ robot: rig.id, laser: 'laser@2,0', power: 1, side: SIGHT.none, hitRobot: plate.id, hitPart: 'armorplate@0,0' });
    expect(beam?.x1).toBeCloseTo(2.5, 3);
    expect(beam?.x2).toBeCloseTo(49.5, 1);
    expect(beam?.y2).toBeCloseTo(100, 3);
    w.step(letGo(rig.id));
    w.step();
    expect(w.liveBeams()).toEqual([]);
    expect(plate.parts.get('armorplate@0,0')?.health).toBeCloseTo(175, 6);
    // One laserBurn when the beam first met the plate, not one per tick.
    expect(w.events.filter((e) => e.kind === 'laserBurn')).toMatchObject([{ robot: plate.id, part: 'armorplate@0,0', partType: 'armorplate', by: rig.id, laser: 'laser@2,0' }]);
    expect(w.laserStats(rig.id)).toMatchObject({ ticks: 30 });
    expect(w.laserStats(rig.id).damage).toBeCloseTo(75, 6);
    w.dispose();
  });

  it('costs 600 W from the pool; a pool that can grant half burns half; an empty one burns nothing', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(RIG, { x: 0, y: 100 });
    const plate = w.spawnBlueprint(PLATE, { x: 50, y: 100 });
    const pool0 = w.energy(rig.id)?.stored ?? 0;
    w.step(hold(rig.id));
    for (let i = 0; i < 59; i++) w.step();
    expect(pool0 - (w.energy(rig.id)?.stored ?? 0)).toBeCloseTo(600, 3);
    // Leave 5 J for a 10 J tick: half power.
    for (const part of rig.parts.values()) if (part.stored !== undefined) part.stored = part.def.id === 'core' ? 5 : 0;
    const before = plate.parts.get('armorplate@0,0')?.health ?? 0;
    w.step();
    expect(w.liveBeams()[0]?.power).toBeCloseTo(0.5, 6);
    expect(plate.parts.get('armorplate@0,0')?.health).toBeCloseTo(before - 1.25, 6);
    w.step();
    expect(w.liveBeams()).toEqual([]);
    expect(plate.parts.get('armorplate@0,0')?.health).toBeCloseTo(before - 1.25, 6);
    // Unlimited energy: full power again.
    w.setUnlimitedEnergy(true);
    w.step();
    expect(w.liveBeams()[0]?.power).toBe(1);
    w.dispose();
  });

  it('reaches 300 m and no farther; the ground stops it', async () => {
    for (const [x, burns] of [
      [290, true],
      [310, false],
    ] as const) {
      const w = await space0();
      const rig = w.spawnBlueprint(RIG, { x: 0, y: 100 });
      const plate = w.spawnBlueprint(PLATE, { x, y: 100 });
      w.step(hold(rig.id));
      expect(plate.parts.get('armorplate@0,0')?.health, `at ${x} m`).toBe(burns ? 247.5 : 250);
      expect(w.liveBeams()[0]?.side).toBe(burns ? SIGHT.none : SIGHT.nothing);
      w.dispose();
    }
    const w = await World.create({ seed: 1 }, flat);
    const down = w.spawnBlueprint({ format: 1, name: 'down', grid: ['Z C', '. Lzv', '. ='], bindings: FIRE }, { x: 0, y: 10 });
    for (let i = 0; i < 3; i++) w.step(hold(down.id));
    expect(w.liveBeams()[0]).toMatchObject({ side: SIGHT.terrain });
    expect(w.liveBeams()[0]?.y2).toBeCloseTo(0, 1);
    expect(w.events.filter((e) => e.kind === 'laserBurn')).toEqual([]);
    w.dispose();
  });

  it('burns its own robot and friends: the turret script has to hold fire', async () => {
    const w = await space0();
    // A frame 3 m in front of the barrel, held by a row of frames under the rig.
    const own = w.spawnBlueprint({ ...RIG, grid: ['Z C Lz> = . . F', 'F F F F F F F'] }, { x: 0, y: 100 });
    for (let i = 0; i < 10; i++) w.step(i === 0 ? hold(own.id) : []);
    expect(own.parts.get('frame@6,1')?.health).toBeCloseTo(60 - 10 * 2.5, 6);
    expect(w.liveBeams()[0]?.side).toBe(SIGHT.own);
    w.dispose();
  });

  it('each smoke cloud the beam crosses halves it', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(RIG, { x: 0, y: 100 });
    const plate = w.spawnBlueprint(PLATE, { x: 100, y: 100 });
    // Two pods 8 m above the line (their clouds are 12 m): the line crosses both clouds, the pods are clear of it.
    const POD = { format: 1, name: 'pod', grid: ['C U'], bindings: [{ key: 's', mode: 'hold', target: 'smoke', channel: 'on', value: 1 }] };
    const a = w.spawnBlueprint(POD, { x: 30, y: 108 });
    const b = w.spawnBlueprint(POD, { x: 70, y: 108 });
    w.step([
      { robot: a.id, pressed: ['s'], released: [] },
      { robot: b.id, pressed: ['s'], released: [] },
    ]);
    expect(w.smokeClouds().length).toBe(2);
    w.step(hold(rig.id));
    expect(plate.parts.get('armorplate@0,0')?.health).toBeCloseTo(250 - 2.5 / 4, 6);
    expect(w.liveBeams()[0]).toMatchObject({ smoke: 2 });
    w.dispose();
  });

  it('an armed warhead burnt to 0 explodes; an unarmed one breaks', async () => {
    for (const armed of [true, false]) {
      const w = await space0();
      const rig = w.spawnBlueprint(RIG, { x: 0, y: 100 });
      w.spawnBlueprint({ format: 1, name: 'mine', grid: ['x'], legend: { x: { part: 'warhead', armed } } }, { x: 40, y: 100 });
      w.step(hold(rig.id));
      for (let i = 0; i < 10; i++) w.step();
      // Health 20 at 2.5 a tick: gone on the 8th tick, and no impact fuze (a beam is heat, not a knock).
      expect(w.events.filter((e) => e.kind === 'partDestroyed')).toMatchObject([{ partType: 'warhead', exploded: armed }]);
      expect(w.events.find((e) => e.kind === 'partDestroyed')?.tick).toBe(7);
      w.dispose();
    }
  });

  it('a laser destroyed explodes, and sets off the laser next to it', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(RIG, { x: 0, y: 100 });
    // Two lasers side by side pointing up, nobody's: the beam meets the left one's base.
    w.spawnBlueprint({ format: 1, name: 'pair', grid: ['= =', 'Lz^ Lz^', 'F F'] }, { x: 40, y: 99 });
    w.step(hold(rig.id));
    for (let i = 0; i < 40; i++) w.step();
    const gone = w.events.filter((e) => e.kind === 'partDestroyed' && e.partType === 'laser');
    expect(gone.length).toBe(2);
    expect(gone.every((e) => e.kind === 'partDestroyed' && e.exploded)).toBe(true);
    expect(w.events.filter((e) => e.kind === 'explosion').length).toBe(2);
    w.dispose();
  });

  it('a wreck (no core in charge) burns nothing', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(RIG, { x: 0, y: 100 });
    const plate = w.spawnBlueprint(PLATE, { x: 50, y: 100 });
    w.step(hold(rig.id));
    const core = rig.parts.get('core@1,0');
    if (!core) throw new Error('no core');
    core.health = 0;
    w.step();
    const left = plate.parts.get('armorplate@0,0')?.health;
    for (let i = 0; i < 10; i++) w.step();
    expect(plate.parts.get('armorplate@0,0')?.health).toBe(left);
    expect(w.liveBeams()).toEqual([]);
    w.dispose();
  });

  it('its sight reads like a gun: enemy, and aim along the barrel', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(RIG, { x: 0, y: 100 });
    const enemy = w.spawnBlueprint({ format: 1, name: 'enemy', grid: ['C F'] }, { x: 80, y: 100 }, { team: 1 });
    w.step();
    expect(w.partOutput(rig.id, 'laser@2,0', 'sightSide')).toBe(SIGHT.enemy);
    expect(w.partOutput(rig.id, 'laser@2,0', 'sightId')).toBe(enemy.id);
    expect(w.partOutput(rig.id, 'laser@2,0', 'sight')).toBeCloseTo(80 - 0.5 - 2.5, 1);
    expect(w.partOutput(rig.id, 'laser@2,0', 'aim')).toBeCloseTo(0, 6);
    w.dispose();
  });

  it('runs the same twice', async () => {
    const run = async (): Promise<string> => {
      const w = await World.create({ seed: 3 }, flat);
      const rig = w.spawnBlueprint(RIG, { x: -50, y: 0.5 });
      w.spawnBlueprint({ format: 1, name: 'pair', grid: ['= =', 'Lz^ Lz^', 'F F'] }, { x: 0, y: 0.5 });
      w.step(hold(rig.id));
      for (let i = 0; i < 120; i++) w.step();
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });
});
