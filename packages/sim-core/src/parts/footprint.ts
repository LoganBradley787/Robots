import { rotateCell } from './faces';
import type { Face, FootprintCell, PartDef } from './types';

/**
 * A cup (M12, `stretch`): a U open at the top, its hollow `w` wide and `h` tall. The origin is the floor cell under
 * the hollow's left column; the walls are at x -1 and x w.
 */
export function cupFootprint(w: number, h: number): FootprintCell[] {
  const cells: FootprintCell[] = [];
  for (let x = 0; x < w; x++) cells.push({ x, y: 0, faces: ['S'], grips: ['N'] });
  cells.push({ x: -1, y: 0, faces: ['S', 'W'] }, { x: w, y: 0, faces: ['S', 'E'] });
  for (let y = 1; y <= h; y++) cells.push({ x: -1, y, faces: y === h ? ['W', 'N'] : ['W'], grips: ['E'] });
  for (let y = 1; y <= h; y++) cells.push({ x: w, y, faces: y === h ? ['E', 'N'] : ['E'], grips: ['W'] });
  return cells;
}

/** A stretchy part's default size, from the footprint its def lists (M12). */
export function defaultSize(def: PartDef): [number, number] | undefined {
  if (!def.stretch) return undefined;
  const b = footprintBox(def);
  return [b.w - 2, b.h - 1];
}

/** A part's cells at rotation 0 for the size it was placed at (M12); its def's footprint when it does not stretch. */
export function footprintOf(def: PartDef, size?: readonly [number, number]): FootprintCell[] {
  if (!def.stretch || size === undefined) return def.footprint;
  const d = defaultSize(def);
  if (d && d[0] === size[0] && d[1] === size[1]) return def.footprint;
  return cupFootprint(size[0], size[1]);
}

/** A part's mass at its size (M12: a stretchy part weighs `massPerCell` per cell). */
export function partMass(def: PartDef, footprint: readonly FootprintCell[] = def.footprint): number {
  return def.stretch ? def.stretch.massPerCell * footprint.length : def.mass;
}

/**
 * The box a part's sprite covers (M12, multi-cell parts): its footprint's bounding box at rotation 0, in cells. `cx`,
 * `cy` is the box's center measured from the part's origin cell; a one-cell part gives 0, 0, 1, 1.
 */
export function footprintBox(def: PartDef, footprint: readonly FootprintCell[] = def.footprint): { cx: number; cy: number; w: number; h: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of footprint) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const FLIP: Record<Face, Face> = { N: 'N', S: 'S', E: 'W', W: 'E' };

/**
 * Whether a part mirrored left to right is the same part turned and moved (M12). Mirroring reflects a part's rotation
 * and moves its origin so its cells land where the mirrored cells are (`mirroredX`): right for a footprint that is
 * symmetric about some column (every one-cell part, and a bay of any width); any other multi-cell footprint mirrored
 * would need a different part.
 */
export function mirrorable(def: PartDef, footprint: readonly FootprintCell[] = def.footprint): boolean {
  if (footprint.length === 1) return true;
  const xs = footprint.map((c) => c.x);
  const mid = Math.min(...xs) + Math.max(...xs);
  const key = (x: number, y: number, faces: readonly Face[], grips: readonly Face[] = []): string => `${x},${y}:${[...faces].sort().join('')}:${[...grips].sort().join('')}`;
  const cells = new Set(footprint.map((c) => key(c.x, c.y, c.faces, c.grips)));
  return footprint.every((c) => cells.has(key(mid - c.x, c.y, c.faces.map((f) => FLIP[f]), (c.grips ?? []).map((f) => FLIP[f]))));
}

/**
 * How far a mirrored part's origin moves from the reflection of its old origin (M12). A footprint symmetric about the
 * column halfway between x = 0 and x = m (m = its leftmost plus rightmost x) reflects onto itself shifted by m, so the
 * mirrored part, turned to `newRot` (the reflected rotation), sits m cells back along its own x.
 */
export function mirroredShift(footprint: readonly FootprintCell[], newRot: 0 | 90 | 180 | 270): { x: number; y: number } {
  const xs = footprint.map((c) => c.x);
  const m = Math.min(...xs) + Math.max(...xs);
  if (m === 0) return { x: 0, y: 0 };
  const d = rotateCell({ x: m, y: 0 }, newRot);
  return { x: -d.x + 0, y: -d.y + 0 };
}
