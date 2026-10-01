import type { Blueprint, PlacedPart } from '../blueprint/types';
import type { BodyId, PhysicsWorld } from '../physics/PhysicsWorld';
import type { PartRegistry } from '../parts/registry';
import type { Face } from '../parts/types';
import type { BodyGroup, PartInstance, Robot } from '../world/Robot';
import { assembleLinked, isCore, type AssemblyLinks, type GroupPlan } from './assemble';
import { buildBodies, type GroupPose } from './build';

/** A body's pose and motion; velocity is the center of mass's. */
export interface BodyMotion {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  w: number;
  comX: number;
  comY: number;
}

export interface RebuildHost {
  physics: PhysicsWorld;
  registry: PartRegistry;
  tick: number;
  /** A body's motion, counting a kick it was given earlier this tick (Rapier reports it only after a step). */
  motion(body: BodyId): BodyMotion;
  /** Gives a new body its velocity on the next step (`PhysicsWorld.kick`). */
  kick(body: BodyId, vx: number, vy: number, w: number): void;
  /** Forgets anything kept for a body that is about to be removed. */
  forget(body: BodyId): void;
  newRobotId(): number;
  /** Tests only: always work the pieces out from scratch, never from what the robot kept (`Kept`). Same result, slower. */
  full?: boolean;
  /** Counts rebuilds by how the pieces were found: `whole` from what the robot kept, `assembled` from scratch. Reporting only. */
  tally?: { whole: number; assembled: number };
}

/**
 * What a robot keeps from its last rebuild: how its parts hold together, by index into `ids`. With it the next
 * rebuild can tell that a robot which only lost parts is still one piece with the same bodies, without assembling it
 * again (a robot of thousands of parts under fire loses a part most ticks). Derived from the robot and its blueprint;
 * a robot without one is worked out in full.
 */
interface Kept {
  /** The robot's blueprint and bodies when this was made: either replaced by anything else means it is stale. */
  blueprint: Blueprint;
  bodies: BodyGroup[];
  /** Part ids in blueprint order, and whether each is still there. */
  ids: string[];
  here: Uint8Array;
  left: number;
  links: AssemblyLinks;
  core: Uint8Array;
  /** Each part's cut faces (how many) and whether it was holding: a change in either changes the links. */
  cuts: Uint8Array;
  holding: Uint8Array;
  /** Each body group's parts, in the order of `Robot.groups`. */
  groups: number[][];
  /** Scratch for searches: a part is marked when it holds the current `stamp` or the one before. */
  mark: Int32Array;
  stamp: number;
}

const kept = new WeakMap<Robot, Kept>();

/** One piece of a rebuilt robot: its parts (blueprint order), body groups, and root. */
interface Piece {
  ids: string[];
  groups: GroupPlan[];
  rootId: string;
  cores: number;
  /** Set when the piece was assembled: what its robot keeps. */
  keep?: Omit<Kept, 'bodies'>;
}

/**
 * Rebuilds a robot after it lost parts or faces (`03`, Cell removal pipeline). All its bodies are replaced from its
 * surviving parts, one piece per connected set. Every new body starts where its parts were, at its old body's
 * angle, moving with the old body's velocity field: `v + w x (c - p)` and `w` (`03`, Momentum transfer), given by
 * a kick. A wheel keeps its own spin.
 *
 * Returns the pieces, the robot itself first (it keeps its id), or [] when no part is left. The robot keeps the piece
 * with its active core, or else the largest piece. Every other piece is a new robot; one with exactly one core
 * wakes that core (`04`: a dormant core wakes when its sub-assembly splits off). The robot itself never wakes a
 * dormant core: shoot the pilot and the jet does not fly by its missiles (Q1).
 *
 * The pieces come from `assemble`, except for a robot that only lost parts and provably stays as it was (`stillWhole`):
 * its body groups are its old ones less the lost parts. Either way the same bodies are made in the same order.
 */
