import { DefaultIntrinsics, newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSSyncVariant } from 'quickjs-emscripten-core';
import { Prng } from '../rng/Prng';
import { PRELUDE } from './prelude';
import { DEFAULT_LIMITS, type CompileOptions, type CompileResult, type ParamSpec, type ScriptError, type ScriptHost, type ScriptInput, type ScriptInstance, type ScriptLimits, type ScriptResult } from './types';

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
      runtime.setMemoryLimit(limits.memoryBytes);
      runtime.setMaxStackSize(limits.stackBytes);
      const meter = new Meter(runtime);
      // No Date at all: sim time comes in through `time`.
      const ctx = runtime.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } });
      const fail = (error: ScriptError): CompileResult => {
        ctx.dispose();
        runtime.dispose();
        return { ok: false, error };
      };
      const seed = new Prng(opts.seed >>> 0).state();
      const setup = `var __seed = ${JSON.stringify([...seed])}; var __params = ${JSON.stringify(opts.params ?? {})};\n${PRELUDE}`;
      meter.arm(limits.budgetPerTick * COMPILE_BUDGET_TICKS);
      const pre = run(ctx, meter, () => ctx.evalCode(setup, 'prelude.js'));
      if (!pre.ok) return fail(pre.error);
      meter.arm(limits.budgetPerTick * COMPILE_BUDGET_TICKS);
      const user = run(ctx, meter, () => ctx.evalCode(source, opts.name), true);
      if (!user.ok) return fail(user.error);
      const specs = readJson(ctx, 'JSON.stringify(__paramSpecs)') as Record<string, ParamSpec> | undefined;
      const hasTick = readJson(ctx, "typeof tick === 'function'") === true;
      if (!hasTick) return fail({ kind: 'compile', message: `${opts.name} does not define function tick()` });
      return { ok: true, instance: new QuickJsInstance(runtime, ctx, meter, limits, specs ?? {}) };
    },
  };
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
  private disposed = false;

  constructor(runtime: QuickJSRuntime, ctx: QuickJSContext, meter: Meter, limits: ScriptLimits, params: Record<string, ParamSpec>) {
    this.runtime = runtime;
    this.ctx = ctx;
    this.meter = meter;
    this.limits = limits;
    this.params = params;
  }

  setup(input: ScriptInput): ScriptResult {
    return this.call('__setup', input);
  }

  tick(input: ScriptInput): ScriptResult {
    return this.call('__tick', input);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ctx.dispose();
    this.runtime.dispose();
  }

  private call(fn: '__setup' | '__tick', input: ScriptInput): ScriptResult {
    if (this.disposed) return { ok: false, error: { kind: 'throw', message: 'script was stopped' } };
    const ctx = this.ctx;
    this.meter.arm(this.limits.budgetPerTick);
    const fnHandle = ctx.getProp(ctx.global, fn);
    const arg = ctx.newString(JSON.stringify(input));
    const r = run(ctx, this.meter, () => ctx.callFunction(fnHandle, ctx.undefined, arg));
    fnHandle.dispose();
    arg.dispose();
    if (!r.ok) return r;
    const out = JSON.parse(r.text) as { writes: [string, string, number][]; logs: string[] };
    return {
      ok: true,
      writes: out.writes.filter((w) => Number.isFinite(w[2])).map(([target, channel, value]) => ({ target, channel, value })),
      logs: out.logs,
    };
  }
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

function readJson(ctx: QuickJSContext, expr: string): unknown {
  const r = ctx.evalCode(expr, 'host.js');
  if (r.error) {
    r.error.dispose();
    return undefined;
  }
  const v = ctx.dump(r.value) as unknown;
  r.value.dispose();
  return typeof v === 'string' && expr.startsWith('JSON.stringify') ? JSON.parse(v) : v;
}
