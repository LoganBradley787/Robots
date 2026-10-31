import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { partWorldPose } from '../src/metrics/robotMetrics';
import { defaultRegistry } from '../src/parts/registry';
import { validateBlueprint } from '../src/blueprint/validate';

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });

/** A base with a piston on the core carrying a frame block; C extends, V retracts. */
const LIFT = {
  format: 1,
  name: 'lift',
  grid: ['.  .  .  F  .  .  .', '.  .  .  I^ .  .  .', 'B  B  B  C  B  B  B'],
};

const CAR = {
  format: 1,
  name: 'test car',
  grid: ['F  F  C  B  F  F', 'W  .  .  .  .  W'],
  legend: { W: { part: 'wheel', tags: ['wheels'] } },
};

const PISTON = 'piston@3,1';

function block(w: World, r: Robot): { x: number; y: number } {
  const pose = partWorldPose(w, r, 'frame@3,2');
  return { x: pose.x, y: pose.y };
}

function press(w: World, r: Robot, key: string, ticks: number): void {
  w.step([{ robot: r.id, pressed: [key], released: [] }]);
  for (let i = 1; i < ticks; i++) w.step();
  w.step([{ robot: r.id, pressed: [], released: [key] }]);
}

function position(w: World, r: Robot): number {
  return w.partOutput(r.id, PISTON, 'position') ?? NaN;
}

