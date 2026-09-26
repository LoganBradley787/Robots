import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World, type WorldEvent } from '../src/world/World';

const flat = parseWorldFile(flatJson);
/** A live bomb: since M10 a warhead needs arming, and a stock bomb starts armed. */
const ARMED = { X: { part: 'warhead', armed: true } };
const BOMB = { format: 1, name: 'bomb', grid: ['X'], legend: ARMED };

const kinds = (w: World, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind);
const destroyed = (w: World): string[] => w.events.flatMap((e) => (e.kind === 'partDestroyed' ? [e.part] : []));

describe('warheads (M6)', () => {
  it('a bomb dropped from 3 m explodes on the ground; one set down from 0.3 m does not', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.spawnBlueprint(BOMB, { x: -100, y: 3.5 });
    w.spawnBlueprint(BOMB, { x: -80, y: 0.8 });
    for (let i = 0; i < 120; i++) w.step();
    expect(kinds(w, 'explosion')).toHaveLength(1);
    expect(w.robots.map((r) => r.spawnX)).toEqual([-80]);
    w.dispose();
  });

  it('a warhead nose hitting a wall at 3 m/s holds; at 10 m/s it goes off', async () => {
    const ram = async (speed: number): Promise<number> => {
      const wall = parseWorldFile({ name: 'wall', ground: { width: 50, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [{ x: 6, y: 20, w: 1, h: 10 }] });
      const w = await World.create({ seed: 1, gravityY: 0 }, wall);
      const r = w.spawnBlueprint({ format: 1, name: 'ram', grid: ['F  F  C  X'], legend: ARMED }, { x: 0, y: 20 });
      w.physics.kick(r.groups[0]?.bodyId as number, speed, 0, 0);
      for (let i = 0; i < 180; i++) w.step();
      const n = kinds(w, 'explosion').length;
      w.dispose();
      return n;
    };
    expect(await ram(3)).toBe(0);
    expect(await ram(10)).toBe(1);
  });

  it('detonate on a key: the warhead goes, and a warhead touching it goes too (chain)', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(
      {
        format: 1,
        name: 'chain',
        grid: ['C  F  F  F  F  X  X'],
        legend: ARMED,
        bindings: [{ key: 'x', mode: 'pulse', target: 'warhead@5,0', channel: 'detonate', value: 1 }],
      },
      { x: -100, y: 0.5 },
    );
    w.step([{ robot: r.id, pressed: ['x'], released: [] }]);
    expect(kinds(w, 'explosion')).toHaveLength(2);
    // The frame next to the first warhead is gone (1 m); frames farther out survive. The core, 5 m out, is untouched.
    expect(destroyed(w)).toEqual(['warhead@5,0', 'frame@4,0', 'warhead@6,0']);
    expect(r.parts.get('core@0,0')?.health).toBe(50);
    w.dispose();
  });

  it('a bomb hole: frames within 1.5 m break, frames beyond survive damaged, the rest splits off', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const row = w.spawnBlueprint(
      { format: 1, name: 'row', grid: ['C  F  F  F  X  F  F  F'], legend: ARMED, bindings: [{ key: 'x', mode: 'pulse', target: 'warhead', channel: 'detonate', value: 1 }] },
      { x: -100, y: 0.5 },
    );
    w.step([{ robot: row.id, pressed: ['x'], released: [] }]);
    expect(destroyed(w)).toEqual(['warhead@4,0', 'frame@3,0', 'frame@5,0']);
    expect(w.robots.map((r) => [...r.parts.keys()])).toEqual([
      ['core@0,0', 'frame@1,0', 'frame@2,0'],
      ['frame@6,0', 'frame@7,0'],
    ]);
    // 2 m out behind the frame at 1 m: a third of the damage, halved by cover.
    const kept = w.robots[0]?.parts.get('frame@2,0');
    expect(kept?.health).toBeCloseTo(60 - (120 / 3) * 0.5, 9);
    // Thrown up and away: the right piece flies right and up.
    for (let i = 0; i < 3; i++) w.step();
    const right = w.robots[1];
    const s = w.physics.state(right?.groups[0]?.bodyId as number);
    expect(s.vx).toBeGreaterThan(3);
    expect(s.vy).toBeGreaterThan(1);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(40);
    w.dispose();
  });
});
