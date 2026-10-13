import type { Blueprint, Issue, Rotation, StaticStats } from '@robots/sim-core';
import type { Mode } from '../app/modes';
import type { BlueprintListing } from '../storage/blueprintApi';
import type { WorldView } from '../world/WorldScreen';
import type { ControlsView } from '../builder/coreControls';
import type { GroupOffer } from '../builder/boardOps';
import type { NoteLine } from '../builder/notice';
import type { ScriptProblem, ScriptShow } from '../builder/scriptView';

/** A refusal or an offer shown at the cursor (M16), at a point in window pixels. One of `text` and `offers` is set. */
export interface CursorNote {
  seq: number;
  x: number;
  y: number;
  /** Why the last click, drag or key did nothing. */
  text?: string;
  /** Groups the blank parts just placed could join: one click each. */
  offers?: GroupOffer[];
}

export interface BuilderView {
  draft: Blueprint;
  held?: { part: string; rot: Rotation };
  /** A saved blueprint held to place as a copy (M7). */
  stamp?: { name: string; rot: Rotation; flipped: boolean };
  /** A copy of parts in hand (Alt+click, Cmd+D): their types, and the groups they carry. */
  copy?: { types: string[]; rot: Rotation; flipped: boolean; groups: string[] };
  /** The drag going on, if any. */
  dragging?: 'paint' | 'erase' | 'box' | 'move';
  /** What the last edit affected, with Undo in it. */
  note?: { seq: number; lines: NoteLine[]; undo: boolean };
  cursorNote?: CursorNote;
  /** The script whose reach is lit on the board. */
  shown?: ScriptShow;
  /** The script kept lit (Show), by id. `shown` may be another one for a moment, while the mouse is on its row. */
  shownPinned?: string;
  /** Dead names and wrong inputs in the robot's scripts, for Problems. */
  scriptProblems: ScriptProblem[];
  /** The core the Controls and Scripts panels edit (absent: the main core), its controls, and every core to pick. */
  controlsFor?: string;
  controls: ControlsView;
  cores: { core?: string; label: string }[];
  eraser: boolean;
  selection: string[];
  /** The cell under the cursor. */
  hover?: { x: number; y: number };
  /** Goes up by one on each right-click on a part: the inspector turns to its Part tab. */
  partFocus: number;
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

export type InspectorTab = 'part' | 'robot' | 'keys' | 'behaviors';

/** What the builder's panels show (M16): nothing here is saved. */
export interface PanelState {
  tab: InspectorTab;
  drawer: 'parts' | 'assemblies';
  problemsOpen: boolean;
  /** The library (Open) or the key list (?), over the board. */
  overlay?: 'library' | 'help';
}

/** What the library knows of one saved robot: its picture and what is in it. */
export interface BlueprintMeta {
  /** A PNG data URL; absent when there is nothing to draw. */
  thumb?: string;
  /** -1 when the file could not be read. */
  parts: number;
  scripts: number;
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
  /** The script open in the builder's code editor, by id. */
  scriptEditor?: string;
  /** A line of that script to show and select (a click on a problem). `seq` goes up on each ask. */
  scriptLine?: { line: number; seq: number };
  panel: PanelState;
  /** Nine slots on the keys 1 to 9 (M16): a part id, or null for an empty slot. Kept in the browser. */
  hotbar: Array<string | null>;
  /** The parts taken in hand last, newest first (the drawer's recent row). */
  recent: string[];
  /** Pictures and counts of saved robots, by file, filled in as the library asks for them. */
  meta: Record<string, BlueprintMeta>;
}
