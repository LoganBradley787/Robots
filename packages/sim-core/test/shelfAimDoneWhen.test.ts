import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import flatJson from '../../../worlds/flat.json';
import { copyParts } from '../src/blueprint/edit';
import type { Blueprint } from '../src/blueprint/types';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { built, give, raw, registry, shipped } from './shelfHelp';

/**
 * The shelf behavior Aim and fire (`behaviors/aim-and-fire.js`) on robots it was never tuned for. Every robot gets it
 * the way the builder gives it (`attachBehavior`, the slots filled with their guess); a stock robot has its own
 * turret script taken off first.
 *
 * Measured when this was written (flat world, seed 1); the tests ask for less:
 * - one gun on a hinge, a block of frames 60 m off, 10 s:          100 shells, 97 on the block, 0 on itself
 * - the same with a friend standing in the line at 30 m:           0 shells
 * - the same with `auto` 0 and no key held:                         0 shells
 * - the armored gun drone (2 turrets), a fab drone 80 m off, 15 s:  102 shells, 88 on it, 10 of its parts broken
 *   (its own script: 60 shells, 49 on it, 10 parts)
 * - the many gun drone (12 turrets), a fab drone 120 m off, 15 s:   107 shells, 102 on it, its core gone at 2.2 s
 *   (its own script: 298 shells, 232 on it, its core gone at 12.1 s: it goes for other parts first)
 * - the cannon tower (charged), a fab drone 155 m off, 25 s:        2 bolts, 27 parts hit, 34 broken, no backfire
 *   (its own script: the same numbers)
 * A lance drone and a laser tower were tried the same way and matched their own scripts (1 bolt and 7 parts hit each
 * way; 13 burns against 18), but have no test here.
 */
const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** One gun on a hinge on a post, with a radar: the hinge points the gun to the right. */
const tower = (): Blueprint => built({ format: 1, name: 'tower', grid: ['.  r  g', 'O  F  .', 'B  C  B'], legend: { r: { part: 'rotator', rot: 0 }, g: { part: 'gun', rot: 270 } } });
const BLOCK = { format: 1, name: 'target', grid: ['F F F', 'F F F', 'F C F', 'F F F'] };
const FRIEND = { format: 1, name: 'friend', grid: ['F F F', 'F C F', 'F F F'] };

interface Fight {
  shots: number;
  /** Hits on the target by the shooter: shells, bolts, and beam burns. */
  target: number;
  /** Hits by the shooter on itself, and on the friend. */
  own: number;
  friend: number;
  bolts: number;
  backfires: number;
  targetCoreLost: boolean;
  crashes: number;
  world: World;
  shooter: number;
}

async function fight(shooter: Blueprint, at: { x: number; y: number }, target: unknown, targetAt: { x: number; y: number }, seconds: number, opts: { friendAt?: { x: number; y: number }; each?: (w: World, t: number, shooter: number) => void; input?: (t: number, shooter: number) => { robot: number; pressed: string[]; released: string[] }[] } = {}): Promise<Fight> {
  const w = await World.create({ seed: 1, scripts: host }, flat);
  const r = w.spawnBlueprint(raw(shooter), at);
  const enemy = w.spawnBlueprint(target, targetAt, { team: 1 });
  const friend = opts.friendAt ? w.spawnBlueprint(FRIEND, opts.friendAt) : undefined;
  for (let t = 0; t < seconds * 60; t++) {
    w.step(opts.input?.(t, r.id) ?? []);
    opts.each?.(w, t, r.id);
  }
  const hits = (id: number | undefined): number => w.events.filter((e) => (e.kind === 'shellHit' || e.kind === 'boltHit' || e.kind === 'laserBurn') && e.robot === id && e.by === r.id).length;
  return {
    shots: w.shotsBy(r.id),
    target: hits(enemy.id),
    own: hits(r.id),
    friend: hits(friend?.id),
    bolts: w.events.filter((e) => e.kind === 'cannonFire' && e.robot === r.id).length,
    backfires: w.events.filter((e) => e.kind === 'cannonBackfire' && e.robot === r.id).length,
    targetCoreLost: w.events.some((e) => e.kind === 'coreLost' && e.robot === enemy.id),
    crashes: w.events.filter((e) => e.kind === 'scriptCrashed').length,
    world: w,
    shooter: r.id,
  };
}

