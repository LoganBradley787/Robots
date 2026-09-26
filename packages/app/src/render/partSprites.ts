import { footprintBox, rotateCell, type FootprintCell, type PartDef, type Rotation } from '@robots/sim-core';

/** One sprite of a part, before its body: frame, center offset from the part's origin cell, size in cells, flipped. */
export interface PartSprite {
  frame: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Mirrored left to right in the part's own frame (the right side of a cup). */
  flip: boolean;
}

/**
 * How a part is drawn, turned with it (M12): one sprite over its footprint's box, or, for a stretchy cup with tiles,
 * one tile per cell (and the hollow's back), so any size looks built. Offsets are from the origin cell, in cells.
 */
export function partSprites(def: PartDef, rot: Rotation, cells: readonly FootprintCell[] = def.footprint, frame = def.sprite.frame): PartSprite[] {
  const tiles = def.sprite.tiles;
  if (!def.stretch || !tiles) {
    const box = footprintBox(def, cells);
    const o = rotateCell({ x: box.cx, y: box.cy }, rot);
    return [{ frame, x: o.x, y: o.y, w: box.w, h: box.h, flip: false }];
  }
  const xs = cells.map((c) => c.x);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.max(...cells.map((c) => c.y));
  const out: PartSprite[] = [];
  const at = (x: number, y: number, name: string, flip: boolean): void => {
    const o = rotateCell({ x, y }, rot);
    out.push({ frame: name, x: o.x, y: o.y, w: 1, h: 1, flip });
  };
  // The back of the hollow first, so the walls and anything built draw over it.
  for (let y = 1; y <= top; y++) for (let x = left + 1; x < right; x++) at(x, y, tiles.back, false);
  for (const c of cells) {
    const side = c.x === left ? 'left' : c.x === right ? 'right' : 'middle';
    const name = c.y === 0 ? (side === 'middle' ? tiles.floor : tiles.corner) : c.y === top ? tiles.mouth : tiles.wall;
    at(c.x, c.y, name, side === 'right');
  }
  return out;
}
