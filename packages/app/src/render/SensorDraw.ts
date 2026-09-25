import type { Graphics } from 'pixi.js';
import { toScreen } from './units';

/** What one robot's sensors see, as `World.sensorView` gives it, plus its scripts' marks (M8). */
export interface SensorOverlay {
  sensors: readonly { x: number; y: number; facing: number; cone: number; range: number }[];
  contacts: readonly { side: 'enemy' | 'friend' | 'none'; x: number; y: number }[];
  from: { x: number; y: number };
  marks: readonly { x: number; y: number }[];
}

const SIDE_COLOR = { enemy: 0xff5a5a, friend: 0x5aa8ff, none: 0x9a9a9a } as const;
const SENSOR_COLOR = 0x3dff8b;

/**
 * The sensor layer of the debug overlay (M8): each working sensor's cone and range (faint), a line from the robot to
 * each robot it sees (red enemy, blue friend, grey debris), and its scripts' marks as small crosses.
 */
export function drawSensors(g: Graphics, overlays: readonly SensorOverlay[]): void {
  for (const o of overlays) {
    for (const s of o.sensors) {
      const c = toScreen(s);
      const r = toScreen({ x: s.range, y: 0 }).x;
      if (s.cone >= 360) {
        g.circle(c.x, c.y, r).stroke({ color: SENSOR_COLOR, alpha: 0.18, pixelLine: true });
        continue;
      }
      const half = (s.cone / 2) * (Math.PI / 180);
      // Screen angles run clockwise (y down), so a counterclockwise world angle a is -a on screen.
      const a0 = -(s.facing + half);
      const a1 = -(s.facing - half);
      g.moveTo(c.x, c.y)
        .lineTo(c.x + r * Math.cos(a0), c.y + r * Math.sin(a0))
        .arc(c.x, c.y, r, a0, a1)
        .lineTo(c.x, c.y)
        .stroke({ color: SENSOR_COLOR, alpha: 0.25, pixelLine: true });
    }
    const from = toScreen(o.from);
    for (const t of o.contacts) {
      const p = toScreen(t);
      g.moveTo(from.x, from.y).lineTo(p.x, p.y).stroke({ color: SIDE_COLOR[t.side], alpha: 0.7, pixelLine: true });
    }
    for (const m of o.marks) {
      const p = toScreen(m);
      g.moveTo(p.x - 6, p.y - 6).lineTo(p.x + 6, p.y + 6).moveTo(p.x - 6, p.y + 6).lineTo(p.x + 6, p.y - 6).stroke({ color: 0xffd23d, width: 2 });
    }
  }
}
