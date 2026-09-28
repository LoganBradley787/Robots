import { Graphics } from 'pixi.js';
import type { Shell } from '@robots/sim-core';
import { toScreen } from './units';

const TRACER = 0xfff1b8;
const GLOW = 0xffb13b;
/** Meters of streak behind each shell (it moves 5 m a tick, so a dot would flicker). */
const STREAK = 2.5;

/**
 * Shells in flight (M13), drawn fresh every frame as short bright streaks, each between where it was on the last tick
 * and where it is now (`alpha` of the way), so they move smoothly at any frame rate. Read-only: nothing here touches
 * the simulation.
 */
export class ShellsView {
  readonly root = new Graphics();

  draw(shells: readonly Shell[], alpha: number): void {
    const g = this.root;
    g.clear();
    for (const s of shells) {
      const x = s.px + (s.x - s.px) * alpha;
      const y = s.py + (s.y - s.py) * alpha;
      const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      if (v === 0) continue;
      const head = toScreen({ x, y });
      // Not behind the muzzle on the tick it left.
      const len = Math.min(STREAK, Math.hypot(x - s.px, y - s.py) + 0.3);
      const tail = toScreen({ x: x - (s.vx / v) * len, y: y - (s.vy / v) * len });
      g.moveTo(tail.x, tail.y).lineTo(head.x, head.y).stroke({ color: GLOW, width: 5, alpha: 0.35 });
      g.moveTo(tail.x, tail.y).lineTo(head.x, head.y).stroke({ color: TRACER, width: 2 });
    }
  }
}
