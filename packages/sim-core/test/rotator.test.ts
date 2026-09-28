import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';

const flat = parseWorldFile(flatJson);
const DEG = Math.PI / 180;

/** A heavy base with a rotator on the core carrying a 3-cell arm one row up (so the arm never touches the base). */
const TURRET = {
  format: 1,
  name: 'turret',
  grid: ['.  .  .  F  F  F  .', '.  .  .  R  .  .  .', 'B  B  B  C  B  B  B'],
};

function jointAngle(w: World, r: Robot): number {
  const rot = r.parts.get('rotator@3,1');
  const joint = rot ? r.groups[rot.group]?.joint : undefined;
  if (!joint) throw new Error('no rotator joint');
  return w.physics.jointAngle(joint.jointId);
}

describe('rotator (M6)', () => {
  it('holds a 3-cell arm level against gravity', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(TURRET, { x: -100, y: 0.5 });
    for (let i = 0; i < 120; i++) w.step();
    expect(Math.abs(jointAngle(w, r))).toBeLessThan(2 * DEG);
    w.dispose();
  });

  it('Z swings it counterclockwise, releasing holds the aim, and it stops at 90 degrees', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(TURRET, { x: -100, y: 0.5 });
    for (let i = 0; i < 30; i++) w.step();
    w.step([{ robot: r.id, pressed: ['z'], released: [] }]);
    for (let i = 0; i < 29; i++) w.step();
    // 0.5 s at 2 rad/s.
    expect(w.partOutput(r.id, 'rotator@3,1', 'angle')).toBeCloseTo(1 / 1.5708, 2);
    w.step([{ robot: r.id, pressed: [], released: ['z'] }]);
    for (let i = 0; i < 90; i++) w.step();
    expect(Math.abs(jointAngle(w, r) - 1)).toBeLessThan(2 * DEG);
    w.step([{ robot: r.id, pressed: ['z'], released: [] }]);
    for (let i = 0; i < 120; i++) w.step();
    expect(w.partOutput(r.id, 'rotator@3,1', 'angle')).toBe(1);
    expect(Math.abs(jointAngle(w, r) - Math.PI / 2)).toBeLessThan(2 * DEG);
    // X brings it back the other way: 0.785 s at 2 rad/s is back to level (all the way down would hit the ground).
    w.step([{ robot: r.id, pressed: ['x'], released: ['z'] }]);
    for (let i = 0; i < 46; i++) w.step();
    w.step([{ robot: r.id, pressed: [], released: ['x'] }]);
    for (let i = 0; i < 60; i++) w.step();
    expect(Math.abs(jointAngle(w, r) - (r.parts.get('rotator@3,1')?.aim ?? 9))).toBeLessThan(2 * DEG);
    expect(Math.abs(r.parts.get('rotator@3,1')?.aim ?? 9)).toBeLessThan(0.05);
    w.dispose();
  });

  it('a rotator whose base is shot away goes limp instead of failing', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(TURRET, { x: -100, y: 0.5 });
    const core = r.parts.get('core@3,0');
    if (core) core.health = 0;
    for (let i = 0; i < 60; i++) w.step();
    // The turret (rotator and arm) broke off as a piece of its own; nothing throws.
    expect(w.robots.some((x) => x.parts.has('rotator@3,1') && x.parts.size === 4)).toBe(true);
    w.dispose();
  });

  it('holds its angle to within 0.05 degrees under a steady load (Batch: integral term)', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(TURRET, { x: -100, y: 0.5 });
    let worst = 0;
    for (let i = 0; i < 60 * 10; i++) {
      w.step();
      if (i >= 60 * 6) worst = Math.max(worst, Math.abs(jointAngle(w, r)));
    }
    expect(worst).toBeLessThan(0.05 * DEG);
    w.dispose();
  });

  it('a swing settles on its aim without the overshoot growing (Batch)', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(TURRET, { x: -100, y: 0.5 });
    for (let i = 0; i < 30; i++) w.step();
    w.step([{ robot: r.id, pressed: ['z'], released: [] }]);
    for (let i = 0; i < 29; i++) w.step();
    w.step([{ robot: r.id, pressed: [], released: ['z'] }]);
    const aim = r.parts.get('rotator@3,1')?.aim ?? 0;
    let peak1 = 0;
    let peak2 = 0;
    for (let i = 0; i < 60 * 12; i++) {
      w.step();
      const over = Math.abs(jointAngle(w, r) - aim);
      if (i < 60 * 3) peak1 = Math.max(peak1, over);
      else if (i < 60 * 6) peak2 = Math.max(peak2, over);
    }
    expect(peak2).toBeLessThanOrEqual(peak1);
    expect(Math.abs(jointAngle(w, r) - aim)).toBeLessThan(0.05 * DEG);
    w.dispose();
  });

  it('the integral term is capped to the motor torque and is hashed (Batch)', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(TURRET, { x: -100, y: 0.5 });
    const before = w.hash();
    for (let i = 0; i < 120; i++) w.step();
    expect(w.hash()).not.toBe(before);
    const rot = r.parts.get('rotator@3,1');
    const joint = rot ? r.groups[rot.group]?.joint : undefined;
    const entry = (w.physics as unknown as { joints: Map<number, { integral: number; maxTorque: number }> }).joints.get(joint?.jointId ?? -1);
    expect(entry).toBeDefined();
    expect(Math.abs(entry?.integral ?? 0)).toBeLessThanOrEqual(entry?.maxTorque ?? 0);
    expect(Math.abs(entry?.integral ?? 0)).toBeGreaterThan(0);
    w.dispose();
  });
});
