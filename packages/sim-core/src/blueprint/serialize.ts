import { isCore, rootPartId } from '../assembly/assemble';
import type { PartRegistry } from '../parts/registry';
import { partId } from './expand';
import { toGrid } from './toGrid';
import type { Blueprint, ScriptSpec } from './types';

/**
 * The JSON written to a blueprint file: the grid form when a grid can express the blueprint (readable in diffs and
 * by Claude), else the parts form. Empty optional sections are left out. `inlineScripts` puts script code inline
 * (deploys, replays, dirty checks) instead of referencing the script's file.
 */
export function toFileJson(bp: Blueprint, registry: PartRegistry, opts: { inlineScripts?: boolean } = {}): Record<string, unknown> {
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
      if (p.auto === false) e.auto = false;
      if (p.armed === true) e.armed = true;
      if (p.makes !== undefined) e.makes = p.makes;
      if (p.size !== undefined) e.size = p.size;
      return e;
    });
  }
  if (bp.primaryCore !== undefined) out.primaryCore = bp.primaryCore;
  // With two cores and none named, the pilot is the first core in part order, and the file writes parts in grid
  // reading order: name it, so the file (and a deploy, and the validator) keeps the same pilot (M7 review).
  else if (bp.parts.filter((p) => registry.has(p.part) && isCore(p, registry)).length > 1) {
    const root = rootPartId(bp, registry);
    if (root !== undefined) out.primaryCore = root;
  }
  if (bp.corePriority !== undefined) out.corePriority = bp.corePriority;
  if (bp.autoControls === false) out.autoControls = false;
  if (bp.bindings.length > 0) out.bindings = bp.bindings;
  if (bp.scripts.length > 0) out.scripts = bp.scripts.map((s) => scriptJson(s, opts));
  if (bp.cores && bp.cores.length > 0) {
    const cores: Record<string, unknown> = {};
    for (const c of bp.cores) {
      const e: Record<string, unknown> = {};
      if (c.scope !== undefined) e.scope = c.scope;
      if (c.autoControls === false) e.autoControls = false;
      if (c.bindings.length > 0) e.bindings = c.bindings;
      if (c.scripts.length > 0) e.scripts = c.scripts.map((s) => scriptJson(s, opts));
      // defineProperty: a core id is data, never `__proto__` magic.
      Object.defineProperty(cores, c.core, { value: e, enumerable: true, writable: true, configurable: true });
    }
    out.cores = cores;
  }
  if (bp.recipes && bp.recipes.length > 0) {
    const recipes: Record<string, unknown> = {};
    for (const r of bp.recipes) Object.defineProperty(recipes, r.name, { value: toFileJson(r.blueprint, registry, opts), enumerable: true, writable: true, configurable: true });
    out.recipes = recipes;
  }
  return out;
}

/**
 * On disk a script with a file is a reference (its code is in the .js file). Deploys and replays inline the code,
 * so a run never depends on files that change later.
 */
function scriptJson(s: ScriptSpec, opts: { inlineScripts?: boolean }): Record<string, unknown> {
  const e: Record<string, unknown> = { id: s.id };
  if (!s.enabled) e.enabled = false;
  if (Object.keys(s.params).length > 0) e.params = s.params;
  if (s.file !== undefined && !(opts.inlineScripts && typeof s.source === 'string')) e.source = { file: s.file };
  else {
    e.source = s.source;
    if (s.file !== undefined) e.file = s.file;
  }
  return e;
}
