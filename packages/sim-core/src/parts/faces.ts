import type { Face, Rotation } from './types';

export const FACES: readonly Face[] = ['N', 'E', 'S', 'W'];
export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export interface Cell {
  x: number;
  y: number;
}

const DIRS: Record<Face, Cell> = { N: { x: 0, y: 1 }, E: { x: 1, y: 0 }, S: { x: 0, y: -1 }, W: { x: -1, y: 0 } };
const OPPOSITE: Record<Face, Face> = { N: 'S', E: 'W', S: 'N', W: 'E' };
// One counterclockwise quarter turn: N to W, W to S, S to E, E to N.
const CCW: Record<Face, Face> = { N: 'W', W: 'S', S: 'E', E: 'N' };

export function faceDir(f: Face): Cell {
  return DIRS[f];
}

export function opposite(f: Face): Face {
  return OPPOSITE[f];
}

export function rotateFace(f: Face, rot: Rotation): Face {
  let r = f;
  for (let i = 0; i < rot / 90; i++) r = CCW[r];
  return r;
}

/** Rotates an integer cell offset counterclockwise. Exact, no trig. */
export function rotateCell(c: Cell, rot: Rotation): Cell {
  switch (rot) {
    case 0:
      return { x: c.x, y: c.y };
    case 90:
      return { x: -c.y + 0, y: c.x + 0 };
    case 180:
      return { x: -c.x + 0, y: -c.y + 0 };
    case 270:
      return { x: c.y + 0, y: -c.x + 0 };
  }
}

export function rotationRadians(rot: Rotation): number {
  return (rot * Math.PI) / 180;
}

export function isRotation(v: unknown): v is Rotation {
  return v === 0 || v === 90 || v === 180 || v === 270;
}

export function isFace(v: unknown): v is Face {
  return v === 'N' || v === 'E' || v === 'S' || v === 'W';
}
