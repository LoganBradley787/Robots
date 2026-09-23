import { beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, rapierVersion } from '../src/physics/rapier';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { StateHasher } from '../src/replay/StateHasher';

beforeAll(async () => {
  await loadRapier();
});

describe('PhysicsWorld', () => {
  it('reports a semver rapier version', () => {
    expect(rapierVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('a dynamic box falls onto the ground and settles at y = 0.5', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    pw.createFixedBox(0, -1, 100, 2); // top surface at y = 0
    const box = pw.createDynamicBox(0, 5, 1, 1, 1);
    for (let i = 0; i < 180; i++) pw.step();
    const s = pw.state(box);
    expect(s.y).toBeCloseTo(0.5, 1);
    expect(Math.abs(s.vy)).toBeLessThan(0.05);
    expect(pw.bodyIds).toEqual([1, 2]);
    pw.free();
  });

  it('keeps the previous state for interpolation', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const box = pw.createDynamicBox(0, 5, 1, 1, 1);
    pw.step();
    expect(pw.prevState(box).y).toBe(5);
    expect(pw.state(box).y).toBeLessThan(5);
    pw.free();
  });

  it('applies the initial rotation of fixed boxes', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const ramp = pw.createFixedBox(0, 0, 4, 1, 0.5);
    expect(pw.state(ramp).angle).toBeCloseTo(0.5, 6);
    pw.free();
  });

  it('debugRender returns line buffers with 4 color floats per vertex', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    pw.createFixedBox(0, -1, 10, 2);
    pw.step();
    const d = pw.debugRender();
    expect(d.vertices.length).toBeGreaterThan(0);
    expect(d.colors.length).toBe(d.vertices.length * 2);
    pw.free();
  });

  it('hashInto is identical for identical worlds', () => {
    const make = (): PhysicsWorld => {
      const pw = new PhysicsWorld(-9.81, 1 / 60);
      pw.createFixedBox(0, -1, 100, 2);
      pw.createDynamicBox(0.3, 5, 1, 1, 1, 0.2);
      for (let i = 0; i < 120; i++) pw.step();
      return pw;
    };
    const a = make();
    const b = make();
    const ha = new StateHasher();
    const hb = new StateHasher();
    a.hashInto(ha);
    b.hashInto(hb);
    expect(ha.digest()).toBe(hb.digest());
    a.free();
    b.free();
  });
});
