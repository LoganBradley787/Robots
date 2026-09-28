import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { SIGHT } from '../src/weapons/shells';

const flat = parseWorldFile(flatJson);
const hold = (robot: number, key: string) => [{ robot, pressed: [key], released: [] }];
const FIRE = [{ key: 'f', mode: 'hold', target: 'gun', channel: 'fire', value: 1 }];
/** A core with a gun on its right, pointing right: F fires. */
const GUN_CAR = { format: 1, name: 'gun-car', grid: ['C M>'], bindings: FIRE };
/** A post of three frames, nobody's. */
const POST = { format: 1, name: 'post', grid: ['F', 'F', 'F'] };
const ENEMY_CAR = { format: 1, name: 'target', grid: ['C F'] };

describe('guns (M13)', () => {
  it('fires 10 shells a second while fire is held, out of the barrel at about 300 m/s', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(GUN_CAR, { x: -100, y: 0.5 });
    for (let i = 0; i < 5; i++) w.step();
    expect(w.shotsBy(car.id)).toBe(0);
    w.step(hold(car.id, 'f'));
    const first = w.liveShells()[0];
    expect(first?.vx).toBeCloseTo(300, 3);
    // It left the barrel's end (x -98.5) and flew one tick.
    expect(first?.px).toBeCloseTo(-98.5, 2);
    expect(first?.x).toBeCloseTo(-98.5 + 5, 2);
    for (let i = 0; i < 59; i++) w.step();
    // The tick F went down, then every 6 ticks: 0, 6, ..., 54.
    expect(w.shotsBy(car.id)).toBe(10);
    w.dispose();
  });

  it('a shell falls under gravity and is gone after 1 s', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(GUN_CAR, { x: -150, y: 300 });
    w.step(hold(car.id, 'f'));
    const first = w.liveShells()[0];
    if (!first) throw new Error('no shell');
    const y0 = first.py;
    for (let i = 0; i < 29; i++) w.step();
    // After 30 ticks (0.5 s): down about g t^2 / 2 = 1.2 m, give or take the gun falling as it fired.
    expect(y0 - first.y).toBeGreaterThan(1.1);
    expect(y0 - first.y).toBeLessThan(1.35);
    w.dispose();
    // In the air, nothing to hit: each shell lives 60 ticks.
    const w2 = await World.create({ seed: 1 }, flat);
    const high = w2.spawnBlueprint({ ...GUN_CAR, grid: ['C M>'] }, { x: -150, y: 200 });
    w2.step(hold(high.id, 'f'));
    w2.step([{ robot: high.id, pressed: [], released: ['f'] }]);
    for (let i = 0; i < 57; i++) w2.step();
    expect(w2.liveShells().length).toBe(1);
    w2.step();
    expect(w2.liveShells().length).toBe(0);
    w2.dispose();
  });

  it('a shell takes 5 off the first part it hits; a frame block goes after 12 hits', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(GUN_CAR, { x: -100, y: 0.5 });
    // A coreless blueprint is placed by its first part, the top of the post.
    const post = w.spawnBlueprint(POST, { x: -80, y: 2.5 });
    for (let i = 0; i < 20; i++) w.step();
    w.step(hold(car.id, 'f'));
    for (let i = 0; i < 40; i++) w.step();
    const hits = w.events.filter((e) => e.kind === 'shellHit');
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(hits[0]).toMatchObject({ robot: post.id, part: 'frame@0,0', partType: 'frame', by: car.id, damage: 5 });
    expect(post.parts.get('frame@0,0')?.health).toBe(60 - 5 * hits.length);
    for (let i = 0; i < 60; i++) w.step();
    expect(post.parts.has('frame@0,0')).toBe(false);
    w.dispose();
  });

  it('nothing tunnels: a one-cell wall 50 m off stops every shell', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(GUN_CAR, { x: -100, y: 0.5 });
    w.spawnBlueprint({ format: 1, name: 'slab', grid: ['F', 'F', 'F', 'F'] }, { x: -49.7, y: 3.5 });
    w.step(hold(car.id, 'f'));
    let furthest = -Infinity;
    for (let i = 0; i < 70; i++) {
      w.step();
      for (const s of w.liveShells()) furthest = Math.max(furthest, s.x);
    }
    expect(w.shotsBy(car.id)).toBeGreaterThan(8);
    expect(furthest).toBeLessThan(-49.7);
    expect(w.events.filter((e) => e.kind === 'shellHit').length).toBeGreaterThan(5);
    w.dispose();
  });

  it('an armed warhead shot 4 times explodes; an unarmed one just breaks', async () => {
    for (const armed of [true, false]) {
      const w = await World.create({ seed: 1 }, flat);
      const car = w.spawnBlueprint(GUN_CAR, { x: -100, y: 0.5 });
      w.spawnBlueprint({ format: 1, name: 'mine', grid: ['x'], legend: { x: { part: 'warhead', armed } } }, { x: -60, y: 0.5 });
      w.step(hold(car.id, 'f'));
      for (let i = 0; i < 40; i++) w.step();
      const hits = w.events.filter((e) => e.kind === 'shellHit');
      expect(hits.length).toBe(4);
      expect(w.events.filter((e) => e.kind === 'partDestroyed')).toMatchObject([{ partType: 'warhead', exploded: armed }]);
      expect(w.events.filter((e) => e.kind === 'explosion').length).toBe(armed ? 1 : 0);
      w.dispose();
    }
  });

  it('shells hit friends and its own robot; the gun itself is never hit', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(GUN_CAR, { x: -100, y: 0.5 });
    const friend = w.spawnBlueprint(ENEMY_CAR, { x: -90, y: 0.5 });
    const self = w.spawnBlueprint({ format: 1, name: 'self-shooter', grid: ['F F F', 'C M> F'], bindings: FIRE }, { x: 0, y: 0.5 });
    w.step([...hold(car.id, 'f'), ...hold(self.id, 'f')]);
    for (let i = 0; i < 20; i++) w.step();
    expect(friend.parts.get('core@0,0')?.health).toBeLessThan(50);
    expect(self.parts.get('frame@2,0')?.health).toBeLessThan(60);
    expect(self.parts.get('gun@1,0')?.health).toBe(25);
    expect(car.parts.get('gun@1,0')?.health).toBe(25);
    w.dispose();
  });

  it('each shot kicks the gun back 2 N s', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(GUN_CAR, { x: -100, y: 300 });
    const still = w.spawnBlueprint(GUN_CAR, { x: 100, y: 300 });
    w.step(hold(car.id, 'f'));
    for (let i = 0; i < 29; i++) w.step();
    const vx = (id: number): number => {
      const r = w.robots.find((x) => x.id === id);
      const g = r?.groups[0];
      return g ? w.physics.state(g.bodyId).vx : NaN;
    };
    // 5 shots of 2 N s on 3 kg: about -3.3 m/s (a little drag).
    expect(vx(car.id)).toBeLessThan(-3);
    expect(vx(car.id)).toBeGreaterThan(-3.5);
    expect(Math.abs(vx(still.id))).toBeLessThan(1e-9);
    w.dispose();
  });

  it('the sight reads what is straight out of the barrel: nothing, an enemy, nobody, its own robot, terrain', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(GUN_CAR, { x: -100, y: 40 });
    const out = (id: number, part: string) => ({
      sight: w.partOutput(id, part, 'sight'),
      side: w.partOutput(id, part, 'sightSide'),
      id: w.partOutput(id, part, 'sightId'),
      aim: w.partOutput(id, part, 'aim'),
    });
    // Before it first looks: nothing within its range.
    expect(out(car.id, 'gun@1,0')).toEqual({ sight: 150, side: SIGHT.nothing, id: 0, aim: 0 });
    w.step();
    expect(out(car.id, 'gun@1,0')).toMatchObject({ sight: 150, side: SIGHT.nothing, id: 0 });
    expect(out(car.id, 'gun@1,0').aim).toBeCloseTo(0, 6);
    const enemy = w.spawnBlueprint(ENEMY_CAR, { x: -70, y: 40 }, { team: 1 });
    w.step();
    // Barrel end at -98.5, the enemy core's left face at -70.49. Both fall together.
    expect(out(car.id, 'gun@1,0')).toMatchObject({ side: SIGHT.enemy, id: enemy.id });
    expect(out(car.id, 'gun@1,0').sight).toBeCloseTo(28.01, 1);
    const post = w.spawnBlueprint(POST, { x: -90, y: 41 });
    w.step();
    expect(out(car.id, 'gun@1,0')).toMatchObject({ side: SIGHT.none, id: post.id });
    const self = w.spawnBlueprint({ format: 1, name: 'self-shooter', grid: ['F F F', 'C M> F'] }, { x: 0, y: 40 });
    const down = w.spawnBlueprint({ format: 1, name: 'down', grid: ['C', 'Mv'] }, { x: 50, y: 20 });
    w.step();
    expect(out(self.id, 'gun@1,0')).toMatchObject({ side: SIGHT.own, id: self.id });
    expect(out(self.id, 'gun@1,0').sight).toBeLessThan(0.05);
    const d = out(down.id, 'gun@0,0');
    expect(d.side).toBe(SIGHT.terrain);
    expect(d.id).toBe(0);
    expect(d.sight).toBeGreaterThan(17);
    expect(d.sight).toBeLessThan(19);
    expect(d.aim).toBeCloseTo(-Math.PI / 2, 6);
    w.dispose();
  });

  it('is deterministic: the same fight hashes the same', async () => {
    const run = async (): Promise<string> => {
      const w = await World.create({ seed: 3 }, flat);
      const car = w.spawnBlueprint(GUN_CAR, { x: -100, y: 0.5 });
      w.spawnBlueprint(POST, { x: -70, y: 0.5 });
      w.step(hold(car.id, 'f'));
      for (let i = 0; i < 90; i++) w.step();
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });
});
