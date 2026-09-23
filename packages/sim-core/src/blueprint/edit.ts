import { partCells } from '../assembly/assemble';
import type { PartRegistry } from '../parts/registry';
import type { Rotation } from '../parts/types';
import { partId } from './expand';
import type { Binding, Blueprint, PlacedPart } from './types';

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
  const kept = bp.parts.filter((p) => !covered(p));
  const id = uniqueId(partId(part, x, y), new Set(kept.map((p) => p.id)));
  return { ...bp, parts: [...kept, { id, part, x, y, rot, tags: [id] }] };
}

export function erasePartAt(bp: Blueprint, registry: PartRegistry, x: number, y: number): Blueprint {
  const hit = partAt(bp, registry, x, y);
  return hit ? removeParts(bp, [hit.id]) : bp;
}

export function removeParts(bp: Blueprint, ids: readonly string[]): Blueprint {
  if (!bp.parts.some((p) => ids.includes(p.id))) return bp;
  return { ...bp, parts: bp.parts.filter((p) => !ids.includes(p.id)) };
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

/** Turns auto controls on or off for the whole blueprint. */
export function setAutoControls(bp: Blueprint, on: boolean): Blueprint {
  if ((bp.autoControls !== false) === on) return bp;
  if (on) {
    const { autoControls: _a, ...rest } = bp;
    return rest;
  }
  return { ...bp, autoControls: false };
}
