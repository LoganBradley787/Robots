import type { ScriptHost, ScriptInstance } from '@robots/sim-core';

/** Time spent inside scripts, summed since the last `take()`. */
export interface ScriptClock {
  ms: number;
  calls: number;
  take(): { ms: number; calls: number };
}

/**
 * Wraps a script host so every `setup` and `tick` call is timed with the machine's clock (M9, for `bench` and
 * reports only). Lives outside sim-core on purpose: the sim never reads a clock, and nothing here feeds back into it.
 */
export function timedHost(host: ScriptHost, now: () => number = () => performance.now()): { host: ScriptHost; clock: ScriptClock } {
  const clock: ScriptClock = {
    ms: 0,
    calls: 0,
    take() {
      const out = { ms: this.ms, calls: this.calls };
      this.ms = 0;
      this.calls = 0;
      return out;
    },
  };
  const timed = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => {
    const t = now();
    try {
      return fn(...args);
    } finally {
      clock.ms += now() - t;
      clock.calls++;
    }
  };
  return {
    clock,
    host: {
      compile(source, opts) {
        const r = host.compile(source, opts);
        if (!r.ok) return r;
        const inner = r.instance;
        const instance: ScriptInstance = {
          params: inner.params,
          setup: timed(inner.setup.bind(inner)),
          tick: timed(inner.tick.bind(inner)),
          dispose: () => inner.dispose(),
        };
        return { ok: true, instance };
      },
    },
  };
}
