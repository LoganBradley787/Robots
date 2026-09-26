import { DefaultIntrinsics, newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSSyncVariant } from 'quickjs-emscripten-core';
import { Prng } from '../rng/Prng';
import type { ScriptFrame } from './frame';
import { PRELUDE } from './prelude';
import { DEFAULT_LIMITS, type CompileOptions, type CompileResult, type ParamSpec, type ScriptError, type ScriptHost, type ScriptInstance, type ScriptLimits, type ScriptMark, type ScriptResult, type ScriptServices, type ScriptWrite } from './types';

/** Global code (the user's top level, and `param()` calls) gets a few ticks' worth of budget. */
const COMPILE_BUDGET_TICKS = 4;

/**
 * The QuickJS backend (`08`, `docs/research/script-sandbox.md`). The caller passes the variant, so sim-core never
 * picks a browser or Node build: the app passes the single-file browser build, Node the wasm-file build; both are
 * the same engine. One runtime per script: its own memory limit, interrupt counter, and crash blast radius.
 */
export async function createQuickJsHost(variant: QuickJSSyncVariant): Promise<ScriptHost> {
  const module = await newQuickJSWASMModuleFromVariant(variant);
  return {
    compile(source: string, opts: CompileOptions): CompileResult {
      const limits = opts.limits ?? DEFAULT_LIMITS;
      const runtime = module.newRuntime();
      const handles: QuickJSHandle[] = [];
      let ctx: QuickJSContext | undefined;
      const fail = (error: ScriptError): CompileResult => {
        for (const h of handles) safely(() => h.dispose());
        if (ctx) safely(() => ctx?.dispose());
        safely(() => runtime.dispose());
        return { ok: false, error };
      };
      try {
        runtime.setMemoryLimit(limits.memoryBytes);
        runtime.setMaxStackSize(limits.stackBytes);
        const meter = new Meter(runtime);
        // No Date at all: sim time comes in through `time`.
        ctx = runtime.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } });
        const c = ctx;
        const seed = new Prng(opts.seed >>> 0).state();
        // Host calls (M8): the prelude takes them and deletes the global, so only its capped wrappers reach them.
        const services: { current?: ScriptServices } = {};
        const scan = c.newFunction('scan', (idHandle) => {
          const id = c.typeof(idHandle) === 'number' ? c.getNumber(idHandle) : Number.NaN;
          const found = Number.isInteger(id) ? (services.current?.scan(id) ?? null) : null;
          return c.newString(JSON.stringify(found));
        });
        c.setProp(c.global, '__scan', scan);
        scan.dispose();
        const send = c.newFunction('send', (toHandle, jsonHandle) => {
          if (c.typeof(toHandle) !== 'string' || c.typeof(jsonHandle) !== 'string') return c.newString('false');
          const ok = services.current?.send(c.getString(toHandle), c.getString(jsonHandle)) ?? false;
          return c.newString(ok ? 'true' : 'false');
        });
        c.setProp(c.global, '__send', send);
        send.dispose();
        const setup = `var __seed = ${JSON.stringify([...seed])}; var __params = ${JSON.stringify(opts.params ?? {})};\n${PRELUDE}`;
        meter.arm(limits.budgetPerTick * COMPILE_BUDGET_TICKS);
        const pre = c.evalCode(setup, 'prelude.js');
        if (pre.error) {
          const err = dumpError(c, pre.error);
          pre.error.dispose();
          return fail(classify(err, meter, false));
        }
        const entry = pre.value;
        handles.push(entry);
        const fn = (name: string): QuickJSHandle => {
          const h = c.getProp(entry, name);
          handles.push(h);
          return h;
        };
        const entries = { layout: fn('layout'), setup: fn('setup'), tick: fn('tick'), specs: fn('specs'), hasTick: fn('hasTick'), inspect: fn('inspect') };
        meter.arm(limits.budgetPerTick * COMPILE_BUDGET_TICKS);
        const user = run(c, meter, () => c.evalCode(source, opts.name), true);
        if (!user.ok) return fail(user.error);
        meter.arm(limits.budgetPerTick);
        const hasTick = run(c, meter, () => c.callFunction(entries.hasTick, c.undefined));
        if (!hasTick.ok) return fail(hasTick.error);
        if (hasTick.text !== 'true') return fail({ kind: 'compile', message: `${opts.name} does not define function tick()` });
        meter.arm(limits.budgetPerTick);
        const specs = run(c, meter, () => c.callFunction(entries.specs, c.undefined));
        if (!specs.ok) return fail(specs.error);
        return { ok: true, instance: new QuickJsInstance(runtime, c, meter, limits, readSpecs(specs.text), entries, handles, services) };
      } catch (e) {
        // Anything the engine throws at the host (not a script error) must not escape into the world.
        return fail({ kind: 'throw', message: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}

/** Disposal can itself fail (QuickJS asserts on objects a native stack overflow left behind); never let it escape. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // The runtime is abandoned either way; a leak beats a crashed world.
  }
}

/** Param specs as the script declared them, keeping only well-formed numbers. */
function readSpecs(text: string): Record<string, ParamSpec> {
  const out: Record<string, ParamSpec> = {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [name, v] of Object.entries(raw as Record<string, unknown>).slice(0, 50)) {
    const o = v as { default?: unknown; min?: unknown; max?: unknown } | null;
    if (!o || typeof o.default !== 'number' || !Number.isFinite(o.default)) continue;
    const spec: ParamSpec = { default: o.default };
    if (typeof o.min === 'number' && Number.isFinite(o.min)) spec.min = o.min;
    if (typeof o.max === 'number' && Number.isFinite(o.max)) spec.max = o.max;
    out[name.slice(0, 60)] = spec;
  }
  return out;
}

/** Counts interrupt-handler calls and stops the script past its budget. Counting, never wall clock. */
class Meter {
  private calls = 0;
  private budget = 0;
  tripped = false;

  constructor(runtime: QuickJSRuntime) {
    runtime.setInterruptHandler(() => {
      this.calls++;
      if (this.calls > this.budget) {
        this.tripped = true;
        return true;
      }
      return false;
    });
  }

  arm(budget: number): void {
    this.calls = 0;
    this.budget = budget;
    this.tripped = false;
  }
}

class QuickJsInstance implements ScriptInstance {
  readonly params: Readonly<Record<string, ParamSpec>>;
  private readonly runtime: QuickJSRuntime;
  private readonly ctx: QuickJSContext;
  private readonly meter: Meter;
  private readonly limits: ScriptLimits;
  private readonly entries: Entries;
  private readonly handles: QuickJSHandle[];
  private readonly services: { current?: ScriptServices };
  private disposed = false;
  /** The layout this script last read (M9); a frame with another id sends its layout first. */
  private layoutId: number | undefined;

  constructor(
    runtime: QuickJSRuntime,
    ctx: QuickJSContext,
    meter: Meter,
    limits: ScriptLimits,
    params: Record<string, ParamSpec>,
    entries: Entries,
    handles: QuickJSHandle[],
    services: { current?: ScriptServices },
  ) {
    this.services = services;
    this.runtime = runtime;
    this.ctx = ctx;
    this.meter = meter;
    this.limits = limits;
    this.params = params;
    this.entries = entries;
    this.handles = handles;
  }

  setup(frame: ScriptFrame, services?: ScriptServices): ScriptResult {
    return this.call(this.entries.setup, frame, services);
  }

  tick(frame: ScriptFrame, services?: ScriptServices): ScriptResult {
    return this.call(this.entries.tick, frame, services);
  }

  /** What the script saw on its last call, as JSON in the order `ScriptInput` has (the parity test). */
  inspect(): string {
    if (this.disposed) return '';
    this.meter.arm(this.limits.budgetPerTick);
    const r = run(this.ctx, this.meter, () => this.ctx.callFunction(this.entries.inspect, this.ctx.undefined));
    return r.ok ? r.text : '';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const h of this.handles) safely(() => h.dispose());
    safely(() => this.ctx.dispose());
    safely(() => this.runtime.dispose());
  }

  private call(entry: QuickJSHandle, frame: ScriptFrame, services?: ScriptServices): ScriptResult {
    if (this.disposed) return { ok: false, error: { kind: 'throw', message: 'script was stopped' } };
    const ctx = this.ctx;
    if (services) this.services.current = services;
    else delete this.services.current;
    try {
      this.meter.arm(this.limits.budgetPerTick);
      if (frame.layout.id !== this.layoutId) {
        const text = ctx.newString(frame.layout.json);
        const r = run(ctx, this.meter, () => ctx.callFunction(this.entries.layout, ctx.undefined, text));
        text.dispose();
        if (!r.ok) return r;
        this.layoutId = frame.layout.id;
      }
      const n = frame.numbers;
      // Copied into the sandbox's own memory: exactly the numbers' bytes, even when they are a view of a bigger buffer.
      const buf = ctx.newArrayBuffer(n.byteOffset === 0 && n.byteLength === n.buffer.byteLength ? n.buffer : n.slice().buffer);
      const extras = ctx.newString(frame.extras);
      const r = run(ctx, this.meter, () => ctx.callFunction(entry, ctx.undefined, buf, extras));
      buf.dispose();
      extras.dispose();
      return r.ok ? readResult(r.text) : r;
    } catch (e) {
      return { ok: false, error: { kind: 'throw', message: e instanceof Error ? e.message : String(e) } };
    }
  }
}

interface Entries {
  layout: QuickJSHandle;
  setup: QuickJSHandle;
  tick: QuickJSHandle;
  inspect: QuickJSHandle;
}

/** Limits on what one tick may hand back, whatever the script did to its own globals. */
const MAX_WRITES = 1000;
const MAX_LOGS = 5;
const MAX_LOG_CHARS = 300;
const MAX_MARKS = 4;

/** Checks the shape of a tick's output. Anything malformed is the script's error, never the host's. */
function readResult(text: string): ScriptResult {
  const bad: ScriptResult = { ok: false, error: { kind: 'throw', message: 'the script broke its own output (did it replace JSON or a built-in?)' } };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad;
  }
  const o = raw as { writes?: unknown; logs?: unknown; marks?: unknown } | null;
  if (!o || !Array.isArray(o.writes) || !Array.isArray(o.logs) || !Array.isArray(o.marks)) return bad;
  const writes: ScriptWrite[] = [];
  for (const w of o.writes.slice(0, MAX_WRITES)) {
    if (!Array.isArray(w) || typeof w[0] !== 'string' || typeof w[1] !== 'string' || typeof w[2] !== 'number') return bad;
    if (Number.isFinite(w[2])) writes.push({ target: w[0].slice(0, 100), channel: w[1].slice(0, 100), value: w[2] });
  }
  const logs: string[] = [];
  for (const l of o.logs.slice(0, MAX_LOGS)) {
    if (typeof l !== 'string') return bad;
    logs.push(l.slice(0, MAX_LOG_CHARS));
  }
  const marks: ScriptMark[] = [];
  for (const m of o.marks.slice(0, MAX_MARKS)) {
    if (!Array.isArray(m) || typeof m[0] !== 'number' || typeof m[1] !== 'number') return bad;
    if (!Number.isFinite(m[0]) || !Number.isFinite(m[1])) continue;
    marks.push({ x: m[0], y: m[1], ...(typeof m[2] === 'string' && m[2] !== '' ? { label: m[2].slice(0, 40) } : {}) });
  }
  return { ok: true, writes, logs, marks };
}

