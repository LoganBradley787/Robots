import { Texture } from 'pixi.js';

/** Steps of the brown ring: a fuse's burn changes every tick, its look need not. */
export const BURN_STEPS = 16;
const SIZE = 64;
const BROWN = '#5e3f28';

/** The step a burnt share (0 to 1) is drawn at: the last only at 1, so all brown means burnt out. */
export function burnStep(burnt: number): number {
  return Math.floor(Math.max(0, Math.min(1, burnt)) * BURN_STEPS);
}

/** The side of the part's own art left at a step, as a share of the part's: the brown covers exactly the burnt share. */
export function unburntSide(step: number): number {
  return Math.sqrt(1 - step / BURN_STEPS);
}

const rings: Texture[] = [];

/** A brown square with its middle cut out, one per step, made the first time it is asked for and shared by every part. */
export function burnRing(step: number): Texture {
  let t = rings[step];
  if (!t) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const c = canvas.getContext('2d') as CanvasRenderingContext2D;
    c.fillStyle = BROWN;
    c.fillRect(0, 0, SIZE, SIZE);
    const side = Math.round(unburntSide(step) * SIZE);
    c.clearRect((SIZE - side) / 2, (SIZE - side) / 2, side, side);
    t = Texture.from(canvas);
    rings[step] = t;
  }
  return t;
}
