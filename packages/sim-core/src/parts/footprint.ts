import type { Face, PartDef } from './types';

/**
 * The box a part's sprite covers (M12, multi-cell parts): its footprint's bounding box at rotation 0, in cells. `cx`,
 * `cy` is the box's center measured from the part's origin cell; a one-cell part gives 0, 0, 1, 1.
 */
export function footprintBox(def: PartDef): { cx: number; cy: number; w: number; h: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of def.footprint) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const FLIP: Record<Face, Face> = { N: 'N', S: 'S', E: 'W', W: 'E' };

/**
 * Whether a part mirrored left to right is the same part turned (M12). Mirroring only reflects a part's rotation, which
 * is right for a footprint symmetric about its origin column (every one-cell part, and the fabricator bay); any other
 * multi-cell footprint mirrored would need a different part.
 */
export function mirrorable(def: PartDef): boolean {
  if (def.footprint.length === 1) return true;
  const key = (x: number, y: number, faces: readonly Face[], grips: readonly Face[] = []): string => `${x},${y}:${[...faces].sort().join('')}:${[...grips].sort().join('')}`;
  const cells = new Set(def.footprint.map((c) => key(c.x, c.y, c.faces, c.grips)));
  return def.footprint.every((c) => cells.has(key(-c.x, c.y, c.faces.map((f) => FLIP[f]), (c.grips ?? []).map((f) => FLIP[f]))));
}
