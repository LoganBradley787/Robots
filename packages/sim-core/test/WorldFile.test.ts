import { beforeAll, describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { loadRapier } from '../src/physics/rapier';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { buildWorld, parseWorldFile, WorldFileError } from '../src/world/WorldFile';

beforeAll(async () => {
  await loadRapier();
});

describe('parseWorldFile', () => {
  it('parses the shipped flat world with defaults filled in', () => {
    const w = parseWorldFile(flatJson);
    expect(w.name).toBe('flat');
    expect(w.ground).toEqual({ width: 4000, thickness: 2 });
    expect(w.spawn).toEqual({ x: 0, y: 6 });
    expect(w.boxes).toHaveLength(3);
    expect(w.boxes[0]).toEqual({ x: 8, y: 1, w: 2, h: 2, angleDeg: 0, dynamic: false, mass: 1 });
    expect(w.boxes[1]?.angleDeg).toBe(18);
  });

  it('names the missing field in its error', () => {
    expect(() => parseWorldFile({ name: 'x', ground: { width: 10 } })).toThrow(WorldFileError);
    expect(() => parseWorldFile({ name: 'x', ground: { width: 10 } })).toThrow('world.spawn');
  });

  it('rejects non-positive sizes', () => {
    expect(() => parseWorldFile({ ground: { width: 0 }, spawn: { x: 0, y: 0 } })).toThrow('world.ground.width');
    expect(() =>
      parseWorldFile({ ground: { width: 10 }, spawn: { x: 0, y: 0 }, boxes: [{ x: 0, y: 0, w: 1, h: -1 }] }),
    ).toThrow('world.boxes[0].h');
  });
});

describe('parseWorldFile strictness', () => {
  const base = { ground: { width: 10 }, spawn: { x: 0, y: 0 } };

  it('rejects unknown keys and names the allowed ones', () => {
    expect(() => parseWorldFile({ ...base, boxes: [{ x: 0, y: 0, w: 1, h: 1, dynamics: true }] })).toThrow(
      'world.boxes[0].dynamics is not a known field',
    );
    expect(() => parseWorldFile({ ...base, gravity: -9 })).toThrow('world.gravity is not a known field');
  });

  it('rejects a non-boolean dynamic and a non-string name', () => {
    expect(() => parseWorldFile({ ...base, boxes: [{ x: 0, y: 0, w: 1, h: 1, dynamic: 'true' }] })).toThrow(
      'world.boxes[0].dynamic must be true or false',
    );
    expect(() => parseWorldFile({ ...base, name: 3 })).toThrow('world.name must be a string');
  });
});

describe('buildWorld', () => {
  it('creates one ground body plus one body per box', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const file = parseWorldFile(flatJson);
    const built = buildWorld(pw, file);
    expect(built.boxIds).toHaveLength(3);
    expect(pw.bodyIds).toHaveLength(4);
    expect(pw.state(built.groundId).y).toBe(-1);
    expect(pw.state(built.boxIds[1] ?? 0).angle).toBeCloseTo((18 * Math.PI) / 180, 6);
    pw.free();
  });
});
