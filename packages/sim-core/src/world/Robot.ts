import type { Blueprint } from '../blueprint/types';
import type { BodyId, JointId } from '../physics/PhysicsWorld';
import type { Face, FootprintCell, PartDef, Rotation } from '../parts/types';
import type { GunSight } from '../weapons/shells';

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
  /** Faces (after rotation) this part no longer attaches through: a fired decoupler's release face. */
  cut?: Face[];
  /** A rotator's aim: radians relative to its base, within its range. */
  aim?: number;
  /** A sensor part (M8): whether it was switched on and powered on the last tick. Undefined until it first runs (sees). */
  sensing?: boolean;
  /**
   * A core's messages from other cores (M8), oldest first, at most 16: its scripts see those sent before this tick,
   * then they are gone. A dormant core keeps them until it wakes. `data` is the JSON text.
   */
  inbox?: { from: string; tick: number; data: string }[];
  /**
   * M10: for a part whose def has `arming`, whether it is armed (set by the blueprint's `armed`, or for good once its
   * `arm` input goes above 0.5). Undefined for other parts. Unarmed, it does not explode, its fuze is off, and a
   * warhead ignores `detonate`.
   */
  armed?: boolean;
  /**
   * M11: for a part whose def has `decoy`, the ticks it has left to burn once lit (counting down to 0, when it is
   * destroyed). Undefined until lit.
   */
  burn?: number;
  /** M11: the robot a lit decoy stands in for: the one it was part of when it was lit. */
  decoyOf?: number;
  /** M12: for a part with grips (a fabricator bay), whether its grips hold what touches them. Undefined for others. */
  holding?: boolean;
  /**
   * M12: a fabricator bay's build: how far along the item it is making is (0 to 1, reset when the item is finished),
   * how many it has finished so far (names each item's scope), and the scope of the item it holds. Undefined for other
   * parts.
   */
  progress?: number;
  built?: number;
  holds?: string;
  /** M13: a gun's ticks until it may fire again (undefined is 0: ready). */
  cooldown?: number;
  /** M13: what a gun's sight saw after the last physics step. Undefined until it first looks. Derived, not hashed. */
  sight?: GunSight;
  /** Batch: a mine that was set off this tick (by an enemy near or `detonate`) and blasts as it is destroyed. Transient, never hashed. */
  fired?: boolean;
  /** What a container part (one with `resource` in its def) holds now. Starts full. Undefined for other parts. */
  stored?: number;
  /** M12: the part's cells when they differ from its def's (a stretchy part placed at another size). */
  footprint?: FootprintCell[];
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
  /** Which side the robot fights for (M8). 0 is the player's, 1 the enemy; a number so more sides need no new format. Pieces keep their parent's. */
  team: number;
  parts: Map<string, PartInstance>;
  groups: BodyGroup[];
  chunks: Chunk[];
  /** The part the robot was placed by: the primary core, or the first part of a core-less blueprint. */
  rootId: string;
  /** The active core: the primary core, or a core that woke when its piece broke off (`04`). */
  primaryCoreId?: string;
  /** Bumped whenever the robot's bodies are rebuilt (damage, a split), so views rebuild their sprites. */
  version: number;
  /** For a piece that broke off another robot: that robot's id. */
  brokeFrom?: number;
  /** A piece whose single dormant core woke up: it runs that core's own controls from `cores` if it has any (M7), else its parts' auto controls (`04`). */
  woke?: true;
}
