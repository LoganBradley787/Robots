import { isCore, rootPartId } from '../assembly/assemble';
import { rotateCell } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { Rotation } from '../parts/types';
import { partId } from './expand';
import { mirrorRotation } from './mirror';
import { toFileJson } from './serialize';
import { validateBlueprint } from './validate';
import type { Binding, Blueprint } from './types';

export interface Orientation {
  /** Left to right, across the root part's column, before turning. */
  flip?: boolean;
  /** Counterclockwise, around the root part's cell. */
  rot?: Rotation;
}

/**
 * The whole blueprint flipped and turned around its root part (the primary core, or the first part), for deploying a
 * robot facing the other way (M8). The root keeps its cell, so the robot lands where the ghost shows it. Parts get the
 * ids of their new cells, and everything that named a part by id follows (binding targets, `primaryCore`,
 * `corePriority`, each core's controls). Tags and scripts stay as they are, as with `mirrorBlueprint`: a script that
 * steers by its parts' positions and its heading works turned; one with hard-coded left and right may not.
 */
export function orientBlueprint(bp: Blueprint, o: Orientation, registry: PartRegistry): Blueprint {
  const rot: Rotation = o.rot ?? 0;
  if (!o.flip && rot === 0) return bp;
  const rootId = rootPartId(bp, registry);
  const root = bp.parts.find((p) => p.id === rootId);
  if (!root) return bp;
  const newId = new Map<string, string>();
  const parts = bp.parts.map((p) => {
    let dx = p.x - root.x;
    let r = p.rot;
    if (o.flip) {
      dx = -dx;
      r = mirrorRotation(r);
    }
    const d = rotateCell({ x: dx, y: p.y - root.y }, rot);
    const x = root.x + d.x;
    const y = root.y + d.y;
    const id = partId(p.part, x, y);
    newId.set(p.id, id);
    const explicit = p.tags.filter((t) => t !== p.id);
    return { id, part: p.part, x, y, rot: ((r + rot) % 360) as Rotation, tags: [...explicit, id], ...(p.auto === false ? { auto: false as const } : {}), ...(p.armed === true ? { armed: true as const } : {}) };
  });
  const rename = (id: string): string => newId.get(id) ?? id;
  const renameBindings = (bs: readonly Binding[]): Binding[] => bs.map((b) => (b.target !== undefined && newId.has(b.target) ? { ...b, target: rename(b.target) } : b));
  const out: Blueprint = { ...bp, parts, bindings: renameBindings(bp.bindings) };
  // Turning changes which core comes first in reading order: name the pilot so it stays the pilot.
  if (bp.primaryCore !== undefined) out.primaryCore = rename(bp.primaryCore);
  else if (bp.parts.filter((p) => registry.has(p.part) && isCore(p, registry)).length > 1) out.primaryCore = rename(root.id);
  if (bp.corePriority !== undefined) out.corePriority = bp.corePriority.map(rename);
  if (bp.cores !== undefined) out.cores = bp.cores.map((c) => ({ ...c, core: rename(c.core), bindings: renameBindings(c.bindings) }));
  return out;
}

/**
 * `orientBlueprint` on a raw blueprint (a file's JSON with its scripts inline, as deploys and replays pass them),
 * returning raw JSON again, so the spawn log records the robot as it was deployed. An invalid blueprint is returned
 * unchanged, so spawning it reports its own errors.
 */
export function orientRaw(raw: unknown, o: Orientation, registry: PartRegistry): unknown {
  if (!o.flip && (o.rot ?? 0) === 0) return raw;
  const v = validateBlueprint(raw, registry);
  if (!v.ok || !v.blueprint) return raw;
  return toFileJson(orientBlueprint(v.blueprint, o, registry), registry, { inlineScripts: true });
}
