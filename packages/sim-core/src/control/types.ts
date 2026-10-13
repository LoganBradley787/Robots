/**
 * Key edges for one robot on one tick. A robot's controller keeps its own held keys and toggles and changes them
 * only when an input for it arrives, so a robot nobody sends inputs to holds its last state (latching).
 */
export interface RobotInput {
  robot: number;
  pressed: string[];
  released: string[];
}

/** What a controller needs to know about a part: its id, type, tags, and input channels. */
export interface ControlledPart {
  id: string;
  part: string;
  tags: readonly string[];
  inputs: readonly { name: string; min: number; max: number; default: number }[];
}

/** Snapshot of a controller for the hash, the UI, and tests. Sorted so it is stable. */
export interface ControlState {
  held: string[];
  /** Indices (into the controller's bindings) of toggle bindings that are on. */
  toggles: number[];
}

/** One `set()` a script made this tick, as it was made (M16, the trace). */
export interface TraceWrite {
  /** The script's id. */
  script: string;
  target: string;
  channel: string;
  value: number;
  /** How many parts it reached that have the input. 0: it did nothing. */
  parts: number;
}

/** One input of one part this tick, and who decided its value (M16, the trace). */
export interface TraceInput {
  part: string;
  channel: string;
  min: number;
  max: number;
  default: number;
  /** The value the part got, after the range was applied. */
  value: number;
  /** `key`: a key that is held or toggled on (keys beat scripts). `script`: no key writes it, a script did. `default`: nobody writes it now. */
  source: 'key' | 'script' | 'default';
  /** Every key bound to it, in binding order, and whether it writes now. The values of the ones that do are added up. */
  keys: { key: string; mode: 'hold' | 'toggle' | 'pulse'; value: number; active: boolean }[];
  /** The last script that wrote it this tick and what it asked for, whether or not a key beat it. */
  script?: { id: string; value: number };
}

/**
 * A robot's control layer for one tick, for a live readout (M16): what each script set, and who is driving each input
 * a key is bound to or a script wrote. Made only while something asks for it (`World.setTrace`); never part of the
 * state hash, and reading it changes nothing.
 */
export interface ControlTrace {
  writes: TraceWrite[];
  inputs: TraceInput[];
}
