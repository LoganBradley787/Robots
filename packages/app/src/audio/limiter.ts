/** A one-shot asking to play: its sound name and how loud it would be at the ear (0 to 1). */
export interface Ask {
  name: string;
  gain: number;
  /** Seconds it sounds for. */
  seconds: number;
  /** Plays from its own small reserve of voices, whatever else is sounding (a blast in the middle of a gun fight). */
  must?: boolean;
}

export interface LimiterOptions {
  /** One-shots sounding at once. */
  maxLive: number;
  /** `must` one-shots sounding at once, on top of `maxLive`. */
  maxMust: number;
  /** Starts of one sound name per window. */
  perWindow: number;
  windowSeconds: number;
  /** Quieter than this at the ear is not worth a voice. */
  floor: number;
}

export const DEFAULT_LIMITS: LimiterOptions = { maxLive: 32, maxMust: 8, perWindow: 4, windowSeconds: 0.05, floor: 0.01 };

/**
 * Keeps a titan fight from starting a thousand sounds a second (M15). Each frame's asks are taken loudest first: at
 * most `perWindow` starts of one name per window, at most `maxLive` sounding at once, nothing under `floor`.
 */
export class OneShotLimiter {
  /** When each sounding one-shot ends. */
  private ends: number[] = [];
  /** The same for `must` one-shots, which never take a voice from the others. */
  private mustEnds: number[] = [];
  /** Recent start times per sound name. */
  private readonly starts = new Map<string, number[]>();

  private readonly opts: LimiterOptions;

  constructor(opts: LimiterOptions = DEFAULT_LIMITS) {
    this.opts = opts;
  }

  /** The asks that may play, loudest first. `now` is in seconds, on any clock that only moves forward. */
  pick<T extends Ask>(asks: readonly T[], now: number): T[] {
    this.ends = this.ends.filter((t) => t > now);
    this.mustEnds = this.mustEnds.filter((t) => t > now);
    const out: T[] = [];
    for (const ask of [...asks].sort((a, b) => b.gain - a.gain)) {
      if (ask.gain < this.opts.floor) break;
      const pool = ask.must === true ? this.mustEnds : this.ends;
      if (pool.length >= (ask.must === true ? this.opts.maxMust : this.opts.maxLive)) continue;
      const recent = (this.starts.get(ask.name) ?? []).filter((t) => t > now - this.opts.windowSeconds);
      if (recent.length >= this.opts.perWindow) {
        this.starts.set(ask.name, recent);
        continue;
      }
      recent.push(now);
      this.starts.set(ask.name, recent);
      pool.push(now + ask.seconds);
      out.push(ask);
    }
    return out;
  }

  /** One-shots sounding as of the last `pick`. */
  get live(): number {
    return this.ends.length + this.mustEnds.length;
  }

  /** One-shots still sounding at `now`. */
  liveAt(now: number): number {
    return this.ends.filter((t) => t > now).length + this.mustEnds.filter((t) => t > now).length;
  }

  clear(): void {
    this.ends = [];
    this.mustEnds = [];
    this.starts.clear();
  }
}
