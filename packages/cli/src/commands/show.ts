import { autoBindings, defaultRegistry, formatIssues, rootPartId, toGrid, validateBlueprint, type Binding, type GridForm, type ScriptSpec } from '@robots/sim-core';

/** Human and AI readable summary: grid, legend, mass, static center of mass, and body structure. */
export function showBlueprint(blueprint: unknown): { ok: boolean; text: string } {
  const registry = defaultRegistry();
  const v = validateBlueprint(blueprint, registry);
  if (!v.blueprint || !v.plan) return { ok: false, text: formatIssues(v.issues) };
  const bp = v.blueprint;
  const plan = v.plan;
  const lines: string[] = [`${bp.name}: ${bp.parts.length} parts`];
  // The file's own grid and legend when it has one, so the letters match what was written; else one made from the parts.
  const own = ownGrid(blueprint);
  const g = own ?? toGrid(bp, registry);
  if (g) lines.push('grid:', ...g.grid.map((r) => `  ${r}`));
  else {
    lines.push('parts (not expressible as a grid):');
    for (const p of bp.parts) lines.push(`  ${p.id}: ${p.part} at (${p.x}, ${p.y}) rot ${p.rot} tags ${p.tags.join(', ')}`);
  }
  const legend = Object.entries(g?.legend ?? {});
  if (legend.length > 0) {
    lines.push('legend:');
    for (const [token, e] of legend) lines.push(`  ${token} = ${e.part} rot ${e.rot ?? 0}${e.tags ? ` tags ${e.tags.join(', ')}` : ''}${e.auto === false ? ', auto controls off' : ''}`);
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
  const pilot = rootPartId(bp, registry);
  lines.push(`controls of ${pilot ?? 'the robot'}${pilot !== undefined ? ' (the primary core, active from deploy)' : ''}:`);
  const auto = autoBindings(bp, registry);
  if (bp.autoControls === false) lines.push('  auto controls: off');
  else if (auto.length > 0) {
    lines.push('  auto controls:');
    const byKey = new Map<string, string[]>();
    for (const b of auto) byKey.set(b.key, [...(byKey.get(b.key) ?? []), `${b.target} ${b.channel} ${(b.value ?? 0) > 0 ? '+' : ''}${Math.round((b.value ?? 0) * 100)}%`]);
    for (const [key, what] of byKey) lines.push(`    ${key.toUpperCase()}: ${what.join(', ')}`);
  }
  lines.push(...controlLines(bp.bindings, bp.scripts));
  for (const c of bp.cores ?? []) {
    lines.push(`controls of ${c.core}${c.scope !== undefined ? ` (scope ${c.scope}: its parts are tagged ${c.scope}, and its targets mean only those parts)` : ''}, active when its piece breaks off:`);
    lines.push(`  auto controls: ${c.autoControls === false ? 'off' : "on for its piece's parts"}`);
    lines.push(...controlLines(c.bindings, c.scripts));
  }
  if (v.issues.length > 0) lines.push(formatIssues(v.issues));
  return { ok: v.ok, text: lines.join('\n') };
}

function ownGrid(raw: unknown): GridForm | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as { grid?: unknown; legend?: unknown };
  if (!Array.isArray(r.grid) || !r.grid.every((row) => typeof row === 'string')) return undefined;
  return { grid: r.grid as string[], legend: (typeof r.legend === 'object' && r.legend !== null ? r.legend : {}) as GridForm['legend'] };
}

function controlLines(bindings: readonly Binding[], scripts: readonly ScriptSpec[]): string[] {
  const out: string[] = [];
  if (bindings.length > 0) {
    out.push('  bindings:');
    for (const b of bindings) out.push(`    ${b.key} ${b.mode} ${b.mode === 'script' ? `${b.script}` : `${b.target} ${b.channel} ${b.value}`}`);
  }
  if (scripts.length > 0) {
    out.push('  scripts:');
    for (const sc of scripts) {
      const params = Object.entries(sc.params).map(([k, v]) => `${k}=${v}`);
      const where = sc.file ?? (typeof sc.source === 'string' ? 'inline' : sc.source.file);
      out.push(`    ${sc.id}: ${sc.enabled ? 'on' : 'off until its key is pressed'}, ${where}${params.length > 0 ? `, params ${params.join(' ')}` : ''}`);
    }
  }
  return out;
}
