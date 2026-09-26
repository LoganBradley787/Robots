import { isCore, partCells, rootPartId } from '../assembly/assemble';
import { rotateCell } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { Rotation } from '../parts/types';
import { partId } from './expand';
import { mirrorProblem, mirrorRotation } from './mirror';
import type { Binding, Blueprint, CoreControls, PlacedPart, ScriptSpec } from './types';

export interface PlaceOptions {
  rot?: Rotation;
  /** Flip the source left to right (across its root part's column) before turning it. */
  mirror?: boolean;
}

export type PlaceResult = { ok: true; blueprint: Blueprint; scope?: string; warnings: string[] } | { ok: false; error: string };

/**
 * Places a copy of `source` on `target` (M7, Logan: a placed blueprint becomes part of the robot, never a link to
 * its file). The source's root part (its primary core, else its first core, else its first part) lands on `at`;
 * `mirror` flips it first, then `rot` turns it around that cell.
 *
 * When the target already has a core, the copy gets a scope (`missile1`, the source's name plus the first free
 * number): every copied part is tagged `missile1`, its own tags become `missile1.<tag>`, and the source's controls
 * move to its core's entry in `cores` with that scope, so its bindings and scripts keep meaning the same parts and
 * the target's controls never reach the copy by tag. When the target has no core, the source's core becomes the
 * robot's primary core and everything is copied as it is.
 *
 * Copied parts get ordinary ids for their new cells; bindings that named a part by id are rewritten to its new id.
 * Scripts must be loaded (code, not `{ file }`); they lose their file so the target saves them under its own names.
 * Pure. Refuses overlaps with the target's parts.
 */
