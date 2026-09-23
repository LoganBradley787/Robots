/** Classic fixed-timestep accumulator. Time scale multiplies frame time, so dt itself never changes. */
export class FixedStepper {
  private acc = 0;
  readonly dtMs: number;
  readonly maxFrameMs: number;

  constructor(dtMs: number, maxFrameMs = 250) {
    this.dtMs = dtMs;
    this.maxFrameMs = maxFrameMs;
  }

  /** Returns how many fixed ticks to run this frame. */
  advance(frameMs: number, timeScale: number): number {
    this.acc += Math.min(frameMs, this.maxFrameMs) * timeScale;
    let ticks = 0;
    while (this.acc >= this.dtMs) {
      this.acc -= this.dtMs;
      ticks++;
    }
    return ticks;
  }

  /** Fraction of the way from the previous tick to the current one, for render interpolation. */
  get alpha(): number {
    return this.acc / this.dtMs;
  }

  reset(): void {
    this.acc = 0;
  }
}
