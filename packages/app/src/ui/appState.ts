import type { Blueprint, Issue, Rotation, StaticStats } from '@robots/sim-core';
import type { Mode } from '../app/modes';

export interface BuilderView {
  draft: Blueprint;
  held?: { part: string; rot: Rotation };
  selection: string[];
  mirror: { on: boolean; axisHalfCells: number };
  canUndo: boolean;
  canRedo: boolean;
  issues: Issue[];
  stats: StaticStats;
}

/** State shared between the canvas screens and the Preact panels. */
export interface AppState {
  mode: Mode;
  builder: BuilderView;
}
