/** One frame's worth of timing, measured by the world screen (M9). */
export interface FrameSample {
  /** Time since the last frame (the ticker's delta). */
  frameMs: number;
  /** Ticks stepped this frame. */
  ticks: number;
  /** Time spent stepping them, and of that, inside robot scripts. */
  simMs: number;
  scriptMs: number;
  scriptCalls: number;
  /** Time spent after stepping: syncing robot views, effects, the overlay, and the HUD. */
  viewMs: number;
}

/** Averages over one window, as the readout shows them. */
export interface PerfReadout {
  fps: number;
  ticksPerFrame: number;
  /** Per tick: the whole step, scripts, everything else in the step. */
  simMs: number;
  scriptMs: number;
  restMs: number;
  scriptCallsPerTick: number;
  /** Per frame. */
  viewMs: number;
}

/**
 * The debug overlay's perf readout (M9): frame samples summed over about half a second, then averaged, so the numbers
 * hold still long enough to read. Wall-clock timing for display only; it never reaches the sim.
 */
export class PerfMeter {
  private readonly windowMs: number;
  private sum: FrameSample = zero();
  private frames = 0;
  private current: PerfReadout | undefined;

  constructor(windowMs = 500) {
    this.windowMs = windowMs;
  }

  add(s: FrameSample): void {
    const t = this.sum;
    t.frameMs += s.frameMs;
    t.ticks += s.ticks;
    t.simMs += s.simMs;
    t.scriptMs += s.scriptMs;
    t.scriptCalls += s.scriptCalls;
    t.viewMs += s.viewMs;
    this.frames++;
    if (t.frameMs < this.windowMs) return;
    const perTick = (v: number): number => (t.ticks > 0 ? v / t.ticks : 0);
    this.current = {
      fps: t.frameMs > 0 ? (1000 * this.frames) / t.frameMs : 0,
      ticksPerFrame: t.ticks / this.frames,
      simMs: perTick(t.simMs),
      scriptMs: perTick(t.scriptMs),
      restMs: perTick(t.simMs - t.scriptMs),
      scriptCallsPerTick: perTick(t.scriptCalls),
      viewMs: t.viewMs / this.frames,
    };
    this.sum = zero();
    this.frames = 0;
  }

  /** The last full window's averages, or undefined before the first one ends. */
  get readout(): PerfReadout | undefined {
    return this.current;
  }

  /** The readout as HUD lines. */
  lines(robots: number): string[] {
    const r = this.current;
    if (!r) return ['perf: measuring...'];
    const f = (v: number): string => v.toFixed(2);
    return [
      `perf: ${Math.round(r.fps)} fps   ${r.ticksPerFrame.toFixed(1)} ticks/frame   views ${f(r.viewMs)} ms/frame   ${robots} robots   ${r.scriptCallsPerTick.toFixed(0)} script calls/tick`,
      `sim ${f(r.simMs)} ms/tick = scripts ${f(r.scriptMs)} + rest ${f(r.restMs)}   (a frame has 16.7 ms)`,
    ];
  }
}

function zero(): FrameSample {
  return { frameMs: 0, ticks: 0, simMs: 0, scriptMs: 0, scriptCalls: 0, viewMs: 0 };
}
