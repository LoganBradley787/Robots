import { assemble, isCore, partCells, rootPartId, type AssemblyPlan } from '../assembly/assemble';
import { matchesTarget, scopedView } from '../control/target';
import { keyProblem } from '../control/keys';
import { FACES, rotateFace } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { Face } from '../parts/types';
import { expandBlueprint } from './expand';
import { toFileJson } from './serialize';
import { recipePlacement } from '../fabricate/recipe';
import type { Binding, Blueprint, Issue, PlacedPart, ScriptSpec } from './types';

export interface ValidationResult {
  blueprint?: Blueprint;
  plan?: AssemblyPlan;
  issues: Issue[];
  /** True when there are no errors. Warnings do not block spawning. */
  ok: boolean;
}

export class BlueprintError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[]) {
    super(`blueprint is invalid:\n${formatIssues(issues)}`);
    this.issues = issues;
  }
}

export function formatIssues(issues: readonly Issue[]): string {
  return issues.map((i) => `${i.severity} ${i.code}: ${i.message}`).join('\n');
}

const MAX_LISTED = 8;

function listIds(ids: readonly string[]): string {
  const shown = ids.slice(0, MAX_LISTED).join(', ');
  return ids.length > MAX_LISTED ? `${shown}, and ${ids.length - MAX_LISTED} more` : shown;
}

function sortFaces(faces: Face[]): Face[] {
  return FACES.filter((f) => faces.includes(f));
}

