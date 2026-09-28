import { segmentHitsBox, type BlastBox } from '../damage/explosion';
import { smokeBlocks, type SmokeCloud } from './smoke';

/** A working sensor part in world space (M8). `facing` is the direction it looks, in radians. */
export interface SensorPose {
  id: string;
  x: number;
  y: number;
  facing: number;
  /** Degrees; 360 sees all around. */
  cone: number;
  range: number;
}

/**
 * Whether the sensor sees the point: within range, inside its cone, and no terrain box crosses the line between them.
 * Robots never block (Logan, M8). Batch: a smoke cloud blocks too when the line touches its circle (either end inside
 * one counts). Pure.
 */
export function sees(s: SensorPose, p: { x: number; y: number }, terrain: readonly BlastBox[], clouds: readonly SmokeCloud[] = []): boolean {
  const dx = p.x - s.x;
  const dy = p.y - s.y;
  const d2 = dx * dx + dy * dy;
  if (d2 > s.range * s.range) return false;
  if (s.cone < 360 && d2 > 1e-12) {
    const d = Math.sqrt(d2);
    const along = (dx * Math.cos(s.facing) + dy * Math.sin(s.facing)) / d;
    if (along < Math.cos(((s.cone / 2) * Math.PI) / 180) - 1e-12) return false;
  }
  for (const t of terrain) if (segmentHitsBox(s.x, s.y, p.x, p.y, t.x, t.y, t.hx, t.hy, t.angle)) return false;
  for (const c of clouds) if (smokeBlocks(c, s.x, s.y, p.x, p.y)) return false;
  return true;
}
