import type { Blueprint, PlacedPart } from '../blueprint/types';
import { faceDir, opposite, rotateCell, rotateFace, type Cell } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { Face } from '../parts/types';

export interface AttachEdge {
  /** Part ids; `a` comes before `b` in blueprint order. */
  a: string;
  b: string;
}

export interface GroupPlan {
  index: number;
  partIds: string[];
  /** The part whose cell is the body origin. */
  originId: string;
  /** Set for joint parts attached to a parent group. */
  joint?: { partId: string; parentGroup: number };
}

export interface ChunkPlan {
  partIds: string[];
  groups: number[];
}

export interface AssemblyPlan {
  edges: AttachEdge[];
  chunks: ChunkPlan[];
  groups: GroupPlan[];
  /** Number of attached faces per part id. */
  attachedFaces: Map<string, number>;
}

/** Occupied world cells of a part: its footprint rotated by its rotation, plus its position. */
export function partCells(part: PlacedPart, registry: PartRegistry): { cell: Cell; faces: Face[] }[] {
  const def = registry.get(part.part);
  return def.footprint.map((fc) => {
    const off = rotateCell(fc, part.rot);
    return { cell: { x: part.x + off.x, y: part.y + off.y }, faces: fc.faces.map((f) => rotateFace(f, part.rot)) };
  });
}

export function isCore(part: PlacedPart, registry: PartRegistry): boolean {
  return registry.has(part.part) && registry.get(part.part).role === 'core';
}

/** The root part: the explicit primary core, else the first core, else the first part. */
export function rootPartId(bp: Blueprint, registry: PartRegistry): string | undefined {
  return bp.primaryCore ?? bp.parts.find((p) => isCore(p, registry))?.id ?? bp.parts[0]?.id;
}

/**
 * Pure assembly: attachment graph, chunks (connected sets), and body groups (joint parts are their own body).
 * Assumes a blueprint without overlaps or unknown parts; the validator checks those first.
 * All iteration is in blueprint order so the result, and the physics built from it, is deterministic.
 */
export function assemble(bp: Blueprint, registry: PartRegistry, rootId: string | undefined = rootPartId(bp, registry)): AssemblyPlan {
  const order = new Map(bp.parts.map((p, i) => [p.id, i]));
  const byCell = new Map<string, { id: string; faces: Face[] }>();
  for (const p of bp.parts) {
    for (const { cell, faces } of partCells(p, registry)) byCell.set(`${cell.x},${cell.y}`, { id: p.id, faces });
  }

  const edges: AttachEdge[] = [];
  const edgeKeys = new Set<string>();
  const neighbors = new Map<string, string[]>(bp.parts.map((p) => [p.id, []]));
  const attachedFaces = new Map<string, number>(bp.parts.map((p) => [p.id, 0]));
  /** Part across each attached face, keyed `id|face`, for finding a joint part's parent. */
  const across = new Map<string, string>();

  for (const p of bp.parts) {
    for (const { cell, faces } of partCells(p, registry)) {
      for (const f of faces) {
        const d = faceDir(f);
        const other = byCell.get(`${cell.x + d.x},${cell.y + d.y}`);
        if (!other || other.id === p.id || !other.faces.includes(opposite(f))) continue;
        attachedFaces.set(p.id, (attachedFaces.get(p.id) ?? 0) + 1);
        across.set(`${p.id}|${f}`, other.id);
        const [a, b] = (order.get(p.id) ?? 0) < (order.get(other.id) ?? 0) ? [p.id, other.id] : [other.id, p.id];
        const key = `${a}|${b}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({ a, b });
        neighbors.get(a)?.push(b);
        neighbors.get(b)?.push(a);
      }
    }
  }
  for (const list of neighbors.values()) list.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));

  const isJoint = (id: string): boolean => {
    const p = bp.parts[order.get(id) ?? -1];
    return p !== undefined && registry.get(p.part).joint !== undefined;
  };

  const components = (include: (id: string) => boolean, follow: (a: string, b: string) => boolean): string[][] => {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const p of bp.parts) {
      if (seen.has(p.id) || !include(p.id)) continue;
      const comp: string[] = [];
      const queue = [p.id];
      seen.add(p.id);
      while (queue.length > 0) {
        const id = queue.shift() as string;
        comp.push(id);
        for (const n of neighbors.get(id) ?? []) {
          if (seen.has(n) || !include(n) || !follow(id, n)) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      comp.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
      out.push(comp);
    }
    return out;
  };

  // Body groups: welded parts connect through non-joint neighbors only; each joint part is a group of its own.
  const groupParts = components(
    () => true,
    (a, b) => !isJoint(a) && !isJoint(b),
  );
  const groupOf = new Map<string, number>();
  groupParts.forEach((ids, i) => ids.forEach((id) => groupOf.set(id, i)));

  const groups: GroupPlan[] = groupParts.map((ids, index) => {
    const g: GroupPlan = { index, partIds: ids, originId: rootId !== undefined && ids.includes(rootId) ? rootId : (ids[0] as string) };
    const only = ids[0] as string;
    if (ids.length === 1 && isJoint(only)) {
      const p = bp.parts[order.get(only) ?? -1] as PlacedPart;
      const mount = rotateFace(registry.get(p.part).joint?.mountFace ?? 'N', p.rot);
      const parentId = across.get(`${only}|${mount}`);
      if (parentId !== undefined) g.joint = { partId: only, parentGroup: groupOf.get(parentId) ?? -1 };
    }
    return g;
  });

  const chunks: ChunkPlan[] = components(
    () => true,
    () => true,
  ).map((ids) => {
    const gs: number[] = [];
    for (const id of ids) {
      const g = groupOf.get(id) ?? -1;
      if (!gs.includes(g)) gs.push(g);
    }
    gs.sort((x, y) => x - y);
    return { partIds: ids, groups: gs };
  });

  return { edges, chunks, groups, attachedFaces };
}
