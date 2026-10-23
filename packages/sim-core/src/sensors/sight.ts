import { segmentHitsTurnedBox, type BlastBox } from '../damage/explosion';
import { smokeBlocks, type SmokeCloud } from './smoke';
import { cos, sin } from '../math/fdlibm';

/** A working sensor part in world space (M8). `facing` is the direction it looks, in radians. */
export interface SensorPose {
  id: string;
  x: number;
  y: number;
  facing: number;
  /** Degrees; 360 sees all around. */
  cone: number;
  range: number;
  /** Titans: the sensor is inside a jammer's bubble and sees only what is within this many meters of it. */
  jamNear?: number;
}

/** A sensor's facing as a cosine and sine, and the cosine its cone's edge is at (less a hair), worked out once per pose. */
const cones = new WeakMap<SensorPose, { c: number; s: number; edge: number; facing: number; cone: number }>();
function coneOf(s: SensorPose): { c: number; s: number; edge: number } {
  let k = cones.get(s);
  if (!k || k.facing !== s.facing || k.cone !== s.cone) {
    k = { c: cos(s.facing), s: sin(s.facing), edge: cos(((s.cone / 2) * Math.PI) / 180) - 1e-12, facing: s.facing, cone: s.cone };
    cones.set(s, k);
  }
  return k;
}

/** A box's angle as a cosine and sine, worked out once per box. */
const turns = new WeakMap<BlastBox, { c: number; s: number; angle: number }>();
function turnOf(t: BlastBox): { c: number; s: number } {
  let k = turns.get(t);
  if (!k || k.angle !== t.angle) {
    k = { c: cos(t.angle), s: sin(t.angle), angle: t.angle };
    turns.set(t, k);
  }
  return k;
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
    const k = coneOf(s);
    const along = (dx * k.c + dy * k.s) / d;
    if (along < k.edge) return false;
  }
  for (const t of terrain) {
    const k = turnOf(t);
    if (segmentHitsTurnedBox(s.x, s.y, p.x, p.y, t.x, t.y, t.hx, t.hy, k.c, k.s)) return false;
  }
  for (const c of clouds) if (smokeBlocks(c, s.x, s.y, p.x, p.y)) return false;
  return true;
}