/** Runs on load, in the editor, and in the headless runner. Errors block spawning; warnings do not. */
export function validateBlueprint(raw: unknown, registry: PartRegistry): ValidationResult {
  const expanded = expandBlueprint(raw);
  if (!expanded.blueprint) return { issues: expanded.issues, ok: false };
  const issues: Issue[] = [];
  const err = (code: string, message: string, extra: Partial<Issue> = {}): void => {
    issues.push({ severity: 'error', code, message, ...extra });
  };
  const warn = (code: string, message: string, extra: Partial<Issue> = {}): void => {
    issues.push({ severity: 'warning', code, message, ...extra });
  };

  const src = expanded.blueprint;
  // Structural checks. Assembly assumes all of these pass.
  for (const p of src.parts) {
    if (!registry.has(p.part)) {
      err('UNKNOWN_PART', `${p.id} uses part '${p.part}', which does not exist (known: ${registry.ids().join(', ')})`, {
        partId: p.id,
        cell: { x: p.x, y: p.y },
      });
    }
  }
  if (src.parts.length === 0) err('EMPTY', 'blueprint has no parts');
  const seenIds = new Set<string>();
  for (const p of src.parts) {
    if (seenIds.has(p.id)) err('DUPLICATE_ID', `part id '${p.id}' is used by more than one part`, { partId: p.id });
    if (registry.has(p.id)) {
      err('BAD_ID', `part id '${p.id}' is a part type name, so a binding to it would reach every ${p.id}; pick another id, like 'left-${p.id}'`, {
        partId: p.id,
      });
    }
    seenIds.add(p.id);
  }
  if (issues.length > 0) return { issues, ok: false };

  const occupied = new Map<string, string>();
  for (const p of src.parts) {
    for (const { cell } of partCells(p, registry)) {
      const key = `${cell.x},${cell.y}`;
      const prev = occupied.get(key);
      if (prev !== undefined) err('OVERLAP', `${p.id} overlaps ${prev}`, { partId: p.id, cell });
      else occupied.set(key, p.id);
    }
  }
  for (const c of src.continuations) {
    if (!occupied.has(`${c.x},${c.y}`)) err('BAD_CONTINUATION', `'=' at (${c.x}, ${c.y}) does not continue a multi-cell part`, { cell: c });
  }
  // M10: only a part that needs arming can start armed.
  for (const p of src.parts) {
    if (p.armed !== true || registry.get(p.part).arming === true) continue;
    const armable = registry.ids().filter((id) => registry.get(id).arming === true);
    err('BAD_ARMED', `${p.id} is marked armed, but a ${p.part} is never armed (parts that need arming: ${armable.join(', ') || 'none'}); remove "armed"`, { partId: p.id, cell: { x: p.x, y: p.y } });
  }
  if (issues.length > 0) return { issues, ok: false };

  // Def default tags join the blueprint's tags.
  const blueprint: Blueprint = {
    ...src,
    parts: src.parts.map((p) => {
      const extra = (registry.get(p.part).defaultTags ?? []).filter((t) => !p.tags.includes(t));
      return extra.length > 0 ? { ...p, tags: [...p.tags, ...extra] } : p;
    }),
  };

  const cores = blueprint.parts.filter((p) => isCore(p, registry));
  if (blueprint.primaryCore !== undefined && !cores.some((c) => c.id === blueprint.primaryCore)) {
    err('BAD_PRIMARY_CORE', `primaryCore '${blueprint.primaryCore}' is not a core in this blueprint`, { path: 'primaryCore' });
    return { issues, ok: false };
  }
  for (const id of blueprint.corePriority ?? []) {
    if (!cores.some((c) => c.id === id)) err('BAD_CORE_PRIORITY', `corePriority lists '${id}', which is not a core in this blueprint`);
  }
  if (cores.length === 0) warn('NO_CORE', 'blueprint has no core; it will spawn as debris');

  const rootId = rootPartId(blueprint, registry) as string;
  const plan = assemble(blueprint, registry, rootId);

  const unattached = new Set<string>();
  if (blueprint.parts.length > 1) {
    for (const p of blueprint.parts) {
      // The root is where the robot is anchored; when it is alone, the problem is the other parts.
      if (p.id === rootId || (plan.attachedFaces.get(p.id) ?? 0) > 0) continue;
      unattached.add(p.id);
      err('UNATTACHED', `${p.id} has no attached face (${describeFaces(p, registry)} touch${facesCount(p, registry) === 1 ? 'es' : ''} nothing)`, {
        partId: p.id,
        cell: { x: p.x, y: p.y },
      });
    }
  }

  for (const id of plan.lockedJoints) {
    const p = blueprint.parts.find((q) => q.id === id);
    err('LOCKED_JOINT', `${id} cannot turn: the parts it carries also attach to its base another way, or another joint carries them too (a loop)`, {
      partId: id,
      ...(p ? { cell: { x: p.x, y: p.y } } : {}),
    });
  }

  const rootChunk = plan.chunks.find((c) => c.partIds.includes(rootId));
  const disconnected = blueprint.parts.map((p) => p.id).filter((id) => !rootChunk?.partIds.includes(id) && !unattached.has(id));
  if (disconnected.length > 0) {
    const root = cores.length > 0 ? `the primary core ${rootId}` : `the first part ${rootId}`;
    const n = disconnected.length;
    err('DISCONNECTED', `${n} ${n === 1 ? 'part is' : 'parts are'} not connected to ${root}: ${listIds(disconnected)}`, {
      partId: disconnected[0] as string,
    });
  }

  checkScripts(blueprint.scripts, err, '');
  checkBindings(blueprint.bindings, blueprint.scripts, blueprint.parts, registry, err, warn, '');
  const seenCores = new Set<string>();
  for (const c of blueprint.cores ?? []) {
    const label = `core ${c.core}${c.scope !== undefined ? ` (${c.scope})` : ''}: `;
    if (c.core === rootId) err('BAD_CORE_CONTROLS', `cores lists ${c.core}, the primary core; its controls are the top-level bindings and scripts`, { path: `cores.${c.core}` });
    else if (!cores.some((p) => p.id === c.core)) err('BAD_CORE_CONTROLS', `cores lists '${c.core}', which is not a core in this blueprint`, { path: `cores.${c.core}` });
    if (seenCores.has(c.core)) err('BAD_CORE_CONTROLS', `cores lists ${c.core} twice`);
    seenCores.add(c.core);
    checkScripts(c.scripts, err, label);
    // A scoped core sees its members' tags without the prefix, like its bindings were written (M7).
    const view = blueprint.parts.map((p) => {
      const v = scopedView(p, c.scope);
      return { ...p, tags: [...v.tags], matchPart: v.part };
    });
    checkBindings(c.bindings, c.scripts, view, registry, err, warn, label);
  }
  const files = new Set<string>();
  for (const s of [...blueprint.scripts, ...(blueprint.cores ?? []).flatMap((c) => c.scripts)]) {
    if (s.file !== undefined && files.has(s.file)) err('BAD_SCRIPT', `two scripts use the file '${s.file}'; give each its own`);
    if (s.file !== undefined) files.add(s.file);
  }
  checkRecipes(blueprint, registry, err, warn);
  const ok = !issues.some((i) => i.severity === 'error');
  return { blueprint, plan, issues, ok };
}

/**
 * M12: every recipe is a valid blueprint on its own, and every part with `makes` is a fabricator whose recipe exists
 * and fits its hollow (`recipePlacement`).
 */
