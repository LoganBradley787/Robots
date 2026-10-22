import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';

const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 }, boxes: [] });

/**
 * A hull with a rotator turret (so its bodies are multibody links, which take their velocity as a kick) and a bay that
 * builds a small dart, let go on R. The bay's hollow is exactly as wide as the dart, as on titan-hive. The frame under
 * the core is there to be shot off.
 */
const SHIP = {
  format: 1,
  name: 'ship',
  parts: [
    { part: 'core', x: 0, y: 0 },
    { part: 'densebattery', x: -1, y: 0 },
    { part: 'densebattery', x: 1, y: 0 },
    { part: 'frame', x: 2, y: 0 },
    { part: 'rotator', x: 2, y: 1 },
    { part: 'frame', x: 2, y: 2 },
    { part: 'frame', x: 0, y: -1 },
    { part: 'fabbay', x: -2, y: 1, tags: ['bay'], makes: 'dart' },
  ],
  recipes: { dart: { format: 1, name: 'dart', grid: ['F', 'F', 'C'] } },
  bindings: [{ key: 'r', mode: 'pulse', target: 'bay', channel: 'release', value: 1 }],
};
const SPEED = 40;

const coreBody = (r: Robot): number => r.groups[r.parts.get(r.primaryCoreId ?? '')?.group ?? 0]?.bodyId as number;

/** The ship flying sideways at 40 m/s with no gravity, its dart built and held. */
async function flying(): Promise<{ w: World; ship: Robot }> {
  const w = await World.create({ seed: 1, gravityY: 0 }, space);
  const ship = w.spawnBlueprint(SHIP, { x: 0, y: 100 });
  w.setUnlimitedEnergy(true);
  for (let t = 0; t < 400 && !w.events.some((e) => e.kind === 'built'); t++) w.step();
  expect(w.events.some((e) => e.kind === 'built')).toBe(true);
  w.kickRobot(ship, SPEED, 0, 0);
  for (let t = 0; t < 10; t++) w.step();
  return { w, ship };
}

/** How far the ship's core moves in one tick, and its velocity as Rapier reports it after. */
function stepShip(w: World, ship: Robot, keys: { pressed: string[]; released: string[] } = { pressed: [], released: [] }): { dx: number; vx: number } {
  const x0 = w.physics.state(coreBody(ship)).x;
  w.step([{ robot: ship.id, ...keys }]);
  const s = w.physics.state(coreBody(ship));
  return { dx: s.x - x0, vx: s.vx };
}

describe('a kicked multibody link has its velocity from the start of its first step (2026-10 kick fix)', () => {
  it('a jointed robot kicked from rest moves a whole step at the kick velocity, and Rapier reports it at once', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const r = w.spawnBlueprint({ ...SHIP, parts: SHIP.parts.filter((p) => p.part !== 'fabbay'), recipes: undefined, bindings: [] }, { x: 0, y: 100 });
    w.step();
    expect(w.physics.isLinked(coreBody(r))).toBe(true);
    w.kickRobot(r, SPEED, 0, 0);
    const { dx, vx } = stepShip(w, r);
    // Air drag takes a little; before the fix the step moved 9/16 of this and Rapier reported 7/8 of the speed.
    expect(dx / (SPEED * w.dt)).toBeGreaterThan(0.99);
    expect(vx / SPEED).toBeGreaterThan(0.99);
    w.dispose();
  });

  it('letting go of a dart: the ship moves a whole step, and the dart moves with it and slides out of its bay', async () => {
    const { w, ship } = await flying();
    const before = stepShip(w, ship);
    const release = stepShip(w, ship, { pressed: ['r'], released: [] });
    expect(w.events.some((e) => e.kind === 'released')).toBe(true);
    const dart = w.robots.find((r) => r !== ship) as Robot;
    expect(dart).toBeDefined();
    // Rebuilt, the ship moves as far as on the tick before (before the fix: 61 percent of it, 0.26 m short).
    expect(release.dx / before.dx).toBeGreaterThan(0.995);
    expect(release.vx / before.vx).toBeGreaterThan(0.995);
    const d = w.physics.state(coreBody(dart));
    const s = w.physics.state(coreBody(ship));
    // The dart keeps the ship's speed and is pushed out along the bay (up) by its separation (4 N s on about 4 kg).
    expect(Math.abs(d.vx - s.vx)).toBeLessThan(0.05);
    expect(d.vy).toBeGreaterThan(0.8);
    w.dispose();
  });

  it('a ship rebuilt while its dart is still in the bay does not hit the dart (titan-hive lost 9 darts a minute)', async () => {
    const { w, ship } = await flying();
    stepShip(w, ship, { pressed: ['r'], released: [] });
    const dart = w.robots.find((r) => r !== ship) as Robot;
    const parts = dart.parts.size;
    // The tick after the release the ship loses a part: it is rebuilt with the dart still inside the bay.
    const lost = ship.parts.get('frame@0,-1');
    if (lost) lost.health = 0;
    const before = stepShip(w, ship, { pressed: [], released: ['r'] });
    const after = stepShip(w, ship);
    expect(ship.groups.length).toBeGreaterThan(1);
    // Rebuilt, it moves a whole step (before the fix: 60 percent), and the dart moves with it and keeps sliding out.
    expect(after.dx / before.dx).toBeGreaterThan(0.995);
    for (let t = 0; t < 5; t++) {
      const d = w.physics.state(coreBody(dart));
      const s = w.physics.state(coreBody(ship));
      // Before the fix the wall stopped it (0.08 m/s up) and dragged it back.
      expect(Math.abs(d.vx - s.vx), `tick ${t}`).toBeLessThan(0.05);
      expect(d.vy, `tick ${t}`).toBeGreaterThan(0.8);
      stepShip(w, ship);
    }
    expect(dart.parts.size).toBe(parts);
    expect(w.events.filter((e) => e.kind === 'impact')).toEqual([]);
    w.dispose();
  });
});
