export const TIME_SCALES = [0.25, 0.5, 1, 2, 4] as const;

export class TimeControls {
  paused = false;
  private index = 2;
  private pendingSteps = 0;

  get timeScale(): number {
    return TIME_SCALES[this.index] ?? 1;
  }

  /** Where the speed is in `TIME_SCALES`: 2 is 1x. */
  get scaleIndex(): number {
    return this.index;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  faster(): void {
    this.setScale(this.index + 1);
  }

  slower(): void {
    this.setScale(this.index - 1);
  }

  /** Straight to one speed of `TIME_SCALES` (the time panel's arrows), clamped to the table. */
  setScale(index: number): void {
    this.index = Math.max(0, Math.min(TIME_SCALES.length - 1, Math.round(index)));
  }

  /** Single step: pauses and queues one tick. */
  requestStep(): void {
    this.paused = true;
    this.pendingSteps++;
  }

  takePendingSteps(): number {
    const n = this.pendingSteps;
    this.pendingSteps = 0;
    return n;
  }
}
