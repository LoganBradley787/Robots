import { isCore, rootPartId, type Binding, type Blueprint, type CoreControls, type PartRegistry, type ScriptSpec } from '@robots/sim-core';

/** One core's controls as the Controls and Scripts panels edit them (M7). `core` absent means the primary core. */
export interface ControlsView {
  core?: string;
  /** Set for a placed copy (`missile1`): its targets mean only its own parts. */
  scope?: string;
  bindings: readonly Binding[];
  scripts: readonly ScriptSpec[];
  autoOn: boolean;
}

/** Every core that can own controls, primary first, then the others in part order, each with a label for the picker. */
export function controlCores(bp: Blueprint, registry: PartRegistry): { core?: string; label: string }[] {
  const primary = rootPartId(bp, registry);
  const out: { core?: string; label: string }[] = [{ label: 'main core' }];
  for (const p of bp.parts) {
    if (p.id === primary || !isCore(p, registry)) continue;
    const scope = bp.cores?.find((c) => c.core === p.id)?.scope;
    out.push({ core: p.id, label: scope !== undefined ? `${scope} (${p.id})` : p.id });
  }
  return out;
}

/** True when `core` is absent or names the primary core, whose controls are the blueprint's top-level fields. */
function isPrimary(bp: Blueprint, registry: PartRegistry, core: string | undefined): boolean {
  return core === undefined || core === rootPartId(bp, registry);
}

export function controlsOf(bp: Blueprint, registry: PartRegistry, core: string | undefined): ControlsView {
  if (isPrimary(bp, registry, core)) return { bindings: bp.bindings, scripts: bp.scripts, autoOn: bp.autoControls !== false };
  const c = bp.cores?.find((x) => x.core === core);
  return { core: core as string, ...(c?.scope !== undefined ? { scope: c.scope } : {}), bindings: c?.bindings ?? [], scripts: c?.scripts ?? [], autoOn: c?.autoControls !== false };
}

export interface ControlsPatch {
  bindings?: readonly Binding[];
  scripts?: readonly ScriptSpec[];
  autoOn?: boolean;
}

/**
 * Writes one core's controls. The primary core's go to the top-level fields; another core's go to its `cores` entry,
 * which is created when it had none and dropped when it holds nothing (no scope, no bindings, no scripts, auto on).
 */
export function withControls(bp: Blueprint, registry: PartRegistry, core: string | undefined, patch: ControlsPatch): Blueprint {
  if (isPrimary(bp, registry, core)) {
    const out: Blueprint = { ...bp };
    if (patch.bindings) out.bindings = patch.bindings.map((b) => ({ ...b }));
    if (patch.scripts) out.scripts = [...patch.scripts];
    if (patch.autoOn === true) delete out.autoControls;
    if (patch.autoOn === false) out.autoControls = false;
    return out;
  }
  const cores = [...(bp.cores ?? [])];
  const i = cores.findIndex((c) => c.core === core);
  const before: CoreControls = cores[i] ?? { core: core as string, bindings: [], scripts: [] };
  const next: CoreControls = { ...before };
  if (patch.bindings) next.bindings = patch.bindings.map((b) => ({ ...b }));
  if (patch.scripts) next.scripts = [...patch.scripts];
  if (patch.autoOn === true) delete next.autoControls;
  if (patch.autoOn === false) next.autoControls = false;
  const empty = next.scope === undefined && next.bindings.length === 0 && next.scripts.length === 0 && next.autoControls === undefined;
  if (i >= 0) {
    if (empty) cores.splice(i, 1);
    else cores[i] = next;
  } else if (!empty) cores.push(next);
  const out: Blueprint = { ...bp };
  if (cores.length > 0) out.cores = cores;
  else delete out.cores;
  return out;
}
