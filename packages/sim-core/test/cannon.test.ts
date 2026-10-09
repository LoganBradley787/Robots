import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot, PartInstance } from '../src/world/Robot';
import { parsePartDef } from '../src/parts/parsePartDef';
import { defaultRegistry } from '../src/parts/registry';
import { DEFAULT_LEGEND } from '../src/blueprint/legend';
import { SIGHT } from '../src/weapons/shells';
import { WIND } from '../src/behaviors/cannon';
import { buildReplay, parseReplay, runReplay } from '../src/replay/replayFile';

/** No gravity, a small ground far below, so nothing moves on its own. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 } });
const flat = parseWorldFile(flatJson);
const fire = (target: string) => [{ key: 'f', mode: 'hold', target, channel: 'fire', value: 1 }];
/** Two dense batteries, a core, and a lance pointing right (cells +1 to +4, its barrel's end at +4.5): F charges. */
const LANCE = { format: 1, name: 'lance-rig', grid: ['Z Z C Ln> = = ='], bindings: fire('lance') };
/**
 * The same with a cannon: two wide, four long, pointing right. Its cells are +1 to +4 on the core's row and the row
 * below, so its barrel's end is at +4.5, half a cell below the core's row.
 */
const CANNON = { format: 1, name: 'cannon-rig', grid: ['Z Z C Cn> = = =', 'Z Z F =   = = ='], bindings: fire('cannon') };
const hold = (robot: number) => [{ robot, pressed: ['f'], released: [] }];
const letGo = (robot: number) => [{ robot, pressed: [], released: ['f'] }];
const gunOf = (r: Robot): PartInstance => {
  const p = [...r.parts.values()].find((q) => q.def.cannon !== undefined);
  if (!p) throw new Error('no charged gun');
  return p;
};
const stored = (w: World, r: Robot): number => w.energy(r.id)?.stored ?? 0;
const charged = (w: World, r: Robot): number => w.partOutput(r.id, gunOf(r).id, 'charged') ?? -1;
const steps = (w: World, n: number): void => {
  for (let i = 0; i < n; i++) w.step();
};

async function space0(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0 }, space);
}

/** Charges a rig's gun to full: the hold, then the rest of its charge time. */
function chargeUp(w: World, rig: Robot): void {
  w.step(hold(rig.id));
  steps(w, Math.round((gunOf(rig).def.cannon?.charge ?? 0) * 60) - 1);
}

