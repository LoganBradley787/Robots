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

/** What a script sees on a tick. Plain data; nothing from the host leaks in. */
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
  parts: { id: string; type: string; tags: string[]; pos: { x: number; y: number }; angle: number; in: Record<string, number>; out: Record<string, number> }[];
  keys: { down: string[]; pressed: string[]; released: string[] };
}

export type ScriptResult = { ok: true; writes: ScriptWrite[]; logs: string[] } | { ok: false; error: ScriptError };

export interface ScriptInstance {
  /** Params the script declared with `param()`, with the values it got. */
  readonly params: Readonly<Record<string, ParamSpec>>;
  /** Clears `state` and runs `setup()` if the script defines it. */
  setup(input: ScriptInput): ScriptResult;
  /** Runs `tick()`. Synchronous by contract, so the sim stays a plain loop in browser and Node. */
  tick(input: ScriptInput): ScriptResult;
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
