import { Graphics } from 'pixi.js';
import type { BodyState } from '@robots/sim-core';
import { PIXELS_PER_METER, toScreen, toScreenAngle } from './units';

/** A filled rectangle that follows an interpolated body state. Sprites replace this in M1. */
export class BoxView {
  readonly gfx = new Graphics();

  constructor(widthM: number, heightM: number, color: number) {
    const w = widthM * PIXELS_PER_METER;
    const h = heightM * PIXELS_PER_METER;
    this.gfx.rect(-w / 2, -h / 2, w, h).fill(color).stroke({ color: 0xffffff, width: 1, alpha: 0.4 });
  }

  sync(state: BodyState): void {
    const p = toScreen(state);
    this.gfx.position.set(p.x, p.y);
    this.gfx.rotation = toScreenAngle(state.angle);
  }
}
