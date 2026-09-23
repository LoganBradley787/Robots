import type { WorldFile } from '@robots/sim-core';
import { runSim, type RunOptions } from './run';

export interface DeterminismResult {
  equal: boolean;
  hashA: string;
  hashB: string;
  ticks: number;
}

/** Runs the same simulation twice in one process and compares final hashes. */
export async function checkDeterminism(file: WorldFile, opts: RunOptions): Promise<DeterminismResult> {
  const a = await runSim(file, opts);
  const b = await runSim(file, opts);
  return { equal: a.finalHash === b.finalHash, hashA: a.finalHash, hashB: b.finalHash, ticks: a.ticks };
}
