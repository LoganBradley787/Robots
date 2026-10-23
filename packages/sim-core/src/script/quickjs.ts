import { DefaultIntrinsics, newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSSyncVariant } from 'quickjs-emscripten-core';
import { Prng } from '../rng/Prng';
import type { ScriptFrame } from './frame';
import { PRELUDE } from './prelude';
import { readScanOptions, type ScanOptions } from './scanOptions';
import { DEFAULT_LIMITS, type CompileOptions, type CompileResult, type ParamSpec, type ScriptError, type ScriptHost, type ScriptInstance, type ScriptLimits, type ScriptMark, type ScriptResult, type ScriptServices, type ScriptWrite, SLEEP_MAX } from './types';

/** Global code (the user's top level, and `param()` calls) gets a few ticks' worth of budget. */
const COMPILE_BUDGET_TICKS = 4;

/**
 * The QuickJS backend (`08`, `docs/research/script-sandbox.md`). The caller passes the variant, so sim-core never
 * picks a browser or Node build: the app passes the single-file browser build, Node the wasm-file build; both are
 * the same engine. One runtime per script: its own memory limit, interrupt counter, and crash blast radius.
 */
export async function createQuickJsHost(variant: QuickJSSyncVariant): Promise<ScriptHost> {
  const module = await newQuickJSWASMModuleFromVariant(variant);
  const stack = new StackBase(() => module.newRuntime());
  return {
    compile(source: string, opts: CompileOptions): CompileResult {
      const limits = opts.limits ?? DEFAULT_LIMITS;
      const runtime = module.newRuntime();
      const handles: QuickJSHandle[] = [];
      let ctx: QuickJSContext | undefined;
      const fail = (error: ScriptError): CompileResult => {
        let freed = true;
        for (const h of handles) freed = safely(() => h.dispose()) && freed;
        if (ctx) freed = safely(() => ctx?.dispose()) && freed;
        freed = safely(() => runtime.dispose()) && freed;
        // A failed free aborts inside the engine and leaves the wasm stack pointer lower (`StackBase`).
        if (!freed) safely(() => stack.moved());
        return { ok: false, error };
      };
      try {
        runtime.setMemoryLimit(limits.memoryBytes);
        const meter = new Meter(runtime, new StackGuard(runtime, stack, limits.stackBytes));
        // No Date at all: sim time comes in through `time`.
        ctx = runtime.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } });
        const c = ctx;
        const seed = new Prng(opts.seed >>> 0).state();
        // Host calls (M8): the prelude takes them and deletes the global, so only its capped wrappers reach them.
        const services: { current?: ScriptServices } = {};
        // The prelude hands options as JSON text ('' for none); a line starting with '!' says what is wrong with them.
        const scan = c.newFunction('scan', (idHandle, optsHandle) => {
          const id = c.typeof(idHandle) === 'number' ? c.getNumber(idHandle) : Number.NaN;
          const now = services.current;
          if (!now || !Number.isInteger(id)) return c.newString('null');
          const text = optsHandle !== undefined && c.typeof(optsHandle) === 'string' ? c.getString(optsHandle) : '';
          const opts = text === '' ? {} : readScanText(text);
          if (typeof opts === 'string') return c.newString(`!${opts}`);
          return c.newString(now.scanJson ? now.scanJson(id, opts) : JSON.stringify(now.scan(id, opts) ?? null));
        });
        c.setProp(c.global, '__scan', scan);
        scan.dispose();
        const send = c.newFunction('send', (toHandle, jsonHandle) => {
          // Once the script has gone past its stack nothing more of it reaches the world, even if it caught the error.
          if (meter.guard.touched()) return c.newString('false');
          if (c.typeof(toHandle) !== 'string' || c.typeof(jsonHandle) !== 'string') return c.newString('false');
          const ok = services.current?.send(c.getString(toHandle), c.getString(jsonHandle)) ?? false;
          return c.newString(ok ? 'true' : 'false');
        });
        c.setProp(c.global, '__send', send);
        send.dispose();
        const setup = `var __seed = ${JSON.stringify([...seed])}; var __params = ${JSON.stringify(opts.params ?? {})}; var __inspect = ${opts.inspect === true}; var __arena = ${opts.arena ? JSON.stringify({ x: opts.arena.x, y: opts.arena.y }) : 'null'};\n${PRELUDE}`;
        meter.arm(limits.budgetPerTick * COMPILE_BUDGET_TICKS);
        meter.guard.arm();
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
        const entries = { layout: fn('layout'), patch: fn('patch'), partSpecs: fn('partSpecs'), setup: fn('setup'), tick: fn('tick'), specs: fn('specs'), hasTick: fn('hasTick'), inspect: fn('inspect') };
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
        // Anything the engine throws at the host (not a script error) must not escape into the world. It also left the
        // wasm stack pointer lower.
        safely(() => stack.moved());
        return fail({ kind: 'throw', message: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}

/** `scan()` options as the prelude sends them: JSON text, at most 4 KB. */
function readScanText(text: string): ScanOptions | string {
  if (text.length > 4096) return 'scan(): the options are too long (4 KB at most)';
  try {
    return readScanOptions(JSON.parse(text));
  } catch {
    return 'scan(): the options could not be read';
  }
}

/**
 * Disposal can itself fail (QuickJS asserts on objects a native stack overflow left behind); never let it escape.
 * Returns whether `fn` ran without throwing.
 */
function safely(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    // The runtime is abandoned either way; a leak beats a crashed world.
    return false;
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

/**
 * Counts interrupt-handler calls and stops the script past its budget. Counting, never wall clock. It also stops a
 * script that has overflowed its stack and caught the error: the interrupt cannot be caught.
 */
class Meter {
  private calls = 0;
  private budget = 0;
  tripped = false;
  readonly guard: StackGuard;

  constructor(runtime: QuickJSRuntime, guard: StackGuard) {
    this.guard = guard;
    runtime.setInterruptHandler(() => {
      this.calls++;
      if (guard.touched()) return true;
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

/**
 * Stack overflow is always fatal (review D2). Two things can stop deep recursion, and they used to end differently:
 * QuickJS's own check throws an InternalError the script can catch and carry on from; the host's own stack running
 * out throws through the engine and stops the script. Which comes first depended on how deep the host's stack
 * already was and how big it is, so one replay could end two ways.
 *
 * The script's stack (QuickJS's C stack, in the wasm memory) is the same on every host for the same calls: it does
 * not depend on the host's stack. So the host marks the stack's last part, the guard: `GUARD_BYTES` past
 * `stackBytes`, plus `BELOW_BYTES` past QuickJS's own limit (its error is built there). Before each call into the
 * script it fills the guard with a known word; after the call, at every interrupt, and in `send` it looks whether
 * any word changed. One changed word means the script went past `stackBytes`: the interrupt (which cannot be
 * caught) stops it, `send` does nothing, and the call's result is a stack crash whatever the script did with the
 * error. QuickJS's own limit (`stackBytes + GUARD_BYTES`) is a backstop that also writes the guard when it throws.
 * A function with more than about 1000 locals and temporaries could step over the guard; then QuickJS's error is
 * catchable, but the same on every host.
 *
 * `stackBytes` is small (`DEFAULT_LIMITS`), so QuickJS stops recursion through script functions long before the
 * host's own stack runs out, even from a deep host stack (`stackOverflow.test.ts`). Nesting that QuickJS walks in
 * C (deeply nested source for `eval`, `JSON.stringify` of an array nested thousands deep) uses far more host stack
 * per level and can still run it out first: that is the same stack crash, but how deep it gets can differ by host.
 */
const GUARD_BYTES = 8 * 1024;
const BELOW_BYTES = 4 * 1024;
const CANARY = 0x5ca1ab1e;
/** How far into QuickJS's runtime struct to look for its stack fields. */
const STRUCT_WORDS = 256;
/** How much wasm stack host stack overflows may use up before scripts stop running (see `StackBase`). */
const MAX_DRIFT_BYTES = 1024 * 1024;

/** What the guard reads from a runtime: QuickJS's own pointer to it and the wasm memory. Not public API. */
interface RuntimeInternals {
  rt: { value: number };
  module: { HEAPU8: Uint8Array };
}

function internals(runtime: QuickJSRuntime): RuntimeInternals {
  return runtime as unknown as RuntimeInternals;
}

/** The wasm memory as words. It can grow, which replaces its buffer, so a kept view is checked first. */
function wordsOf(runtime: QuickJSRuntime, kept?: Uint32Array): Uint32Array {
  const buffer = internals(runtime).module.HEAPU8.buffer;
  return kept?.buffer === buffer ? kept : new Uint32Array(buffer);
}

/**
 * Where the wasm stack starts for a call from the host, shared by every script of one host (they share one wasm
 * memory). QuickJS takes it once, when a runtime is made. But when the host's own stack runs out inside the engine,
 * the error unwinds past the code that would put the wasm stack pointer back, so every later call starts lower:
 * left alone, every script made before would lose that much of its stack, and on another host (where the host's
 * stack did not run out) it would not. So each call sets the runtime's stack fields from here, and after such an
 * error the host measures again with a new runtime. Each one uses up some wasm stack for good (at most
 * `stackBytes + GUARD_BYTES`); past `MAX_DRIFT_BYTES` scripts stop rather than run into the wasm memory below it.
 */
class StackBase {
  /** The byte offset of `stack_size` in QuickJS's runtime struct; `stack_top` and `stack_limit` follow it. */
  readonly field: number;
  top: number;
  private readonly first: number;
  private readonly newRuntime: () => QuickJSRuntime;

  constructor(newRuntime: () => QuickJSRuntime) {
    this.newRuntime = newRuntime;
    this.field = this.find();
    this.top = this.measure();
    this.first = this.top;
  }

  get usedUp(): boolean {
    return this.first - this.top > MAX_DRIFT_BYTES;
  }

  /**
   * After anything thrown through the engine: the host's stack running out, and also an abort while freeing a
   * runtime it ran out in (QuickJS's assertion leaves the pointer 16 bytes lower), or any other engine-level error.
   */
  moved(): void {
    this.top = this.measure();
  }

  private measure(): number {
    const runtime = this.newRuntime();
    try {
      runtime.setMaxStackSize(64 * 1024);
      return wordsOf(runtime)[((internals(runtime).rt.value + this.field) >>> 2) + 1] ?? 0;
    } finally {
      safely(() => runtime.dispose());
    }
  }

  /**
   * A word that equals the size just set, followed by two words (top and limit) that differ by it, is the place;
   * checked with a second size. Throws when it is not found (a quickjs-emscripten upgrade that moved it): scripts
   * must not run without the guard.
   */
  private find(): number {
    const runtime = this.newRuntime();
    try {
      const at = (size: number): number[] => {
        runtime.setMaxStackSize(size);
        const m = wordsOf(runtime);
        const base = internals(runtime).rt.value >>> 2;
        const found: number[] = [];
        for (let i = base; i < base + STRUCT_WORDS; i++) {
          if (m[i] === size && ((m[i + 1] ?? 0) - (m[i + 2] ?? 0)) >>> 0 === size) found.push((i - base) * 4);
        }
        return found;
      };
      const a = at(64 * 1024 + 16);
      const b = at(96 * 1024 + 32);
      const offset = a.find((o) => b.includes(o));
      if (offset === undefined) throw new Error('the script sandbox could not find QuickJS stack limit (did quickjs-emscripten change?)');
      return offset;
    } finally {
      safely(() => runtime.dispose());
    }
  }
}

/** The guard words past a script's stack limit. See the comment above `GUARD_BYTES`. */
class StackGuard {
  readonly base: StackBase;
  private readonly runtime: QuickJSRuntime;
  private readonly cap: number;
  private view: Uint32Array | undefined;
  private lo = 0;
  private hi = 0;

  constructor(runtime: QuickJSRuntime, base: StackBase, stackBytes: number) {
    this.runtime = runtime;
    this.base = base;
    this.cap = stackBytes + GUARD_BYTES;
    runtime.setMaxStackSize(this.cap);
  }

  /** Sets QuickJS's limit from where the wasm stack starts now and fills the guard. Before each call into the script. */
  arm(): void {
    const m = this.words();
    const at = (internals(this.runtime).rt.value + this.base.field) >>> 2;
    const limit = this.base.top - this.cap;
    m[at + 1] = this.base.top;
    m[at + 2] = limit;
    this.lo = (limit - BELOW_BYTES) >>> 2;
    this.hi = (limit + GUARD_BYTES) >>> 2;
    m.fill(CANARY, this.lo, this.hi);
  }

  /** Whether the script's stack has reached the guard since `arm()`. */
  touched(): boolean {
    const m = this.words();
    for (let i = this.lo; i < this.hi; i++) if (m[i] !== CANARY) return true;
    return false;
  }

  private words(): Uint32Array {
    this.view = wordsOf(this.runtime, this.view);
    return this.view;
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
  /** The layout this script last read (M9); a frame with another id sends its layout first, as a patch on this one when it has one. */
  private layoutId: number | undefined;
  /** The part specs this script was last sent (M16, `ScriptLayout.specs`): the world's is one text, so this is sent once. */
  private specsSeen: string | undefined;

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
    let freed = true;
    for (const h of this.handles) freed = safely(() => h.dispose()) && freed;
    freed = safely(() => this.ctx.dispose()) && freed;
    freed = safely(() => this.runtime.dispose()) && freed;
    // A failed free aborts inside the engine and leaves the wasm stack pointer lower (`StackBase`).
    if (!freed) safely(() => this.meter.guard.base.moved());
  }

  private call(entry: QuickJSHandle, frame: ScriptFrame, services?: ScriptServices): ScriptResult {
    if (this.disposed) return { ok: false, error: { kind: 'throw', message: 'script was stopped' } };
    const ctx = this.ctx;
    if (services) this.services.current = services;
    else delete this.services.current;
    try {
      this.meter.arm(this.limits.budgetPerTick);
      if (frame.layout.id !== this.layoutId) {
        // The part types' static numbers first (M16), when they are not the ones this script holds: the layout's parts take their `spec` from them.
        const specs = frame.layout.specs;
        if (specs !== undefined && specs !== this.specsSeen) {
          const text = ctx.newString(specs);
          const r = run(ctx, this.meter, () => ctx.callFunction(this.entries.partSpecs, ctx.undefined, text));
          text.dispose();
          if (!r.ok) return r;
          this.specsSeen = specs;
        }
        // A patch on the layout this script holds when there is one, else the whole layout.
        const patch = frame.layout.patch !== undefined && frame.layout.patch.from === this.layoutId ? frame.layout.patch.json : undefined;
        const text = ctx.newString(patch ?? frame.layout.json);
        const r = run(ctx, this.meter, () => ctx.callFunction(patch === undefined ? this.entries.layout : this.entries.patch, ctx.undefined, text));
        text.dispose();
        if (!r.ok) return r;
        this.layoutId = frame.layout.id;
      }
      const n = frame.numbers;
      // Copied into the sandbox's own memory: exactly the numbers' bytes, even when they are a view of a bigger buffer.
      const buf = ctx.newArrayBuffer(n.byteOffset === 0 && n.byteLength === n.buffer.byteLength ? n.buffer : n.slice().buffer);
      const extras = ctx.newString(frame.extras);
      const c = frame.contacts;
      const contacts = c === undefined ? undefined : ctx.newArrayBuffer(c.byteOffset === 0 && c.byteLength === c.buffer.byteLength ? c.buffer : c.slice().buffer);
      const r = run(ctx, this.meter, () => ctx.callFunction(entry, ctx.undefined, buf, extras, contacts ?? ctx.undefined));
      buf.dispose();
      extras.dispose();
      contacts?.dispose();
      return r.ok ? readResult(r.text) : r;
    } catch (e) {
      // An engine-level error outside `run` (copying the inputs in) moves the wasm stack pointer the same way.
      safely(() => this.meter.guard.base.moved());
      return { ok: false, error: { kind: 'throw', message: e instanceof Error ? e.message : String(e) } };
    }
  }
}

interface Entries {
  layout: QuickJSHandle;
  patch: QuickJSHandle;
  partSpecs: QuickJSHandle;
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
  const o = raw as { writes?: unknown; logs?: unknown; marks?: unknown; keys?: unknown; sleep?: unknown } | null;
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
  // Keys it asked about (M16): plain strings only, kept short; anything else is left out, not an error.
  const keys = Array.isArray(o.keys) ? o.keys.slice(0, 16).filter((k): k is string => typeof k === 'string').map((k) => k.slice(0, 20)) : [];
  // Ticks it asked to sleep (`sleep(n)`): a whole number from 1 to SLEEP_MAX, anything else none.
  const sleep = typeof o.sleep === 'number' && Number.isInteger(o.sleep) && o.sleep > 0 ? Math.min(SLEEP_MAX, o.sleep) : 0;
  return { ok: true, writes, logs, marks, ...(keys.length > 0 ? { keys } : {}), ...(sleep > 0 ? { sleep } : {}) };
}

type RunResult = { ok: true; text: string } | { ok: false; error: ScriptError };

const stackError = (): ScriptError => ({ kind: 'stack', message: 'recursed too deep (stack overflow)' });

/** Runs an eval or call, turning QuickJS results into plain data and every failure into a ScriptError. */
function run(ctx: QuickJSContext, meter: Meter, go: () => ReturnType<QuickJSContext['evalCode']>, isUserCode = false): RunResult {
  const guard = meter.guard;
  if (guard.base.usedUp) return { ok: false, error: { kind: 'stack', message: 'too many scripts ran the stack out in this session: reload to run scripts again' } };
  guard.arm();
  let result: ReturnType<QuickJSContext['evalCode']>;
  try {
    result = go();
  } catch (e) {
    // Only an engine-level failure reaches here (the host's own stack or memory); the instance is disposed after.
    // Any error thrown through the engine skips the code that puts the wasm stack pointer back, so measure again.
    const message = e instanceof Error ? e.message : String(e);
    const stack = /call stack/i.test(message);
    safely(() => guard.base.moved());
    return { ok: false, error: stack || guard.touched() ? stackError() : { kind: 'memory', message } };
  }
  // Past its stack is a crash even when the script caught the error and carried on (review D2).
  if (guard.touched()) {
    safely(() => (result.error ?? result.value).dispose());
    return { ok: false, error: stackError() };
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
  if (err.message.includes('stack overflow')) return stackError();
  const where = /:(\d+)(?::(\d+))?/.exec(err.stack);
  const line = where ? ` (line ${where[1]})` : '';
  if (isUserCode && err.name === 'SyntaxError') return { kind: 'compile', message: `${err.name}: ${err.message}${line}` };
  return { kind: 'throw', message: `${err.name}: ${err.message}${line}` };
}
