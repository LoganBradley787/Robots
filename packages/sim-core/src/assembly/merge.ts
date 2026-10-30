/** One cell of a body to merge: where it is in the body's frame (whole cells), the part it belongs to, its mass. */
export interface MergeCell {
  x: number;
  y: number;
  owner: string;
  mass: number;
}

/**
 * A filled rectangle of a body's cells. Its cells' owners go by column, then row: `owners[(cx - x) * h + (cy - y)]`.
 * Mass, center of mass (body frame) and inertia about it are the sum of its cells', each a box of half side `half`.
 */
export interface CellRect {
  /** Its lowest, leftmost cell. */
  x: number;
  y: number;
  w: number;
  h: number;
  owners: string[];
  mass: number;
  comX: number;
  comY: number;
  inertia: number;
}

/**
 * Rectangles that cover a body's cells exactly, each cell in one: greedy, from the lowest, leftmost cell not yet taken,
 * grown right as far as it goes, then up while whole rows are free. The result depends only on the set of cells, never
 * on their order, so a rebuilt robot's colliders have no history. `half` is the half side of a cell's box, for its own
 * inertia. The cells must not repeat.
 */
export function mergeCells(cells: readonly MergeCell[], half: number): CellRect[] {
  const n = cells.length;
  if (n === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  // Which cell is at each spot, by a spot's number: in a table when the box is not much bigger than the body.
  const table = cols * rows <= 8 * n + 4096 ? new Int32Array(cols * rows).fill(-1) : undefined;
  const sparse = table ? undefined : new Map<number, number>();
  const spot = (x: number, y: number): number => (y - minY) * cols + (x - minX);
  for (let i = 0; i < n; i++) {
    const c = cells[i] as MergeCell;
    if (table) table[spot(c.x, c.y)] = i;
    else sparse?.set(spot(c.x, c.y), i);
  }
  const taken = new Uint8Array(n);
  /** The cell at (x, y) if it is free, else -1. */
  const free = (x: number, y: number): number => {
    if (x < minX || x > maxX || y < minY || y > maxY) return -1;
    const i = table ? (table[spot(x, y)] as number) : (sparse?.get(spot(x, y)) ?? -1);
    return i >= 0 && taken[i] === 0 ? i : -1;
  };
  const rowFree = (x: number, y: number, w: number): boolean => {
    for (let i = 0; i < w; i++) if (free(x + i, y) < 0) return false;
    return true;
  };

  // Lowest row first, left to right.
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((p, q) => spot((cells[p] as MergeCell).x, (cells[p] as MergeCell).y) - spot((cells[q] as MergeCell).x, (cells[q] as MergeCell).y));

  const rects: CellRect[] = [];
  for (let k = 0; k < n; k++) {
    const first = order[k] as number;
    if (taken[first] === 1) continue;
    const { x, y } = cells[first] as MergeCell;
    let w = 1;
    while (free(x + w, y) >= 0) w++;
    let h = 1;
    while (rowFree(x, y + h, w)) h++;
    const owners: string[] = [];
    let mass = 0;
    let sx = 0;
    let sy = 0;
    let turning = 0;
    for (let cx = x; cx < x + w; cx++) {
      for (let cy = y; cy < y + h; cy++) {
        const i = free(cx, cy);
        const c = cells[i] as MergeCell;
        taken[i] = 1;
        owners.push(c.owner);
        mass += c.mass;
        sx += c.mass * cx;
        sy += c.mass * cy;
        // Second moment about the body's origin: the cell's own box, then the cell at its place.
        turning += c.mass * (cx * cx + cy * cy + (2 * half * half) / 3);
      }
    }
    const comX = mass > 0 ? sx / mass : x + (w - 1) / 2;
    const comY = mass > 0 ? sy / mass : y + (h - 1) / 2;
    rects.push({ x, y, w, h, owners, mass, comX, comY, inertia: turning - mass * (comX * comX + comY * comY) });
  }
  return rects;
}
