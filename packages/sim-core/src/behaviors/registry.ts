import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { BodyGroup, PartInstance, Robot } from '../world/Robot';
import { thrust } from './thrust';
import { wheel } from './wheel';
import { gyro } from './gyro';

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
}

export interface Behavior {
  /** behaviorConfig keys this behavior reads. A test checks every def that uses the behavior has them. */
  readonly config: readonly string[];
  /** Whether the def must have a joint (wheels) or `acts` (thrust). */
  readonly needsJoint?: boolean;
  readonly needsActs?: boolean;
  /**
   * Decides what the part will do this tick, before energy is granted (`05`, two phases). Returns undefined when it
   * does nothing. `load` (0 to 1) is how hard it works; the part requests `powerDraw * load * dt`.
   */
  plan(ctx: BehaviorContext): PlannedAction | undefined;
}

export interface PlannedAction {
  load: number;
  /** Acts with `grant` (0 to 1) of the energy it asked for: a brownout scales the output down. */
  run(grant: number): void;
}

/**
 * Behaviors by the def's `behavior` id. Defs name their behavior; the engine never names a part. Behaviors not
 * listed here (core, battery, decoupler, warhead) do nothing yet.
 */
export const BEHAVIORS: ReadonlyMap<string, Behavior> = new Map<string, Behavior>([
  ['wheel', wheel],
  ['thrust', thrust],
  ['gyro', gyro],
]);
