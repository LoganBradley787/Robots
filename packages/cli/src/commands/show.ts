import { autoBindings, defaultRegistry, formatIssues, toGrid, validateBlueprint } from '@robots/sim-core';

/** Human and AI readable summary: grid, legend, mass, static center of mass, and body structure. */
export function showBlueprint(blueprint: unknown): { ok: boolean; text: string } {
  const registry = defaultRegistry();
  const v = validateBlueprint(blueprint, registry);
  if (!v.blueprint || !v.plan) return { ok: false, text: formatIssues(v.issues) };
  const bp = v.blueprint;
  const plan = v.plan;
  const lines: string[] = [`${bp.name}: ${bp.parts.length} parts`];
  const g = toGrid(bp, registry);
  if (g) lines.push('grid:', ...g.grid.map((r) => `  ${r}`));
  else {
    lines.push('parts (not expressible as a grid):');
    for (const p of bp.parts) lines.push(`  ${p.id}: ${p.part} at (${p.x}, ${p.y}) rot ${p.rot} tags ${p.tags.join(', ')}`);
  }
  const legend = Object.entries(g?.legend ?? {});
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
  const auto = autoBindings(bp, registry);
  if (bp.autoControls === false) lines.push('auto controls: off');
  else if (auto.length > 0) {
    lines.push('auto controls:');
    const byKey = new Map<string, string[]>();
    for (const b of auto) byKey.set(b.key, [...(byKey.get(b.key) ?? []), `${b.target} ${b.channel} ${(b.value ?? 0) > 0 ? '+' : ''}${Math.round((b.value ?? 0) * 100)}%`]);
    for (const [key, what] of byKey) lines.push(`  ${key.toUpperCase()}: ${what.join(', ')}`);
  }
  if (bp.bindings.length > 0) {
    lines.push('bindings:');
    for (const b of bp.bindings) lines.push(`  ${b.key} ${b.mode} ${b.mode === 'script' ? `script ${b.script}` : `${b.target} ${b.channel} ${b.value}`}`);
  }
  if (v.issues.length > 0) lines.push(formatIssues(v.issues));
  return { ok: v.ok, text: lines.join('\n') };
}