type RunResult = { ok: true; text: string } | { ok: false; error: ScriptError };

/** Runs an eval or call, turning QuickJS results into plain data and every failure into a ScriptError. */
function run(ctx: QuickJSContext, meter: Meter, go: () => ReturnType<QuickJSContext['evalCode']>, isUserCode = false): RunResult {
  let result: ReturnType<QuickJSContext['evalCode']>;
  try {
    result = go();
  } catch (e) {
    // Only an engine-level failure reaches here (the host's own stack or memory); the instance is disposed after.
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /call stack/i.test(message) ? { kind: 'stack', message: 'recursed too deep (stack overflow)' } : { kind: 'memory', message } };
  }
  if (result.error) {
    const err = dumpError(ctx, result.error);
    result.error.dispose();
    return { ok: false, error: classify(err, meter, isUserCode) };
  }
  const value = result.value;
  const text = ctx.typeof(value) === 'string' ? ctx.getString(value) : '';
  value.dispose();
  return { ok: true, text };
}

function dumpError(ctx: QuickJSContext, handle: QuickJSHandle): { name: string; message: string; stack: string } {
  const d = ctx.dump(handle) as unknown;
  if (d && typeof d === 'object') {
    const o = d as { name?: unknown; message?: unknown; stack?: unknown };
    return { name: String(o.name ?? 'Error'), message: String(o.message ?? ''), stack: String(o.stack ?? '') };
  }
  return { name: 'Error', message: String(d), stack: '' };
}

function classify(err: { name: string; message: string; stack: string }, meter: Meter, isUserCode: boolean): ScriptError {
  if (meter.tripped || err.message === 'interrupted') return { kind: 'budget', message: 'ran too long for one tick (an endless loop?)' };
  if (err.message.includes('out of memory')) return { kind: 'memory', message: 'used too much memory' };
  if (err.message.includes('stack overflow')) return { kind: 'stack', message: 'recursed too deep (stack overflow)' };
  const where = /:(\d+)(?::(\d+))?/.exec(err.stack);
  const line = where ? ` (line ${where[1]})` : '';
  if (isUserCode && err.name === 'SyntaxError') return { kind: 'compile', message: `${err.name}: ${err.message}${line}` };
  return { kind: 'throw', message: `${err.name}: ${err.message}${line}` };
}