describe('shelf Aim and fire: aims and fires on robots it was never tuned for', () => {
  it('a single turret: the guess is the hinge and the gun, and the target takes the hits', { timeout: 60_000 }, async () => {
    const g = give(tower(), 'aim-and-fire');
    expect(g.fit.slots.map((s) => [s.slot.group, s.guess])).toEqual([
      ['turn', ['rotator@1,2']],
      ['fire', ['gun@2,2']],
    ]);
    const f = await fight(g.blueprint, { x: 0, y: 0.5 }, BLOCK, { x: 60, y: 1.5 }, 10);
    expect(f.crashes).toBe(0);
    expect(f.shots).toBeGreaterThan(50);
    expect(f.target).toBeGreaterThan(0.8 * f.shots);
    expect(f.own).toBe(0);
    f.world.dispose();
  });

  it('a friend standing in the line: it holds its fire, and the friend takes nothing', { timeout: 60_000 }, async () => {
    const g = give(tower(), 'aim-and-fire');
    const f = await fight(g.blueprint, { x: 0, y: 0.5 }, BLOCK, { x: 60, y: 1.5 }, 10, { friendAt: { x: 30, y: 1.5 } });
    expect(f.friend).toBe(0);
    expect(f.own).toBe(0);
    expect(f.shots).toBe(0);
    f.world.dispose();
  });

  it('with auto at 0 it aims and fires only while F is held', { timeout: 60_000 }, async () => {
    const g = give(tower(), 'aim-and-fire', { params: { auto: 0 } });
    const quiet = await fight(g.blueprint, { x: 0, y: 0.5 }, BLOCK, { x: 60, y: 1.5 }, 10);
    expect(quiet.shots).toBe(0);
    quiet.world.dispose();
    // F from 3 s to 5 s: shells in that window and none after it (a gun fires 10 a second).
    let after = 0;
    const held = await fight(g.blueprint, { x: 0, y: 0.5 }, BLOCK, { x: 60, y: 1.5 }, 8, {
      input: (t, robot) => (t === 180 ? [{ robot, pressed: ['f'], released: [] }] : t === 300 ? [{ robot, pressed: [], released: ['f'] }] : []),
      each: (w, t, robot) => {
        if (t === 310) after = w.shotsBy(robot);
      },
    });
    expect(after).toBeGreaterThan(10);
    expect(held.shots).toBe(after);
    expect(held.target).toBeGreaterThan(0);
    held.world.dispose();
  });

  it('several turrets: the armored gun drone with its own turret script taken off', { timeout: 120_000 }, async () => {
    const g = give(shipped('enemy-armored-gun-drone', ['turrets']), 'aim-and-fire');
    // Its two hinges and their two guns; the six other parts with a fire input (flares, decouplers) are not guessed.
    expect(g.fit.slots.map((s) => [s.slot.group, s.guess.length, s.could.length])).toEqual([
      ['turn', 2, 2],
      ['fire', 2, 8],
    ]);
    const f = await fight(g.blueprint, { x: -40, y: 40 }, raw(shipped('enemy-fab-drone')), { x: 40, y: 40 }, 15);
    expect(f.crashes).toBe(0);
    expect(f.target).toBeGreaterThan(40);
    expect(f.own).toBe(0);
    f.world.dispose();
  });

  it('twelve turrets stay within the script time budget and end the target', { timeout: 120_000 }, async () => {
    const g = give(shipped('enemy-many-gun-drone', ['turrets']), 'aim-and-fire');
    expect(g.fit.slots.map((s) => s.guess.length)).toEqual([12, 12]);
    const f = await fight(g.blueprint, { x: -60, y: 40 }, raw(shipped('enemy-fab-drone')), { x: 60, y: 40 }, 15);
    expect(f.crashes).toBe(0);
    expect(f.target).toBeGreaterThan(50);
    expect(f.targetCoreLost).toBe(true);
    expect(f.own).toBe(0);
    f.world.dispose();
  });

  it('a charged kind: the cannon tower charges, lets go on target, and never backfires', { timeout: 120_000 }, async () => {
    const g = give(shipped('enemy-cannon-tower', ['turrets']), 'aim-and-fire');
    expect(g.fit.slots.map((s) => [s.slot.group, s.guess])).toEqual([
      ['turn', ['heavyrotator@5,8']],
      ['fire', ['cannon@5,9']],
    ]);
    const f = await fight(g.blueprint, { x: 0, y: 0.5 }, raw(shipped('enemy-fab-drone')), { x: 150, y: 40 }, 25);
    expect(f.crashes).toBe(0);
    expect(f.bolts).toBeGreaterThanOrEqual(1);
    expect(f.backfires).toBe(0);
    expect(f.target).toBeGreaterThan(5);
    expect(f.own).toBe(0);
    f.world.dispose();
  });

  it('a second turret added by copying the first with its tags aims and fires too, with nothing more done', { timeout: 60_000 }, async () => {
    // One turret on a tall post; the copy lands on a low post in front of it, under the first one's line of fire.
    const one = give(built({ format: 1, name: 'two', grid: ['r  g  .  .  .', 'F  .  .  .  .', 'O  F  .  .  .', 'B  C  B  F  .'], legend: { r: { part: 'rotator', rot: 0 }, g: { part: 'gun', rot: 270 } } }), 'aim-and-fire');
    const copy = copyParts(one.blueprint, registry, ['rotator@0,3', 'gun@1,3'], 3, -2);
    if (!copy.ok) throw new Error(copy.error);
    const added = copy.blueprint.parts.filter((p) => p.id === 'rotator@3,1' || p.id === 'gun@4,1');
    expect(added.map((p) => p.tags.filter((t) => t !== p.id))).toEqual([['turn'], ['fire']]);
    // Whether each gun has fired: a gun that fired is waiting to fire again.
    const fired = new Set<string>();
    // Well left of the flat world's boxes: the low gun's line would end on the one at x 8.
    const f = await fight(copy.blueprint, { x: -100, y: 0.5 }, BLOCK, { x: -40, y: 1.5 }, 10, {
      each: (w, _t, robot) => {
        for (const p of w.robots.find((x) => x.id === robot)?.parts.values() ?? []) if ((p.cooldown ?? 0) > 0) fired.add(p.id);
      },
    });
    expect([...fired].sort()).toEqual(['gun@1,3', 'gun@4,1']);
    expect(f.target).toBeGreaterThan(50);
    expect(f.own).toBe(0);
    f.world.dispose();
  });
});
