import type { ScriptFrame } from './frame';

/** Why a script stopped. Uniform across backends, so the UI, replays, and reports never learn which one ran it. */
export interface ScriptError {
  kind: 'budget' | 'memory' | 'stack' | 'throw' | 'compile';
  message: string;
}

export interface ParamSpec {
  default: number;
  min?: number;
  max?: number;
}

export interface ScriptLimits {
  /** Interrupt-handler calls per tick (about 10,000 bytecode poll points each). Deterministic, unlike time. */
  budgetPerTick: number;
  memoryBytes: number;
  stackBytes: number;
}

/**
 * Starting limits (`04`). The stack is 256 KB, not 512: at 512 deep recursion overflowed the host's own stack before
 * QuickJS's check fired (the research spike also used 256).
 */
export const DEFAULT_LIMITS: ScriptLimits = { budgetPerTick: 50, memoryBytes: 16 * 1024 * 1024, stackBytes: 256 * 1024 };

/** One `set(target, channel, value)` from a script. */
export interface ScriptWrite {
  target: string;
  channel: string;
  value: number;
}

/**
 * A robot this robot's sensors see (M8). `side` is relative to the viewer: `enemy` (another team), `friend` (its own
 * team), or `none` (debris, or a robot whose core is gone). `pos` and `vel` are its live core's, or for a robot
 * without one its center of mass's.
 */
export interface ScriptContact {
  id: number;
  side: 'enemy' | 'friend' | 'none';
  /** Whether it has a live core. */
  core: boolean;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  center: { x: number; y: number };
  mass: number;
  parts: number;
  /** From this robot's core to `pos`, in meters. */
  distance: number;
  /** Ids of this robot's sensor parts that see it. */
  by: string[];
}

/** One part of a seen robot, from `scan(id)` (M8). */
export interface ScannedPart {
  id: string;
  type: string;
  pos: { x: number; y: number };
  angle: number;
  health: number;
  maxHealth: number;
}

/** A message another core sent this one (M8), as its scripts see it in `inbox`. */
export interface ScriptMessage {
  /** The sender's core part id. */
  from: string;
  /** The tick it was sent on. */
  tick: number;
  data: unknown;
}

/** A point a script marked for the debug overlay and the CLI side view (M8). Not simulation state. */
export interface ScriptMark {
  x: number;
  y: number;
  label?: string;
}

/**
 * Host calls a script can make mid-tick (M8). Scripts run in a fixed order, so the order of calls is deterministic.
 * `scan` only reads; `send` queues a message that is shown next tick.
 */
export interface ScriptServices {
  /** A seen robot's parts, or null when it is not seen this tick. */
  scan(id: number): ScannedPart[] | null;
  /** Queues `json` for an attached core named `to` (its scope or its part id). False when there is no such core. */
  send(to: string, json: string): boolean;
}

/**
 * What a script sees on a tick. Plain data; nothing from the host leaks in. Since M9 it crosses into the sandbox as a
 * `ScriptFrame` (`frame.ts`); this is the shape the script ends up with.
 */
export interface ScriptInput {
  frame: number;
  dt: number;
  time: number;
  self: {
    pos: { x: number; y: number };
    vel: { x: number; y: number };
    angle: number;
    angVel: number;
    mass: number;
    energy: { stored: number; capacity: number };
  };
  /** Every part still attached to the script's core, in world coordinates, with its mass (kg) from its def. */
  parts: { id: string; type: string; tags: string[]; pos: { x: number; y: number }; angle: number; mass: number; in: Record<string, number>; out: Record<string, number> }[];
  keys: { down: string[]; pressed: string[]; released: string[] };
  /** M8: robots this robot's sensors see, nearest first. Empty without sensors. */
  contacts: ScriptContact[];
  /** M8: messages sent to this core since its scripts last ran, oldest first. */
  inbox: ScriptMessage[];
}

export type ScriptResult = { ok: true; writes: ScriptWrite[]; logs: string[]; marks: ScriptMark[] } | { ok: false; error: ScriptError };

export interface ScriptInstance {
  /** Params the script declared with `param()`, with the values it got. */
  readonly params: Readonly<Record<string, ParamSpec>>;
  /** Clears `state` and runs `setup()` if the script defines it. The frame is what it sees (M9, `frame.ts`). */
  setup(frame: ScriptFrame, services?: ScriptServices): ScriptResult;
  /** Runs `tick()`. Synchronous by contract, so the sim stays a plain loop in browser and Node. */
  tick(frame: ScriptFrame, services?: ScriptServices): ScriptResult;
  /** What the script saw on its last call, as `ScriptInput` JSON (tests only; a backend may leave it out). */
  inspect?(): string;
  dispose(): void;
}

export interface CompileOptions {
  /** For error messages: `drone.hover.js`. */
  name: string;
  /** Seeds the script's `Math.random` and `random()`. */
  seed: number;
  /** Values for `param()`, by name. Missing ones use the script's default. */
  params?: Readonly<Record<string, number>>;
  limits?: ScriptLimits;
}

export type CompileResult = { ok: true; instance: ScriptInstance } | { ok: false; error: ScriptError };

/** A script backend. The world only ever sees this interface. */
export interface ScriptHost {
  compile(source: string, opts: CompileOptions): CompileResult;
}