function checkRecipes(bp: Blueprint, registry: PartRegistry, err: Report, warn: Report): void {
  const names = (bp.recipes ?? []).map((r) => r.name);
  for (const r of bp.recipes ?? []) {
    const v = validateBlueprint(toFileJson(r.blueprint, registry, { inlineScripts: true }), registry);
    for (const i of v.issues) (i.severity === 'error' ? err : warn)(i.code, `recipe ${r.name}: ${i.message}`, { path: `recipes.${r.name}` });
  }
  for (const p of bp.parts) {
    if (p.makes === undefined) continue;
    const at = { partId: p.id, cell: { x: p.x, y: p.y } };
    if (!registry.get(p.part).fabricate) {
      const makers = registry.ids().filter((id) => registry.get(id).fabricate !== undefined);
      err('BAD_MAKES', `${p.id} makes '${p.makes}', but a ${p.part} builds nothing (parts that do: ${makers.join(', ') || 'none'}); remove "makes"`, at);
      continue;
    }
    const recipe = bp.recipes?.find((r) => r.name === p.makes);
    if (!recipe) {
      err('BAD_MAKES', `${p.id} makes '${p.makes}', which is not one of the blueprint's recipes (${names.join(', ') || 'none'})`, at);
      continue;
    }
    const place = recipePlacement(p, recipe.blueprint, registry);
    if (!place.ok) err('BAD_RECIPE', `${p.id}: ${place.error}`, at);
  }
}

function facesOf(p: PlacedPart, registry: PartRegistry): Face[] {
  const faces: Face[] = [];
  for (const { faces: fs } of partCells(p, registry)) for (const f of fs) if (!faces.includes(f)) faces.push(f);
  return sortFaces(faces);
}

function facesCount(p: PlacedPart, registry: PartRegistry): number {
  return facesOf(p, registry).length;
}

function describeFaces(p: PlacedPart, registry: PartRegistry): string {
  const joint = registry.get(p.part).joint;
  if (joint) return `its mount face ${rotateFace(joint.mountFace, p.rot)}`;
  return `its faces ${facesOf(p, registry).join(', ')}`;
}

type Report = (code: string, message: string, extra?: Partial<Issue>) => void;

/** Script ids are names you bind keys to; files live in `blueprints/` and must be plain `.js` names. */
export const SCRIPT_FILE = /^[a-z0-9][a-z0-9._-]*\.js$/;

function checkScripts(scripts: readonly ScriptSpec[], err: Report, label: string): void {
  const seen = new Set<string>();
  for (const s of scripts) {
    if (seen.has(s.id)) err('BAD_SCRIPT', `${label}script id '${s.id}' is used twice`);
    seen.add(s.id);
    if (s.file !== undefined && (!SCRIPT_FILE.test(s.file) || s.file.includes('..'))) {
      err('BAD_SCRIPT', `${label}script '${s.id}' file '${s.file}' must be a plain name in blueprints/ like 'drone.hover.js'`);
    }
  }
}

function checkBindings(
  bindings: readonly Binding[],
  scripts: readonly ScriptSpec[],
  /** `matchPart` stands in for the part type when a scope hides it (`scopedView`). */
  parts: readonly (PlacedPart & { matchPart?: string })[],
  registry: PartRegistry,
  err: Report,
  warn: Report,
  label: string,
): void {
  for (const b of bindings) {
    const problem = keyProblem(b.key);
    if (problem) err('BAD_KEY', `${label}binding ${problem}`);
    if (b.mode === 'script') {
      if (!scripts.some((s) => s.id === b.script)) {
        err('BAD_SCRIPT_REF', `${label}binding key '${b.key}' toggles script '${b.script}', which is not in scripts`);
      }
      continue;
    }
    const tagged = parts.filter((p) => matchesTarget({ part: p.matchPart ?? p.part, tags: p.tags }, b.target as string));
    if (tagged.length === 0) {
      err('BAD_TARGET', `${label}binding key '${b.key}' targets '${b.target}' but no part has that tag or part type`);
      continue;
    }
    const hasInput = (p: PlacedPart): boolean => registry.get(p.part).inputs.some((c) => c.name === b.channel);
    const lacking = tagged.filter((p) => !hasInput(p));
    if (lacking.length === tagged.length) {
      const kinds = [...new Set(tagged.map((p) => p.part))].join(' and ');
      err('BAD_CHANNEL', `${label}binding key '${b.key}' writes channel '${b.channel}' on tag '${b.target}' but ${kinds} has no input '${b.channel}'`);
    } else if (lacking.length > 0) {
      const ids = listIds(lacking.map((p) => p.id));
      warn(
        'CHANNEL_SKIPPED',
        `${label}binding key '${b.key}' writes channel '${b.channel}' on tag '${b.target}'; ${ids} ${lacking.length === 1 ? 'has' : 'have'} no input '${b.channel}' and ${lacking.length === 1 ? 'is' : 'are'} skipped`,
      );
    }
  }
}

/** Validates and returns the blueprint and its assembly plan, or throws BlueprintError with every issue. */
export function loadBlueprint(raw: unknown, registry: PartRegistry): { blueprint: Blueprint; plan: AssemblyPlan; issues: Issue[] } {
  const r = validateBlueprint(raw, registry);
  if (!r.ok || !r.blueprint || !r.plan) throw new BlueprintError(r.issues.filter((i) => i.severity === 'error'));
  return { blueprint: r.blueprint, plan: r.plan, issues: r.issues };
}
