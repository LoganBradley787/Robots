import type { Behavior } from './registry';

/**
 * A fabricator bay (M12, def field `fabricate`). Empty, it builds its recipe: it asks for the energy the build costs
 * spread over the build time (at most its `powerDraw`; a costlier build takes longer) and advances `progress` (0 to 1)
 * by what it is granted, so a brownout slows it and an empty pool stops it. At 1 it finishes: the world adds the
 * copy to the robot, held by its grips (it waits while anything is still in its hollow). Holding, `release` above
 * 0.5 lets the copy go. Not holding, it keeps an eye on the copy it let go until that is out of its hollow (Batch).
 */
export const fabricate: Behavior = {
  config: [],
  early: true,
  plan(ctx) {
    const part = ctx.part;
    if (part.holding === true) {
      if (ctx.value('release') <= 0.5) return undefined;
      return { load: 0, run: () => ctx.release() };
    }
    ctx.watch();
    const job = ctx.job();
    if (!job) return undefined;
    if ((part.progress ?? 0) >= 1) return { load: 0, run: () => ctx.finish() };
    // Joules per second the build wants, and the share of the bay's full draw that is.
    const rate = job.joules / job.seconds;
    const draw = Math.max(1e-9, part.def.powerDraw);
    // The last tick asks only for what is left, so a build costs exactly its joules.
    const left = (1 - (part.progress ?? 0)) * job.joules;
    const load = Math.min(1, rate / draw, left / (draw * ctx.dt));
    return {
      load,
      run: (grant) => {
        // Seconds of work done this tick: a full grant at the wanted rate is one tick's worth.
        const work = (grant * load * part.def.powerDraw * ctx.dt) / rate;
        part.progress = Math.min(1, (part.progress ?? 0) + work / job.seconds);
        if (part.progress >= 1) ctx.finish();
      },
    };
  },
  output(part, name) {
    if (name === 'ready') return part.holding === true ? 1 : 0;
    if (name === 'progress') return part.holding === true ? 1 : (part.progress ?? 0);
    if (name === 'built') return part.built ?? 0;
    return undefined;
  },
};
