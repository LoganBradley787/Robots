/**
 * Batch: a jammer pod's bubble. While a pod jams, every sensor inside it sees nothing and every sensor outside sees no
 * robot whose reference point is inside (both ways). Pure; the world finds the bubbles (`World.jamBubbles`).
 */
export interface JamBubble {
  x: number;
  y: number;
  radius: number;
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
