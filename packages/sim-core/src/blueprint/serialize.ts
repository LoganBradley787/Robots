import type { PartRegistry } from '../parts/registry';
import { partId } from './expand';
import { toGrid } from './toGrid';
import type { Blueprint } from './types';

/**
 * The JSON written to a blueprint file: the grid form when a grid can express the blueprint (readable in diffs and
 * by Claude), else the parts form. Empty optional sections are left out.
 */
export function toFileJson(bp: Blueprint, registry: PartRegistry): Record<string, unknown> {
  const out: Record<string, unknown> = { format: 1, name: bp.name };
  const g = toGrid(bp, registry);
  if (g) {
    out.grid = g.grid;
    if (Object.keys(g.legend).length > 0) out.legend = g.legend;
  } else {
    out.parts = bp.parts.map((p) => {
      const e: Record<string, unknown> = {};
      if (p.id !== partId(p.part, p.x, p.y)) e.id = p.id;
      e.part = p.part;
      e.x = p.x;
      e.y = p.y;
      if (p.rot !== 0) e.rot = p.rot;
      const tags = p.tags.filter((t) => t !== p.id);
      if (tags.length > 0) e.tags = tags;
      return e;
    });
  }
  if (bp.primaryCore !== undefined) out.primaryCore = bp.primaryCore;
  if (bp.corePriority !== undefined) out.corePriority = bp.corePriority;
  if (bp.bindings.length > 0) out.bindings = bp.bindings;
  if (bp.scripts.length > 0) out.scripts = bp.scripts;
  return out;
}
