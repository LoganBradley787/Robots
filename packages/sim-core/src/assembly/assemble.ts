import { footprintOf } from '../parts/footprint';
import type { Blueprint, PlacedPart } from '../blueprint/types';
import { opposite, rotateCell, rotateFace, type Cell } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { Face, FootprintCell, PartDef, Rotation } from '../parts/types';

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
 * What assembly needs to know of a part: a blueprint's placed part with its def looked up, or a live part of a robot
 * (a `PartInstance` is one), so a rebuild assembles its parts as they are.
 */
export interface AssemblyPart {
  id: string;
  def: PartDef;
  x: number;
  y: number;
  rot: Rotation;
  /** Its cells when they differ from its def's (a stretchy part placed at another size). */
  footprint?: FootprintCell[];
  /** Faces (after rotation) it no longer attaches through. */
  cut?: readonly Face[];
  /** Whether its grips hold (M12). */
  holding?: boolean;
}

/**
 * How the parts hold together, as assembly found it, by part index (the order they were given in). A rebuilt robot
 * keeps it to tell quickly whether it is still one piece after losing parts (`rebuild.ts`).
 */
export interface AssemblyLinks {
  /** The parts each part is welded to: every attached neighbor except across a joint part's mount face. */
  welds: number[][];
  /** 1 for a joint part whose mount face is attached, and for the part it is mounted on. */
  jointed: Uint8Array;
  /** Each part's body group. */
  groupOf: Int32Array;
}

/** What `assembleParts` works out: the plan's chunks and groups, and the rest by part index. */
export interface Assembly {
  chunks: ChunkPlan[];
  groups: GroupPlan[];
  lockedJoints: string[];
  /** Each part's chunk. */
  chunkOf: Int32Array;
  /** Attached pairs of parts in the order they were found, flat: `a, b, a, b`, each `a` before its `b`. */
  pairs: number[];
  /** Attached faces per part. */
  attached: Int32Array;
  /** Left out when a joint is locked: such a robot is always worked out in full. */
  links?: AssemblyLinks;
}

/**
 * Pure assembly: attachment graph, chunks (connected sets), and body groups (joint parts are their own body).
 * Assumes a blueprint without overlaps, unknown parts, or repeated ids; the validator checks those first.
 * All iteration is in blueprint order so the result, and the physics built from it, is deterministic. `cut` faces no
 * longer attach (fired decouplers); parts in `holding` (M12) attach through their grips as well as their faces.
 */
export function assemble(bp: Blueprint, registry: PartRegistry, rootId: string | undefined = rootPartId(bp, registry), cut?: CutFaces, holding?: ReadonlySet<string>): AssemblyPlan {
  const parts: AssemblyPart[] = bp.parts.map((p) => {
    const def = registry.get(p.part);
    const gone = cut?.get(p.id);
    return { id: p.id, def, x: p.x, y: p.y, rot: p.rot, footprint: footprintOf(def, p.size), ...(gone ? { cut: gone } : {}), holding: holding?.has(p.id) === true };
  });
  const a = assembleParts(parts, rootId);
  const edges: AttachEdge[] = [];
  for (let i = 0; i < a.pairs.length; i += 2) edges.push({ a: (parts[a.pairs[i] as number] as AssemblyPart).id, b: (parts[a.pairs[i + 1] as number] as AssemblyPart).id });
  const attachedFaces = new Map<string, number>();
  parts.forEach((p, i) => attachedFaces.set(p.id, a.attached[i] as number));
  return { edges, chunks: a.chunks, groups: a.groups, attachedFaces, lockedJoints: a.lockedJoints };
}

/**
 * Assembly itself, on parts already looked up. It works by part index and numbered cells, not id strings: a robot of
 * thousands of parts is assembled every time it splits (`test/reference/assembleReference.ts` is the plain version it
 * must agree with).
 */
