import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { hingeInertia, MOTOR_REDUCED_LIMIT, motorLoad } from '../src/behaviors/reduced';

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
  // S4 (review 2026-10-09): a joint whose mount side is one frame and whose carried side is an 8 wide hull. The motor
  // pushes the frame round as hard as the hull, so gains sized from the hull alone flung the frame: it was still
  // spinning at 3 to 4 rad/s nine seconds after the key was released.
  for (const [part, token] of [
    ['rotator', 'R'],
    ['heavyrotator', 'RR'],
  ] as const) {
    it(`a ${part} on a light mount under a heavy hull settles after the key is released (S4)`, async () => {
      const space = parseWorldFile({ name: 'void', ground: { width: 50, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
      const stub = { format: 1, name: 'stub', grid: ['B  B  B  C  B  B  B  B', `.  .  .  ${token}  .  .  .  .`, '.  .  .  F  .  .  .  .'] };
      const w = await World.create({ seed: 1, gravityY: 0 }, space);
      const r = w.spawnBlueprint(stub, { x: 0, y: 500 });
      for (let i = 0; i < 30; i++) w.step();
      w.step([{ robot: r.id, pressed: ['z'], released: [] }]);
      for (let i = 0; i < 29; i++) w.step();
      w.step([{ robot: r.id, pressed: [], released: ['z'] }]);
      for (let i = 0; i < 60 * 9; i++) w.step();
      const frame = r.parts.get('frame@3,0');
      const group = frame ? r.groups[frame.group] : undefined;
      expect(group).toBeDefined();
      expect(Math.abs(w.physics.state(group?.bodyId ?? -1).w)).toBeLessThan(0.1);
      // It holds the aim it was given, and nothing broke.
      const rot = r.parts.get(`${part}@3,1`);
      const joint = rot ? r.groups[rot.group]?.joint : undefined;
      expect(Math.abs(w.physics.jointAngle(joint?.jointId ?? -1) - (rot?.aim ?? 9))).toBeLessThan(2 * DEG);
      expect(Math.abs(rot?.aim ?? 0)).toBeGreaterThan(0.2);
      expect(r.parts.size).toBe(10);
      w.dispose();
    });
  }

  it('sizes its gains from both sides: a heavy turret on a heavy hull is unchanged, a light mount takes over (S4)', () => {
    // A 6 kg turret 1.5 m above the hinge (14.5 kg m^2 about it) on a 40 kg hull whose center is 0.5 m below.
    const turret = { mass: 6, comX: 0, comY: 1.5, inertia: 1 };
    const own = turret.inertia + turret.mass * 1.5 * 1.5;
    const hull = { mass: 40, comX: 0, comY: -0.5, inertia: 200 };
    expect(hingeInertia(turret, hull, 0, 0)).toBeGreaterThan(0.9 * own);
    expect(hingeInertia(turret, hull, 0, 0)).toBeLessThan(own);
    expect(motorLoad(own, hingeInertia(turret, hull, 0, 0))).toBe(own);
    // The same turret on a 1 kg mount 1 m below: the reduced inertia is about the mount's own, and the gains follow it.
    const mount = { mass: 1, comX: 0, comY: -1, inertia: 1 / 6 };
    const reduced = hingeInertia(turret, mount, 0, 0);
    expect(reduced).toBeLessThan(1.1);
    expect(motorLoad(own, reduced)).toBeCloseTo(MOTOR_REDUCED_LIMIT * reduced, 9);
    // Symmetric in its two sides, as a torque pair is.
    expect(hingeInertia(hull, turret, 0, 0)).toBeCloseTo(hingeInertia(turret, hull, 0, 0), 9);
  });
});
