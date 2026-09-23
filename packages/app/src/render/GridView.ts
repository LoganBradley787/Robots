import { Graphics } from 'pixi.js';
import { toScreen } from './units';

export interface GridBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Faint 1 m lines, drawn once, so scale reads at a glance. Every fifth line is a little brighter. */
export function buildGridView(bounds: GridBounds): Graphics {
  const g = new Graphics();
  const line = (ax: number, ay: number, bx: number, by: number): void => {
    const a = toScreen({ x: ax, y: ay });
    const b = toScreen({ x: bx, y: by });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  };
  for (const major of [false, true]) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) if ((x % 5 === 0) === major) line(x, bounds.minY, x, bounds.maxY);
    for (let y = bounds.minY; y <= bounds.maxY; y++) if ((y % 5 === 0) === major) line(bounds.minX, y, bounds.maxX, y);
    g.stroke({ color: 0xffffff, alpha: major ? 0.09 : 0.045, pixelLine: true });
  }
  return g;
}
