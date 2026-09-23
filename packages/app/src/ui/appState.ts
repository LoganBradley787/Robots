import type { Blueprint, Issue, Rotation, StaticStats } from '@robots/sim-core';
import type { Mode } from '../app/modes';
import type { BlueprintListing } from '../storage/blueprintApi';
import type { WorldView } from '../world/WorldScreen';

export interface BuilderView {
  draft: Blueprint;
  held?: { part: string; rot: Rotation };
  selection: string[];
  mirror: { on: boolean; axisHalfCells: number; axisSet: boolean };
  canUndo: boolean;
  canRedo: boolean;
  issues: Issue[];
  stats: StaticStats;
}

export interface DocView {
  file?: string;
  name: string;
  dirty: boolean;
  files: BlueprintListing[];
}

export interface DialogButton {
  label: string;
  value: string;
  kind?: 'primary' | 'danger';
}

export interface DialogSpec {
  title: string;
  message?: string;
  /** Shows a text field; its value comes back with the answer. */
  input?: { value: string; placeholder?: string };
  buttons: DialogButton[];
  /** The value returned for Esc or a click outside. */
  cancelValue: string;
}

export interface ActiveDialog extends DialogSpec {
  resolve(answer: { value: string; input: string }): void;
}

/** State shared between the canvas screens and the Preact panels. */
export interface AppState {
  mode: Mode;
  builder: BuilderView;
  doc: DocView;
  dialog?: ActiveDialog;
  /** A short message shown for a few seconds. */
  notice?: string;
  /** Palette icons: part id to a PNG data URL. */
  icons: Record<string, string>;
  /** What the world toolbar shows; absent until the world has drawn a frame. */
  world?: WorldView;
}
