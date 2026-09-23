import type { Blueprint } from '../blueprint/types';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { rotateCell } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { BodyGroup, Chunk, PartInstance, Robot } from '../world/Robot';
import { isCore, rootPartId, type AssemblyPlan } from './assemble';

/**
 * Friction of a part cell with no `collider.friction` of its own: steel sliding on ground (Rapier's default is 0.5).
 * At 0.5 a car with one frame corner caught on a block could not drive off it: that corner's friction matched the
 * grounded wheel's whole push (Gate 3). At 0.3 it drives off; a box robot still holds on the 18 degree ramp.
 */
export const PART_FRICTION = 0.3;

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
  const groups: BodyGroup[] = [];

  for (const g of plan.groups) {
    const origin = cell(g.originId);
    const pos = toWorld(origin);
    const bodyId = physics.createBody({ x: pos.x, y: pos.y, kind: 'dynamic' });
    for (const id of g.partIds) {
      const p = byId.get(id);
      if (!p) continue;
      const def = registry.get(p.part);
      const cellMass = def.mass / def.footprint.length;
      for (const fc of def.footprint) {
        const off = rotateCell(fc, p.rot);
        const offsetX = p.x + off.x - origin.x;
        const offsetY = p.y + off.y - origin.y;
        // Cells are squares, so boxes need no rotation; keeping angle 0 avoids trig in collider poses.
        if (def.collider?.shape === 'ball') {
          physics.addCollider(bodyId, { shape: 'ball', radius: def.collider.radius ?? 0.5 }, { offsetX, offsetY, mass: cellMass, friction: def.collider.friction }, id);
        } else {
          physics.addCollider(bodyId, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX, offsetY, mass: cellMass, friction: def.collider?.friction ?? PART_FRICTION }, id);
        }
      }
      const inst: PartInstance = { id, def, x: p.x, y: p.y, rot: p.rot, tags: [...p.tags], health: def.health, group: g.index, localX: p.x - origin.x, localY: p.y - origin.y };
      if (def.resource) inst.stored = def.resource.capacity;
      parts.set(id, inst);
    }
    groups.push({ index: g.index, bodyId, originId: g.originId, partIds: [...g.partIds] });
  }

  for (const g of plan.groups) {
    if (!g.joint) continue;
    const parent = groups[g.joint.parentGroup];
    const child = groups[g.index];
    if (!parent || !child) continue;
    const p = byId.get(g.joint.partId);
    const def = p ? registry.get(p.part) : undefined;
    const parentOrigin = cell(parent.originId);
    const jointCell = cell(g.joint.partId);
    const anchorParentX = jointCell.x - parentOrigin.x;
    const anchorParentY = jointCell.y - parentOrigin.y;
    const js = def?.joint;
    const motor = js ? { targetVelocity: 0, factor: js.motorFactor, maxTorque: js.maxTorque } : undefined;
    const jointId = physics.createRevoluteJoint(parent.bodyId, child.bodyId, { x: anchorParentX, y: anchorParentY }, { x: 0, y: 0 }, motor);
    child.joint = { partId: g.joint.partId, parentGroup: g.joint.parentGroup, jointId, anchorParentX, anchorParentY };
  }

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

  const robot: Robot = { id: args.id, name: bp.name, blueprint: bp, spawnTick: args.tick, spawnX: args.at.x, spawnY: args.at.y, parts, groups, chunks, rootId };
  const primary = bp.parts.find((p) => p.id === rootId);
  if (primary && isCore(primary, registry)) robot.primaryCoreId = rootId;
  return robot;
}
