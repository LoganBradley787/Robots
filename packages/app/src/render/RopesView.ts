import { Graphics } from 'pixi.js';
import { toScreen } from './units';

const ROPE = 0xd9c9a3;
const SHADOW = 0x2a2218;
const HOOK = 0xe8c21e;

/**
 * Grapple ropes (Batch), drawn fresh every frame as a line from each grapple's barrel to where its hook caught, with a
 * small hook at the far end. A taut rope is pale and solid; a slack one is drawn fainter. Read-only: nothing here
 * touches the simulation.
 */
export class RopesView {
  readonly root = new Graphics();

  draw(ropes: readonly { x1: number; y1: number; x2: number; y2: number; taut: boolean }[]): void {
    const g = this.root;
    g.clear();
    for (const r of ropes) {
      const a = toScreen({ x: r.x1, y: r.y1 });
      const b = toScreen({ x: r.x2, y: r.y2 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: SHADOW, width: 5, alpha: 0.4 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: ROPE, width: 2.5, alpha: r.taut ? 1 : 0.7 });
      g.circle(b.x, b.y, 4).fill({ color: HOOK });
    }
  }
}
