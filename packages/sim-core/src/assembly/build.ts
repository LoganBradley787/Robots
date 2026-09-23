import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { rotateCell } from '../parts/faces';
import type { BodyGroup, PartInstance } from '../world/Robot';
import type { AssemblyPlan, GroupPlan } from './assemble';

/**
 * Friction of a part cell with no `collider.friction` of its own: steel sliding on ground (Rapier's default is 0.5).
 * At 0.5 a car with one frame corner caught on a block could not drive off it: that corner's friction matched the
 * grounded wheel's whole push (Gate 3). At 0.3 it drives off; a box robot still holds on the 18 degree ramp.
 */
export const PART_FRICTION = 0.3;

/** World pose of a group's origin cell center and its body angle. */
export interface GroupPose {
  x: number;
  y: number;
  angle: number;
}

/**
 * Creates the rigid bodies, colliders, and joints for one assembled piece: a body per group at `pose(group)`,
 * colliders in part order, joints in group order. Updates every part instance's group and body-local offset.
 * Used at spawn (every pose upright) and when a damaged robot is rebuilt (poses taken from its old bodies, `03`).
 * The same parts and poses always make the same physics.
 */
export function buildBodies(
  physics: PhysicsWorld,
  parts: ReadonlyMap<string, PartInstance>,
  plan: AssemblyPlan,
  pose: (group: GroupPlan) => GroupPose,
): BodyGroup[] {
  const part = (id: string): PartInstance => {
    const p = parts.get(id);
    if (!p) throw new Error(`unknown part ${id}`);
    return p;
  };
  const poses = plan.groups.map((g) => pose(g));
  const groups: BodyGroup[] = [];

  for (const g of plan.groups) {
    const origin = part(g.originId);
    const at = poses[g.index] as GroupPose;
    const bodyId = physics.createBody({ x: at.x, y: at.y, angle: at.angle, kind: 'dynamic' });
    for (const id of g.partIds) {
      const p = part(id);
      const def = p.def;
      const cellMass = def.mass / def.footprint.length;
      for (const fc of def.footprint) {
        const off = rotateCell(fc, p.rot);
        const offsetX = p.x + off.x - origin.x;
        const offsetY = p.y + off.y - origin.y;
        // A hit that stops even this cell alone by `impact.speed` in one step is worth reporting; the world then
        // judges it against the whole body's mass.
        const impactForce = def.impact ? (def.impact.speed * cellMass) / physics.dt : undefined;
        const place = { offsetX, offsetY, mass: cellMass, ...(impactForce !== undefined ? { impactForce } : {}) };
        // Cells are squares, so boxes need no rotation; keeping angle 0 avoids trig in collider poses.
        if (def.collider?.shape === 'ball') {
          physics.addCollider(bodyId, { shape: 'ball', radius: def.collider.radius ?? 0.5 }, { ...place, friction: def.collider.friction }, id);
        } else {
          physics.addCollider(bodyId, { shape: 'box', hx: 0.5, hy: 0.5 }, { ...place, friction: def.collider?.friction ?? PART_FRICTION }, id);
        }
      }
      p.group = g.index;
      p.localX = p.x - origin.x;
      p.localY = p.y - origin.y;
    }
    groups.push({ index: g.index, bodyId, originId: g.originId, partIds: [...g.partIds] });
  }

  // A tumbling piece keeps its angle only if its multibody root is pinned before any joint exists (spike, M6).
  const jointed = new Set(plan.groups.filter((g) => g.joint).map((g) => g.joint?.parentGroup));
  for (const g of plan.groups) {
    if (g.joint || !jointed.has(g.index)) continue;
    physics.keepRootAngle((groups[g.index] as BodyGroup).bodyId, (poses[g.index] as GroupPose).angle);
  }

  // Joints parent first (a multibody grows from its root), which group order does not promise after a split.
  for (const g of treeOrder(plan)) {
    if (!g.joint) continue;
    const parent = groups[g.joint.parentGroup];
    const child = groups[g.index];
    if (!parent || !child) continue;
    const jp = part(g.joint.partId);
    const parentOrigin = part(parent.originId);
    const anchorParentX = jp.x - parentOrigin.x;
    const anchorParentY = jp.y - parentOrigin.y;
    const js = jp.def.joint;
    const motor = js?.motor === 'velocity' ? { targetVelocity: 0, factor: js.motorFactor, maxTorque: js.maxTorque } : undefined;
    const rel = (poses[g.index] as GroupPose).angle - (poses[g.joint.parentGroup] as GroupPose).angle;
    const jointId = physics.createRevoluteJoint(parent.bodyId, child.bodyId, { x: anchorParentX, y: anchorParentY }, { x: 0, y: 0 }, motor, rel);
    child.joint = { partId: g.joint.partId, parentGroup: g.joint.parentGroup, jointId, anchorParentX, anchorParentY };
  }
  return groups;
}

/** Groups ordered so every joint's parent comes before its child (breadth first from the roots, then group order). */
function treeOrder(plan: AssemblyPlan): GroupPlan[] {
  const out: GroupPlan[] = [];
  const placed = new Set<number>();
  let frontier = plan.groups.filter((g) => !g.joint);
  while (frontier.length > 0) {
    for (const g of frontier) {
      out.push(g);
      placed.add(g.index);
    }
    frontier = plan.groups.filter((g) => !placed.has(g.index) && g.joint !== undefined && placed.has(g.joint.parentGroup));
  }
  return out;
}
