import { appendEdge, type RobotInput } from '@robots/sim-core';

/** Where a key press came from. The key counts as down while any source holds it. */
export type KeySource = 'keyboard' | 'mouse';

/**
 * Turns key downs and ups (keyboard, keys bar buttons) into edges for the controlled robot, drained once per tick.
 * Rules from `11`: a robot you leave for another you drive keeps its held keys (nothing is sent to it); the robot you
 * switch to starts with nothing held, so a key already down only counts once pressed again. `releaseAll` (window blur,
 * leaving the world, and `follow` to only watch a robot) releases every held key on the controlled robot so nothing sticks.
 */
export class KeyboardSource {
  private controlled: number | undefined;
  private readonly held = new Map<string, Set<KeySource>>();
  private pending: RobotInput[] = [];

  get robot(): number | undefined {
    return this.controlled;
  }

  /** Switches control. Pending edges for the old robot still go out; its held keys stay held (latched). */
  setControlled(robot: number | undefined): void {
    if (robot === this.controlled) return;
    this.controlled = robot;
    this.held.clear();
  }

  /**
   * Control moves to `robot` because you clicked or cycled to it; undefined when you only watch (an enemy, a core-less
   * robot). Moving to another robot you drive latches the old one, keys held and all (Logan, `11`). Letting go to only
   * watch releases the old one's held keys first, as leaving the world does, so it does not drive off unseen while you
   * watch something else. The releases are ordinary edges: they reach the world, and its replay, on the next tick.
   */
  follow(robot: number | undefined): void {
    if (robot === undefined) this.releaseAll();
    this.setControlled(robot);
  }

  down(source: KeySource, key: string): void {
    if (this.controlled === undefined) return;
    const by = this.held.get(key);
    if (by) {
      by.add(source);
      return;
    }
    this.held.set(key, new Set([source]));
    appendEdge(this.pending, this.controlled, key, 'press');
  }

  up(source: KeySource, key: string): void {
    const by = this.held.get(key);
    if (!by?.delete(source) || this.controlled === undefined) return;
    if (by.size > 0) return;
    this.held.delete(key);
    appendEdge(this.pending, this.controlled, key, 'release');
  }

  /** Releases every key held on the controlled robot. */
  releaseAll(): void {
    if (this.controlled !== undefined) for (const key of this.held.keys()) appendEdge(this.pending, this.controlled, key, 'release');
    this.held.clear();
  }

  /** Forgets everything, pending edges included: the robots they were for are gone. */
  clear(): void {
    this.controlled = undefined;
    this.held.clear();
    this.pending = [];
  }

  isDown(key: string): boolean {
    return this.held.has(key);
  }

  /** This tick's edges in the order they happened (see `appendEdge`). */
  drain(): RobotInput[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
}
