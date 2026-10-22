import type { ScriptFrame } from './frame';
import type { ScriptPartSpec } from './partSpec';
import type { ScanOptions } from './scanOptions';
import type { Arena } from '../world/arena';

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
  /** QuickJS stack a script may use; going past it stops the script, even if it catches the error (review D2). */
  stackBytes: number;
}

/**
 * Starting limits (`04`). The stack is 64 KB (about 350 plain calls deep). It was 256 KB, but that much script stack
 * took about 60% of Node's and Chrome's own stack, so from a deep enough host stack the host ran out first and the
 * same replay ended another way (review D2). At 64 KB, plus the guard past it, plain recursion takes about a quarter
 * of the host's stack at most (`quickjs.ts`, `StackGuard`).
 */
export const DEFAULT_LIMITS: ScriptLimits = { budgetPerTick: 200, memoryBytes: 16 * 1024 * 1024, stackBytes: 64 * 1024 };

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
  /**
   * M16, only when scanned with `from` (`scanOptions.ts`): the summed health and the count of the robot's other parts
   * in front of this one on the straight line from that point.
   */
  cover?: number;
  coverParts?: number;
  /**
   * M16, only when scanned with `acts: true` and only for a part that acts along one of its faces: the way it pushes,
   * fires, or looks in the world, radians counterclockwise.
   */
  acts?: number;
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
  /** A seen robot's parts (M16: only those `opts` asks for), or null when it is not seen this tick. */
  scan(id: number, opts?: ScanOptions): ScannedPart[] | null;
  /**
   * The same answer as JSON text (`JSON.stringify(scan(id, opts))`), for a host that hands its script text: without
   * options the world makes it once per robot per tick, however many scripts scan that robot. Optional; a host falls
   * back to `scan`.
   */
  scanJson?(id: number, opts?: ScanOptions): string;
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
    /**
     * M16: seconds since this robot was put in the world, or since its piece broke off what carried it. `time` is the
     * world's clock and says nothing of that. Absent only from input built by hand (it then reads 0).
     */
    age?: number;
  };
  /**
   * Every part still attached to the script's core, in world coordinates, with its mass (kg) from its def. `spec`
   * (M16) is its definition's static numbers, the same object for every part of a type (`partSpec.ts`); absent only
   * from input built by hand without it. `rot` and `on` (M16, `frame.ts`, `LayoutPart`): how the part was built turned,
   * in degrees counterclockwise, and the id of the joint part that carries it ('' for none). `angle` is its body's
   * angle, so the way it acts is `angle` plus `rot + spec.acts` degrees. Absent only from input built by hand.
   * `center` (M16 review): where its middle is (its weight), from `pos`, built unturned, at the size it was placed: in
   * the world, `pos` plus this turned by `angle + rot` degrees. 0, 0 for a part of one cell. With `rot` and `on`.
   */
  parts: { id: string; type: string; tags: string[]; pos: { x: number; y: number }; angle: number; mass: number; in: Record<string, number>; out: Record<string, number>; rot?: number; on?: string; center?: { x: number; y: number }; spec?: ScriptPartSpec }[];
  keys: { down: string[]; pressed: string[]; released: string[] };
  /** M8: robots this robot's sensors see, nearest first. Empty without sensors. */
  contacts: ScriptContact[];
  /** M8: messages sent to this core since its scripts last ran, oldest first. */
  inbox: ScriptMessage[];
}

/** `keys`: the keys it asked about with `keys.down` and friends this call (M16, for the readout), when any. */
export type ScriptResult = { ok: true; writes: ScriptWrite[]; logs: string[]; marks: ScriptMark[]; keys?: string[] } | { ok: false; error: ScriptError };

export interface ScriptInstance {
  /** Params the script declared with `param()`, with the values it got. */
  readonly params: Readonly<Record<string, ParamSpec>>;
  /** Clears `state` and runs `setup()` if the script defines it. The frame is what it sees (M9, `frame.ts`). */
  setup(frame: ScriptFrame, services?: ScriptServices): ScriptResult;
  /** Runs `tick()`. Synchronous by contract, so the sim stays a plain loop in browser and Node. */
  tick(frame: ScriptFrame, services?: ScriptServices): ScriptResult;
  /** What the script saw on its last call, before it ran, as `ScriptInput` JSON (compiled with `inspect`; tests only). */
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
  /** Tests only (M9 parity): keep what the script sees on each call for `inspect()`. Costs a JSON text per call. */
  inspect?: boolean;
  /** The world's arena, which the script reads as the global `arena` (null when absent or null). */
  arena?: Arena | null;
}

export type CompileResult = { ok: true; instance: ScriptInstance } | { ok: false; error: ScriptError };

/** A script backend. The world only ever sees this interface. */
export interface ScriptHost {
  compile(source: string, opts: CompileOptions): CompileResult;
}
