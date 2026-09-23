import type { Graphics } from 'pixi.js';
import type { DebugBuffers } from '@robots/sim-core';
import { toScreen } from './units';

function packColor(r: number, g: number, b: number): number {
  return ((Math.round(r * 255) & 0xff) << 16) | ((Math.round(g * 255) & 0xff) << 8) | (Math.round(b * 255) & 0xff);
}

/**
 * Rapier debug buffers: vertices hold 2 floats per point and 2 points per segment; colors hold 4 floats per point.
 * One stroke per run of identical color keeps draw calls low. pixelLine keeps lines 1 px at any zoom.
 */
export function drawDebug(g: Graphics, buffers: DebugBuffers, visible: boolean): void {
  g.clear();
  if (!visible) return;
  const v = buffers.vertices;
  const c = buffers.colors;
  const segments = Math.floor(v.length / 4);
  let current = -1;
  let open = false;
  for (let i = 0; i < segments; i++) {
    const color = packColor(c[i * 8] ?? 1, c[i * 8 + 1] ?? 1, c[i * 8 + 2] ?? 1);
    if (color !== current) {
      if (open) g.stroke({ color: current, pixelLine: true });
      current = color;
      open = true;
    }
    const a = toScreen({ x: v[i * 4] ?? 0, y: v[i * 4 + 1] ?? 0 });
    const b = toScreen({ x: v[i * 4 + 2] ?? 0, y: v[i * 4 + 3] ?? 0 });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  if (open) g.stroke({ color: current, pixelLine: true });
}
