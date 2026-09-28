/**
 * Smoke (Batch): a cloud a smoke pod leaves where it went off. It is a circle that drifts down slowly and blocks
 * sensors' line of sight like terrain does. Pure: the world keeps the list and hashes it.
 */
export interface SmokeCloud {
  x: number;
  y: number;
  radius: number;
  /** Ticks it has left. */
  left: number;
  /** Ticks it lasted in all, so a drawing can fade it out. */
  total: number;
}

/** How fast a cloud sinks, m/s. */
export const SMOKE_DRIFT = 0.5;

/**
 * Whether the segment from `a` to `b` touches the cloud's circle. A sensor or a target inside the cloud counts (the
 * nearest point of the segment to the center is then inside). Pure.
 */
export function smokeBlocks(c: { x: number; y: number; radius: number }, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.y - ay) * dy) / len2));
  const px = ax + t * dx - c.x;
  const py = ay + t * dy - c.y;
  return px * px + py * py <= c.radius * c.radius;
}
