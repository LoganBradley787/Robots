/**
 * Batch: a jammer pod's bubble. While a pod jams, every sensor inside it sees nothing and every sensor outside sees no
 * robot whose reference point is inside (both ways). Pure; the world finds the bubbles (`World.jamBubbles`).
 * Titans (Logan): up close a jam does nothing. A sensor and a point within `near` meters of each other see through
 * the bubble, whichever of them is inside it (a factory parked on a hidden titan could not find it).
 */
export interface JamBubble {
  x: number;
  y: number;
  radius: number;
  /** Meters a sensor sees through this bubble at; absent or 0 for never. */
  near?: number;
}

/** Whether the point is inside any bubble (on the edge counts as inside). */
export function jammed(bubbles: readonly JamBubble[], p: { x: number; y: number }): boolean {
  for (const b of bubbles) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    if (dx * dx + dy * dy <= b.radius * b.radius) return true;
  }
  return false;
}

/**
 * How near a sensor and a point must be to see through the jam at `p`: undefined when `p` is in no bubble (nothing is
 * jammed), else the smallest `near` of the bubbles it is in (0 when one of them is never seen through).
 */
export function jamNear(bubbles: readonly JamBubble[], p: { x: number; y: number }): number | undefined {
  let near: number | undefined;
  for (const b of bubbles) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    if (dx * dx + dy * dy > b.radius * b.radius) continue;
    const n = b.near ?? 0;
    if (near === undefined || n < near) near = n;
  }
  return near;
}