describe('piston (Batch)', () => {
  it('is a prismatic joint part that acts away from its mount face', () => {
    const def = defaultRegistry().get('piston');
    expect(def.joint).toMatchObject({ kind: 'prismatic', mountFace: 'S', motor: 'position', maxForce: 3000 });
    expect(def.behaviorConfig).toMatchObject({ stroke: 2, extendSpeed: 1.5 });
    expect(validateBlueprint(LIFT, defaultRegistry()).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('lifts a frame block 2 m, holds it, and brings it back', async () => {
    const w = await World.create({ seed: 1 }, open);
    const r = w.spawnBlueprint(LIFT, { x: -100, y: 0.5 });
    for (let i = 0; i < 60; i++) w.step();
    const y0 = block(w, r).y;
    // Holding at rest: it does not sag or creep.
    expect(position(w, r)).toBe(0);
    // 1.4 s at 1.5 m/s is 2.1 m of travel: it stops at the end of the stroke.
    press(w, r, 'c', 84);
    for (let i = 0; i < 90; i++) w.step();
    expect(position(w, r)).toBe(1);
    expect(block(w, r).y - y0).toBeGreaterThan(1.97);
    expect(block(w, r).y - y0).toBeLessThan(2.03);
    // Holds it there for four more seconds.
    for (let i = 0; i < 240; i++) w.step();
    expect(block(w, r).y - y0).toBeGreaterThan(1.97);
    expect(block(w, r).y - y0).toBeLessThan(2.03);
    // The block stayed over the base.
    expect(Math.abs(block(w, r).x - -100)).toBeLessThan(0.05);
    // V brings it back.
    press(w, r, 'v', 84);
    for (let i = 0; i < 90; i++) w.step();
    expect(position(w, r)).toBe(0);
    expect(Math.abs(block(w, r).y - y0)).toBeLessThan(0.03);
    w.dispose();
  });

  it('follows its input at the extend speed and holds a partial stroke', async () => {
    const w = await World.create({ seed: 1 }, open);
    const r = w.spawnBlueprint(LIFT, { x: -100, y: 0.5 });
    for (let i = 0; i < 60; i++) w.step();
    const y0 = block(w, r).y;
    // 0.6 s at 1.5 m/s is 0.9 m.
    press(w, r, 'c', 36);
    for (let i = 0; i < 90; i++) w.step();
    expect(position(w, r)).toBeCloseTo(0.45, 1);
    expect(Math.abs(block(w, r).y - y0 - 0.9)).toBeLessThan(0.05);
    w.dispose();
  });

  it('lifts a car parked on its head', async () => {
    const w = await World.create({ seed: 1 }, open);
    // A plate of frames across the head for the car to sit on.
    const plate = { format: 1, name: 'plate', grid: ['F  F  F  F  F  F  F', '.  .  .  I^ .  .  .', 'B  B  B  C  B  B  B'] };
    const lift = w.spawnBlueprint(plate, { x: -100, y: 0.5 });
    const car = w.spawnBlueprint(CAR, { x: -100, y: 4 });
    for (let i = 0; i < 120; i++) w.step();
    const y0 = partWorldPose(w, car, 'core@2,1').y;
    // It came to rest on the plate, not on the ground.
    expect(y0).toBeGreaterThan(2.5);
    // The car weighs more than the head it sits on: the piston has to lift it, not just its own load.
    const carMass = car.groups.reduce((m, g) => m + w.physics.massProperties(g.bodyId).mass, 0);
    expect(carMass).toBeGreaterThan(8);
    press(w, lift, 'c', 150);
    for (let i = 0; i < 180; i++) w.step();
    expect(position(w, lift)).toBe(1);
    const pose = partWorldPose(w, car, 'core@2,1');
    expect(pose.y - y0).toBeGreaterThan(1.9);
    expect(pose.y - y0).toBeLessThan(2.1);
    // It stays lifted.
    for (let i = 0; i < 240; i++) w.step();
    expect(partWorldPose(w, car, 'core@2,1').y - y0).toBeGreaterThan(1.9);
    w.dispose();
  });

  it('lifts a heavy load resting on its head and learns to hold it', async () => {
    const w = await World.create({ seed: 1 }, open);
    const plate = { format: 1, name: 'plate', grid: ['F  F  F  F  F  F  F', '.  .  .  I^ .  .  .', 'B  B  B  C  B  B  B'] };
    // 10 rows of 15 frames and a core: about 150 kg, 1500 N, half the piston's 3000 N.
    const row = 'F  F  F  F  F  F  F  F  F  F  F  F  F  F  F';
    const crate = { format: 1, name: 'crate', grid: [row, row, row, row, row, row, row, row, row, 'F  F  F  F  F  F  F  C  F  F  F  F  F  F  F'] };
    const lift = w.spawnBlueprint(plate, { x: -100, y: 0.5 });
    const load = w.spawnBlueprint(crate, { x: -100, y: 4.5 });
    for (let i = 0; i < 300; i++) w.step();
    const mass = load.groups.reduce((m, g) => m + w.physics.massProperties(g.bodyId).mass, 0);
    expect(mass * 9.81).toBeGreaterThan(1300);
    const y0 = partWorldPose(w, load, 'core@7,0').y;
    press(w, lift, 'c', 240);
    for (let i = 0; i < 300; i++) w.step();
    const lifted = partWorldPose(w, load, 'core@7,0').y - y0;
    expect(lifted).toBeGreaterThan(1.85);
    expect(lifted).toBeLessThan(2.1);
    // And it holds it for five more seconds.
    for (let i = 0; i < 300; i++) w.step();
    expect(partWorldPose(w, load, 'core@7,0').y - y0).toBeGreaterThan(1.85);
    w.dispose();
  });

  it('works sideways and pointing down', async () => {
    const w = await World.create({ seed: 1 }, open);
    // A piston pushing a block east from the core, and one hanging a block below the core, both high enough not to land.
    const side = { format: 1, name: 'side', grid: ['B  B  B  C  I>  F'] };
    const down = { format: 1, name: 'down', grid: ['C  B', 'Iv .', 'F  .'] };
    const r = w.spawnBlueprint(side, { x: -100, y: 500 });
    const d = w.spawnBlueprint(down, { x: -50, y: 500 });
    for (let i = 0; i < 30; i++) w.step();
    // The recoil turns a free base, so measure the distance between the core and the block, not one axis of it.
    const gap = (robot: Robot, from: string, to: string): number => {
      const a = partWorldPose(w, robot, from);
      const b = partWorldPose(w, robot, to);
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    const east0 = gap(r, 'core@3,0', 'frame@5,0');
    const down0 = gap(d, 'core@0,2', 'frame@0,0');
    press(w, r, 'c', 84);
    press(w, d, 'c', 84);
    for (let i = 0; i < 120; i++) w.step();
    expect(gap(r, 'core@3,0', 'frame@5,0') - east0).toBeGreaterThan(1.9);
    expect(gap(d, 'core@0,2', 'frame@0,0') - down0).toBeGreaterThan(1.9);
    w.dispose();
  });

  it('keeps its stroke when the robot is rebuilt after a part is shot away', async () => {
    const w = await World.create({ seed: 1 }, open);
    const r = w.spawnBlueprint(LIFT, { x: -100, y: 0.5 });
    for (let i = 0; i < 30; i++) w.step();
    press(w, r, 'c', 42);
    for (let i = 0; i < 60; i++) w.step();
    const before = block(w, r).y;
    expect(position(w, r)).toBeGreaterThan(0.5);
    const end = r.parts.get('battery@6,0');
    if (end) end.health = 0;
    for (let i = 0; i < 60; i++) w.step();
    expect(r.parts.has('battery@6,0')).toBe(false);
    // The piston is still extended where it was and still answers.
    expect(Math.abs(block(w, r).y - before)).toBeLessThan(0.05);
    press(w, r, 'c', 60);
    for (let i = 0; i < 90; i++) w.step();
    expect(position(w, r)).toBe(1);
    expect(block(w, r).y - before).toBeGreaterThan(0.9);
    w.dispose();
  });

  it('is deterministic', async () => {
    const run = async (): Promise<string> => {
      const w = await World.create({ seed: 3 }, open);
      const r = w.spawnBlueprint(LIFT, { x: -100, y: 0.5 });
      for (let i = 0; i < 30; i++) w.step();
      press(w, r, 'c', 50);
      for (let i = 0; i < 100; i++) w.step();
      press(w, r, 'v', 20);
      for (let i = 0; i < 100; i++) w.step();
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });
  // S4 (review 2026-10-09): the mount side is one 1 kg frame and the carried side an 8 wide hull. Gains sized from the
  // hull alone threw the frame at over 24 m/s in one step, and the crash check destroyed it.
  it('pushes a heavy hull off a light mount without throwing the mount (S4)', async () => {
    const stub = { format: 1, name: 'stub', grid: ['B  B  B  C  B  B  B  B', '.  .  .  I^ .  .  .  .', '.  .  .  F  .  .  .  .'] };
    const w = await World.create({ seed: 1, gravityY: 0 }, open);
    const r = w.spawnBlueprint(stub, { x: 0, y: 500 });
    for (let i = 0; i < 30; i++) w.step();
    const gap = (): number => {
      const a = partWorldPose(w, r, 'frame@3,0');
      const b = partWorldPose(w, r, 'core@3,2');
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    const gap0 = gap();
    let worst = 0;
    let prev: { vx: number; vy: number } | undefined;
    w.step([{ robot: r.id, pressed: ['c'], released: [] }]);
    for (let i = 0; i < 180; i++) {
      if (i === 90) w.step([{ robot: r.id, pressed: [], released: ['c'] }]);
      else w.step();
      const frame = r.parts.get('frame@3,0');
      expect(frame).toBeDefined();
      const s = w.physics.state(r.groups[frame?.group ?? -1]?.bodyId ?? -1);
      if (prev) worst = Math.max(worst, Math.hypot(s.vx - prev.vx, s.vy - prev.vy));
      prev = s;
    }
    expect(worst).toBeLessThan(2);
    expect(r.parts.size).toBe(10);
    // It still did its job: the whole stroke.
    expect(position(w, r)).toBe(1);
    expect(gap() - gap0).toBeGreaterThan(1.9);
    w.dispose();
  });

  /** A robot's piston: its motor as the physics holds it, and how far its head is out, in meters. */
  function arm(w: World, r: Robot): { motor: { stiffness: number; integral: number; target: number }; out: number } {
    const group = r.groups.find((g) => r.parts.get(g.joint?.partId ?? '')?.def.id === 'piston');
    const jointId = group?.joint?.jointId ?? -1;
    const motor = (w.physics as unknown as { sliders: Map<number, { stiffness: number; integral: number; target: number }> }).sliders.get(jointId);
    if (!motor) throw new Error('no piston');
    return { motor, out: w.physics.sliderPosition(jointId) };
  }

  /** Throws the whole robot up at `speed` m/s, so it comes down hard. */
  function hop(w: World, r: Robot, speed: number): void {
    for (const g of r.groups) w.physics.kick(g.bodyId, 0, speed, 0);
  }

  // A hull on legs with a piston hanging under it, as the Anvil's arms hang: a landing swings the head off the stop it
  // is held on, and it can never swing past that stop, so the error only ever has one sign.
  const LEGS = ['F  .  .  .  .  .  F', 'F  .  .  .  .  .  F', 'F  .  .  .  .  .  F', 'F  .  .  .  .  .  F'];
  const BARE = { format: 1, name: 'bare', grid: ['F  F  F  C  F  F  F', 'F  .  .  Iv .  .  F', ...LEGS] };
  const LOADED = { format: 1, name: 'loaded', grid: ['F  F  F  C  F  F  F', 'F  .  .  Iv .  .  F', 'F  .  .  Rv .  .  F', 'F  .  .  Lzv .  .  F', ...LEGS] };

  /** Hops a robot `hops` times, and returns the worst of it: how far the head strayed once settled, and the gains. */
  async function landings(blueprint: { format: number; name: string; grid: string[] }, hops: number, setup?: (w: World, r: Robot) => void): Promise<{ strayed: number; stiffness: number; left: number; lost: number }> {
    const w = await World.create({ seed: 1 }, open);
    const r = w.spawnBlueprint(blueprint, { x: -100, y: blueprint.grid.length - 0.5 });
    const parts = r.parts.size;
    for (let i = 0; i < 60; i++) w.step();
    setup?.(w, r);
    const rest = arm(w, r).motor.target;
    let strayed = 0;
    let stiffness = 0;
    for (let n = 0; n < hops; n++) {
      hop(w, r, 8);
      for (let i = 0; i < 300; i++) {
        w.step();
        stiffness = Math.max(stiffness, arm(w, r).motor.stiffness);
        // Up for about 1.6 s; by 4 s it has landed and should be still.
        if (i > 240) strayed = Math.max(strayed, Math.abs(arm(w, r).out - rest));
      }
    }
    for (let i = 0; i < 180; i++) w.step();
    const left = Math.abs(arm(w, r).motor.integral);
    const lost = parts - r.parts.size;
    w.dispose();
    return { strayed, stiffness, left, lost };
  }

  it('keeps a bare head still through hard landings: a jolt is not a load', async () => {
    const m = await landings(BARE, 6);
    expect(m.lost).toBe(0);
    expect(m.strayed).toBeLessThan(0.02);
    // A 2 kg head needs 200 N/m. It may follow what it thinks it carries, not past what one step can stand.
    expect(m.stiffness).toBeLessThanOrEqual(600);
    // Pressing a stop, it has bled away what the jolts taught it.
    expect(m.left).toBeLessThan(20);
  });

  it('keeps a head carrying a rotator and a laser still through hard landings', async () => {
    const m = await landings(LOADED, 6);
    expect(m.lost).toBe(0);
    expect(m.strayed).toBeLessThan(0.02);
    expect(m.stiffness).toBeLessThanOrEqual(2400);
  });

  it('holds a commanded stroke through hard landings', async () => {
    const m = await landings(BARE, 6, (w, r) => {
      press(w, r, 'c', 40);
      for (let i = 0; i < 60; i++) w.step();
    });
    expect(m.lost).toBe(0);
    expect(m.strayed).toBeLessThan(0.02);
    expect(m.stiffness).toBeLessThanOrEqual(600);
  });

  it('holds up what it carries by joints with no sag: its weight is fed forward', async () => {
    const w = await World.create({ seed: 1 }, open);
    const r = w.spawnBlueprint(LOADED, { x: -100, y: LOADED.grid.length - 0.5 });
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      w.step();
      worst = Math.max(worst, Math.abs(arm(w, r).out));
    }
    expect(worst).toBeLessThan(0.02);
    // Its gains are sized for all of it, and it has nothing to learn.
    expect(arm(w, r).motor.stiffness).toBeGreaterThan(600);
    expect(Math.abs(arm(w, r).motor.integral)).toBeLessThan(5);
    w.dispose();
  });

  it('settles at once when the load it held is gone', async () => {
    const w = await World.create({ seed: 1 }, open);
    const plate = { format: 1, name: 'plate', grid: ['F  F  F  F  F  F  F', '.  .  .  I^ .  .  .', 'B  B  B  C  B  B  B'] };
    const row = 'F  F  F  F  F  F  F  F  F  F  F  F  F  F  F';
    const crate = { format: 1, name: 'crate', grid: [row, row, row, row, row, row, row, row, row, 'F  F  F  F  F  F  F  C  F  F  F  F  F  F  F'] };
    const lift = w.spawnBlueprint(plate, { x: -100, y: 0.5 });
    const load = w.spawnBlueprint(crate, { x: -100, y: 4.5 });
    for (let i = 0; i < 300; i++) w.step();
    press(w, lift, 'c', 50);
    for (let i = 0; i < 240; i++) w.step();
    const held = arm(w, lift);
    expect(held.motor.integral).toBeGreaterThan(1000);
    expect(held.motor.stiffness).toBeGreaterThan(5000);
    w.removeRobots([load.id]);
    // Up it goes, with 1400 N learned on a light head. It may hit the stop, then it comes back and stays.
    for (let i = 0; i < 300; i++) w.step();
    expect(lift.parts.size).toBe(15);
    expect(arm(w, lift).motor.stiffness).toBeLessThan(5000);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 120; i++) {
      w.step();
      lo = Math.min(lo, arm(w, lift).out);
      hi = Math.max(hi, arm(w, lift).out);
    }
    expect(hi - lo).toBeLessThan(0.01);
    expect(Math.abs(hi - held.motor.target)).toBeLessThan(0.02);
    w.dispose();
  });
});
