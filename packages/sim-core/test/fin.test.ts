import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { fin } from '../src/behaviors/fin';
import { defaultRegistry } from '../src/parts/registry';
import type { BehaviorContext } from '../src/behaviors/registry';
import type { BodyState } from '../src/physics/PhysicsWorld';

const sky = parseWorldFile({ name: 'sky', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
const DEFLECT = [{ key: 'f', mode: 'hold', target: 'fin', channel: 'deflect', value: 1 }];
/** A rod with a core on top and a fin on each side of its tail. */
const ROD = { format: 1, name: 'rod', grid: ['.  C  .', '.  F  .', 'L^ F  L^'], bindings: DEFLECT };
const hold = (robot: number, key: string) => [{ robot, pressed: [key], released: [] }];

/** Runs the fin behavior against a fake body: returns the force it applies, or undefined when it applies none. */
function forceOn(state: Partial<BodyState>, opts: { deflect?: number; rot?: 0 | 90 | 180 | 270; localY?: number } = {}) {
  const def = defaultRegistry().get('fin');
  let force: { fx: number; fy: number; px: number; py: number } | undefined;
  const s: BodyState = { x: 0, y: 0, angle: 0, vx: 0, vy: 0, w: 0, ...state };
  const ctx = {
    physics: {
      state: () => s,
      massProperties: () => ({ mass: 3, comX: 0, comY: 0, inertia: 1 }),
      addForceAt: (_id: number, fx: number, fy: number, px: number, py: number) => {
        force = { fx, fy, px, py };
      },
    },
    part: { def, rot: opts.rot ?? 0, localX: 0, localY: opts.localY ?? -2 },
    group: { bodyId: 1 },
    value: () => opts.deflect ?? 0,
    config: (key: string) => def.behaviorConfig?.[key] ?? 0,
  } as unknown as BehaviorContext;
  fin.plan(ctx)?.run(1);
  return force;
}

describe('fins (Batch)', () => {
  it('is a 0.3 kg, 10 health plate with a deflect input and no power draw', () => {
    const d = defaultRegistry().get('fin');
    expect(d).toMatchObject({ mass: 0.3, health: 10, powerDraw: 0, acts: 'N', behavior: 'fin' });
    expect(d.inputs).toEqual([{ name: 'deflect', min: -1, max: 1, default: 0 }]);
  });

  it('a still fin does nothing, and neither does one moving along its plate', () => {
    expect(forceOn({})).toBeUndefined();
    expect(forceOn({ vy: 50 })).toBeUndefined();
  });

  it('a fin at speed pushes back across its plate, in proportion to speed squared', () => {
    const at = (v: number) => forceOn({ vx: v });
    // k = 0.5 * 1.2 * 0.6 = 0.36, so 0.36 * 10 * 10 = 36 N at 10 m/s, against the motion, at the fin's cell.
    expect(at(10)).toMatchObject({ fx: -36, px: 0, py: -2 });
    expect(at(10)?.fy).toBeCloseTo(0, 9);
    expect(at(20)?.fx).toBeCloseTo(-144, 6);
    expect(at(40)?.fx).toBeCloseTo(-576, 6);
    expect(forceOn({ vx: -10 })?.fx).toBeCloseTo(36, 9);
  });

  it('a slanted flow gets the sine of the angle in the cross term and the full speed in the other', () => {
    const f = forceOn({ vx: 3, vy: 4 });
    // v . n = -3, |v| = 5, F = -k * (-3) * 5 along n = (-1, 0): 5.4 N toward -x.
    expect(f?.fx).toBeCloseTo(-0.36 * 3 * 5, 9);
    expect(f?.fy).toBeCloseTo(0, 9);
  });

  it('follows the part turned on the body: a fin at rotation 90 lies across the body', () => {
    // Acts W (rotated from N), so the plate is horizontal and only vertical motion crosses it.
    expect(forceOn({ vx: 30 }, { rot: 90 })).toBeUndefined();
    expect(forceOn({ vy: 10 }, { rot: 90 })?.fy).toBeCloseTo(-36, 9);
    // A body turned a quarter turn counterclockwise lays the plate along x: only vertical motion crosses it.
    expect(forceOn({ vy: 10, angle: Math.PI / 2 }, { localY: 0 })?.fy).toBeCloseTo(-36, 9);
    expect(forceOn({ vx: 10, angle: Math.PI / 2 }, { localY: 0 })?.fx).toBeCloseTo(0, 9);
  });

  it('the air velocity is the body velocity at the cell: spin adds to it', () => {
    // Spinning counterclockwise at 5 rad/s, the cell 2 m below the center moves at +10 m/s in x.
    expect(forceOn({ w: 5 })?.fx).toBeCloseTo(-36, 9);
  });

  it('deflecting turns the plate up to 20 degrees, counterclockwise positive', () => {
    const a = (20 * Math.PI) / 180;
    const along = forceOn({ vy: 10 }, { deflect: 1 });
    // Moving along the plate, a plate turned by a: v . n = -10 sin a, force -k (v . n) |v| along n.
    const mag = 0.36 * 10 * 10 * Math.sin(a);
    expect(along?.fx).toBeCloseTo(-mag * Math.cos(a), 9);
    expect(along?.fy).toBeCloseTo(-mag * Math.sin(a), 9);
    expect(forceOn({ vy: 10 }, { deflect: -1 })?.fx).toBeCloseTo(mag * Math.cos(a), 9);
    // Beyond the range it stops at 20 degrees; half a deflection is 10.
    expect(forceOn({ vy: 10 }, { deflect: 5 })?.fx).toBeCloseTo(-mag * Math.cos(a), 9);
    expect(forceOn({ vy: 10 }, { deflect: 0.5 })?.fx).toBeLessThan(along?.fx !== undefined ? -1 : 0);
  });

  describe('in a world', () => {
    async function rod() {
      const w = await World.create({ seed: 1, gravityY: 0 }, sky);
      const r = w.spawnBlueprint(ROD, { x: 0, y: 100 });
      const body = r.groups[0]?.bodyId as number;
      return { w, r, body };
    }

    it('a still rod with fins stays where it is', async () => {
      const { w, body } = await rod();
      const s0 = w.physics.state(body);
      for (let i = 0; i < 120; i++) w.step();
      const s = w.physics.state(body);
      expect(s.x).toBeCloseTo(s0.x, 9);
      expect(s.y).toBeCloseTo(s0.y, 9);
      expect(s.angle).toBeCloseTo(0, 9);
      w.dispose();
    });

    it('fins at the tail keep the nose into the wind', async () => {
      const finned = await rod();
      const bare = await World.create({ seed: 1, gravityY: 0 }, sky);
      const plain = bare.spawnBlueprint({ format: 1, name: 'rod', grid: ['.  C  .', '.  F  .', 'F  F  F'] }, { x: 0, y: 100 });
      // Thrown sideways at 60 m/s with its nose up (kickRobot: a raw physics kick reads as a crash).
      finned.w.kickRobot(finned.r, 60, 0);
      bare.kickRobot(plain, 60, 0);
      for (let i = 0; i < 40; i++) {
        finned.w.step();
        bare.step();
      }
      // The wind comes from the right, so the nose swings right (clockwise, negative); the bare rod does not turn.
      expect(finned.w.physics.state(finned.body).angle).toBeLessThan(-0.05);
      expect(Math.abs(bare.physics.state(plain.groups[0]?.bodyId as number).angle)).toBeLessThan(1e-6);
      finned.w.dispose();
      bare.dispose();
    });

    it('a fin at speed pushes sideways with the square of the speed', async () => {
      // One tick from a fast start: the sideways speed lost is force over mass, so four times as much at double speed.
      const lost = async (v: number): Promise<number> => {
        const { w, r, body } = await rod();
        w.kickRobot(r, v, 0);
        w.step();
        w.step();
        const s = w.physics.state(body);
        w.dispose();
        return v - s.vx;
      };
      const slow = await lost(20);
      const fast = await lost(40);
      expect(slow).toBeGreaterThan(0.01);
      // Air drag on the body is quadratic too, so the ratio holds for the sum.
      expect(fast / slow).toBeGreaterThan(3.5);
      expect(fast / slow).toBeLessThan(4.5);
    });

    it('deflecting the fins turns a free-flying body', async () => {
      const steer = async (press: boolean) => {
        const { w, r, body } = await rod();
        w.kickRobot(r, 0, 100);
        w.step(press ? hold(r.id, 'f') : []);
        for (let i = 0; i < 30; i++) w.step();
        const s = w.physics.state(body);
        w.dispose();
        return s;
      };
      const free = await steer(false);
      const steered = await steer(true);
      expect(Math.abs(free.angle)).toBeLessThan(1e-6);
      expect(Math.abs(free.vx)).toBeLessThan(1e-6);
      // Both tail fins turned counterclockwise push the tail left, so the nose swings right (clockwise, negative).
      expect(steered.angle).toBeLessThan(-0.02);
      expect(steered.vx).not.toBeCloseTo(0, 2);
    });

    it('is deterministic with fins in it', async () => {
      const run = async (): Promise<string> => {
        const { w, r } = await rod();
        w.kickRobot(r, 30, 80);
        w.step(hold(r.id, 'f'));
        for (let i = 0; i < 60; i++) w.step();
        const h = w.hash();
        w.dispose();
        return h;
      };
      expect(await run()).toBe(await run());
    });
  });
});
