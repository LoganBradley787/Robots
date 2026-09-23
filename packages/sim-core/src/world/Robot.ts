import type { Blueprint } from '../blueprint/types';
import type { BodyId, JointId } from '../physics/PhysicsWorld';
import type { PartDef, Rotation } from '../parts/types';

/** A placed part in a spawned robot. */
export interface PartInstance {
  id: string;
  def: PartDef;
  /** Blueprint cell. */
  x: number;
  y: number;
  rot: Rotation;
  tags: string[];
  health: number;
  /** Index of the body group that owns this part. */
  group: number;
  /** Offset of this part's cell from its group's origin cell, in meters (body frame). */
  localX: number;
  localY: number;
}

/** The parts that share one rigid body. */
export interface BodyGroup {
  index: number;
  bodyId: BodyId;
  originId: string;
  partIds: string[];
  joint?: {
    partId: string;
    parentGroup: number;
    jointId: JointId;
    /** Joint anchor in the parent body's frame; the child's anchor is its origin. */
    anchorParentX: number;
    anchorParentY: number;
  };
}

/** A connected set of parts: the unit of control, power, and splitting. */
export interface Chunk {
  partIds: string[];
  groups: number[];
  /** First core in blueprint order, if any. Without one the chunk is debris. */
  coreId?: string;
}

/** A spawned blueprint instance. Read-only for render and UI. */
export interface Robot {
  id: number;
  name: string;
  blueprint: Blueprint;
  spawnTick: number;
  spawnX: number;
  spawnY: number;
  parts: Map<string, PartInstance>;
  groups: BodyGroup[];
  chunks: Chunk[];
  /** The part the robot was placed by: the primary core, or the first part of a core-less blueprint. */
  rootId: string;
  primaryCoreId?: string;
}