describe('charged guns (M15): the cannon and the lance', () => {
  it('are shipped parts: the cannon 2 by 4 and 40 kg, the lance 1 by 4 and everything twice as quick, both explode', () => {
    const c = defaultRegistry().get('cannon');
    expect(c).toMatchObject({ mass: 40, health: 150, powerDraw: 1000, acts: 'N', behavior: 'cannon' });
    expect(c.cannon).toEqual({ charge: 6, hold: 4, dead: 4, damage: 500, speed: 300, width: 1.5, life: 2, range: 250, recoil: 800, backfire: 80 });
    expect(c.footprint).toHaveLength(8);
    expect(c.footprint.filter((f) => f.faces.length > 0)).toEqual([
      { x: 0, y: 0, faces: ['S'] },
      { x: 1, y: 0, faces: ['S'] },
    ]);
    const l = defaultRegistry().get('lance');
    expect(l).toMatchObject({ mass: 15, health: 60, powerDraw: 1000, acts: 'N', behavior: 'cannon' });
    expect(l.cannon).toEqual({ charge: 3, hold: 2, dead: 2, damage: 250, speed: 600, width: 0, life: 2, range: 400, recoil: 300, backfire: 30 });
    expect(l.footprint.map((f) => [f.x, f.y])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    expect(c.onDestroyed?.explode).toBeDefined();
    expect(l.onDestroyed?.explode).toBeDefined();
    expect(DEFAULT_LEGEND['Cn^']).toEqual({ part: 'cannon', rot: 0 });
    expect(DEFAULT_LEGEND['Ln>']).toEqual({ part: 'lance', rot: 270 });
  });

  it('the parser wants acts, the cannon behavior, a fire input, the sight outputs and charged, sight max = range, a power draw', () => {
    const raw = JSON.parse(JSON.stringify(defaultRegistry().get('lance')));
    expect(() => parsePartDef({ ...raw, inputs: [] }, 'x.json')).toThrow('must have a "fire" input');
    expect(() => parsePartDef({ ...raw, outputs: raw.outputs.filter((o: { name: string }) => o.name !== 'charged') }, 'x.json')).toThrow('"charged" output');
    expect(() => parsePartDef({ ...raw, outputs: raw.outputs.filter((o: { name: string }) => o.name !== 'sightId') }, 'x.json')).toThrow('"sightId" output');
    expect(() => parsePartDef({ ...raw, cannon: { ...raw.cannon, range: 200 } }, 'x.json')).toThrow('max must be its range');
    expect(() => parsePartDef({ ...raw, behavior: undefined }, 'x.json')).toThrow('"behavior": "cannon"');
    expect(() => parsePartDef({ ...raw, cannon: undefined }, 'x.json')).toThrow('needs a "cannon" block');
    expect(() => parsePartDef({ ...raw, powerDraw: 0 }, 'x.json')).toThrow('"powerDraw" above 0');
    expect(() => parsePartDef({ ...raw, acts: undefined }, 'x.json')).toThrow('needs "acts"');
    expect(() => parsePartDef({ ...raw, cannon: { ...raw.cannon, charge: 0 } }, 'x.json')).toThrow();
    expect(() => parsePartDef({ ...raw, cannon: { ...raw.cannon, width: -1 } }, 'x.json')).toThrow('0 to 10 meters');
    expect(() => parsePartDef({ ...raw, cannon: { ...raw.cannon, x: 1 } }, 'x.json')).toThrow();
    expect(() => parsePartDef({ ...raw, laser: { dps: 1, range: 400 } }, 'x.json')).toThrow();
  });

  it('charges only while fire is held: 3 s and 3000 J for the lance, then it is full', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(LANCE, { x: 0, y: 100 });
    steps(w, 30);
    const pool0 = stored(w, rig);
    expect(charged(w, rig)).toBe(0);
    w.step(hold(rig.id));
    steps(w, 89);
    expect(charged(w, rig)).toBeCloseTo(0.5, 6);
    expect(gunOf(rig).wind?.phase).toBe(WIND.charging);
    expect(pool0 - stored(w, rig)).toBeCloseTo(1500, 3);
    steps(w, 89);
    expect(gunOf(rig).wind?.phase).toBe(WIND.charging);
    w.step();
    expect(charged(w, rig)).toBe(1);
    expect(gunOf(rig).wind?.phase).toBe(WIND.full);
    expect(pool0 - stored(w, rig)).toBeCloseTo(3000, 3);
    // Held full it costs nothing more (Logan: charging is where the energy is).
    steps(w, 60);
    expect(pool0 - stored(w, rig)).toBeCloseTo(3000, 3);
    expect(w.liveBolts()).toEqual([]);
    w.dispose();
  });

  it('the cannon takes 6 s and 6000 J', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(CANNON, { x: 0, y: 100 });
    steps(w, 5);
    const pool0 = stored(w, rig);
    w.step(hold(rig.id));
    steps(w, 358);
    expect(gunOf(rig).wind?.phase).toBe(WIND.charging);
    w.step();
    expect(gunOf(rig).wind?.phase).toBe(WIND.full);
    expect(pool0 - stored(w, rig)).toBeCloseTo(6000, 3);
    w.dispose();
  });

  it('let go early, it drains at the rate it charged, gives the energy back, and cannot start again until it is empty', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(LANCE, { x: 0, y: 100 });
    steps(w, 5);
    const pool0 = stored(w, rig);
    w.step(hold(rig.id));
    steps(w, 119);
    expect(charged(w, rig)).toBeCloseTo(2 / 3, 6);
    expect(pool0 - stored(w, rig)).toBeCloseTo(2000, 3);
    w.step(letGo(rig.id));
    expect(gunOf(rig).wind?.phase).toBe(WIND.draining);
    steps(w, 30);
    // Half a second of the two it has to drain: a quarter of what it took is back.
    expect(charged(w, rig)).toBeCloseTo(2 / 3 - 0.5 / 3, 6);
    expect(pool0 - stored(w, rig)).toBeCloseTo(1500, 3);
    // Holding fire again changes nothing while it drains (Logan: no keeping it at 5.5 s).
    w.step(hold(rig.id));
    steps(w, 59);
    expect(gunOf(rig).wind?.phase).toBe(WIND.draining);
    expect(charged(w, rig)).toBeCloseTo(2 / 3 - 1.5 / 3, 6);
    steps(w, 30);
    // Empty after 2 s of draining: every joule is back, and with fire still held it starts over on the next tick. No dead time.
    expect(gunOf(rig).wind?.phase).toBe(WIND.idle);
    expect(pool0 - stored(w, rig)).toBeCloseTo(0, 3);
    w.step();
    expect(gunOf(rig).wind?.phase).toBe(WIND.charging);
    expect(charged(w, rig)).toBeLessThan(0.02);
    expect(pool0 - stored(w, rig)).toBeLessThan(40);
    expect(w.events.filter((e) => e.kind === 'cannonFire' || e.kind === 'cannonBackfire')).toEqual([]);
    w.dispose();
  });

  it('a brownout charges it slower, and an empty pool drains it (the energy flows back)', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(LANCE, { x: 0, y: 100 });
    steps(w, 5);
    const setPool = (joules: number): void => {
      let first = true;
      for (const part of rig.parts.values()) {
        if (part.stored === undefined) continue;
        part.stored = first ? joules : 0;
        first = false;
      }
    };
    // Half of what one tick of charging asks for (1000 J/s over a 60th of a second), ten ticks running.
    w.step(hold(rig.id));
    const after1 = charged(w, rig);
    for (let i = 0; i < 10; i++) {
      setPool(1000 / 60 / 2);
      w.step();
    }
    expect((charged(w, rig) - after1) * 3).toBeCloseTo((10 / 60) * 0.5, 6);
    expect(gunOf(rig).wind?.phase).toBe(WIND.charging);
    setPool(0);
    w.step();
    expect(gunOf(rig).wind?.phase).toBe(WIND.draining);
    const level = charged(w, rig);
    steps(w, 5);
    expect(charged(w, rig)).toBeLessThan(level);
    expect(stored(w, rig)).toBeCloseTo((5 * 1000) / 60, 3);
    w.dispose();
  });

  it('full, letting go fires one bolt out of the barrel and kicks the gun back; then it is dead for 2 s', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(LANCE, { x: 0, y: 100 });
    steps(w, 5);
    chargeUp(w, rig);
    expect(gunOf(rig).wind?.phase).toBe(WIND.full);
    w.step(letGo(rig.id));
    expect(w.liveBolts()).toHaveLength(1);
    const bolt = w.liveBolts()[0];
    // From the barrel's end (+4.5), one tick of 600 m/s on.
    expect(bolt).toMatchObject({ robot: rig.id, gun: gunOf(rig).id, damage: 250, left: 250, width: 0 });
    expect(bolt?.px).toBeCloseTo(4.5, 3);
    expect(bolt?.x).toBeCloseTo(14.5, 3);
    expect(bolt?.y).toBeCloseTo(100, 6);
    expect(bolt?.vx).toBeCloseTo(600, 3);
    expect(w.events.filter((e) => e.kind === 'cannonFire')).toMatchObject([{ robot: rig.id, part: gunOf(rig).id, partType: 'lance' }]);
    expect(w.cannonStats(rig.id)).toEqual({ shots: 1, backfires: 0, damage: 0 });
    expect(gunOf(rig).wind?.phase).toBe(WIND.dead);
    expect(charged(w, rig)).toBe(0);
    w.step();
    // 300 N s on the whole rig, pushed back along the barrel.
    const body = rig.groups[0]?.bodyId as number;
    const mass = w.physics.massProperties(body).mass;
    expect(w.physics.state(body).vx).toBeCloseTo(-300 / mass, 3);
    // Dead: holding fire does nothing for 2 s, then it charges again.
    w.step(hold(rig.id));
    steps(w, 110);
    expect(charged(w, rig)).toBe(0);
    expect(w.liveBolts()).toHaveLength(1);
    steps(w, 20);
    expect(charged(w, rig)).toBeGreaterThan(0);
    // The bolt flew its 2 s and is gone.
    expect(w.liveBolts()).toEqual([]);
    w.dispose();
  });

  it('held full past its hold it backfires: a small push, an event, nothing fired, then dead', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(LANCE, { x: 0, y: 100 });
    steps(w, 5);
    chargeUp(w, rig);
    steps(w, 120);
    expect(gunOf(rig).wind?.phase).toBe(WIND.full);
    expect(w.events.filter((e) => e.kind === 'cannonBackfire')).toEqual([]);
    w.step();
    expect(w.events.filter((e) => e.kind === 'cannonBackfire')).toMatchObject([{ robot: rig.id, part: gunOf(rig).id, partType: 'lance' }]);
    expect(gunOf(rig).wind?.phase).toBe(WIND.dead);
    expect(w.liveBolts()).toEqual([]);
    expect(w.cannonStats(rig.id)).toEqual({ shots: 0, backfires: 1, damage: 0 });
    w.step();
    const body = rig.groups[0]?.bodyId as number;
    expect(w.physics.state(body).vx).toBeCloseTo(-30 / w.physics.massProperties(body).mass, 3);
    // Fire is still held: nothing for the 2 s it is dead, then it charges again.
    steps(w, 110);
    expect(charged(w, rig)).toBe(0);
    steps(w, 20);
    expect(gunOf(rig).wind?.phase).toBe(WIND.charging);
    w.dispose();
  });

  it('a lance bolt takes a fresh heavy plate in full and stops there: no shell resistance, the plate behind is untouched', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(LANCE, { x: 0, y: 100 });
    const plates = w.spawnBlueprint({ format: 1, name: 'plates', grid: ['A A'] }, { x: 50, y: 100 });
    steps(w, 5);
    chargeUp(w, rig);
    w.step(letGo(rig.id));
    steps(w, 10);
    const hits = w.events.filter((e) => e.kind === 'boltHit');
    expect(hits).toMatchObject([{ part: 'armorplate@0,0', partType: 'armorplate', by: rig.id, damage: 250 }]);
    expect(hits[0]).toMatchObject({ robot: plates.id });
    const all = w.robots.flatMap((r) => [...r.parts.values()]).filter((p) => p.def.id === 'armorplate');
    expect(all.map((p) => p.health)).toEqual([250]);
    expect(w.liveBolts()).toEqual([]);
    expect(w.cannonStats(rig.id).damage).toBe(250);
    w.dispose();
  });

  it('through lighter parts it carries on with what is left: four frames gone, the fifth scratched', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(LANCE, { x: 0, y: 100 });
    const row = w.spawnBlueprint({ format: 1, name: 'row', grid: ['F F F F F F'] }, { x: 50, y: 100 });
    steps(w, 5);
    chargeUp(w, rig);
    w.step(letGo(rig.id));
    steps(w, 10);
    expect(w.events.filter((e) => e.kind === 'boltHit').map((e) => (e.kind === 'boltHit' ? [e.part, e.damage] : []))).toEqual([
      ['frame@0,0', 60], ['frame@1,0', 60], ['frame@2,0', 60], ['frame@3,0', 60], ['frame@4,0', 10],
    ]);
    const left = w.robots.flatMap((r) => [...r.parts.values()]).filter((p) => p.def.id === 'frame').map((p) => p.health).sort((a, b) => a - b);
    expect(left).toEqual([50, 60]);
    expect(row.parts.size).toBeLessThanOrEqual(2);
    w.dispose();
  });

  it('just does its damage: a part with more health than the bolt has left survives and stops it', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(LANCE, { x: 0, y: 100 });
    w.spawnBlueprint({ format: 1, name: 'wall', grid: ['F A F'] }, { x: 50, y: 100 });
    steps(w, 5);
    chargeUp(w, rig);
    w.step(letGo(rig.id));
    steps(w, 10);
    // 60 for the frame, the other 190 into the plate, which keeps 60 and stops the bolt.
    expect(w.events.filter((e) => e.kind === 'boltHit').map((e) => (e.kind === 'boltHit' ? [e.partType, e.damage] : []))).toEqual([['frame', 60], ['armorplate', 190]]);
    const parts = w.robots.flatMap((r) => [...r.parts.values()]);
    expect(parts.find((p) => p.def.id === 'armorplate')?.health).toBe(60);
    expect(parts.filter((p) => p.def.id === 'frame').map((p) => p.health)).toEqual([60]);
    w.dispose();
  });

  it('the cannon fires from the middle of its two barrel cells and breaks two heavy plates side by side', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(CANNON, { x: 0, y: 100 });
    // Two plates deep, two high: rows 100 and 99, the cannon's two rows.
    w.spawnBlueprint({ format: 1, name: 'block', grid: ['A A', 'A A'] }, { x: 50, y: 100 });
    steps(w, 5);
    chargeUp(w, rig);
    w.step(letGo(rig.id));
    const bolt = w.liveBolts()[0];
    expect(bolt).toMatchObject({ damage: 500, left: 500, width: 1.5 });
    expect(bolt?.px).toBeCloseTo(4.5, 3);
    expect(bolt?.py).toBeCloseTo(99.5, 3);
    expect(bolt?.vx).toBeCloseTo(300, 3);
    steps(w, 20);
    const hits = w.events.filter((e) => e.kind === 'boltHit');
    expect(hits.map((e) => (e.kind === 'boltHit' ? [e.part, e.damage] : []))).toEqual([['armorplate@0,0', 250], ['armorplate@0,1', 250]]);
    const plates = w.robots.flatMap((r) => [...r.parts.values()]).filter((p) => p.def.id === 'armorplate');
    expect(plates.map((p) => p.health)).toEqual([250, 250]);
    expect(w.liveBolts()).toEqual([]);
    w.step();
    const body = rig.groups[0]?.bodyId as number;
    expect(w.physics.state(body).vx).toBeLessThan(0);
    w.dispose();
  });

  it('the cannon carves a hole two wide through frames: eight gone and the ninth scratched', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(CANNON, { x: 0, y: 100 });
    w.spawnBlueprint({ format: 1, name: 'slab', grid: ['F F F F F F', 'F F F F F F', 'F F F F F F', 'F F F F F F'] }, { x: 50, y: 101 });
    steps(w, 5);
    chargeUp(w, rig);
    w.step(letGo(rig.id));
    steps(w, 20);
    const hits = w.events.filter((e) => e.kind === 'boltHit').map((e) => (e.kind === 'boltHit' ? e : undefined));
    expect(hits.map((e) => e?.damage)).toEqual([60, 60, 60, 60, 60, 60, 60, 60, 20]);
    // Only the two middle rows (the slab's rows 1 and 2 from the bottom are at 99 and 100), four columns deep.
    expect(new Set(hits.map((e) => e?.part.split(',')[1]))).toEqual(new Set(['1', '2']));
    w.dispose();
  });

  it('terrain stops a bolt, a bolt hits its own robot but never its own gun, and an armed warhead on the way goes off', async () => {
    const w = await World.create({ seed: 1 }, parseWorldFile({ name: 'pad', ground: { width: 400, thickness: 2 }, spawn: { x: 0, y: 5 } }));
    // Pointing down at the ground from 20 m up, held by nothing: it falls as it charges, so it is unlimited and quick.
    const down = w.spawnBlueprint({ format: 1, name: 'down', grid: ['C', 'Lnv', '=', '=', '='], bindings: fire('lance') }, { x: 0, y: 400 });
    w.setUnlimitedEnergy(true);
    chargeUp(w, down);
    w.step(letGo(down.id));
    steps(w, 120);
    expect(w.liveBolts()).toEqual([]);
    expect(w.events.filter((e) => e.kind === 'boltHit')).toEqual([]);
    w.dispose();

    const s = await space0();
    // A frame of its own robot in front of the barrel (joined round the side), then an armed warhead of nobody's.
    const own = s.spawnBlueprint({ format: 1, name: 'own', grid: ['F F F F F F F F F', 'Z Z C Ln> = = = . F'], bindings: fire('lance') }, { x: 0, y: 100 });
    s.spawnBlueprint({ format: 1, name: 'bomb', grid: ['X'], legend: { X: { part: 'warhead', armed: true } } }, { x: 30, y: 100 });
    steps(s, 5);
    chargeUp(s, own);
    s.step(letGo(own.id));
    steps(s, 10);
    const hits = s.events.filter((e) => e.kind === 'boltHit').map((e) => (e.kind === 'boltHit' ? [e.robot === own.id, e.partType, e.damage] : []));
    expect(hits).toEqual([[true, 'frame', 60], [false, 'warhead', 20]]);
    expect(s.events.filter((e) => e.kind === 'explosion')).toHaveLength(1);
    s.dispose();
  });

  it('a wide orb skims the ground: only its middle meeting terrain stops it', async () => {
    const w = await World.create({ seed: 1 }, flat);
    // On the ground, barrel 1 m up. Over 100 m the orb drops half a meter: its lower edge is under the ground for the
    // last stretch, its middle is not.
    const rig = w.spawnBlueprint(CANNON, { x: -300, y: 1.5 });
    const plate = w.spawnBlueprint({ format: 1, name: 'plate', grid: ['A'] }, { x: -200, y: 0.5 }, { team: 1 });
    w.setUnlimitedEnergy(true);
    steps(w, 30);
    chargeUp(w, rig);
    w.step(letGo(rig.id));
    steps(w, 40);
    expect(w.events.filter((e) => e.kind === 'boltHit')).toMatchObject([{ robot: plate.id, partType: 'armorplate', damage: 250 }]);
    // The rest of it flew on and dug into the ground past the plate.
    expect(w.liveBolts()).toEqual([]);
    w.dispose();
  });

  it('its sight reads like a gun\'s, from the middle of the barrel, out to its range', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(CANNON, { x: 0, y: 100 });
    const gun = gunOf(rig).id;
    expect(w.partOutput(rig.id, gun, 'sight')).toBe(250);
    w.spawnBlueprint({ format: 1, name: 'target', grid: ['C'] }, { x: 100, y: 99.5 }, { team: 1 });
    steps(w, 2);
    expect(w.partOutput(rig.id, gun, 'sightSide')).toBe(SIGHT.enemy);
    expect(w.partOutput(rig.id, gun, 'sight')).toBeCloseTo(100 - 0.49 - 4.5, 2);
    expect(w.partOutput(rig.id, gun, 'aim')).toBeCloseTo(0, 6);
    w.dispose();
  });

  it('a wreck cannot fire: a charge in progress drains, a full one backfires', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(LANCE, { x: 0, y: 100 });
    steps(w, 5);
    chargeUp(w, rig);
    const gun = gunOf(rig);
    const core = [...rig.parts.values()].find((p) => p.def.id === 'core');
    if (core) core.health = 0;
    steps(w, 125);
    expect(w.events.filter((e) => e.kind === 'cannonBackfire')).toHaveLength(1);
    expect(w.events.filter((e) => e.kind === 'cannonFire')).toEqual([]);
    expect(gun.wind?.phase).toBe(WIND.dead);
    w.dispose();
  });

  it('Unlimited energy charges it in full and costs nothing', async () => {
    const w = await space0();
    const rig = w.spawnBlueprint(LANCE, { x: 0, y: 100 });
    w.setUnlimitedEnergy(true);
    steps(w, 2);
    const pool0 = stored(w, rig);
    chargeUp(w, rig);
    expect(gunOf(rig).wind?.phase).toBe(WIND.full);
    expect(stored(w, rig)).toBe(pool0);
    w.dispose();
  });

  it('is hashed only when present, and runs the same twice and on a replay', async () => {
    const run = async (): Promise<{ hash: string; w: World }> => {
      // On the ground with gravity on, well left of the flat world's boxes.
      const w = await World.create({ seed: 1 }, flat);
      const rig = w.spawnBlueprint(CANNON, { x: -200, y: 1.5 });
      w.spawnBlueprint({ format: 1, name: 'slab', grid: ['F F F', 'F A F', 'F F F'] }, { x: -140, y: 2.5 }, { team: 1 });
      steps(w, 5);
      chargeUp(w, rig);
      w.step(letGo(rig.id));
      steps(w, 3);
      const mid = w.hash();
      steps(w, 60);
      return { hash: `${mid}:${w.hash()}`, w };
    };
    const a = await run();
    const b = await run();
    expect(a.hash).toBe(b.hash);
    expect(a.w.events.filter((e) => e.kind === 'boltHit').length).toBeGreaterThan(2);
    const again = await runReplay(parseReplay(JSON.parse(JSON.stringify(buildReplay(a.w)))));
    expect(again.matches).toBe(true);
    expect(again.hash).toBe(a.w.hash());
    again.world.dispose();
    a.w.dispose();
    b.w.dispose();
  });
});
