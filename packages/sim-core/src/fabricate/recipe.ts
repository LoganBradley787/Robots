import { partCells, rootPartId } from '../assembly/assemble';
import { faceDir, opposite, rotateCell, type Cell } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { PartDef, Rotation } from '../parts/types';
import type { Blueprint, PlacedPart } from '../blueprint/types';

/**
 * A part's hollow (M12): the cells inside its footprint's bounding box that are not part of it, at rotation 0,
 * from its origin. A fabricator bay builds inside it.
 */
export function hollowCells(def: PartDef): Cell[] {
  const own = new Set(def.footprint.map((c) => `${c.x},${c.y}`));
  const xs = def.footprint.map((c) => c.x);
  const ys = def.footprint.map((c) => c.y);
  const out: Cell[] = [];
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) for (let x = Math.min(...xs); x <= Math.max(...xs); x++) if (!own.has(`${x},${y}`)) out.push({ x, y });
  return out;
}

/** What a recipe weighs, and the energy its containers hold full (M12: a build pays for both). */
export function recipeStats(bp: Blueprint, registry: PartRegistry): { mass: number; stored: number } {
  let mass = 0;
  let stored = 0;
  for (const p of bp.parts) {
    const d = registry.get(p.part);
    mass += d.mass;
    stored += d.resource?.capacity ?? 0;
  }
  return { mass, stored };
}

/**
 * Where a bay builds a recipe (M12): the recipe as it is (not turned), its bounding box's bottom-left cell on the
 * hollow's bottom-left cell, then turned with the bay. Every recipe cell must be in the hollow, and one of its faces
 * must meet one of the bay's grips, or it would fall out as soon as it was built. `at` is where the recipe's root
 * part lands in the robot's cells, and `rot` its turn, as `placeBlueprint` takes them.
 */
export function recipePlacement(bay: PlacedPart, recipe: Blueprint, registry: PartRegistry): { ok: true; at: Cell; rot: Rotation } | { ok: false; error: string } {
  const def = registry.get(bay.part);
  const hollow = hollowCells(def);
  if (hollow.length === 0) return { ok: false, error: `a ${bay.part} has no hollow to build in` };
  if (recipe.parts.length === 0) return { ok: false, error: `${recipe.name} has no parts` };
  const cells = recipe.parts.flatMap((p) => (registry.has(p.part) ? partCells(p, registry) : []));
  const minX = (cs: readonly Cell[]): number => Math.min(...cs.map((c) => c.x));
  const minY = (cs: readonly Cell[]): number => Math.min(...cs.map((c) => c.y));
  const dx = minX(hollow) - minX(cells.map((c) => c.cell));
  const dy = minY(hollow) - minY(cells.map((c) => c.cell));
  const inHollow = new Set(hollow.map((c) => `${c.x},${c.y}`));
  const outside = cells.find((c) => !inHollow.has(`${c.cell.x + dx},${c.cell.y + dy}`));
  if (outside) {
    const w = Math.max(...hollow.map((c) => c.x)) - minX(hollow) + 1;
    const h = Math.max(...hollow.map((c) => c.y)) - minY(hollow) + 1;
    return { ok: false, error: `${recipe.name} does not fit a ${bay.part}'s hollow (${w} wide, ${h} tall, filled from its bottom-left)` };
  }
  const grips = new Map<string, readonly string[]>();
  for (const fc of def.footprint) if (fc.grips) grips.set(`${fc.x},${fc.y}`, fc.grips);
  const held = cells.some((c) =>
    c.faces.some((f) => {
      const d = faceDir(f);
      return grips.get(`${c.cell.x + dx + d.x},${c.cell.y + dy + d.y}`)?.includes(opposite(f)) === true;
    }),
  );
  if (!held) return { ok: false, error: `${recipe.name} would touch none of a ${bay.part}'s grips, so it would fall out when built` };
  const rootId = rootPartId(recipe, registry);
  const root = recipe.parts.find((p) => p.id === rootId) as PlacedPart;
  const off = rotateCell({ x: root.x + dx, y: root.y + dy }, bay.rot);
  return { ok: true, at: { x: bay.x + off.x, y: bay.y + off.y }, rot: bay.rot };
}

/** The bay's hollow cells in the robot's cells, turned with it. */
export function hollowAt(bay: PlacedPart, def: PartDef): Cell[] {
  return hollowCells(def).map((c) => {
    const o = rotateCell(c, bay.rot);
    return { x: bay.x + o.x, y: bay.y + o.y };
  });
}


/**
 * What a fabricator names its copies after (M12): its most specific explicit tag (`bay`, or `fab-drone1.bay` in a
 * placed copy, so a woken copy's scripts still reach `bay1` inside their scope). Copies are `<base><n>`. Undefined
 * without an explicit tag.
 */
export function scopeBase(bay: PlacedPart, def: PartDef): string | undefined {
  const explicit = bay.tags.filter((t) => t !== bay.id && !(def.defaultTags ?? []).includes(t));
  return explicit[explicit.length - 1];
}

/** The cells (and faces) a recipe's parts take in the robot once built, from `recipePlacement`. */
export function placedRecipeCells(recipe: Blueprint, at: Cell, rot: Rotation, registry: PartRegistry): { id: string; cell: Cell; faces: string[] }[] {
  const rootId = rootPartId(recipe, registry);
  const root = recipe.parts.find((p) => p.id === rootId);
  if (!root) return [];
  return recipe.parts.flatMap((p) => {
    if (!registry.has(p.part)) return [];
    const off = rotateCell({ x: p.x - root.x, y: p.y - root.y }, rot);
    const moved: PlacedPart = { ...p, x: at.x + off.x, y: at.y + off.y, rot: ((p.rot + rot) % 360) as Rotation };
    return partCells(moved, registry).map((c) => ({ id: p.id, cell: c.cell, faces: c.faces }));
  });
}
