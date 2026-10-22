import type { ScriptSpec } from '../blueprint/types';
import type { ScriptFrame } from './frame';
import type { Arena } from '../world/arena';
import type { ScriptError, ScriptHost, ScriptInstance, ScriptMark, ScriptResult, ScriptServices, ScriptWrite } from './types';

/** One script on one robot: its source, whether it runs, and why it stopped if it crashed. */
export interface ScriptSlot {
  id: string;
  enabled: boolean;
  crashed?: ScriptError;
  /** Keys it has asked about since it was last switched on (M16, for the readout), in the order it first did. */
  reads?: readonly string[];
}

export interface ScriptTickOutput {
  writes: ScriptWrite[];
  /** Whose `writes` they are (M16, for the trace): each script that ran, in order, with how many of the writes are its own. */
  writesBy: { script: string; count: number }[];
  /** Marks from this tick (M8), per script; a script that ran with none clears its old ones. */
  marks: { script: string; marks: ScriptMark[] }[];
  /** Whether any script ran (and so saw this tick's input, its inbox included). */
  ran: boolean;
  logs: { script: string; text: string }[];
  crashes: { script: string; error: ScriptError }[];
}

/**
 * A robot's scripts (`04`, Layer 3). Runs only on the robot's active core. Enabling runs `setup()` (fresh `state`)
 * then `tick()` on the same tick; a crash disables the script and keeps the error; enabling it again recompiles from
 * source. Scripts run in blueprint order and their writes apply in that order (last write wins).
 */
export class ScriptRunner {
  private readonly slots: (Omit<ScriptSlot, 'reads'> & { source?: string; params: Record<string, number>; instance?: ScriptInstance; needsSetup: boolean; seed: number; name: string; reads: string[]; last: ScriptWrite[] })[];
  private readonly host: ScriptHost | undefined;
  /** The world's arena, handed to every script it compiles (the global `arena`). */
  private readonly arena: Arena | null;

  constructor(specs: readonly ScriptSpec[], host: ScriptHost | undefined, seed: (index: number) => number, arena: Arena | null = null) {
    this.host = host;
    this.arena = arena;
    this.slots = specs.map((s, i) => ({
      id: s.id,
      enabled: false,
      params: { ...s.params },
      needsSetup: false,
      reads: [],
      last: [],
      seed: seed(i),
      name: typeof s.source === 'string' ? `${s.id}.js` : s.source.file,
      ...(typeof s.source === 'string' ? { source: s.source } : {}),
    }));
    // Scripts that start on deploy: `enabled` in the blueprint.
    specs.forEach((s, i) => {
      if (s.enabled) this.enable(i);
    });
  }

  get scripts(): readonly ScriptSlot[] {
    return this.slots.map((s) => ({ id: s.id, enabled: s.enabled, ...(s.crashed ? { crashed: s.crashed } : {}), ...(s.reads.length > 0 ? { reads: [...s.reads] } : {}) }));
  }

  /** Crashes found while enabling at construction (compile errors), reported on the first tick. */
  private pending: { script: string; error: ScriptError }[] = [];

  /** Flips a script by id (a `script` binding's key press). */
  toggle(id: string): void {
    const i = this.slots.findIndex((s) => s.id === id);
    const slot = this.slots[i];
    if (!slot) return;
    if (slot.enabled) {
      slot.enabled = false;
      return;
    }
    this.enable(i);
  }

  /** Runs every enabled script for this tick. `input` is built only when a script needs it. */
  tick(input: () => ScriptFrame, services?: ScriptServices): ScriptTickOutput {
    const out: ScriptTickOutput = { writes: [], writesBy: [], marks: [], ran: false, logs: [], crashes: this.pending };
    this.pending = [];
    let built: ScriptFrame | undefined;
    for (const slot of this.slots) {
      if (!slot.enabled || !slot.instance) continue;
      built ??= input();
      out.ran = true;
      const instance = slot.instance;
      const results: ScriptResult[] = [];
      slot.last = [];
      try {
        if (slot.needsSetup) results.push(instance.setup(built, services));
        slot.needsSetup = false;
        if (results[0]?.ok !== false) results.push(instance.tick(built, services));
      } catch (e) {
        // A backstop: the host already turns script failures into results, but nothing may escape into the world.
        results.push({ ok: false, error: { kind: 'throw', message: e instanceof Error ? e.message : String(e) } });
      }
      for (const r of results) {
        if (r.ok) {
          out.writes.push(...r.writes);
          slot.last = slot.last.length === 0 ? r.writes : [...slot.last, ...r.writes];
          out.writesBy.push({ script: slot.id, count: r.writes.length });
          out.marks.push({ script: slot.id, marks: r.marks });
          out.logs.push(...r.logs.map((text) => ({ script: slot.id, text })));
          for (const k of r.keys ?? []) if (slot.reads.length < 16 && !slot.reads.includes(k)) slot.reads.push(k);
        } else {
          this.crash(slot, r.error);
          out.crashes.push({ script: slot.id, error: r.error });
          break;
        }
      }
    }
    return out;
  }

  /**
   * A tick its scripts sit out (Smooth, `skip` in the input log): no script is called, and each running script's
   * `set()` calls from the last tick it ran are made again, in the same order, so its parts keep what it set (the
   * script layer is cleared every tick, `Controller.endTick`). A script switched on since it last ran has none yet.
   * Compile errors from switching one on are reported here too, as on a tick that ran.
   */
  repeat(): ScriptTickOutput {
    const out: ScriptTickOutput = { writes: [], writesBy: [], marks: [], ran: false, logs: [], crashes: this.pending };
    this.pending = [];
    for (const slot of this.slots) {
      if (!slot.enabled || !slot.instance || slot.needsSetup) continue;
      out.writes.push(...slot.last);
      out.writesBy.push({ script: slot.id, count: slot.last.length });
    }
    return out;
  }

  dispose(): void {
    for (const s of this.slots) s.instance?.dispose();
  }

  private enable(i: number): void {
    const slot = this.slots[i];
    if (!slot) return;
    delete slot.crashed;
    slot.reads = [];
    slot.instance?.dispose();
    delete slot.instance;
    const fail = (error: ScriptError): void => {
      slot.crashed = error;
      slot.enabled = false;
      this.pending.push({ script: slot.id, error });
    };
    if (!this.host) return fail({ kind: 'compile', message: 'this world has no script host, so scripts cannot run' });
    if (slot.source === undefined) return fail({ kind: 'compile', message: `the source of ${slot.name} was not loaded` });
    let r: ReturnType<ScriptHost['compile']>;
    try {
      r = this.host.compile(slot.source, { name: slot.name, seed: slot.seed, params: slot.params, arena: this.arena });
    } catch (e) {
      return fail({ kind: 'throw', message: e instanceof Error ? e.message : String(e) });
    }
    if (!r.ok) return fail(r.error);
    slot.instance = r.instance;
    slot.last = [];
    slot.enabled = true;
    slot.needsSetup = true;
  }

  private crash(slot: (typeof this.slots)[number], error: ScriptError): void {
    slot.crashed = error;
    slot.enabled = false;
    slot.instance?.dispose();
    delete slot.instance;
  }
}
