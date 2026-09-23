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
