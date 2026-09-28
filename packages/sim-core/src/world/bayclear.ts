/**
 * Batch: a fabricator bay clears its hollow. A finished build waits while anything is in the bay's hollow; a piece
 * with no core in it (debris from a blast, a copy whose core is gone) would block the bay for the rest of the fight,
 * so after this long the bay pushes such a piece out along its `acts` face, every tick, until it is clear. A piece with
 * a live core is never pushed: it may be a copy on its way out.
 */
export const BAY_CLEAR_AFTER_S = 1;

/** Speed (m/s) each push adds to a piece in the way, along the bay's acts face (up and out of the U). */
export const BAY_CLEAR_SPEED = 2;

/** Ticks a bay waits on a coreless blocker before it starts pushing. */
export function bayClearAfterTicks(dt: number): number {
  return Math.max(1, Math.round(BAY_CLEAR_AFTER_S / dt));
}
