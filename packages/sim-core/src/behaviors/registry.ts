import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Face } from '../parts/types';
import type { BodyGroup, PartInstance, Robot } from '../world/Robot';
import { thrust } from './thrust';
import { wheel } from './wheel';
import { gyro } from './gyro';
import { decoupler } from './decoupler';
import { warhead } from './warhead';
import { rotator } from './rotator';
import { sensor } from './sensor';
import { fabricate } from './fabricate';
import { piston } from './piston';

export interface BehaviorContext {
  physics: PhysicsWorld;
  robot: Robot;
  part: PartInstance;
  group: BodyGroup;
  dt: number;
  /** The part's final value on an input channel this tick (the channel default when nothing writes it). */
  value(channel: string): number;
  /** A number from the def's behaviorConfig. Missing keys are caught by the part def tests, not at runtime. */
  config(key: string): number;
  /**
   * Stops the part attaching through `face` (after its rotation) and pushes the two sides apart with `impulse` N s
   * each along the face. The robot splits in the damage phase after the physics step (`03`).
   */
  detach(face: Face, impulse: number): void;
  /** M12, fabricators: what the part's recipe costs (seconds of build, joules), or undefined when it makes nothing. */
  job(): { seconds: number; joules: number } | undefined;
  /** M12: the build is done; the world adds the copy to the robot if the hollow is clear, else it tries next tick. */
  finish(): void;
  /** M12: lets go of the copy the part holds, pushing it out along the part's `acts`. */
  release(): void;
}

export interface Behavior {
  /** behaviorConfig keys this behavior reads. A test checks every def that uses the behavior has them. */
  readonly config: readonly string[];
  /**
   * Changes the robot's structure (a decoupler): runs before every other behavior, and the robot is rebuilt right
   * after, before anything pushes. A missile lit on the tick its decoupler fires then pushes the missile, not the
   * turret it was sitting on.
   */
  readonly early?: boolean;
  /** Whether the def must have a joint (wheels) or `acts` (thrust). */
  readonly needsJoint?: boolean;
  readonly needsActs?: boolean;
  /**
   * Decides what the part will do this tick, before energy is granted (`05`, two phases). Returns undefined when it
   * does nothing. `load` (0 to 1) is how hard it works; the part requests `powerDraw * load * dt`.
   */
  plan(ctx: BehaviorContext): PlannedAction | undefined;
  /** An output channel this behavior reports (a decoupler's `armed`), or undefined for one it does not. */
  output?(part: PartInstance, name: string): number | undefined;
}

export interface PlannedAction {
  load: number;
  /** Acts with `grant` (0 to 1) of the energy it asked for: a brownout scales the output down. */
  run(grant: number): void;
}

/** Behaviors by the def's `behavior` id. Defs name their behavior; the engine never names a part. */
export const BEHAVIORS: ReadonlyMap<string, Behavior> = new Map<string, Behavior>([
  ['wheel', wheel],
  ['thrust', thrust],
  ['gyro', gyro],
  ['decoupler', decoupler],
  ['warhead', warhead],
  ['rotator', rotator],
  ['sensor', sensor],
  ['fabricate', fabricate],
  ['piston', piston],
]);
