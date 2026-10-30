/**
 * A collider that is a rectangle of a body's cells (`assembly/merge.ts`), and how to find the cell a ray or a contact
 * met in it. Everything is in the body's own frame, where cell centers are whole numbers. Pure: no Rapier.
 */
export interface CellBox {
  body: number;
  /** Half the side of each cell's own box: a hair under half a cell. */
  half: number;
  /** Its lowest, leftmost cell. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The part at each cell, by column, then row: `owners[(cx - x) * h + (cy - y)]`. */
  owners: readonly string[];
}

/** The part at the box's cell nearest a point in the body's frame (a contact point on its face: never outside it by much). */
export function cellAt(box: CellBox, x: number, y: number): string {
  const cx = Math.max(box.x, Math.min(box.x + box.w - 1, Math.round(x)));
  const cy = Math.max(box.y, Math.min(box.y + box.h - 1, Math.round(y)));
  return box.owners[(cx - box.x) * box.h + (cy - box.y)] as string;
}

/**
 * Visits each cell of a box that a ray meets within `length`, nearest first, with how far along the ray the cell's own
 * box starts (0 for a ray starting inside it), until `visit` returns true. The ray starts at (ox, oy) along the unit
 * vector (dx, dy), both in the body's frame. Walks the grid: the cells' boxes have gaps between them, as they would as
 * separate colliders, so a ray that starts in a gap meets the next cell where that cell starts. A ray that threads the
 * whole box along a gap (a straight one down the 2 cm between two columns of a level robot) met the box all the same:
 * it stops at the cell where it came in, or a floor of grapples on a 5 m grid goes through a level hull in one tick.
 */
export function walkCells(box: CellBox, ox: number, oy: number, dx: number, dy: number, length: number, visit: (owner: string, distance: number) => boolean): void {
  const lastX = box.x + box.w - 1;
  const lastY = box.y + box.h - 1;
  const { half } = box;
  // Where the ray is inside the box's outer faces.
  let near = 0;
  let far = length;
  if (dx === 0) {
    if (ox < box.x - half || ox > lastX + half) return;
  } else {
    const a = (box.x - half - ox) / dx;
    const b = (lastX + half - ox) / dx;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  if (dy === 0) {
    if (oy < box.y - half || oy > lastY + half) return;
  } else {
    const a = (box.y - half - oy) / dy;
    const b = (lastY + half - oy) / dy;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  if (near > far) return;
  // The cell it starts in, then a step to the next column or row at each half-way line it crosses.
  let cx = Math.max(box.x, Math.min(lastX, Math.round(ox + dx * near)));
  let cy = Math.max(box.y, Math.min(lastY, Math.round(oy + dy * near)));
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const eachX = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const eachY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let nextX = dx === 0 ? Infinity : (cx + stepX / 2 - ox) / dx;
  let nextY = dy === 0 ? Infinity : (cy + stepY / 2 - oy) / dy;
  const startX = cx;
  const startY = cy;
  let met = false;
  for (;;) {
    // This cell's own box.
    let enter = near;
    let exit = far;
    let meets = true;
    if (dx === 0) meets = Math.abs(ox - cx) <= half;
    else {
      const a = (cx - half - ox) / dx;
      const b = (cx + half - ox) / dx;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
    if (dy === 0) meets &&= Math.abs(oy - cy) <= half;
    else {
      const a = (cy - half - oy) / dy;
      const b = (cy + half - oy) / dy;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
    if (meets && enter <= exit) {
      met = true;
      if (visit(box.owners[(cx - box.x) * box.h + (cy - box.y)] as string, enter)) return;
    }
    if (nextX < nextY) {
      if (nextX > far) break;
      cx += stepX;
      nextX += eachX;
      if (cx < box.x || cx > lastX) break;
    } else {
      if (nextY > far) break;
      cy += stepY;
      nextY += eachY;
      if (cy < box.y || cy > lastY) break;
    }
  }
  if (!met) visit(box.owners[(startX - box.x) * box.h + (startY - box.y)] as string, near);
}
