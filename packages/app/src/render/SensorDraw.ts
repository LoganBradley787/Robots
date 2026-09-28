import type { Graphics } from 'pixi.js';
import { toScreen } from './units';

/** What one robot's sensors see, as `World.sensorView` gives it, plus its scripts' marks (M8). */
export interface SensorOverlay {
  sensors: readonly { x: number; y: number; facing: number; cone: number; range: number }[];
  /** `decoy`: seen at a burning flare standing in for the robot (M11). */
  contacts: readonly { side: 'enemy' | 'friend' | 'none'; x: number; y: number; decoy?: boolean }[];
  from: { x: number; y: number };
  marks: readonly { x: number; y: number }[];
  /** M13: each gun's sight: from its barrel's end along its aim for `distance` meters, and what it sees (`SIGHT`). */
  sights?: readonly { x: number; y: number; aim: number; distance: number; side: number }[];
}

const SIDE_COLOR = { enemy: 0xff5a5a, friend: 0x5aa8ff, none: 0x9a9a9a } as const;
const SENSOR_COLOR = 0x3dff8b;
const DECOY_COLOR = 0xffb13b;
/** Sight line colors by what a gun sees (SIGHT: nothing, own, friend, enemy, nobody's, terrain). */
const SIGHT_COLOR = [0x3dff8b, 0xffd23d, 0x5aa8ff, 0xff5a5a, 0x9a9a9a, 0x8a6a4a] as const;

/**
 * The sensor layer of the debug overlay (M8): each working sensor's cone and range (faint), a line from the robot to
 * each robot it sees (red enemy, blue friend, grey debris), and its scripts' marks as small crosses. A robot seen at
 * a flare (M11) gets its line drawn to the flare, ending in an orange ring: that sensor is fooled. Each gun's sight
 * (M13) is a line out of its barrel to what it would hit first: green nothing, yellow its own robot, blue a friend,
 * red an enemy, grey nobody's, brown terrain.
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
      if (t.decoy === true) g.circle(p.x, p.y, 14).stroke({ color: DECOY_COLOR, width: 2, alpha: 0.9 });
    }
    for (const s of o.sights ?? []) {
      const a = toScreen(s);
      const b = toScreen({ x: s.x + Math.cos(s.aim) * s.distance, y: s.y + Math.sin(s.aim) * s.distance });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: SIGHT_COLOR[s.side] ?? 0xffffff, alpha: 0.6, pixelLine: true });
    }
    for (const m of o.marks) {
      const p = toScreen(m);
      g.moveTo(p.x - 6, p.y - 6).lineTo(p.x + 6, p.y + 6).moveTo(p.x - 6, p.y + 6).lineTo(p.x + 6, p.y - 6).stroke({ color: 0xffd23d, width: 2 });
    }
  }
}