export function rebuildRobot(host: RebuildHost, robot: Robot): Robot[] {
  const { physics } = host;
  const all = robot.parts;
  // Everything about the old bodies, before any of them goes.
  const motions = new Map(robot.groups.map((g) => [g.index, host.motion(g.bodyId)]));
  for (const g of robot.groups) {
    host.forget(g.bodyId);
    physics.removeBody(g.bodyId);
  }
  if (all.size === 0) {
    robot.groups = [];
    robot.chunks = [];
    robot.version++;
    kept.delete(robot);
    return [];
  }

  const active = robot.primaryCoreId !== undefined && all.has(robot.primaryCoreId) ? robot.primaryCoreId : undefined;
  const before = host.full === true ? undefined : kept.get(robot);
  const whole = before === undefined ? undefined : stillWhole(robot, before, active);
  const pieces = whole !== undefined ? [whole] : assemblePieces(host, robot, active);
  if (host.tally) host.tally[whole !== undefined ? 'whole' : 'assembled']++;

  /** Where a part is now, from the body it was on. */
  const poseOf = (id: string): GroupPose | undefined => {
    const p = all.get(id);
    const m = p === undefined ? undefined : motions.get(p.group);
    if (p === undefined || m === undefined) return undefined;
    const c = Math.cos(m.angle);
    const n = Math.sin(m.angle);
    return { x: m.x + c * p.localX - n * p.localY, y: m.y + n * p.localX + c * p.localY, angle: m.angle };
  };

  const out: Robot[] = [];
  for (const piece of pieces) {
    const { ids, rootId } = piece;
    const parts = new Map<string, PartInstance>();
    for (const id of ids) parts.set(id, all.get(id) as PartInstance);
    // Each new body's pose and the old body its origin part was on, read before the new bodies take the parts over.
    const poses = piece.groups.map((g) => poseOf(g.originId) as GroupPose);
    const from = piece.groups.map((g) => motions.get(all.get(g.originId)?.group ?? -1));
    const at = poseOf(rootId) as { x: number; y: number };
    const groups = buildBodies(physics, parts, piece, (g) => poses[g.index] as GroupPose);
    for (const g of groups) {
      const m = from[g.index];
      if (!m) continue;
      const mp = physics.massProperties(g.bodyId);
      host.kick(g.bodyId, m.vx - m.w * (mp.comY - m.comY), m.vy + m.w * (mp.comX - m.comX), m.w);
    }
    const chunk = { partIds: [...ids], groups: groups.map((g) => g.index), ...(piece.cores > 0 ? { coreId: rootId } : {}) };
    let made: Robot;
    if (out.length === 0) {
      robot.parts = parts;
      robot.groups = groups;
      robot.chunks = [chunk];
      robot.rootId = rootId;
      robot.version++;
      if (active === undefined) delete robot.primaryCoreId;
      made = robot;
    } else {
      made = {
        id: host.newRobotId(),
        name: robot.name,
        blueprint: robot.blueprint,
        spawnTick: host.tick,
        spawnX: at.x,
        spawnY: at.y,
        team: robot.team,
        parts,
        groups,
        chunks: [chunk],
        rootId,
        version: 0,
        brokeFrom: robot.id,
      };
      if (piece.cores === 1) {
        made.primaryCoreId = rootId;
        made.woke = true;
      }
    }
    if (whole !== undefined && before !== undefined) before.bodies = groups;
    else if (piece.keep !== undefined) kept.set(made, { ...piece.keep, bodies: groups });
    else kept.delete(made);
    out.push(made);
  }
  return out;
}

