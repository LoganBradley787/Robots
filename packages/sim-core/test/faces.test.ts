import { describe, expect, it } from 'vitest';
import { FACES, faceDir, opposite, rotateCell, rotateFace, rotationRadians } from '../src/parts/faces';
import type { Rotation } from '../src/parts/types';

describe('faces', () => {
  it('rotates faces counterclockwise', () => {
    expect(rotateFace('N', 90)).toBe('W');
    expect(rotateFace('N', 180)).toBe('S');
    expect(rotateFace('N', 270)).toBe('E');
    expect(rotateFace('E', 90)).toBe('N');
  });

  it('four quarter turns are the identity', () => {
    for (const f of FACES) {
      let r = f;
      for (let i = 0; i < 4; i++) r = rotateFace(r, 90);
      expect(r).toBe(f);
    }
  });

  it('rotateCell turns offsets counterclockwise', () => {
    expect(rotateCell({ x: 1, y: 0 }, 90)).toEqual({ x: 0, y: 1 });
    expect(rotateCell({ x: 1, y: 0 }, 180)).toEqual({ x: -1, y: 0 });
    expect(rotateCell({ x: 0, y: 0 }, 270)).toEqual({ x: 0, y: 0 });
  });

  it('face directions and opposites agree', () => {
    expect(faceDir('N')).toEqual({ x: 0, y: 1 });
    expect(faceDir('E')).toEqual({ x: 1, y: 0 });
    for (const f of FACES) {
      const d = faceDir(f);
      const o = faceDir(opposite(f));
      expect(d.x + o.x).toBe(0);
      expect(d.y + o.y).toBe(0);
    }
  });

  it('rotating a face matches rotating its direction', () => {
    for (const f of FACES) {
      for (const rot of [0, 90, 180, 270] as Rotation[]) {
        expect(faceDir(rotateFace(f, rot))).toEqual(rotateCell(faceDir(f), rot));
      }
    }
  });

  it('rotationRadians', () => {
    expect(rotationRadians(90)).toBeCloseTo(Math.PI / 2, 12);
  });
});