export function assembleParts(parts: readonly AssemblyPart[], rootId: string | undefined): Assembly {
  const n = parts.length;
  const idOf = (i: number): string => (parts[i] as AssemblyPart).id;

  // Every part's cells in one list (a part's are side by side), and the box around them all.
  const cellX: number[] = [];
  const cellY: number[] = [];
  const cellFaces: (readonly Face[])[] = [];
  const cellPart: number[] = [];
  /** Each def cell's faces turned to each rotation: most parts share a handful of them. */
  const turned = new Map<FootprintCell, (readonly Face[] | undefined)[]>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = parts[i] as AssemblyPart;
    const gone = p.cut !== undefined && p.cut.length > 0 ? p.cut : undefined;
    for (const fc of p.footprint ?? p.def.footprint) {
      let faces: readonly Face[];
      if (p.holding === true && fc.grips) {
        // A holding part's grips (M12) attach like faces.
        faces = [...fc.faces, ...fc.grips].map((f) => rotateFace(f, p.rot));
      } else if (p.rot === 0) faces = fc.faces;
      else {
        let byRot = turned.get(fc);
        if (!byRot) turned.set(fc, (byRot = []));
        faces = byRot[p.rot / 90] ??= fc.faces.map((f) => rotateFace(f, p.rot));
      }
      if (gone) faces = faces.filter((f) => !gone.includes(f));
      const single = fc.x === 0 && fc.y === 0;
      const off = single ? fc : rotateCell(fc, p.rot);
      const x = p.x + off.x;
      const y = p.y + off.y;
      cellX.push(x);
      cellY.push(y);
      cellFaces.push(faces);
      cellPart.push(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // A cell's number: its own for every cell in the box and one step outside it, so a neighbor's is one sum away.
  // The cell at each number is in a table when the box is not much bigger than the robot, else in a map.
  const cellCount = cellPart.length;
  const rows = cellCount === 0 ? 1 : maxY - minY + 3;
  const cols = cellCount === 0 ? 1 : maxX - minX + 3;
  const table = cols * rows <= 8 * cellCount + 4096 ? new Int32Array(cols * rows).fill(-1) : undefined;
  const sparse = table ? undefined : new Map<number, number>();
  const numberOf = (c: number): number => ((cellX[c] as number) - minX + 1) * rows + ((cellY[c] as number) - minY + 1);
  for (let c = 0; c < cellCount; c++) {
    if (table) table[numberOf(c)] = c;
    else sparse?.set(numberOf(c), c);
  }
  const step: Readonly<Record<Face, number>> = { N: 1, S: -1, E: rows, W: -rows };

  /** A joint part's mount face after rotation, or undefined for welded parts. */
  const mount: (Face | undefined)[] = [];
  const jointParts: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = parts[i] as AssemblyPart;
    const joint = p.def.joint;
    mount.push(joint === undefined ? undefined : rotateFace(joint.mountFace, p.rot));
    if (joint !== undefined) jointParts.push(i);
  }

  const pairs: number[] = [];
  /** An edge's number: `a * n + b` for parts `a` before `b`. */
  const edgeNumber = (x: number, y: number): number => (x < y ? x * n + y : y * n + x);
  const neighbors: number[][] = [];
  for (let i = 0; i < n; i++) neighbors.push([]);
  const attached = new Int32Array(n);
  /** Part across each attached face (four slots a part), for finding a joint part's parent; -1 for none. */
  const across = new Int32Array(n * 4).fill(-1);
  /** Edges that cross a joint part's mount face: the joint itself, not a weld. */
  const jointEdges = new Set<number>();

  for (let c = 0; c < cellCount; c++) {
    const i = cellPart[c] as number;
    const here = numberOf(c);
    const mine = neighbors[i] as number[];
    for (const f of cellFaces[c] as readonly Face[]) {
      const there = table ? (table[here + step[f]] as number) : (sparse?.get(here + step[f]) ?? -1);
      if (there < 0) continue;
      const j = cellPart[there] as number;
      if (j === i || !(cellFaces[there] as readonly Face[]).includes(opposite(f))) continue;
      attached[i] = (attached[i] as number) + 1;
      across[i * 4 + FACE_SLOT[f]] = j;
      if (mount[i] === f) jointEdges.add(edgeNumber(i, j));
      // Each edge is found from both ends, and from every cell of a part with several; it counts once.
      if (mine.includes(j)) continue;
      pairs.push(i < j ? i : j, i < j ? j : i);
      mine.push(j);
      (neighbors[j] as number[]).push(i);
    }
  }
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

  const out: Assembly = { chunks, groups, lockedJoints, chunkOf: label, pairs, attached };
  if (lockedJoints.length > 0) return out;
  // No joint was locked, so `jointEdges` is still every joint as first found.
  const jointed = new Uint8Array(n);
  for (const key of jointEdges) {
    jointed[Math.floor(key / n)] = 1;
    jointed[key % n] = 1;
  }
  const welds = jointEdges.size === 0 ? neighbors : neighbors.map((list, i) => list.filter((j) => !jointEdges.has(edgeNumber(i, j))));
  out.links = { welds, jointed, groupOf };
  return out;
}
