import type { Rotation } from '../parts/types';
import { partId } from './expand';
import type { Blueprint } from './types';

/**
 * Mirroring across a vertical axis. The axis is stored in half cells so it can sit on a column center (even) or a
 * cell boundary (odd). Every v1 part is symmetric about its own vertical axis at rotation 0, so a mirrored part only
 * needs its rotation reflected: left-facing becomes right-facing. Asymmetric or multi-cell parts would need a
 * mirrored footprint; none exist yet.
 */
export function mirrorRotation(rot: Rotation): Rotation {
  return ((360 - rot) % 360) as Rotation;
}

export function mirrorX(x: number, axisHalfCells: number): number {
  return axisHalfCells - x;
}

export function mirrorBlueprint(bp: Blueprint, axisHalfCells: number): Blueprint {
  return {
    ...bp,
    parts: bp.parts.map((p) => {
      const x = mirrorX(p.x, axisHalfCells);
      const id = partId(p.part, x, p.y);
      const explicit = p.tags.filter((t) => t !== p.id);
      return { id, part: p.part, x, y: p.y, rot: mirrorRotation(p.rot), tags: [...explicit, id], ...(p.auto === false ? { auto: false as const } : {}) };
    }),
  };
}
