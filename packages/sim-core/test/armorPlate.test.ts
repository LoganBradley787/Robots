import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { blastEffects } from '../src/damage/explosion';
import { defaultRegistry } from '../src/parts/registry';
import { DEFAULT_LEGEND } from '../src/blueprint/legend';
import type { ExplodeSpec } from '../src/parts/types';

const flat = parseWorldFile(flatJson);
const hold = (robot: number, key: string) => [{ robot, pressed: [key], released: [] }];
const FIRE = [{ key: 'f', mode: 'hold', target: 'gun', channel: 'fire', value: 1 }];
const GUN_CAR = { format: 1, name: 'gun-car', grid: ['C M>'], bindings: FIRE };
/** A post of three armor plates, nobody's. */
const POST = { format: 1, name: 'plate-post', grid: ['A', 'A', 'A'] };

describe('heavy armor plate (Batch)', () => {
  const def = defaultRegistry().get('armorplate');

  it('is five frames heavy, 250 health, attaches on every face, takes a tenth of a shell', () => {
    expect(def).toMatchObject({ mass: 5, health: 250, shellDamage: 0.1, powerDraw: 0 });
    expect(def.footprint[0]?.faces).toEqual(['N', 'E', 'S', 'W']);
    expect(def.mass).toBe(5 * defaultRegistry().get('frame').mass);
    expect(DEFAULT_LEGEND.A).toEqual({ part: 'armorplate' });
  });

  it('a shell does 0.5 to it, not the 5 a core takes', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(GUN_CAR, { x: -100, y: 0.5 });
    // A coreless blueprint is placed by its first part, the top of the post.
    const post = w.spawnBlueprint(POST, { x: -80, y: 2.5 });
    for (let i = 0; i < 20; i++) w.step();
    w.step(hold(car.id, 'f'));
    for (let i = 0; i < 40; i++) w.step();
    const onPlate = w.events.filter((e) => e.kind === 'shellHit' && e.robot === post.id && e.part === 'armorplate@0,0');
    expect(onPlate.length).toBeGreaterThanOrEqual(6);
    expect(onPlate[0]).toMatchObject({ partType: 'armorplate', by: car.id, damage: 0.5 });
    expect(post.parts.get('armorplate@0,0')?.health).toBeCloseTo(250 - 0.5 * onPlate.length, 9);
    w.dispose();
  });

  it('a warhead blast at 1 m takes a lot off it but does not kill it', () => {
    const warhead = defaultRegistry().get('warhead').onDestroyed?.explode as ExplodeSpec;
    const fx = blastEffects({ x: 0, y: 0 }, warhead, [{ x: 1, y: 0, angle: 0 }], []);
    const damage = fx.damage[0] as number;
    expect(damage).toBeGreaterThan(50);
    expect(damage).toBeLessThan(def.health);
    // Right against the blast the full 120 still leaves half of it standing.
    expect(blastEffects({ x: 0, y: 0 }, warhead, [{ x: 0, y: 0, angle: 0 }], []).damage[0]).toBeLessThan(def.health);
  });
});
