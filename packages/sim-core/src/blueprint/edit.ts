import { partCells } from '../assembly/assemble';
import type { PartRegistry } from '../parts/registry';
import type { Rotation } from '../parts/types';
import { partId } from './expand';
import type { Binding, Blueprint, PlacedPart, Recipe } from './types';

/**
 * Pure edit operations for the builder. Each returns a new Blueprint, or the same object when nothing changed,
 * so callers can skip history entries by identity. Blueprint order is preserved; new parts are appended.
 */

export function blankBlueprint(name: string): Blueprint {
  return { format: 1, name, parts: [], bindings: [], scripts: [], continuations: [] };
}

function cellsOf(p: PlacedPart, registry: PartRegistry): { x: number; y: number }[] {
  return registry.has(p.part) ? partCells(p, registry).map((c) => c.cell) : [{ x: p.x, y: p.y }];
}

/** The part covering a cell, if any. */
export function partAt(bp: Blueprint, registry: PartRegistry, x: number, y: number): PlacedPart | undefined {
  return bp.parts.find((p) => cellsOf(p, registry).some((c) => c.x === x && c.y === y));
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}#${n}`)) return `${base}#${n}`;
}

/** Places a part, replacing whatever covers its cells. Placing an identical part is a no-op. */
export function placePart(bp: Blueprint, registry: PartRegistry, part: string, x: number, y: number, rot: Rotation): Blueprint {
  const probe: PlacedPart = { id: '', part, x, y, rot, tags: [] };
  const cells = cellsOf(probe, registry);
  const covered = (p: PlacedPart): boolean => cellsOf(p, registry).some((c) => cells.some((d) => d.x === c.x && d.y === c.y));
  const hit = bp.parts.filter(covered);
  const same = hit[0];
  if (hit.length === 1 && same && same.part === part && same.x === x && same.y === y && same.rot === rot) return bp;
  const cleared = removeParts(bp, hit.map((p) => p.id));
  const id = uniqueId(partId(part, x, y), new Set(cleared.parts.map((p) => p.id)));
  return { ...cleared, parts: [...cleared.parts, { id, part, x, y, rot, tags: [id] }] };
}

export function erasePartAt(bp: Blueprint, registry: PartRegistry, x: number, y: number): Blueprint {
  const hit = partAt(bp, registry, x, y);
  return hit ? removeParts(bp, [hit.id]) : bp;
}

export function removeParts(bp: Blueprint, ids: readonly string[]): Blueprint {
  if (!bp.parts.some((p) => ids.includes(p.id))) return bp;
  const out: Blueprint = { ...bp, parts: bp.parts.filter((p) => !ids.includes(p.id)) };
  // Everything that named a removed part by id goes with it (M7): a core's controls, and the pilot and takeover
  // order, which would otherwise point at nothing and never validate again.
  if (bp.cores?.some((c) => ids.includes(c.core))) {
    const cores = bp.cores.filter((c) => !ids.includes(c.core));
    if (cores.length > 0) out.cores = cores;
    else delete out.cores;
  }
  if (bp.primaryCore !== undefined && ids.includes(bp.primaryCore)) delete out.primaryCore;
  if (bp.corePriority?.some((id) => ids.includes(id))) {
    const order = bp.corePriority.filter((id) => !ids.includes(id));
    if (order.length > 0) out.corePriority = order;
    else delete out.corePriority;
  }
  return out;
}

/** Explicit tags first, the implicit id tag last, like the grid expansion writes them. */
function withTags(p: PlacedPart, explicit: string[]): PlacedPart {
  const tags: string[] = [];
  for (const t of explicit) if (t !== p.id && !tags.includes(t)) tags.push(t);
  tags.push(p.id);
  return { ...p, tags };
}

export function addTagToParts(bp: Blueprint, ids: readonly string[], tag: string): Blueprint {
  const t = tag.trim();
  if (t === '') return bp;
  return { ...bp, parts: bp.parts.map((p) => (ids.includes(p.id) ? withTags(p, [...p.tags.filter((x) => x !== p.id), t]) : p)) };
}

