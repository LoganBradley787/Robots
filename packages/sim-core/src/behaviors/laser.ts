import type { Behavior } from './registry';

/**
 * A laser (M14): while `fire` is above 0.5 and a core is in charge it asks for its full `powerDraw`, and keeps the
 * share it was granted as `beam` (0 to 1) for the world to burn with right after the physics step. Otherwise its beam
 * is 0 and it asks for nothing. The beam itself is the world's (`World.runWeapons`): it needs the ray casts.
 */
export const laser: Behavior = {
  config: [],
  needsActs: true,
  plan(ctx) {
    const part = ctx.part;
    if (!ctx.controlled || ctx.value('fire') <= 0.5) {
      part.beam = 0;
      return undefined;
    }
    return {
      load: 1,
      run: (grant) => {
        part.beam = grant;
      },
    };
  },
};
