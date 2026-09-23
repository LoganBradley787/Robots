import { defaultRegistry, formatIssues, validateBlueprint, type Issue } from '@robots/sim-core';

export function validateCommand(blueprint: unknown): { ok: boolean; issues: Issue[]; text: string } {
  const v = validateBlueprint(blueprint, defaultRegistry());
  return { ok: v.ok, issues: v.issues, text: v.issues.length === 0 ? 'ok' : formatIssues(v.issues) };
}
