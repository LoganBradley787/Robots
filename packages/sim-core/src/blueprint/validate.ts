import { assemble, isCore, partCells, rootPartId, type AssemblyPlan } from '../assembly/assemble';
import { matchesTarget } from '../control/target';
import { keyProblem } from '../control/keys';
import { FACES, rotateFace } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { Face } from '../parts/types';
import { expandBlueprint } from './expand';
import type { Blueprint, Issue, PlacedPart } from './types';

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

  const rootChunk = plan.chunks.find((c) => c.partIds.includes(rootId));
  const disconnected = blueprint.parts.map((p) => p.id).filter((id) => !rootChunk?.partIds.includes(id) && !unattached.has(id));
  if (disconnected.length > 0) {
    const root = cores.length > 0 ? `the primary core ${rootId}` : `the first part ${rootId}`;
    const n = disconnected.length;
    err('DISCONNECTED', `${n} ${n === 1 ? 'part is' : 'parts are'} not connected to ${root}: ${listIds(disconnected)}`, {
      partId: disconnected[0] as string,
    });
  }

  checkBindings(blueprint, registry, err, warn);
  const ok = !issues.some((i) => i.severity === 'error');
  return { blueprint, plan, issues, ok };
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

function checkBindings(bp: Blueprint, registry: PartRegistry, err: Report, warn: Report): void {
  for (const b of bp.bindings) {
    const problem = keyProblem(b.key);
    if (problem) err('BAD_KEY', `binding ${problem}`);
    if (b.mode === 'script') {
      if (!bp.scripts.some((s) => s.id === b.script)) {
        err('BAD_SCRIPT_REF', `binding key '${b.key}' toggles script '${b.script}', which is not in scripts`);
      }
      continue;
    }
    const tagged = bp.parts.filter((p) => matchesTarget(p, b.target as string));
    if (tagged.length === 0) {
      err('BAD_TARGET', `binding key '${b.key}' targets '${b.target}' but no part has that tag or part type`);
      continue;
    }
    const hasInput = (p: PlacedPart): boolean => registry.get(p.part).inputs.some((c) => c.name === b.channel);
    const lacking = tagged.filter((p) => !hasInput(p));
    if (lacking.length === tagged.length) {
      const kinds = [...new Set(tagged.map((p) => p.part))].join(' and ');
      err('BAD_CHANNEL', `binding key '${b.key}' writes channel '${b.channel}' on tag '${b.target}' but ${kinds} has no input '${b.channel}'`);
    } else if (lacking.length > 0) {
      const ids = listIds(lacking.map((p) => p.id));
      warn(
        'CHANNEL_SKIPPED',
        `binding key '${b.key}' writes channel '${b.channel}' on tag '${b.target}'; ${ids} ${lacking.length === 1 ? 'has' : 'have'} no input '${b.channel}' and ${lacking.length === 1 ? 'is' : 'are'} skipped`,
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
