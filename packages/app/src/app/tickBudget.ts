/**
 * Wall-clock milliseconds the sim may take per frame. A heavy scene at 4x asks for more ticks than a frame has time
 * for; without a budget each long frame asks for even more ticks next time, down to about 10 fps (Gate 10). With it,
 * the scene runs slower than asked but the frame rate holds.
 */
export const SIM_BUDGET_MS = 10;

/**
 * Runs `step(i)` for up to `ticks` ticks, stopping once `budgetMs` of wall time has passed (always at least one tick,
 * so the sim never stalls). Returns how many ran. The app's clock, never the sim's. With `nextMs` (Smooth: what the
 * next tick is expected to take) it also does not start a tick that would end past the budget.
 */
export function runWithin(ticks: number, budgetMs: number, now: () => number, step: (i: number) => void, nextMs?: () => number): number {
  const start = now();
  let ran = 0;
  while (ran < ticks) {
    step(ran);
    ran++;
    const spent = now() - start;
    if (spent >= budgetMs || (nextMs !== undefined && spent + nextMs() > budgetMs)) break;
  }
  return ran;
}