/** The pieces of a robot worked out from scratch: `assemble` on its live parts, the piece it keeps first. */
function assemblePieces(host: RebuildHost, robot: Robot, active: string | undefined): Piece[] {
  const { registry } = host;
  const all = robot.parts;
  const live = robot.blueprint.parts.filter((p) => all.has(p.id));
  const cut = new Map<string, readonly Face[]>();
  // Parts holding with their grips (M12: a fabricator bay with a finished item in it).
  const holding = new Set<string>();
  for (const p of all.values()) {
    if (p.cut && p.cut.length > 0) cut.set(p.id, p.cut);
    if (p.holding === true) holding.add(p.id);
  }
  const whole: Blueprint = { ...robot.blueprint, parts: live };

  const pieceOf = (pieceParts: PlacedPart[], isKept: boolean): { rootId: string; cores: number } => {
    let cores = 0;
    let firstCore: string | undefined;
    for (const p of pieceParts) {
      if (!isCore(p, registry)) continue;
      cores++;
      firstCore ??= p.id;
    }
    return { rootId: isKept && active !== undefined ? active : (firstCore ?? (pieceParts[0]?.id as string)), cores };
  };
  const assembled = (pieceParts: PlacedPart[], isKept: boolean): { piece: Piece; sets: string[][] } => {
    const { rootId, cores } = pieceOf(pieceParts, isKept);
    const { plan, links } = assembleLinked({ ...whole, parts: pieceParts }, registry, rootId, cut, holding);
    const piece: Piece = { ids: pieceParts.map((p) => p.id), groups: plan.groups, rootId, cores };
    if (links !== undefined && plan.chunks.length === 1) piece.keep = keepFor(robot.blueprint, pieceParts, all, registry, links, plan.groups.length);
    return { piece, sets: plan.chunks.map((c) => c.partIds) };
  };

  // The usual rebuild leaves one piece: assembled as that piece (rooted at its own root), it needs no second pass.
  const first = assembled(live, true);
  const sets = first.sets;
  if (sets.length === 1) return [first.piece];

  const setOf = new Map<string, number>();
  sets.forEach((ids, i) => {
    for (const id of ids) setOf.set(id, i);
  });
  let keep = active === undefined ? -1 : (setOf.get(active) ?? -1);
  if (keep < 0) keep = sets.reduce((best, ids, i) => (ids.length > (sets[best]?.length ?? 0) ? i : best), 0);
  const members: PlacedPart[][] = sets.map(() => []);
  for (const p of live) (members[setOf.get(p.id) as number] as PlacedPart[]).push(p);
  const order = [keep, ...sets.map((_, i) => i).filter((i) => i !== keep)];
  return order.map((i) => assembled(members[i] as PlacedPart[], i === keep).piece);
}

/** What a robot keeps of a piece just assembled (`Kept`, less its bodies). */
function keepFor(blueprint: Blueprint, pieceParts: readonly PlacedPart[], all: ReadonlyMap<string, PartInstance>, registry: PartRegistry, links: AssemblyLinks, groupCount: number): Omit<Kept, 'bodies'> {
  const n = pieceParts.length;
  const core = new Uint8Array(n);
  const cuts = new Uint8Array(n);
  const holding = new Uint8Array(n);
  const groups: number[][] = [];
  for (let g = 0; g < groupCount; g++) groups.push([]);
  pieceParts.forEach((p, i) => {
    const inst = all.get(p.id);
    if (isCore(p, registry)) core[i] = 1;
    cuts[i] = inst?.cut?.length ?? 0;
    if (inst?.holding === true) holding[i] = 1;
    (groups[links.groupOf[i] as number] as number[]).push(i);
  });
  return { blueprint, ids: pieceParts.map((p) => p.id), here: new Uint8Array(n).fill(1), left: n, links, core, cuts, holding, groups, mark: new Int32Array(n), stamp: 0 };
}

/**
 * The one piece of a robot that only lost parts since it was last rebuilt and is provably as `assemble` would find
 * it: still one piece, with its old body groups less the lost parts. Undefined when that is not certain, and then the
 * robot is assembled in full. Updates `k` to the robot as it is now.
 *
 * It is certain when nothing else changed (same blueprint, no face cut, no bay taking or letting go), no lost part
 * was at either end of a joint, and in every body group the live parts next to the lost ones still reach each other
 * through welds. The groups are then the old ones (welds decide them, and no weld between live parts went), on the
 * same joints, so the robot hangs together as before. Their order can still change: groups go by their first part.
 */
