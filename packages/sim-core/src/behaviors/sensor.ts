import type { Behavior } from './registry';

/**
 * A sensor part (M8: seeker, radar). What it sees is worked out by the world from its def's `sensor` (cone and range)
 * when scripts run; the behavior only draws its power. With `on` at 0.5 or less, or no energy, it sees nothing on the
 * next tick (`PartInstance.sensing`).
 */
export const sensor: Behavior = {
  config: [],
  plan(ctx) {
    const part = ctx.part;
    if (ctx.value('on') <= 0.5) {
      part.sensing = false;
      return undefined;
    }
    return {
      load: 1,
      run: (grant) => {
        part.sensing = grant > 0;
      },
    };
  },
};
