import { Graphics } from 'pixi.js';
import type { SmokeCloud } from '@robots/sim-core';
import { PIXELS_PER_METER, toScreen } from './units';

const SMOKE = 0x8c9099;
const PUFF = 0xb4b8bf;
/** Ticks a cloud takes to thin out at the end of its life (1.5 s), and to thicken at the start. */
const FADE_OUT = 90;
const FADE_IN = 12;

/**
 * Smoke clouds (Batch), drawn fresh every frame as soft grey circles (a few stacked, each fainter toward the edge)
 * that thin out over the last 1.5 s. Read-only: nothing here touches the simulation.
 */
export class SmokeView {
  readonly root = new Graphics();

  draw(clouds: readonly SmokeCloud[]): void {
    const g = this.root;
    g.clear();
    for (const c of clouds) {
      const fade = Math.min(1, c.left / Math.min(FADE_OUT, c.total), (c.total - c.left + 1) / FADE_IN);
      const p = toScreen({ x: c.x, y: c.y });
      const r = c.radius * PIXELS_PER_METER;
      g.circle(p.x, p.y, r).fill({ color: SMOKE, alpha: 0.28 * fade });
      g.circle(p.x, p.y, r * 0.78).fill({ color: SMOKE, alpha: 0.2 * fade });
      g.circle(p.x - r * 0.12, p.y - r * 0.1, r * 0.5).fill({ color: PUFF, alpha: 0.18 * fade });
      g.circle(p.x + r * 0.2, p.y + r * 0.15, r * 0.32).fill({ color: PUFF, alpha: 0.14 * fade });
    }
  }
}
