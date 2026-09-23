import type { Blueprint } from '../blueprint/types';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { buildBodies } from './build';
import type { PartRegistry } from '../parts/registry';
import type { Chunk, PartInstance, Robot } from '../world/Robot';
import { isCore, rootPartId, type AssemblyPlan } from './assemble';

export { PART_FRICTION } from './build';

export interface SpawnArgs {
  id: number;
  tick: number;
  /** World position for the root part's cell center (the primary core, or the first part). */
  at: { x: number; y: number };
}

/**
 * Builds rigid bodies, colliders, and joints for a validated blueprint. Bodies are created in group order and
 * colliders in part order, so the same blueprint always produces the same physics.
 */
export function spawnRobot(physics: PhysicsWorld, registry: PartRegistry, bp: Blueprint, plan: AssemblyPlan, args: SpawnArgs): Robot {
  const byId = new Map(bp.parts.map((p) => [p.id, p]));
  const cell = (id: string): { x: number; y: number } => {
    const p = byId.get(id);
    if (!p) throw new Error(`unknown part ${id}`);
    return { x: p.x, y: p.y };
  };
  const rootId = rootPartId(bp, registry) as string;
  const root = cell(rootId);
  const toWorld = (c: { x: number; y: number }): { x: number; y: number } => ({ x: args.at.x + (c.x - root.x), y: args.at.y + (c.y - root.y) });

  const parts = new Map<string, PartInstance>();
  for (const p of bp.parts) {
    const def = registry.get(p.part);
    const inst: PartInstance = { id: p.id, def, x: p.x, y: p.y, rot: p.rot, tags: [...p.tags], health: def.health, group: 0, localX: 0, localY: 0 };
    if (def.resource) inst.stored = def.resource.capacity;
    parts.set(p.id, inst);
  }
  // Spawned upright: every body at angle 0, each at its origin cell.
  const groups = buildBodies(physics, parts, plan, (g) => ({ ...toWorld(cell(g.originId)), angle: 0 }));

  // A chunk's core: the primary core if the chunk has it, then corePriority, then blueprint order.
  const corePreference = [rootId, ...(bp.corePriority ?? []), ...bp.parts.map((p) => p.id)].filter((id) => {
    const p = byId.get(id);
    return p !== undefined && isCore(p, registry);
  });
  const chunks: Chunk[] = plan.chunks.map((c) => {
    const chunk: Chunk = { partIds: [...c.partIds], groups: [...c.groups] };
    const core = corePreference.find((id) => c.partIds.includes(id));
    if (core !== undefined) chunk.coreId = core;
    return chunk;
  });

  const robot: Robot = { id: args.id, name: bp.name, blueprint: bp, spawnTick: args.tick, spawnX: args.at.x, spawnY: args.at.y, parts, groups, chunks, rootId, version: 0 };
  const primary = bp.parts.find((p) => p.id === rootId);
  if (primary && isCore(primary, registry)) robot.primaryCoreId = rootId;
  return robot;
}
