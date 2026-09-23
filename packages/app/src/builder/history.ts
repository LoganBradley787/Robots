import type { Blueprint } from '@robots/sim-core';

/**
 * Undo and redo over whole-blueprint snapshots (blueprints are small). Commits of the same object are ignored,
 * so edit functions that return their input unchanged never create entries. A gesture (one drag) is one entry.
 */
export class History {
  private past: Blueprint[] = [];
  private future: Blueprint[] = [];
  private current: Blueprint;
  private inGesture = false;
  private gestureOpened = false;
  private readonly cap: number;

  constructor(initial: Blueprint, cap = 200) {
    this.current = initial;
    this.cap = cap;
  }

  get present(): Blueprint {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  commit(bp: Blueprint): void {
    if (bp === this.current) return;
    if (!this.inGesture || !this.gestureOpened) {
      this.past.push(this.current);
      if (this.past.length > this.cap) this.past.shift();
      this.gestureOpened = this.inGesture;
    }
    this.current = bp;
    this.future = [];
  }

  beginGesture(): void {
    this.inGesture = true;
    this.gestureOpened = false;
  }

  endGesture(): void {
    this.inGesture = false;
    this.gestureOpened = false;
  }

  undo(): Blueprint | undefined {
    const prev = this.past.pop();
    if (!prev) return undefined;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): Blueprint | undefined {
    const next = this.future.pop();
    if (!next) return undefined;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  /** Applies a name to every entry, so undo and redo never bring back an old name after Save As. */
  renameAll(name: string): void {
    const rename = (bp: Blueprint): Blueprint => (bp.name === name ? bp : { ...bp, name });
    this.past = this.past.map(rename);
    this.future = this.future.map(rename);
    this.current = rename(this.current);
  }

  /** Start over from a blueprint (opening a file, New). */
  reset(bp: Blueprint): void {
    this.past = [];
    this.future = [];
    this.current = bp;
    this.endGesture();
  }
}
