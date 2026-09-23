import { rotateFace } from '../parts/faces';
import type { Face } from '../parts/types';
import type { PartInstance } from '../world/Robot';
import type { Behavior } from './registry';

/** The decoupler's release face after its rotation (its `acts` face, N at rotation 0). */
function releaseFace(part: PartInstance): Face | undefined {
  return part.def.acts === undefined ? undefined : rotateFace(part.def.acts, part.rot);
}

/**
 * A decoupler (Q18): `fire` above 0 cuts its release face once. The two sides get `separation` N s each, pushing
 * apart along the face, and whatever was only attached through that face becomes its own robot. The decoupler stays
 * with its other faces, inert. `armed` reads 1 until it fires.
 */
export const decoupler: Behavior = {
  config: ['separation'],
  needsActs: true,
  plan(ctx) {
    const face = releaseFace(ctx.part);
    if (ctx.value('fire') <= 0 || face === undefined || ctx.part.cut?.includes(face)) return undefined;
    return { load: 0, run: () => ctx.detach(face, ctx.config('separation')) };
  },
  output(part, name) {
    if (name !== 'armed') return undefined;
    const face = releaseFace(part);
    return face !== undefined && part.cut?.includes(face) ? 0 : 1;
  },
};
