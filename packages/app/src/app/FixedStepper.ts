/** Classic fixed-timestep accumulator. Time scale multiplies frame time, so dt itself never changes. */
export class FixedStepper {
  private acc = 0;
  readonly dtMs: number;
  readonly maxFrameMs: number;
  readonly maxTicks: number;

  constructor(dtMs: number, maxFrameMs = 250, maxTicks = 16) {
    this.dtMs = dtMs;
    this.maxFrameMs = maxFrameMs;
    this.maxTicks = maxTicks;
  }

  /**
   * Returns how many fixed ticks to run this frame. When the tick cap is hit the leftover time is dropped, so a
   * slow machine at 4x runs slower than 4x instead of falling further behind every frame.
   */
  advance(frameMs: number, timeScale: number): number {
    this.acc += Math.min(frameMs, this.maxFrameMs) * timeScale;
    let ticks = 0;
    while (this.acc >= this.dtMs && ticks < this.maxTicks) {
      this.acc -= this.dtMs;
      ticks++;
    }
    if (ticks === this.maxTicks) this.acc = Math.min(this.acc, this.dtMs * 0.999);
    return ticks;
  }

  /** Fraction of the way from the previous tick to the current one, for render interpolation. */
  get alpha(): number {
    return this.acc / this.dtMs;
  }

  reset(): void {
    this.acc = 0;
  }

  /** Resume after a pause showing the current tick (alpha 1), so unpausing does not jump back one tick. */
  resume(): void {
    this.acc = this.dtMs * 0.999;
  }
}
