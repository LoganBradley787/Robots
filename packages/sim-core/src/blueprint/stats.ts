import { partCells } from '../assembly/assemble';
import { footprintOf, partMass } from '../parts/footprint';
import type { PartRegistry } from '../parts/registry';
import type { Blueprint } from './types';

export interface StaticStats {
  parts: number;
  massKg: number;
  /** Center of mass in cell coordinates (cell centers are integers). */
  comX: number;
  comY: number;
  /** Energy the cores and batteries hold when full. */
  energy: number;
  /** Energy per second with every part working at full command. */
  fullDraw: number;
}

/** Mass, balance, and energy from part defs alone, for the builder. Unknown parts are skipped. */
export function staticStats(bp: Blueprint, registry: PartRegistry): StaticStats {
  let mass = 0;
  let mx = 0;
  let my = 0;
  let energy = 0;
  let fullDraw = 0;
  for (const p of bp.parts) {
    if (!registry.has(p.part)) continue;
    const def = registry.get(p.part);
    if (def.resource?.kind === 'energy') energy += def.resource.capacity;
    fullDraw += def.powerDraw;
    const cells = partCells(p, registry);
    const m = partMass(def, footprintOf(def, p.size)) / cells.length;
    for (const { cell } of cells) {
      mass += m;
      mx += m * cell.x;
      my += m * cell.y;
    }
  }
  return { parts: bp.parts.length, massKg: mass, comX: mass > 0 ? mx / mass : 0, comY: mass > 0 ? my / mass : 0, energy, fullDraw };
}
