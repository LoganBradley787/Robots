import { footprintOf } from '../parts/footprint';
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
  /**
   * Joint parts that cannot turn: what they carry also touches their parent side another way, or a second joint
   * part carries the same parts (a loop). Their mount face is treated as welded. The validator refuses them.
   */
  lockedJoints: string[];
}

/** Faces a part no longer attaches through (a fired decoupler's release face), after its rotation. */
export type CutFaces = ReadonlyMap<string, readonly Face[]>;

/** Occupied world cells of a part: its footprint rotated by its rotation, plus its position. */
export function partCells(part: PlacedPart, registry: PartRegistry, holding = false): { cell: Cell; faces: Face[] }[] {
  const def = registry.get(part.part);
  return footprintOf(def, part.size).map((fc) => {
    const off = rotateCell(fc, part.rot);
    // A holding part's grips (M12) attach like faces.
    const faces = holding && fc.grips ? [...fc.faces, ...fc.grips] : fc.faces;
    return { cell: { x: part.x + off.x, y: part.y + off.y }, faces: faces.map((f) => rotateFace(f, part.rot)) };
  });
}

export function isCore(part: PlacedPart, registry: PartRegistry): boolean {
  return registry.has(part.part) && registry.get(part.part).role === 'core';
}

/** The root part: the explicit primary core, else the first core, else the first part. */
export function rootPartId(bp: Blueprint, registry: PartRegistry): string | undefined {
  return bp.primaryCore ?? bp.parts.find((p) => isCore(p, registry))?.id ?? bp.parts[0]?.id;
}

/** A face's slot in a part's row of `across`. */
const FACE_SLOT: Readonly<Record<Face, number>> = { N: 0, E: 1, S: 2, W: 3 };

/**
 * How the parts hold together, as `assemble` found it, by part index (blueprint order). A rebuilt robot keeps it to
 * tell quickly whether it is still one piece after losing parts (`rebuild.ts`).
 */
export interface AssemblyLinks {
  /** The parts each part is welded to, in blueprint order: every attached neighbor except across a joint part's mount face. */
  welds: number[][];
  /** 1 for a joint part whose mount face is attached, and for the part it is mounted on. */
  jointed: Uint8Array;
  /** Each part's body group. */
  groupOf: Int32Array;
}

/**
 * Pure assembly: attachment graph, chunks (connected sets), and body groups (joint parts are their own body).
 * Assumes a blueprint without overlaps, unknown parts, or repeated ids; the validator checks those first.
 * All iteration is in blueprint order so the result, and the physics built from it, is deterministic. `cut` faces no
 * longer attach (fired decouplers); parts in `holding` (M12) attach through their grips as well as their faces.
 */
export function assemble(bp: Blueprint, registry: PartRegistry, rootId: string | undefined = rootPartId(bp, registry), cut?: CutFaces, holding?: ReadonlySet<string>): AssemblyPlan {
  return assembleLinked(bp, registry, rootId, cut, holding).plan;
}

/**
 * `assemble`, plus the links it found (left out when a joint is locked: such a robot is always worked out in full).
 * Works by part index and numbered cells, not id strings: a robot of thousands of parts is assembled every time it
 * splits (`test/reference/assembleReference.ts` is the plain version it must agree with).
 */
