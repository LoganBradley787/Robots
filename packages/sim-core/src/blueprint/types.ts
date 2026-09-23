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
}

/** A blueprint after expansion: a flat part list in blueprint order. */
export interface Blueprint {
  format: 1;
  name: string;
  parts: PlacedPart[];
  bindings: Binding[];
  scripts: ScriptSpec[];
  primaryCore?: string;
  corePriority?: string[];
  /** `false` turns auto controls off for the whole blueprint (`11`). Absent means on. */
  autoControls?: false;
  /** Grid cells written as `=`, checked against multi-cell footprints by the validator. */
  continuations: { x: number; y: number }[];
}
