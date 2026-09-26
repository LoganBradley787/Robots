import type { WorldFile } from '@robots/sim-core';

/** How a stress test lays robots out (M9): rows of `perRow`, `dx` apart, rows `dy` apart, the lowest `lift` above the ground. */
export interface StressGrid {
  count: number;
  perRow: number;
  dx: number;
  dy: number;
  lift: number;
}

/** Hovering drones: ten to a row, 16 m apart (the drone is 11 wide), rows 12 m apart from 8 m up. */
export const HOVER_GRID = (count: number): StressGrid => ({ count, perRow: 10, dx: 16, dy: 12, lift: 8 });
/** One side of a battle: three to a row, 25 m apart, from 15 m up. */
export const BATTLE_GRID = (count: number): StressGrid => ({ count, perRow: 3, dx: 25, dy: 12, lift: 15 });

/**
 * The top of the terrain under `x`: the ground, or a fixed box standing on it, whichever is higher; undefined past
 * the ground's ends. Read from the world file, so it holds for any ground width and any boxes.
 */
export function surfaceAt(file: WorldFile, x: number): number | undefined {
  let top: number | undefined = Math.abs(x) <= file.ground.width / 2 ? 0 : undefined;
  for (const b of file.boxes) {
    if (b.dynamic) continue;
    const a = (b.angleDeg * Math.PI) / 180;
    // Half the box's width and height once turned: enough to say what it covers.
    const hw = (Math.abs(Math.cos(a)) * b.w + Math.abs(Math.sin(a)) * b.h) / 2;
    const hh = (Math.abs(Math.sin(a)) * b.w + Math.abs(Math.cos(a)) * b.h) / 2;
    if (Math.abs(x - b.x) <= hw) top = Math.max(top ?? -Infinity, b.y + hh);
  }
  return top;
}

/**
 * Places up to `grid.count` robots in rows centered on `center.x`, each spot `lift` plus its row's height above the
 * terrain under it. `tryPlace` places one if it fits there (and says whether it did); spots with no terrain under
 * them or no room are skipped, and after three times as many rows as needed it gives up. Returns the spots used.
 */
export function placeGrid(center: { x: number }, grid: StressGrid, surface: (x: number) => number | undefined, tryPlace: (at: { x: number; y: number }) => boolean): { x: number; y: number }[] {
  const placed: { x: number; y: number }[] = [];
  const rows = Math.ceil(grid.count / grid.perRow) * 3;
  for (let r = 0; r < rows && placed.length < grid.count; r++) {
    for (let c = 0; c < grid.perRow && placed.length < grid.count; c++) {
      const x = center.x + (c - (grid.perRow - 1) / 2) * grid.dx;
      const ground = surface(x);
      if (ground === undefined) continue;
      const at = { x, y: ground + grid.lift + r * grid.dy };
      if (tryPlace(at)) placed.push(at);
    }
  }
  return placed;
}
