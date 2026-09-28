import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { crashFraction, crashWeight } from '../src/world/crash';

const flat = parseWorldFile(flatJson);
const destroyed = (w: World): string[] => w.events.flatMap((e) => (e.kind === 'partDestroyed' ? [e.part] : []));

const CAR = { format: 1, name: 'car', grid: ['F  C  F', 'W  .  W'] };
const DRONE = { format: 1, name: 'drone', grid: ['P  P  P', 'F  C  F'] };

async function drop(bp: object, height: number, seconds = 4): Promise<{ w: World; lost: string[] }> {
  const w = await World.create({ seed: 1 }, flat);
  w.spawnBlueprint(bp as never, { x: -100, y: height });
  for (let i = 0; i < seconds * 60; i++) w.step();
  return { w, lost: destroyed(w) };
}

describe('crash damage (Batch)', () => {
  it('the curve: nothing at or under safe, squared over it, frames tougher', () => {
    expect(crashFraction(12, undefined)).toBe(0);
    expect(crashFraction(3, undefined)).toBe(0);
    expect(crashFraction(12 + 4, undefined)).toBeCloseTo(0.25);
    expect(crashFraction(20, undefined)).toBeCloseTo(1);
    expect(crashFraction(27, { safe: 24 })).toBeCloseTo((3 / 8) ** 2);
    expect(crashWeight(1, 1)).toBe(1.5);
    expect(crashWeight(-1, 1)).toBe(0.5);
    expect(crashWeight(3, 0)).toBe(1);
  });

  it('a car and a drone set down from the 6 m spawn height take nothing', async () => {
    for (const bp of [CAR, DRONE]) {
      const { w, lost } = await drop(bp, 6);
      expect(lost).toEqual([]);
      for (const r of w.robots) for (const p of r.parts.values()) expect(p.health).toBe(p.def.health);
      w.dispose();
    }
  });

  it('a car falling 20 m loses its wheels first and the frames hold', async () => {
    const { w, lost } = await drop(CAR, 20);
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.every((id) => id.startsWith('wheel'))).toBe(true);
    for (const r of w.robots) for (const p of r.parts.values()) if (p.def.id === 'frame') expect(p.health).toBe(60);
    w.dispose();
  });

  it('a nose ramming a wall at 130 m/s shatters it, the nose worst', async () => {
    const wall = parseWorldFile({ name: 'wall', ground: { width: 400, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [{ x: 60, y: 20, w: 1, h: 30 }] });
    const w = await World.create({ seed: 1, gravityY: 0 }, wall);
    const r = w.spawnBlueprint({ format: 1, name: 'ram', grid: ['F  F  C  B  H'] } as never, { x: 0, y: 20 });
    w.kickRobot(r, 130, 0);
    for (let i = 0; i < 120; i++) w.step();
    expect(destroyed(w)).toContain('heavywarhead@4,0');
    expect(destroyed(w).length).toBeGreaterThanOrEqual(3);
    w.dispose();
  });

  it('a kick is not a crash: 40 m/s given to a body in empty space breaks nothing', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, parseWorldFile({ name: 'void', ground: { width: 50, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] }));
    const r = w.spawnBlueprint({ format: 1, name: 'x', grid: ['F  C  B'] } as never, { x: 0, y: 20 });
    w.kickRobot(r, 40, 0);
    for (let i = 0; i < 60; i++) w.step();
    expect(destroyed(w)).toEqual([]);
    w.dispose();
  });

  it('is deterministic', async () => {
    const a = await drop(CAR, 20);
    const b = await drop(CAR, 20);
    expect(a.w.hash()).toBe(b.w.hash());
    a.w.dispose();
    b.w.dispose();
  });
});
