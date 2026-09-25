import type { ScriptSpec } from '../blueprint/types';
import type { ScriptError, ScriptHost, ScriptInput, ScriptInstance, ScriptResult, ScriptServices, ScriptWrite } from './types';

/** One script on one robot: its source, whether it runs, and why it stopped if it crashed. */
export interface ScriptSlot {
  id: string;
  enabled: boolean;
  crashed?: ScriptError;
}

export interface ScriptTickOutput {
  writes: ScriptWrite[];
  logs: { script: string; text: string }[];
  crashes: { script: string; error: ScriptError }[];
}

/**
 * A robot's scripts (`04`, Layer 3). Runs only on the robot's active core. Enabling runs `setup()` (fresh `state`)
 * then `tick()` on the same tick; a crash disables the script and keeps the error; enabling it again recompiles from
 * source. Scripts run in blueprint order and their writes apply in that order (last write wins).
 */
export class ScriptRunner {
  private readonly slots: (ScriptSlot & { source?: string; params: Record<string, number>; instance?: ScriptInstance; needsSetup: boolean; seed: number; name: string })[];
  private readonly host: ScriptHost | undefined;

  constructor(specs: readonly ScriptSpec[], host: ScriptHost | undefined, seed: (index: number) => number) {
    this.host = host;
    this.slots = specs.map((s, i) => ({
      id: s.id,
      enabled: false,
      params: { ...s.params },
      needsSetup: false,
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
    return this.slots.map((s) => ({ id: s.id, enabled: s.enabled, ...(s.crashed ? { crashed: s.crashed } : {}) }));
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
  tick(input: () => ScriptInput, services?: ScriptServices): ScriptTickOutput {
    const out: ScriptTickOutput = { writes: [], logs: [], crashes: this.pending };
    this.pending = [];
    let built: ScriptInput | undefined;
    for (const slot of this.slots) {
      if (!slot.enabled || !slot.instance) continue;
      built ??= input();
      const instance = slot.instance;
      const results: ScriptResult[] = [];
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
          out.logs.push(...r.logs.map((text) => ({ script: slot.id, text })));
        } else {
          this.crash(slot, r.error);
          out.crashes.push({ script: slot.id, error: r.error });
          break;
        }
      }
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
      r = this.host.compile(slot.source, { name: slot.name, seed: slot.seed, params: slot.params });
    } catch (e) {
      return fail({ kind: 'throw', message: e instanceof Error ? e.message : String(e) });
    }
    if (!r.ok) return fail(r.error);
    slot.instance = r.instance;
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