function stillWhole(robot: Robot, k: Kept, active: string | undefined): Piece | undefined {
  if (robot.blueprint !== k.blueprint || robot.groups !== k.bodies || robot.chunks.length !== 1) return undefined;
  const { ids, here, links } = k;
  const all = robot.parts;
  const lost: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (here[i] === 0) continue;
    const p = all.get(ids[i] as string);
    if (p === undefined) {
      if (links.jointed[i] === 1) return undefined;
      lost.push(i);
    } else if ((p.cut?.length ?? 0) !== k.cuts[i] || (p.holding === true ? 1 : 0) !== k.holding[i]) return undefined;
  }
  if (all.size !== k.left - lost.length) return undefined;
  for (const i of lost) here[i] = 0;
  k.left -= lost.length;

  // In each group that lost parts: the live parts next to the lost ones, then a search from one of them for the rest.
  const lostIn = new Map<number, number[]>();
  for (const i of lost) {
    const g = links.groupOf[i] as number;
    const list = lostIn.get(g);
    if (list) list.push(i);
    else lostIn.set(g, [i]);
  }
  for (const gone of lostIn.values()) {
    k.stamp += 2;
    const edge = k.stamp - 1;
    const reached = k.stamp;
    const queue: number[] = [];
    let unreached = 0;
    for (const i of gone) {
      for (const j of links.welds[i] as number[]) {
        if (here[j] === 0 || k.mark[j] === edge) continue;
        k.mark[j] = edge;
        unreached++;
        if (queue.length === 0) queue.push(j);
      }
    }
    if (queue.length === 0) return undefined;
    k.mark[queue[0] as number] = reached;
    unreached--;
    for (let head = 0; head < queue.length && unreached > 0; head++) {
      for (const j of links.welds[queue[head] as number] as number[]) {
        if (here[j] === 0 || k.mark[j] === reached) continue;
        if (k.mark[j] === edge) unreached--;
        k.mark[j] = reached;
        queue.push(j);
      }
    }
    if (unreached > 0) return undefined;
  }

  // The piece: every live part, rooted as `assemble` is asked to root it.
  const live: string[] = [];
  let cores = 0;
  let firstCore = -1;
  for (let i = 0; i < ids.length; i++) {
    if (here[i] === 0) continue;
    live.push(ids[i] as string);
    if (k.core[i] === 0) continue;
    cores++;
    if (firstCore < 0) firstCore = i;
  }
  const rootId = active ?? (firstCore >= 0 ? (ids[firstCore] as string) : (live[0] as string));

  // The old groups less the lost parts, in the order of their first parts.
  for (const g of lostIn.keys()) k.groups[g] = (k.groups[g] as number[]).filter((i) => here[i] === 1);
  const order = k.groups.map((_, g) => g).sort((a, b) => ((k.groups[a] as number[])[0] as number) - ((k.groups[b] as number[])[0] as number));
  const moved = order.some((g, at) => g !== at);
  const newIndex = new Map(order.map((g, at) => [g, at]));
  const groups: GroupPlan[] = order.map((old, index) => {
    const was = robot.groups[old] as BodyGroup;
    const members = k.groups[old] as number[];
    const partIds = lostIn.has(old) ? members.map((i) => ids[i] as string) : was.partIds;
    // A jointed group's origin is its joint part, as in `assemble`.
    const g: GroupPlan = { index, partIds, originId: was.joint?.partId ?? (partIds.includes(rootId) ? rootId : (partIds[0] as string)) };
    if (was.joint) g.joint = { partId: was.joint.partId, parentGroup: newIndex.get(was.joint.parentGroup) as number };
    return g;
  });
  if (moved) {
    k.groups = order.map((old) => k.groups[old] as number[]);
    k.groups.forEach((members, g) => {
      for (const i of members) links.groupOf[i] = g;
    });
    for (const i of lost) links.groupOf[i] = -1;
  }
  return { ids: live, groups, rootId, cores };
}
