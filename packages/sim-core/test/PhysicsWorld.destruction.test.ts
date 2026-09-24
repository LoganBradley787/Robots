import { beforeAll, describe, expect, it } from 'vitest';
import { loadRapier } from '../src/physics/rapier';
import { PhysicsWorld, wrapAngle, type BodyId } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await loadRapier();
});

const DT = 1 / 60;

/** A 3-cell body (6 kg) with a wheel hanging below its right cell, like half a car. */
function car(pw: PhysicsWorld, x: number, y: number, angle = 0, relWheel = 0): { body: BodyId; wheel: BodyId } {
  const body = pw.createBody({ x, y, angle, kind: 'dynamic' });
  for (const ox of [-1, 0, 1]) pw.addCollider(body, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX: ox, offsetY: 0, mass: 2 }, `f${ox}`);
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  const wheel = pw.createBody({ x: x + c * 1 - n * -1, y: y + n * 1 + c * -1, angle: angle + relWheel, kind: 'dynamic' });
  pw.addCollider(wheel, { shape: 'ball', radius: 0.45 }, { offsetX: 0, offsetY: 0, mass: 1.5 }, 'w');
  pw.keepRootAngle(body, angle);
  pw.createRevoluteJoint(body, wheel, { x: 1, y: -1 }, { x: 0, y: 0 }, undefined, relWheel);
  return { body, wheel };
}

describe('PhysicsWorld for destruction (M6)', () => {
  it('a kick gives a multibody its velocity field, wheel spin included', () => {
    const pw = new PhysicsWorld(0, DT);
    const { body, wheel } = car(pw, 0, 10);
    const cb = pw.massProperties(body);
    const cw = pw.massProperties(wheel);
    const v = { x: 5, y: 1 };
    const w = 0.5;
    pw.kick(body, v.x, v.y, w);
    pw.kick(wheel, v.x - w * (cw.comY - cb.comY), v.y + w * (cw.comX - cb.comX), 20);
    pw.step();
    pw.step();
    const s = pw.state(body);
    expect(s.vx).toBeCloseTo(5, 1);
    expect(s.vy).toBeCloseTo(1, 1);
    expect(s.w).toBeCloseTo(0.5, 1);
    expect(Math.abs(pw.state(wheel).w - 20) / 20).toBeLessThan(0.02);
    pw.free();
  });

  it('a piece built mid-tumble keeps its angle and its wheel keeps its relative angle', () => {
    const pw = new PhysicsWorld(0, DT);
    const { body, wheel } = car(pw, 0, 10, 0.9, 0.5);
    pw.step();
    pw.step();
    expect(pw.state(body).angle).toBeCloseTo(0.9, 3);
    expect(pw.state(wheel).angle).toBeCloseTo(1.4, 3);
    // The wheel still hangs where it should: 1 right and 1 down in the body's frame.
    const s = pw.state(body);
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    expect(pw.state(wheel).x).toBeCloseTo(s.x + c + n, 3);
    expect(pw.state(wheel).y).toBeCloseTo(s.y + n - c, 3);
    pw.free();
  });

  it('without the helper Rapier would reset the angle (the reason keepRootAngle exists)', () => {
    const pw = new PhysicsWorld(0, DT);
    const body = pw.createBody({ x: 0, y: 10, angle: 0.9, kind: 'dynamic' });
    pw.addCollider(body, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX: 0, offsetY: 0, mass: 2 }, 'f');
    const wheel = pw.createBody({ x: 0, y: 9, angle: 0.9, kind: 'dynamic' });
    pw.addCollider(wheel, { shape: 'ball', radius: 0.45 }, { offsetX: 0, offsetY: 0, mass: 1 }, 'w');
    pw.createRevoluteJoint(body, wheel, { x: 0, y: -1 }, { x: 0, y: 0 });
    pw.step();
    expect(pw.state(body).angle).toBe(0);
    pw.free();
  });

  it('removing a body drops its colliders, joints, and helpers', () => {
    const pw = new PhysicsWorld(-9.81, DT);
    const { body, wheel } = car(pw, 0, 10, 0.3, 0.2);
    expect(pw.bodyIds.length).toBe(4);
    pw.removeBody(wheel);
    pw.removeBody(body);
    expect(pw.bodyIds).toEqual([]);
    expect(pw.colliderOwners()).toEqual([]);
    pw.step();
    pw.free();
  });

  it('a position motor holds a 3-cell arm level against gravity', () => {
    const pw = new PhysicsWorld(-9.81, DT);
    const base = pw.createBody({ x: 0, y: 10, kind: 'fixed' });
    const arm = pw.createBody({ x: 0, y: 11, kind: 'dynamic' });
    for (const ox of [0, 1, 2, 3]) pw.addCollider(arm, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX: ox, offsetY: 0, mass: 1 }, `a${ox}`);
    const joint = pw.createRevoluteJoint(base, arm, { x: 0, y: 1 }, { x: 0, y: 0 });
    for (let i = 0; i < 240; i++) {
      pw.setPositionMotor(joint, 0.5, 2000, 350, 200);
      pw.step();
    }
    expect(Math.abs(pw.jointAngle(joint) - 0.5)).toBeLessThan((2 * Math.PI) / 180);
    expect(Math.abs(pw.state(arm).w)).toBeLessThan(0.01);
    pw.free();
  });

  it('wraps angles into [-pi, pi)', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapAngle(3 * Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5, 12);
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5, 12);
  });
});
