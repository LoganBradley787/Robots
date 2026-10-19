/**
 * How long each robot's scripts take, on this machine: wall-clock milliseconds per run, smoothed so the readout holds
 * still and a single slow call (a garbage collection) does not swing it. Fed by the world's script watch
 * (`World.watchScripts`), which runs each robot's scripts once a tick; the clock is the app's, never the sim's, and
 * nothing here reaches the sim. Pure: the times come in, so it is testable without a clock.
 */
export class ScriptCosts {
  private readonly ms = new Map<number, number>();
  /** How much of each new run counts: 0.05 settles in about 20 runs, a third of a second at 1x. */
  private readonly weight: number;

  constructor(weight = 0.05) {
    this.weight = weight;
  }

  /** One run of a robot's scripts took `ms`. The first run counts in full. */
  add(robot: number, ms: number): void {
    const had = this.ms.get(robot);
    this.ms.set(robot, had === undefined ? ms : had + (ms - had) * this.weight);
  }

  /** A robot's smoothed time per run, or undefined before its scripts first ran. */
  cost(robot: number): number | undefined {
    return this.ms.get(robot);
  }

  /** The `n` slowest robots, slowest first (ties: lower id first). */
  slowest(n: number): { robot: number; ms: number }[] {
    return [...this.ms]
      .map(([robot, ms]) => ({ robot, ms }))
      .sort((a, b) => b.ms - a.ms || a.robot - b.robot)
      .slice(0, n);
  }

  /** Forgets robots that are gone (or whose scripts stopped), so the list stays the world's. */
  keep(robots: Iterable<number>): void {
    const keep = new Set(robots);
    for (const id of [...this.ms.keys()]) if (!keep.has(id)) this.ms.delete(id);
  }

  clear(): void {
    this.ms.clear();
  }
}

/** "1.4 ms": two places under 0.1 ms, one under 10, none past it. */
export function msText(ms: number): string {
  return `${ms < 0.1 ? ms.toFixed(2) : ms < 10 ? ms.toFixed(1) : ms.toFixed(0)} ms`;
}
