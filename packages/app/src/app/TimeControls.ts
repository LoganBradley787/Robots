export const TIME_SCALES = [0.25, 0.5, 1, 2, 4] as const;

export class TimeControls {
  paused = false;
  private scaleIndex = 2;
  private pendingSteps = 0;

  get timeScale(): number {
    return TIME_SCALES[this.scaleIndex] ?? 1;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  faster(): void {
    this.scaleIndex = Math.min(TIME_SCALES.length - 1, this.scaleIndex + 1);
  }

  slower(): void {
    this.scaleIndex = Math.max(0, this.scaleIndex - 1);
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
