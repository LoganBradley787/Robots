import { defaultRegistry, formatIssues, validateBlueprint, type Issue } from '@robots/sim-core';
import { scriptIssues } from './scriptCheck';

export function validateCommand(blueprint: unknown): { ok: boolean; issues: Issue[]; text: string } {
  const v = validateBlueprint(blueprint, defaultRegistry());
  return { ok: v.ok, issues: v.issues, text: v.issues.length === 0 ? 'ok' : formatIssues(v.issues) };
}

/** `pnpm sim validate`: the validator's issues, then what its scripts would do wrong (review T2; warnings, `scriptCheck.ts`). */
export async function validateWithScripts(blueprint: unknown): Promise<{ ok: boolean; issues: Issue[]; text: string }> {
  const v = validateCommand(blueprint);
  const issues = [...v.issues, ...(await scriptIssues(blueprint))];
  return { ok: v.ok, issues, text: issues.length === 0 ? 'ok' : formatIssues(issues) };
}