/** The implicit id tag cannot be removed. */
export function removeTagFromParts(bp: Blueprint, ids: readonly string[], tag: string): Blueprint {
  return { ...bp, parts: bp.parts.map((p) => (ids.includes(p.id) ? withTags(p, p.tags.filter((x) => x !== tag && x !== p.id)) : p)) };
}

export function setPartRotation(bp: Blueprint, _registry: PartRegistry, id: string, rot: Rotation): Blueprint {
  const p = bp.parts.find((q) => q.id === id);
  if (!p || p.rot === rot) return bp;
  return { ...bp, parts: bp.parts.map((q) => (q.id === id ? { ...q, rot } : q)) };
}

export function setBindings(bp: Blueprint, bindings: Binding[]): Blueprint {
  return { ...bp, bindings: bindings.map((b) => ({ ...b })) };
}

/** Turns auto controls on or off for the given parts (`11`). On is stored as the field being absent. */
export function setPartsAuto(bp: Blueprint, ids: readonly string[], on: boolean): Blueprint {
  return {
    ...bp,
    parts: bp.parts.map((p) => {
      if (!ids.includes(p.id) || (p.auto !== false) === on) return p;
      if (on) {
        const { auto: _auto, ...rest } = p;
        return rest;
      }
      return { ...p, auto: false };
    }),
  };
}

/** M10: starts the given parts armed or unarmed. Unarmed is stored as the field being absent. */
export function setPartsArmed(bp: Blueprint, ids: readonly string[], on: boolean): Blueprint {
  return {
    ...bp,
    parts: bp.parts.map((p) => {
      if (!ids.includes(p.id) || (p.armed === true) === on) return p;
      if (!on) {
        const { armed: _armed, ...rest } = p;
        return rest;
      }
      return { ...p, armed: true };
    }),
  };
}

/** Turns auto controls on or off for the whole blueprint. */
export function setAutoControls(bp: Blueprint, on: boolean): Blueprint {
  if ((bp.autoControls !== false) === on) return bp;
  if (on) {
    const { autoControls: _a, ...rest } = bp;
    return rest;
  }
  return { ...bp, autoControls: false };
}

/**
 * M12: what the given fabricators make. With a recipe, it is added (or replaces the one of its name) and the parts make
 * it; without, the parts make nothing. Recipes no part makes any more are dropped.
 */
export function setPartsMakes(bp: Blueprint, ids: readonly string[], recipe: Recipe | undefined): Blueprint {
  // A bay names what it builds after its tag: one without a tag gets a free one (`bay`, then `bayB`, `bayC`, ...).
  const used = new Set(bp.parts.flatMap((p) => p.tags));
  const freeTag = (): string => {
    for (const t of ['bay', ...'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `bay${c}`)]) if (!used.has(t)) return t;
    return `bay${used.size}`;
  };
  const parts: PlacedPart[] = bp.parts.map((p) => {
    if (!ids.includes(p.id)) return p;
    if (recipe) {
      if (p.tags.some((t) => t !== p.id)) return { ...p, makes: recipe.name };
      const tag = freeTag();
      used.add(tag);
      return { ...p, tags: [tag, ...p.tags], makes: recipe.name };
    }
    const { makes: _makes, ...rest } = p;
    return rest;
  });
  const recipes = [...(bp.recipes ?? []).filter((r) => r.name !== recipe?.name), ...(recipe ? [recipe] : [])].filter((r) => parts.some((p) => p.makes === r.name));
  const { recipes: _old, ...rest } = bp;
  return recipes.length > 0 ? { ...rest, parts, recipes } : { ...rest, parts };
}

/** M12: the size of the given stretchy parts (a bay's hollow); `undefined` goes back to the def's default. */
export function setPartsSize(bp: Blueprint, ids: readonly string[], size: [number, number] | undefined): Blueprint {
  return {
    ...bp,
    parts: bp.parts.map((p) => {
      if (!ids.includes(p.id)) return p;
      if (size !== undefined) return { ...p, size: [size[0], size[1]] };
      const { size: _size, ...rest } = p;
      return rest;
    }),
  };
}
