import type { Blueprint, PlacedPart } from '../../src/blueprint/types';
import { partCells, rootPartId, type AssemblyPlan, type AttachEdge, type ChunkPlan, type CutFaces, type GroupPlan } from '../../src/assembly/assemble';
import { faceDir, opposite, rotateFace, type Cell } from '../../src/parts/faces';
import type { PartRegistry } from '../../src/parts/registry';
import type { Face } from '../../src/parts/types';

/**
 * `assemble` as it was before it was rewritten for speed (big robots: it worked by part id strings). Kept word for
 * word as the reference: `assemble.test.ts` checks the fast one gives the same plan for every blueprint it tries.
 */
export function assembleReference(bp: Blueprint, registry: PartRegistry, rootId: string | undefined = rootPartId(bp, registry), cut?: CutFaces, holding?: ReadonlySet<string>): AssemblyPlan {
  const order = new Map(bp.parts.map((p, i) => [p.id, i]));
  const byCell = new Map<string, { id: string; faces: Face[] }>();
  const cellsOf = (p: PlacedPart): { cell: Cell; faces: Face[] }[] => {
    const gone = cut?.get(p.id);
    const cells = partCells(p, registry, holding?.has(p.id) === true);
    return gone === undefined ? cells : cells.map((c) => ({ cell: c.cell, faces: c.faces.filter((f) => !gone.includes(f)) }));
  };
  for (const p of bp.parts) {
    for (const { cell, faces } of cellsOf(p)) byCell.set(`${cell.x},${cell.y}`, { id: p.id, faces });
  }
  /** A joint part's mount face after rotation, or undefined for welded parts. */
  const mountOf = (id: string): Face | undefined => {
    const p = bp.parts[order.get(id) ?? -1];
    const joint = p === undefined ? undefined : registry.get(p.part).joint;
    return p === undefined || joint === undefined ? undefined : rotateFace(joint.mountFace, p.rot);
  };

  const edges: AttachEdge[] = [];
  const edgeKeys = new Set<string>();
  const neighbors = new Map<string, string[]>(bp.parts.map((p) => [p.id, []]));
  const attachedFaces = new Map<string, number>(bp.parts.map((p) => [p.id, 0]));
  /** Part across each attached face, keyed `id|face`, for finding a joint part's parent. */
  const across = new Map<string, string>();
  /** Edges that cross a joint part's mount face: the joint itself, not a weld. */
  const jointEdges = new Set<string>();

  for (const p of bp.parts) {
    for (const { cell, faces } of cellsOf(p)) {
      for (const f of faces) {
        const d = faceDir(f);
        const other = byCell.get(`${cell.x + d.x},${cell.y + d.y}`);
        if (!other || other.id === p.id || !other.faces.includes(opposite(f))) continue;
        attachedFaces.set(p.id, (attachedFaces.get(p.id) ?? 0) + 1);
        across.set(`${p.id}|${f}`, other.id);
        const [a, b] = (order.get(p.id) ?? 0) < (order.get(other.id) ?? 0) ? [p.id, other.id] : [other.id, p.id];
        const key = `${a}|${b}`;
        if (mountOf(p.id) === f) jointEdges.add(key);
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({ a, b });
        neighbors.get(a)?.push(b);
        neighbors.get(b)?.push(a);
      }
    }
  }
  for (const list of neighbors.values()) list.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));

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

  const edgeKey = (x: string, y: string): string => ((order.get(x) ?? 0) < (order.get(y) ?? 0) ? `${x}|${y}` : `${y}|${x}`);

  // Body groups: parts connect through every edge except a joint part's mount face. A wheel (only a mount face) is a
  // group of its own; a rotator's group is the rotator plus what it carries on its other faces.
  const lockedJoints: string[] = [];
  let groupParts: string[][] = [];
  const groupOf = new Map<string, number>();
  const regroup = (): void => {
    groupParts = components(
      () => true,
      (a, b) => !jointEdges.has(edgeKey(a, b)),
    );
    groupOf.clear();
    groupParts.forEach((ids, i) => ids.forEach((id) => groupOf.set(id, i)));
  };
  regroup();
  // A joint whose two sides are welded together another way cannot turn, and a group hanging from two joints would
  // close a loop (multibodies are trees). Weld those joints (blueprint order decides which joint of a loop survives)
  // and group again until none are left.
  for (;;) {
    const parentOf = new Map<number, string>();
    let locked: string | undefined;
    for (const p of bp.parts) {
      const mount = mountOf(p.id);
      const parentId = mount === undefined || lockedJoints.includes(p.id) ? undefined : across.get(`${p.id}|${mount}`);
      if (parentId === undefined) continue;
      const g = groupOf.get(p.id) ?? -1;
      if (groupOf.get(parentId) === g || parentOf.has(g)) {
        locked = p.id;
        jointEdges.delete(edgeKey(p.id, parentId));
        break;
      }
      parentOf.set(g, p.id);
    }
    // Two groups hanging from each other through two joints is a loop too.
    for (let g = 0; locked === undefined && g < groupParts.length; g++) {
      const seen = new Set<number>();
      let cur = g;
      while (locked === undefined && parentOf.has(cur)) {
        const jointId = parentOf.get(cur) as string;
        if (seen.has(cur)) {
          locked = jointId;
          jointEdges.delete(edgeKey(jointId, across.get(`${jointId}|${mountOf(jointId) as Face}`) as string));
        }
        seen.add(cur);
        cur = groupOf.get(across.get(`${jointId}|${mountOf(jointId) as Face}`) as string) ?? -1;
      }
    }
    if (locked === undefined) break;
    lockedJoints.push(locked);
    regroup();
  }

  const groups: GroupPlan[] = groupParts.map((ids, index) => {
    const jointPart = ids.find((id) => {
      const mount = mountOf(id);
      const parentId = mount === undefined ? undefined : across.get(`${id}|${mount}`);
      return parentId !== undefined && !lockedJoints.includes(id);
    });
    // A jointed group's origin is its joint part: the joint anchors at the child's origin.
    const originId = jointPart ?? (rootId !== undefined && ids.includes(rootId) ? rootId : (ids[0] as string));
    const g: GroupPlan = { index, partIds: ids, originId };
    if (jointPart !== undefined) {
      const parentId = across.get(`${jointPart}|${mountOf(jointPart) as Face}`) as string;
      g.joint = { partId: jointPart, parentGroup: groupOf.get(parentId) ?? -1 };
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

  return { edges, chunks, groups, attachedFaces, lockedJoints };
}
