import type { Rotation } from '../parts/types';
import { partId } from './expand';
import type { Binding, Blueprint } from './types';

/**
 * Mirroring across a vertical axis. The axis is stored in half cells so it can sit on a column center (even) or a
 * cell boundary (odd). Every v1 part is symmetric about its own vertical axis at rotation 0, so a mirrored part only
 * needs its rotation reflected: left-facing becomes right-facing. Asymmetric or multi-cell parts would need a
 * mirrored footprint; none exist yet.
 */
export function mirrorRotation(rot: Rotation): Rotation {
  return ((360 - rot) % 360) as Rotation;
}

export function mirrorX(x: number, axisHalfCells: number): number {
  return axisHalfCells - x;
}

/**
 * The whole blueprint flipped across `axisHalfCells`. Parts get the ids of their new cells, and everything that named
 * a part by id (binding targets, `primaryCore`, `corePriority`, each core's controls) follows it. Tags and scripts are
 * kept as they are: a script that steers left or right still does, so it may need its signs flipped.
 */
export function mirrorBlueprint(bp: Blueprint, axisHalfCells: number): Blueprint {
  const newId = new Map<string, string>();
  const parts = bp.parts.map((p) => {
    const x = mirrorX(p.x, axisHalfCells);
    const id = partId(p.part, x, p.y);
    newId.set(p.id, id);
    const explicit = p.tags.filter((t) => t !== p.id);
    return { id, part: p.part, x, y: p.y, rot: mirrorRotation(p.rot), tags: [...explicit, id], ...(p.auto === false ? { auto: false as const } : {}) };
  });
  const rename = (id: string): string => newId.get(id) ?? id;
  const renameBindings = (bs: readonly Binding[]): Binding[] => bs.map((b) => (b.target !== undefined && newId.has(b.target) ? { ...b, target: rename(b.target) } : b));
  const out: Blueprint = { ...bp, parts, bindings: renameBindings(bp.bindings) };
  if (bp.primaryCore !== undefined) out.primaryCore = rename(bp.primaryCore);
  if (bp.corePriority !== undefined) out.corePriority = bp.corePriority.map(rename);
  if (bp.cores !== undefined) out.cores = bp.cores.map((c) => ({ ...c, core: rename(c.core), bindings: renameBindings(c.bindings) }));
  return out;
}
