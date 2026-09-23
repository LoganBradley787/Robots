import type { RobotInput } from '@robots/sim-core';

/** Where a key press came from. The key counts as down while any source holds it. */
export type KeySource = 'keyboard' | 'mouse';

/**
 * Turns key downs and ups (keyboard, keys bar buttons) into edges for the controlled robot, drained once per tick.
 * Rules from `11`: a robot you leave keeps its held keys (nothing is sent to it); the robot you switch to starts with
 * nothing held, so a key already down only counts once pressed again. `releaseAll` (window blur, leaving the world)
 * releases every held key on the controlled robot so nothing sticks.
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

  down(source: KeySource, key: string): void {
    if (this.controlled === undefined) return;
    const by = this.held.get(key);
    if (by) {
      by.add(source);
      return;
    }
    this.held.set(key, new Set([source]));
    this.edge(this.controlled).pressed.push(key);
  }

  up(source: KeySource, key: string): void {
    const by = this.held.get(key);
    if (!by?.delete(source) || this.controlled === undefined) return;
    if (by.size > 0) return;
    this.held.delete(key);
    this.edge(this.controlled).released.push(key);
  }

  /** Releases every key held on the controlled robot. */
  releaseAll(): void {
    if (this.controlled !== undefined) for (const key of this.held.keys()) this.edge(this.controlled).released.push(key);
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

  /** This tick's edges, one entry per robot, oldest robot first. */
  drain(): RobotInput[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  private edge(robot: number): RobotInput {
    const last = this.pending[this.pending.length - 1];
    if (last && last.robot === robot) return last;
    const i: RobotInput = { robot, pressed: [], released: [] };
    this.pending.push(i);
    return i;
  }
}
