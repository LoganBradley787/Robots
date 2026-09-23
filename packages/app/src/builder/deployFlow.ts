import type { Issue } from '@robots/sim-core';

export type DeployDecision = { step: 'blocked'; errors: number } | { step: 'confirm-unsaved' } | { step: 'place' };

/**
 * Deploy, per docs/design/10: validation errors block it; unsaved changes ask Save / Don't save / Cancel;
 * then the ghost goes on the cursor in the world. Warnings (a core-less bomb) do not block.
 */
export function deployDecision(issues: readonly Issue[], dirty: boolean): DeployDecision {
  const errors = issues.filter((i) => i.severity === 'error').length;
  if (errors > 0) return { step: 'blocked', errors };
  return dirty ? { step: 'confirm-unsaved' } : { step: 'place' };
}

/** Drop points snap to 0.1 m so placement is repeatable. */
export function snapDrop(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(p.x * 10) / 10 + 0, y: Math.round(p.y * 10) / 10 + 0 };
}
