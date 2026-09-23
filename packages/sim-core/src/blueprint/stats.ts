import { partCells } from '../assembly/assemble';
import type { PartRegistry } from '../parts/registry';
import type { Blueprint } from './types';

export interface StaticStats {
  parts: number;
  massKg: number;
  /** Center of mass in cell coordinates (cell centers are integers). */
  comX: number;
  comY: number;
}

/** Mass and balance from part defs alone, for the builder. Unknown parts are skipped. */
export function staticStats(bp: Blueprint, registry: PartRegistry): StaticStats {
  let mass = 0;
  let mx = 0;
  let my = 0;
  for (const p of bp.parts) {
    if (!registry.has(p.part)) continue;
    const def = registry.get(p.part);
    const cells = partCells(p, registry);
    const m = def.mass / cells.length;
    for (const { cell } of cells) {
      mass += m;
      mx += m * cell.x;
      my += m * cell.y;
    }
  }
  return { parts: bp.parts.length, massKg: mass, comX: mass > 0 ? mx / mass : 0, comY: mass > 0 ? my / mass : 0 };
}