export function placeBlueprint(target: Blueprint, source: Blueprint, at: { x: number; y: number }, registry: PartRegistry, opts: PlaceOptions = {}): PlaceResult {
  const rot: Rotation = opts.rot ?? 0;
  const anchorId = rootPartId(source, registry);
  const anchor = source.parts.find((p) => p.id === anchorId);
  if (!anchor) return { ok: false, error: `${source.name} has no parts` };
  for (const p of source.parts) if (!registry.has(p.part)) return { ok: false, error: `${source.name}: ${p.id} uses part '${p.part}', which does not exist` };
  const unloaded = [...source.scripts, ...(source.cores ?? []).flatMap((c) => c.scripts)].find((s) => typeof s.source !== 'string');
  if (unloaded) return { ok: false, error: `${source.name}: script '${unloaded.id}' was not loaded from its file` };

  const unmirrored = opts.mirror ? mirrorProblem(source, registry) : undefined;
  if (unmirrored) return { ok: false, error: unmirrored };
  // Where each source part goes.
  const taken = new Set(target.parts.map((p) => p.id));
  const newId = new Map<string, string>();
  const moved: PlacedPart[] = source.parts.map((p) => {
    let dx = p.x - anchor.x;
    let r = p.rot;
    if (opts.mirror) {
      dx = -dx;
      r = mirrorRotation(r);
    }
    const d = rotateCell({ x: dx, y: p.y - anchor.y }, rot);
    const x = at.x + d.x;
    const y = at.y + d.y;
    const part = p.part;
    let id = partId(part, x, y);
    for (let n = 2; taken.has(id); n++) id = `${partId(part, x, y)}#${n}`;
    taken.add(id);
    newId.set(p.id, id);
    const out: PlacedPart = { id, part, x, y, rot: ((r + rot) % 360) as Rotation, tags: p.tags.filter((t) => t !== p.id) };
    if (p.auto === false || source.autoControls === false) out.auto = false;
    if (p.armed === true) out.armed = true;
    return out;
  });

  const occupied = new Map<string, string>();
  for (const p of target.parts) {
    const cells = registry.has(p.part) ? partCells(p, registry).map((c) => c.cell) : [{ x: p.x, y: p.y }];
    for (const c of cells) occupied.set(`${c.x},${c.y}`, p.id);
  }
  for (const p of moved) {
    for (const { cell } of partCells(p, registry)) {
      const hit = occupied.get(`${cell.x},${cell.y}`);
      if (hit !== undefined) return { ok: false, error: `${source.name} would overlap ${hit} at (${cell.x}, ${cell.y})` };
    }
  }

  const rename = (b: Binding): Binding => (b.target !== undefined && newId.has(b.target) ? { ...b, target: newId.get(b.target) as string } : { ...b });
  const copyScript = (s: ScriptSpec): ScriptSpec => {
    const { file: _file, ...rest } = s;
    return { ...rest, params: { ...s.params } };
  };
  const warnings: string[] = [];
  const anchorIsCore = isCore(anchor, registry);
  const hasTopControls = source.bindings.length > 0 || source.scripts.length > 0 || source.autoControls === false;
  if (!anchorIsCore && hasTopControls) warnings.push(`${source.name} has no core, so its bindings and scripts were left out; bind its parts from this robot`);
  const targetHasCore = target.parts.some((p) => isCore(p, registry));

  if (!targetHasCore) {
    // The copy brings the robot its core: it stays exactly as it was, controls and all.
    const parts = moved.map((p) => ({ ...p, tags: [...p.tags, p.id] }));
    const out: Blueprint = { ...target, parts: [...target.parts, ...parts] };
    if (anchorIsCore) {
      out.bindings = [...target.bindings, ...source.bindings.map(rename)];
      out.scripts = [...target.scripts, ...source.scripts.map(copyScript)];
      if (source.autoControls === false && target.parts.length === 0) out.autoControls = false;
      // The source's pilot stays the pilot: the anchor is it (its primary core, else its first core), and turning the
      // copy changes which core comes first in reading order.
      if (source.parts.filter((p) => isCore(p, registry)).length > 1) out.primaryCore = newId.get(anchor.id) as string;
    }
    const cores = (source.cores ?? []).map((c) => ({ ...c, core: newId.get(c.core) ?? c.core, bindings: c.bindings.map(rename), scripts: c.scripts.map(copyScript) }));
    if (cores.length > 0) out.cores = [...(target.cores ?? []), ...cores];
    return { ok: true, blueprint: out, warnings };
  }

  const scope = freeScope(target, source.name);
  const parts = moved.map((p) => ({ ...p, tags: [scope, ...p.tags.map((t) => `${scope}.${t}`), p.id] }));
  const cores: CoreControls[] = [];
  if (anchorIsCore) {
    const c: CoreControls = { core: newId.get(anchor.id) as string, scope, bindings: source.bindings.map(rename), scripts: source.scripts.map(copyScript) };
    if (source.autoControls === false) c.autoControls = false;
    cores.push(c);
  }
  for (const c of source.cores ?? []) {
    cores.push({ ...c, core: newId.get(c.core) ?? c.core, scope: c.scope !== undefined ? `${scope}.${c.scope}` : scope, bindings: c.bindings.map(rename), scripts: c.scripts.map(copyScript) });
  }
  const out: Blueprint = { ...target, parts: [...target.parts, ...parts] };
  // Saving writes parts in grid reading order, which would make a core placed higher up the first core: name the
  // robot's own core so it stays the pilot.
  if (out.primaryCore === undefined) out.primaryCore = rootPartId(target, registry) as string;
  if (cores.length > 0) out.cores = [...(target.cores ?? []), ...cores];
  return { ok: true, blueprint: out, scope, warnings };
}

/** `missile1`, or the next number no tag or core scope of the target uses yet. */
function freeScope(target: Blueprint, name: string): string {
  const word = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'part';
  const used = (s: string): boolean =>
    target.parts.some((p) => p.tags.some((t) => t === s || t.startsWith(`${s}.`))) || (target.cores ?? []).some((c) => c.scope === s || c.scope?.startsWith(`${s}.`) === true);
  for (let n = 1; ; n++) if (!used(`${word}${n}`)) return `${word}${n}`;
}
