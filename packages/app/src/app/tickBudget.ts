/**
 * Wall-clock milliseconds the sim may take per frame. A heavy scene at 4x asks for more ticks than a frame has time
 * for; without a budget each long frame asks for even more ticks next time, down to about 10 fps (Gate 10). With it,
 * the scene runs slower than asked but the frame rate holds.
 */
export const SIM_BUDGET_MS = 10;

/**
 * Runs `step(i)` for up to `ticks` ticks, stopping once `budgetMs` of wall time has passed (always at least one tick,
 * so the sim never stalls). Returns how many ran. The app's clock, never the sim's.
 */
export function runWithin(ticks: number, budgetMs: number, now: () => number, step: (i: number) => void): number {
  const start = now();
  let ran = 0;
  while (ran < ticks) {
    step(ran);
    ran++;
    if (now() - start >= budgetMs) break;
  }
  return ran;
}