export function assembleLinked(bp: Blueprint, registry: PartRegistry, rootId: string | undefined, cut?: CutFaces, holding?: ReadonlySet<string>): { plan: AssemblyPlan; links?: AssemblyLinks } {
  const parts = bp.parts;
  const n = parts.length;
  const idOf = (i: number): string => (parts[i] as PlacedPart).id;

  // Every part's cells, and the box around them all.
  const cells: { cell: Cell; faces: Face[] }[][] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of parts) {
    const gone = cut?.get(p.id);
    const own = partCells(p, registry, holding?.has(p.id) === true);
    const list = gone === undefined ? own : own.map((c) => ({ cell: c.cell, faces: c.faces.filter((f) => !gone.includes(f)) }));
    cells.push(list);
    for (const { cell } of list) {
      if (cell.x < minX) minX = cell.x;
      if (cell.y < minY) minY = cell.y;
      if (cell.y > maxY) maxY = cell.y;
    }
  }
  // A cell's number: its own for every cell in the box and one step outside it, so a neighbor's is one sum away.
  const rows = maxY - minY + 3;
  const cellNumber = (c: Cell): number => (c.x - minX + 1) * rows + (c.y - minY + 1);
  const byCell = new Map<number, number>();
  const cellPart: number[] = [];
  const cellFaces: Face[][] = [];
  for (let i = 0; i < n; i++) {
    for (const { cell, faces } of cells[i] as { cell: Cell; faces: Face[] }[]) {
      byCell.set(cellNumber(cell), cellPart.length);
      cellPart.push(i);
      cellFaces.push(faces);
    }
  }
  /** A joint part's mount face after rotation, or undefined for welded parts. */
  const mount: (Face | undefined)[] = parts.map((p) => {
    const joint = registry.get(p.part).joint;
    return joint === undefined ? undefined : rotateFace(joint.mountFace, p.rot);
  });
  const jointParts: number[] = [];
  mount.forEach((m, i) => {
    if (m !== undefined) jointParts.push(i);
  });

  const edges: AttachEdge[] = [];
  /** An edge's number: `a * n + b` for parts `a` before `b`. */
  const edgeNumber = (x: number, y: number): number => (x < y ? x * n + y : y * n + x);
  const edgeSeen = new Set<number>();
  const neighbors: number[][] = parts.map(() => []);
  const attached = new Int32Array(n);
  /** Part across each attached face (four slots a part), for finding a joint part's parent; -1 for none. */
  const across = new Int32Array(n * 4).fill(-1);
  /** Edges that cross a joint part's mount face: the joint itself, not a weld. */
  const jointEdges = new Set<number>();

  for (let i = 0; i < n; i++) {
    for (const { cell, faces } of cells[i] as { cell: Cell; faces: Face[] }[]) {
      const here = cellNumber(cell);
      for (const f of faces) {
        const d = faceDir(f);
        const there = byCell.get(here + d.x * rows + d.y);
        if (there === undefined) continue;
        const j = cellPart[there] as number;
        if (j === i || !(cellFaces[there] as Face[]).includes(opposite(f))) continue;
        attached[i] = (attached[i] as number) + 1;
        across[i * 4 + FACE_SLOT[f]] = j;
        const key = edgeNumber(i, j);
        if (mount[i] === f) jointEdges.add(key);
        if (edgeSeen.has(key)) continue;
        edgeSeen.add(key);
        edges.push(i < j ? { a: idOf(i), b: idOf(j) } : { a: idOf(j), b: idOf(i) });
        (neighbors[i] as number[]).push(j);
        (neighbors[j] as number[]).push(i);
      }
    }
  }
  for (const list of neighbors) list.sort((x, y) => x - y);
  /** The part a joint part is mounted on, or -1. */
  const parentOfPart = (i: number): number => across[i * 4 + FACE_SLOT[mount[i] as Face]] as number;

  // Connected sets, each in blueprint order, the sets in the order of their first parts. `welded` leaves out joints.
  const label = new Int32Array(n);
  const queue = new Int32Array(n);
  const components = (welded: boolean): number[][] => {
    label.fill(-1);
    const skipJoints = welded && jointEdges.size > 0;
    let count = 0;
    for (let start = 0; start < n; start++) {
      if ((label[start] as number) >= 0) continue;
      label[start] = count;
      queue[0] = start;
      for (let head = 0, tail = 1; head < tail; head++) {
        const i = queue[head] as number;
        for (const j of neighbors[i] as number[]) {
          if ((label[j] as number) >= 0 || (skipJoints && jointEdges.has(edgeNumber(i, j)))) continue;
          label[j] = count;
          queue[tail++] = j;
        }
      }
      count++;
    }
    const out: number[][] = [];
    for (let c = 0; c < count; c++) out.push([]);
    for (let i = 0; i < n; i++) (out[label[i] as number] as number[]).push(i);
    return out;
  };

  // Body groups: parts connect through every edge except a joint part's mount face. A wheel (only a mount face) is a
  // group of its own; a rotator's group is the rotator plus what it carries on its other faces.
  const lockedJoints: string[] = [];
  const isLocked = new Uint8Array(n);
  let groupParts: number[][] = [];
  let groupOf = new Int32Array(0);
  const regroup = (): void => {
    groupParts = components(true);
    groupOf = label.slice();
  };
  regroup();
  // A joint whose two sides are welded together another way cannot turn, and a group hanging from two joints would
  // close a loop (multibodies are trees). Weld those joints (blueprint order decides which joint of a loop survives)
  // and group again until none are left.
  for (;;) {
    /** The joint part each group hangs from, by group. */
    const hangsFrom = new Map<number, number>();
    let locked = -1;
    for (const i of jointParts) {
      const parent = isLocked[i] === 1 ? -1 : parentOfPart(i);
      if (parent < 0) continue;
      const g = groupOf[i] as number;
      if (groupOf[parent] === g || hangsFrom.has(g)) {
        locked = i;
        jointEdges.delete(edgeNumber(i, parent));
        break;
      }
      hangsFrom.set(g, i);
    }
    // Two groups hanging from each other through two joints is a loop too.
    for (let g = 0; locked < 0 && g < groupParts.length; g++) {
      if (!hangsFrom.has(g)) continue;
      const seen = new Set<number>();
      let cur = g;
      while (locked < 0 && hangsFrom.has(cur)) {
        const jointPart = hangsFrom.get(cur) as number;
        if (seen.has(cur)) {
          locked = jointPart;
          jointEdges.delete(edgeNumber(jointPart, parentOfPart(jointPart)));
        }
        seen.add(cur);
        cur = groupOf[parentOfPart(jointPart)] as number;
      }
    }
    if (locked < 0) break;
    lockedJoints.push(idOf(locked));
    isLocked[locked] = 1;
    regroup();
  }

  // Each group's joint part: its first part (blueprint order) mounted on a parent by a joint that still turns.
  const jointOf = new Int32Array(groupParts.length).fill(-1);
  for (const i of jointParts) {
    const g = groupOf[i] as number;
    if (isLocked[i] === 0 && parentOfPart(i) >= 0 && (jointOf[g] as number) < 0) jointOf[g] = i;
  }
  const rootIndex = rootId === undefined ? -1 : parts.findIndex((p) => p.id === rootId);
  const groups: GroupPlan[] = groupParts.map((members, index) => {
    const jointPart = jointOf[index] as number;
    // A jointed group's origin is its joint part: the joint anchors at the child's origin.
    const origin = jointPart >= 0 ? jointPart : rootIndex >= 0 && groupOf[rootIndex] === index ? rootIndex : (members[0] as number);
    const g: GroupPlan = { index, partIds: members.map(idOf), originId: idOf(origin) };
    if (jointPart >= 0) g.joint = { partId: idOf(jointPart), parentGroup: groupOf[parentOfPart(jointPart)] as number };
    return g;
  });

  const lastIn = new Int32Array(groupParts.length).fill(-1);
  const chunks: ChunkPlan[] = components(false).map((members, chunk) => {
    const gs: number[] = [];
    for (const i of members) {
      const g = groupOf[i] as number;
      if (lastIn[g] === chunk) continue;
      lastIn[g] = chunk;
      gs.push(g);
    }
    gs.sort((x, y) => x - y);
    return { partIds: members.map(idOf), groups: gs };
  });

  const attachedFaces = new Map<string, number>();
  for (let i = 0; i < n; i++) attachedFaces.set(idOf(i), attached[i] as number);
  const plan: AssemblyPlan = { edges, chunks, groups, attachedFaces, lockedJoints };
  if (lockedJoints.length > 0) return { plan };

  // No joint was locked, so `jointEdges` is still every joint as first found.
  const jointed = new Uint8Array(n);
  for (const key of jointEdges) {
    jointed[Math.floor(key / n)] = 1;
    jointed[key % n] = 1;
  }
  const welds = jointEdges.size === 0 ? neighbors : neighbors.map((list, i) => list.filter((j) => !jointEdges.has(edgeNumber(i, j))));
  return { plan, links: { welds, jointed, groupOf } };
}
