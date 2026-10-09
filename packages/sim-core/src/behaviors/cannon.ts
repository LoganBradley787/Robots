import type { Behavior } from './registry';

/** Where a charged gun's charge stands (M15). Numbers because they are hashed. */
export const WIND = { idle: 0, charging: 1, draining: 2, full: 3, dead: 4 } as const;
/** What a charged gun does on this tick's weapon pass, right after the physics step (it needs the barrel's pose). */
export const WIND_ACT = { none: 0, shoot: 1, backfire: 2 } as const;

/**
 * A charged gun (M15, the cannon and the lance): hold `fire` and it charges for its `charge` seconds, asking for its
 * full `powerDraw` all the while (a brownout charges it slower; an empty pool starts a drain). Let go before it is
 * full and it drains at the rate it charged, pouring the energy back into its chunk, and cannot charge again until it
 * is empty. Once full, letting go fires; held full past `hold` seconds it backfires. Either way it is then dead for
 * `dead` seconds. A wreck (no core in charge) cannot fire: its charge drains, or backfires if it was full. The shot and
 * the backfire's push are the world's (`World.runCannons`): this only sets `wind.act`.
 */
export const cannon: Behavior = {
  config: [],
  needsActs: true,
  plan(ctx) {
    const part = ctx.part;
    const spec = part.def.cannon;
    if (!spec) return undefined;
    const w = (part.wind ??= { phase: WIND.idle, level: 0, timer: 0, act: WIND_ACT.none, paid: 0 });
    const held = ctx.controlled && ctx.value('fire') > 0.5;
    const ticks = (seconds: number): number => Math.max(1, Math.round(seconds / ctx.dt));
    if (w.phase === WIND.dead) {
      if (--w.timer <= 0) w.phase = WIND.idle;
      return undefined;
    }
    if (w.phase === WIND.draining) {
      // What it paid comes back evenly over the drain (review: seconds charged for free under Unlimited energy
      // came back as real joules once it was switched off).
      const give = w.level <= ctx.dt ? w.paid : (w.paid * ctx.dt) / w.level;
      ctx.giveBack(give);
      w.paid -= give;
      w.level -= ctx.dt;
      if (w.level <= 1e-9) {
        w.level = 0;
        w.paid = 0;
        w.phase = WIND.idle;
      }
      return undefined;
    }
    if (w.phase === WIND.full) {
      const spent = (act: number): void => {
        w.act = act;
        w.phase = WIND.dead;
        w.timer = ticks(spec.dead);
        w.level = 0;
        w.paid = 0;
      };
      if (ctx.controlled && !held) spent(WIND_ACT.shoot);
      else if (++w.timer > ticks(spec.hold)) spent(WIND_ACT.backfire);
      return undefined;
    }
    if (!held) {
      if (w.phase === WIND.charging) w.phase = WIND.draining;
      return undefined;
    }
    w.phase = WIND.charging;
    return {
      load: 1,
      run: (grant) => {
        if (grant <= 0) {
          w.phase = w.level > 0 ? WIND.draining : WIND.idle;
          return;
        }
        w.level += ctx.dt * grant;
        if (!ctx.free) w.paid += part.def.powerDraw * ctx.dt * grant;
        if (w.level >= spec.charge - 1e-9) {
          w.level = spec.charge;
          w.phase = WIND.full;
          w.timer = 0;
        }
      },
    };
  },
  output(part, name) {
    if (name !== 'charged' || !part.def.cannon) return undefined;
    return Math.min(1, (part.wind?.level ?? 0) / part.def.cannon.charge);
  },
};
