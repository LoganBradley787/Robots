import type { Rotation } from '../parts/types';

export interface Issue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  cell?: { x: number; y: number };
  partId?: string;
  /** JSON path into the blueprint file, for format errors. */
  path?: string;
}

export interface LegendEntry {
  part: string;
  rot?: Rotation;
  tags?: string[];
  /** `false` opts the part out of auto controls (`11`). Absent means on. */
  auto?: false;
  /** M10: `true` starts a part that needs arming (`arming` in its def) armed. Absent means unarmed. */
  armed?: true;
  /** M12: what a fabricator bay makes: the name of one of the blueprint's `recipes`. */
  makes?: string;
  /** M12: a stretchy part's size (its hollow's width and height). Absent means the def's default. */
  size?: [number, number];
}

export interface PlacedPart {
  id: string;
  part: string;
  x: number;
  y: number;
  rot: Rotation;
  tags: string[];
  /** `false` opts the part out of auto controls (`11`). Absent means on. */
  auto?: false;
  /** M10: `true` starts a part that needs arming (`arming` in its def) armed. Absent means unarmed. */
  armed?: true;
  /** M12: what a fabricator bay makes: the name of one of the blueprint's `recipes`. */
  makes?: string;
  /** M12: a stretchy part's size (its hollow's width and height). Absent means the def's default. */
  size?: [number, number];
}

/**
 * M12: a blueprint a fabricator bay builds copies of, carried whole in the robot's blueprint (Logan: a bay makes any
 * blueprint), so saves and replays need nothing else.
 */
export interface Recipe {
  name: string;
  blueprint: Blueprint;
}

export type BindingMode = 'hold' | 'toggle' | 'pulse' | 'script';

export interface Binding {
  key: string;
  mode: BindingMode;
  target?: string;
  channel?: string;
  value?: number;
  script?: string;
}

export interface ScriptSpec {
  id: string;
  enabled: boolean;
  params: Record<string, number>;
  /** The code, or `{ file }` when it has not been loaded from its file yet. */
  source: string | { file: string };
  /** The `.js` file in `blueprints/` the code lives in (M5: scripts are separate files). Absent for inline scripts. */
  file?: string;
  /**
   * The part types and tags the script reads (2026-10-23, for big robots): when every script of a core lists them,
   * its `parts` and `get()` hold only the parts with one of those types or tags (any script's list counts), so the
   * frame carries those rows and no others. Absent: every part, as before. `set()` reaches every part either way.
   */
  parts?: string[];
}

/**
 * Controls of a core other than the primary core (M7): they start when that core wakes, which happens when its piece
 * breaks off with no other core in it (`04`). A blueprint placed on another brings its controls along this way.
 */
export interface CoreControls {
  /** The core part's id. */
  core: string;
  /**
   * Set on a placed blueprint (`missile1`): its parts carry the tag `missile1` and their own tags as `missile1.<tag>`.
   * Targets in these bindings and scripts are resolved inside that scope, so `thrusters` means this missile's
   * thrusters and nothing else. Absent: targets resolve over the core's whole piece, like the primary core's.
   */
  scope?: string;
  bindings: Binding[];
  scripts: ScriptSpec[];
  /** `false` turns auto controls off for this core's piece once it wakes. */
  autoControls?: false;
}

/** A blueprint after expansion: a flat part list in blueprint order. */
export interface Blueprint {
  format: 1;
  name: string;
  /**
   * M16: what kind of robot this is ("yours", "enemy", "piece", or any word), for the builder's library to group by.
   * Nothing in the sim reads it. Absent: no kind set.
   */
  kind?: string;
  parts: PlacedPart[];
  bindings: Binding[];
  scripts: ScriptSpec[];
  primaryCore?: string;
  corePriority?: string[];
  /** `false` turns auto controls off for the whole blueprint (`11`). Absent means on. */
  autoControls?: false;
  /** Controls of other cores, in file order (M7). Absent or empty when only the primary core has controls. */
  cores?: CoreControls[];
  /** Grid cells written as `=`, checked against multi-cell footprints by the validator. */
  continuations: { x: number; y: number }[];
  /** M12: blueprints its fabricator bays make (`makes`), in file order. Absent when there are none. */
  recipes?: Recipe[];
}
