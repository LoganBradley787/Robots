import type { Behavior } from './registry';

/**
 * A proximity mine (Batch): an armed mine goes off on a `detonate` pulse like a warhead. Unlike a warhead it only
 * blasts when it is set off (this, or an enemy coming within its `mine.radius`, which the world checks): destroyed any
 * other way (shot, caught in a blast) it breaks as a dud. Unarmed it ignores `detonate`.
 */
export const mine: Behavior = {
  config: [],
  plan(ctx) {
    if (ctx.part.armed === false || ctx.value('detonate') <= 0) return undefined;
    return {
      load: 0,
      run: () => {
        ctx.part.fired = true;
        ctx.part.health = 0;
      },
    };
  },
};
