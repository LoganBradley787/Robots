import type { Blueprint } from '../blueprint/types';
import type { BodyId, PhysicsWorld } from '../physics/PhysicsWorld';
import type { PartRegistry } from '../parts/registry';
import type { Face } from '../parts/types';
import type { PartInstance, Robot } from '../world/Robot';
import { assemble, isCore } from './assemble';
import { buildBodies } from './build';

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
 */
export function rebuildRobot(host: RebuildHost, robot: Robot): Robot[] {
  const { physics, registry } = host;
  const all = new Map(robot.parts);
  // Everything about the old bodies, before any of them goes.
  const motions = new Map(robot.groups.map((g) => [g.index, host.motion(g.bodyId)]));
  const oldGroup = new Map<string, number>();
  const worldPose = new Map<string, { x: number; y: number; angle: number }>();
  for (const p of robot.parts.values()) {
    const m = motions.get(p.group);
    if (!m) continue;
    const c = Math.cos(m.angle);
    const n = Math.sin(m.angle);
    oldGroup.set(p.id, p.group);
    worldPose.set(p.id, { x: m.x + c * p.localX - n * p.localY, y: m.y + n * p.localX + c * p.localY, angle: m.angle });
  }
  for (const g of robot.groups) {
    host.forget(g.bodyId);
    physics.removeBody(g.bodyId);
  }

  const live = robot.blueprint.parts.filter((p) => all.has(p.id));
  if (live.length === 0) {
    robot.groups = [];
    robot.chunks = [];
    robot.version++;
    return [];
  }
  const cut = new Map<string, readonly Face[]>();
  for (const p of all.values()) if (p.cut && p.cut.length > 0) cut.set(p.id, p.cut);
  const whole: Blueprint = { ...robot.blueprint, parts: live };
  const pieces = assemble(whole, registry, undefined, cut).chunks.map((c) => c.partIds);

  const active = robot.primaryCoreId !== undefined && all.has(robot.primaryCoreId) ? robot.primaryCoreId : undefined;
  let keep = active === undefined ? -1 : pieces.findIndex((ids) => ids.includes(active));
  if (keep < 0) keep = pieces.reduce((best, ids, i) => (ids.length > (pieces[best]?.length ?? 0) ? i : best), 0);
  const order = [keep, ...pieces.map((_, i) => i).filter((i) => i !== keep)];

  const out: Robot[] = [];
  for (const i of order) {
    const ids = pieces[i] as string[];
    const pieceParts = live.filter((p) => ids.includes(p.id));
    const cores = pieceParts.filter((p) => isCore(p, registry));
    const rootId = active !== undefined && ids.includes(active) ? active : (cores[0]?.id ?? (pieceParts[0]?.id as string));
    const plan = assemble({ ...whole, parts: pieceParts }, registry, rootId, cut);
    const parts = new Map<string, PartInstance>();
    for (const p of pieceParts) parts.set(p.id, all.get(p.id) as PartInstance);
    const groups = buildBodies(physics, parts, plan, (g) => worldPose.get(g.originId) as { x: number; y: number; angle: number });
    for (const g of groups) {
      const m = motions.get(oldGroup.get(g.originId) ?? -1);
      if (!m) continue;
      const mp = physics.massProperties(g.bodyId);
      host.kick(g.bodyId, m.vx - m.w * (mp.comY - m.comY), m.vy + m.w * (mp.comX - m.comX), m.w);
    }
    const chunk = { partIds: [...ids], groups: groups.map((g) => g.index), ...(cores.length > 0 ? { coreId: rootId } : {}) };
    if (out.length === 0) {
      robot.parts = parts;
      robot.groups = groups;
      robot.chunks = [chunk];
      robot.rootId = rootId;
      robot.version++;
      if (active === undefined) delete robot.primaryCoreId;
      out.push(robot);
      continue;
    }
    const at = worldPose.get(rootId) as { x: number; y: number };
    const piece: Robot = {
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
    if (cores.length === 1) {
      piece.primaryCoreId = rootId;
      piece.woke = true;
    }
    out.push(piece);
  }
  return out;
}
