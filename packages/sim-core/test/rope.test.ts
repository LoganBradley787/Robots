import { beforeAll, describe, expect, it } from 'vitest';
import { loadRapier } from '../src/physics/rapier';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

beforeAll(loadRapier);

/** Distance between a rope's two anchor points (the body's center and a fixed point). */
function gap(w: PhysicsWorld, body: number, at: { x: number; y: number }): number {
  const s = w.state(body);
  return Math.hypot(s.x - at.x, s.y - at.y);
}

describe('ropes are forces (Batch fix: they stretched without limit on robots with rotators or wheels)', () => {
  for (const jointed of [false, true]) {
    it(`a ${jointed ? 'jointed (multibody link)' : 'lone'} body hangs from a 5 m rope and stays within 0.3 m of it`, () => {
      const w = new PhysicsWorld(-9.81, 1 / 60);
      const ceiling = w.createFixedBox(0, 20, 2, 1);
      const a = w.createDynamicBox(0, 15, 1, 1, 10);
      if (jointed) {
        const b = w.createDynamicBox(1, 15, 1, 1, 10);
        w.createRevoluteJoint(a, b, { x: 1, y: 0 }, { x: 0, y: 0 });
      }
      w.createRope(a, ceiling, { x: 0, y: 0 }, { x: 0, y: 0 }, 5);
      let worst = 0;
      for (let i = 0; i < 300; i++) {
        w.step();
        worst = Math.max(worst, gap(w, a, { x: 0, y: 20 }));
      }
      expect(worst).toBeLessThan(5.3);
      expect(gap(w, a, { x: 0, y: 20 })).toBeGreaterThan(4.9);
      w.free();
    });
  }

  it('a slack rope does nothing', () => {
    const w = new PhysicsWorld(0, 1 / 60);
    const a = w.createDynamicBox(0, 0, 1, 1, 10);
    const b = w.createDynamicBox(3, 0, 1, 1, 10);
    w.createRope(a, b, { x: 0, y: 0 }, { x: 0, y: 0 }, 5);
    for (let i = 0; i < 60; i++) w.step();
    expect(w.state(a).x).toBe(0);
    expect(w.state(b).x).toBe(3);
    w.free();
  });
});
