import { beforeAll, describe, expect, it } from 'vitest';
import { loadRapier } from '../src/physics/rapier';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { StateHasher } from '../src/replay/StateHasher';

beforeAll(async () => {
  await loadRapier();
});

const MOTOR = { model: 'force' as const, targetVelocity: 5, factor: 4, maxTorque: 12 };

describe('PhysicsWorld compound bodies', () => {
  it('sums collider masses into body mass and center of mass', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const body = pw.createBody({ x: 10, y: 20, kind: 'dynamic' });
    let sum = 0;
    let mx = 0;
    let my = 0;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const m = 1 + col + 3 * row;
        pw.addCollider(body, { shape: 'box', hx: 0.25, hy: 0.25 }, { offsetX: col * 0.5, offsetY: row * 0.5, mass: m }, `p${m}`);
        sum += m;
        mx += m * col * 0.5;
        my += m * row * 0.5;
      }
    }
    const mp = pw.massProperties(body);
    expect(mp.mass).toBeCloseTo(45, 3);
    expect(mp.comX - 10).toBeCloseTo(mx / sum, 3);
    expect(mp.comY - 20).toBeCloseTo(my / sum, 3);
    expect(mx / sum).toBeCloseTo(0.567, 3);
    pw.free();
  });

  it('records the owner of each collider', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const body = pw.createBody({ x: 0, y: 0, kind: 'dynamic' });
    pw.addCollider(body, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX: 0, offsetY: 0, mass: 1 }, 'frame@0,0');
    expect(pw.colliderOwners()).toEqual(['frame@0,0']);
    pw.free();
  });

  it('a ball rolls down a fixed ramp', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const angle = (-20 * Math.PI) / 180;
    const ramp = pw.createBody({ x: 0, y: 0, angle, kind: 'fixed' });
    pw.addCollider(ramp, { shape: 'box', hx: 10, hy: 0.5 }, { offsetX: 0, offsetY: 0, mass: 1 });
    const ball = pw.createBody({ x: -3, y: 2, kind: 'dynamic' });
    pw.addCollider(ball, { shape: 'ball', radius: 0.45 }, { offsetX: 0, offsetY: 0, mass: 1.5, friction: 1 });
    const start = pw.state(ball);
    for (let i = 0; i < 90; i++) pw.step();
    const end = pw.state(ball);
    expect(end.x).toBeGreaterThan(start.x + 0.5);
    expect(end.y).toBeLessThan(start.y - 0.5);
    expect(end.w).toBeLessThan(0); // rolling right means spinning clockwise
    pw.free();
  });

  it('a velocity motor drives a wheel toward its target without overshoot', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const hub = pw.createBody({ x: 0, y: 2, kind: 'fixed' });
    pw.addCollider(hub, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX: 0, offsetY: 0, mass: 1 });
    const wheel = pw.createBody({ x: 0, y: 1, kind: 'dynamic' });
    pw.addCollider(wheel, { shape: 'ball', radius: 0.45 }, { offsetX: 0, offsetY: 0, mass: 1.5 });
    const joint = pw.createRevoluteJoint(hub, wheel, { x: 0, y: -1 }, { x: 0, y: 0 }, MOTOR);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      pw.step();
      peak = Math.max(peak, pw.state(wheel).w);
    }
    expect(pw.state(wheel).w).toBeCloseTo(5, 1);
    expect(peak).toBeLessThan(5 * 1.01);
    pw.setMotorVelocity(joint, 0);
    for (let i = 0; i < 30; i++) pw.step();
    expect(Math.abs(pw.state(wheel).w)).toBeLessThan(0.5);
    pw.free();
  });

  it('a joint keeps the wheel at its anchor while the parent falls', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const ground = pw.createBody({ x: 0, y: -1, kind: 'fixed' });
    pw.addCollider(ground, { shape: 'box', hx: 50, hy: 1 }, { offsetX: 0, offsetY: 0, mass: 1 });
    const parent = pw.createBody({ x: 0, y: 3, kind: 'dynamic' });
    pw.addCollider(parent, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX: 0, offsetY: 0, mass: 1 });
    pw.addCollider(parent, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX: 1, offsetY: 0, mass: 1 });
    const wheel = pw.createBody({ x: 0, y: 2, kind: 'dynamic' });
    pw.addCollider(wheel, { shape: 'ball', radius: 0.45 }, { offsetX: 0, offsetY: 0, mass: 1.5 });
    pw.createRevoluteJoint(parent, wheel, { x: 0, y: -1 }, { x: 0, y: 0 }, { ...MOTOR, targetVelocity: 0 });
    for (let i = 0; i < 60; i++) pw.step();
    const p = pw.state(parent);
    const w = pw.state(wheel);
    const ax = p.x + Math.sin(p.angle) * 1;
    const ay = p.y - Math.cos(p.angle) * 1;
    expect(Math.hypot(ax - w.x, ay - w.y)).toBeLessThan(0.01);
    pw.free();
  });

  it('worlds with joints hash identically', () => {
    const make = (): string => {
      const pw = new PhysicsWorld(-9.81, 1 / 60);
      const ground = pw.createBody({ x: 0, y: -1, kind: 'fixed' });
      pw.addCollider(ground, { shape: 'box', hx: 50, hy: 1 }, { offsetX: 0, offsetY: 0, mass: 1 });
      const parent = pw.createBody({ x: 0, y: 3, kind: 'dynamic' });
      pw.addCollider(parent, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX: 0, offsetY: 0, mass: 1 });
      const wheel = pw.createBody({ x: 0, y: 2, kind: 'dynamic' });
      pw.addCollider(wheel, { shape: 'ball', radius: 0.45 }, { offsetX: 0, offsetY: 0, mass: 1.5 });
      pw.createRevoluteJoint(parent, wheel, { x: 0, y: -1 }, { x: 0, y: 0 }, MOTOR);
      for (let i = 0; i < 120; i++) pw.step();
      const h = new StateHasher();
      pw.hashInto(h);
      pw.free();
      return StateHasher.hex(h.digest());
    };
    expect(make()).toBe(make());
  });
});
