import { defaultRegistry, formatIssues, toGrid, validateBlueprint } from '@robots/sim-core';

/** Human and AI readable summary: grid, legend, mass, static center of mass, and body structure. */
export function showBlueprint(blueprint: unknown): string {
  const registry = defaultRegistry();
  const v = validateBlueprint(blueprint, registry);
  if (!v.blueprint || !v.plan) return formatIssues(v.issues);
  const bp = v.blueprint;
  const plan = v.plan;
  const lines: string[] = [`${bp.name}: ${bp.parts.length} parts`];
  const g = toGrid(bp);
  lines.push('grid:', ...g.grid.map((r) => `  ${r}`));
  const legend = Object.entries(g.legend);
  if (legend.length > 0) {
    lines.push('legend:');
    for (const [token, e] of legend) lines.push(`  ${token} = ${e.part} rot ${e.rot ?? 0}${e.tags ? ` tags ${e.tags.join(', ')}` : ''}`);
  }
  let mass = 0;
  let mx = 0;
  let my = 0;
  for (const p of bp.parts) {
    const m = registry.get(p.part).mass;
    mass += m;
    mx += m * p.x;
    my += m * p.y;
  }
  lines.push(`mass: ${mass.toFixed(3)} kg, center of mass at cell (${(mx / mass).toFixed(3)}, ${(my / mass).toFixed(3)})`);
  lines.push(`chunks: ${plan.chunks.length}, bodies: ${plan.groups.length}`);
  for (const grp of plan.groups) {
    const joint = grp.joint ? ` joint -> group ${grp.joint.parentGroup}` : '';
    lines.push(`  group ${grp.index}: ${grp.partIds.length} part${grp.partIds.length === 1 ? '' : 's'} origin ${grp.originId}${joint}`);
  }
  if (v.issues.length > 0) lines.push(formatIssues(v.issues));
  return lines.join('\n');
}
