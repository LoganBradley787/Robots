import type { Behavior } from './registry';

/**
 * A warhead: a `detonate` pulse destroys it, and like any part with `onDestroyed.explode` it then explodes (`03`).
 * Its other triggers are data: being destroyed by a blast (chain reactions) and `impact` (a hard hit).
 */
export const warhead: Behavior = {
  config: [],
  plan(ctx) {
    if (ctx.value('detonate') <= 0) return undefined;
    return {
      load: 0,
      run: () => {
        ctx.part.health = 0;
      },
    };
  },
};
