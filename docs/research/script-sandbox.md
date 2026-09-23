# Script sandbox research: running user robot scripts safely

Date: 2026-09-22. Scope: browser (Vite, TypeScript) plus a Node headless runner. Facts were verified against npm, GitHub, MDN and a local spike (Node 24.4.1, quickjs-emscripten 0.32.0; browser numbers from Chrome 152 on this Mac). Spike code lived in the scratchpad and is not committed.

## Requirements recap
- Per-tick budget with interruption that the script cannot catch; a crash marks the robot, never the game.
- No access to host globals, DOM or network.
- Deterministic normal execution; ideally a deterministic interruption point too.
- Same runtime in browser and Node; later hundreds of headless sims.
- Persistent per-robot state and declared tunable params.
- 10 robots at 60 Hz with total script overhead well under 2 ms per tick.

## A. quickjs-emscripten (QuickJS compiled to WASM)

Facts
- Latest: quickjs-emscripten 0.32.0, published 2026-02-16, engines node >=16 (https://registry.npmjs.org/quickjs-emscripten/latest). Bundles QuickJS 2025-09-13 and quickjs-ng v0.12.1, built with Emscripten 5.0.1 (https://github.com/justjake/quickjs-emscripten/blob/main/CHANGELOG.md).
- Variants: `@jitl/quickjs-wasmfile-{debug,release}-{sync,asyncify}`, `@jitl/quickjs-ng-wasmfile-{debug,release}-{sync,asyncify}`, `@jitl/quickjs-singlefile-{cjs,mjs,browser}-*` (WASM embedded in JS) and an asm.js fallback (https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten-core/README.md). Use `quickjs-emscripten-core` plus one variant so the bundle does not carry all four defaults.
- Sizes: release-sync `.wasm` is 503 KB on disk (package unpacked 650 KB); quickjs-ng release-sync unpacked 676 KB; release-asyncify unpacked 1.2 MB. Asyncify is documented as 2x the size and about 40% of sync speed; not needed here because the tick API is synchronous.
- Browser and Node: one package with export conditions for browser ESM, Node ESM and CJS; Vite is listed as supported; restricted hosts load the WASM through `newVariant` (README above). The spike confirmed `process`, `fetch` and `setTimeout` are all `undefined` inside the VM.

Interrupt handler, verified against engine source
- API: `runtime.setInterruptHandler(cb)`; when `cb` returns true the engine throws `InternalError: interrupted`. `shouldInterruptAfterDeadline(Date.now() + ms)` is a wall-clock helper on the same hook (https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten-core/classes/QuickJSRuntime.md).
- Engine: `#define JS_INTERRUPT_COUNTER_INIT 10000`; `js_poll_interrupts` decrements a per-context counter and calls the handler when it reaches zero, then resets it (https://github.com/bellard/quickjs/blob/master/quickjs.c, search `js_poll_interrupts`). Poll sites: the `OP_goto` family (loop back-edges), taken `OP_if_true`/`OP_if_false`, entry of `JS_CallInternal` and `JS_CallConstructorInternal`, plus internal loops (prototype walks, for-in, Proxy chains). quickjs-ng adds polls inside Array.prototype every/reduce/includes/indexOf/lastIndexOf/find (https://github.com/quickjs-ng/quickjs/blob/master/quickjs.c).
- The handler therefore fires on executed bytecode, not on time. Counting invocations is a deterministic budget with a granularity of 10,000 poll points.
- Spike: `while(true){}` with budget 5 was interrupted after exactly 5 handler calls in two runs; a fixed 123,456-iteration loop produced 25 calls in two runs; adding an `if` inside the loop changed that to 38 (count depends on branch shape, still reproducible). One poll interval of an empty loop took about 24 us, so a budget of N handler calls bounds worst-case time to roughly N x 24 us.
- Caveat: the counter is per context and is not reset between `callFunction` calls, so the phase carries over from tick to tick. Still deterministic given identical history from a fresh context, which replays have.
- The interrupt exception is flagged uncatchable (`JS_SetUncatchableException` in the same source), so user `try/catch` cannot swallow it. Spike confirmed the context stays usable afterwards.

Memory and stack
- `runtime.setMemoryLimit(bytes)` and `runtime.setMaxStackSize(bytes)` (QuickJSRuntime docs above). Spike: an unbounded allocation loop under a 4 MB limit threw `InternalError: out of memory` and the context still evaluated `2+2` afterwards; unbounded recursion under 256 KB threw `InternalError: stack overflow`.
- Older reports show VMs wedged after OOM (https://github.com/justjake/quickjs-emscripten/issues/30), so treat any crash as "dispose runtime, recreate from source and saved state".
- Handles wrap C pointers and must be disposed or memory leaks inside the VM (https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten-core/classes/QuickJSContext.md). Keep handles inside the host wrapper only.

Marshaling cost per tick (spike, 8 sensors in, 8 outputs out)
- Handles path (`newObject`/`newArray`/`newNumber`/`setProp` in, `callFunction`, `getProp`/`getNumber` out): 6.0 us per robot per tick.
- JSON path (`newString(JSON.stringify(in))`, script does `JSON.parse` and `JSON.stringify`, host `getString`): 8.0 us.
- With a counting interrupt handler installed: no measurable change (6.0 us). 10 robots on the handles path: 57 us per tick total, about 3% of the 2 ms budget.
- External data point: Rivet measured 0.4 ms per no-work call on quickjs-emscripten 0.32.0 while creating a fresh context per call, and V8 3 to 12x faster on compute (https://rivet.dev/secure-exec/docs/benchmarks/). Conclusion: keep contexts alive across ticks; never re-eval per tick.
- Cheaper still: keep one persistent `api` object handle in the context and `setProp` only the numbers that changed.

Determinism notes
- `Math.random` is seeded from `gettimeofday` at context creation and `Date.now` reads host time (quickjs.c, `js_math_random`; spike showed different values across processes). Both are ordinary properties: the host prelude must replace `Math.random` with a seeded PRNG and `Date.now`/`Date` with sim time, then freeze them.
- The same WASM binary runs in browser and Node, so engine semantics are identical on both: the strongest parity story of all options.

Scorecard
- Isolation strong (separate WASM linear memory, no host objects reachable). Determinism yes, including the interruption point. Interruptibility yes, uncatchable, bytecode-based. Parity: one package. Marshaling 6 us/tick. Bundle about 500 KB WASM, lazy-loadable. Complexity low to medium (handle discipline). Maintenance: active (0.32.0, Feb 2026), one primary maintainer, both upstream engines alive.

## B. Web Worker isolation

Facts
- `Worker.terminate()` stops the worker at once with no chance to finish (https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate).
- `Atomics.wait` throws `TypeError` on the browser main thread; only `Atomics.waitAsync` is allowed there (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/wait).
- SharedArrayBuffer requires cross-origin isolation: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (https://web.dev/articles/cross-origin-isolation-guide). Vite dev uses `server.headers`; COEP can break the HMR websocket and third-party embeds (https://github.com/vitejs/vite/issues/16536).
- Structured clone: payloads up to 10 KiB stay inside a frame budget on every tested device (https://surma.dev/things/is-postmessage-slow/).
- Measured in Chrome 152: single-worker round trip 12 us; 10-worker fan-out with await-all 48 us; `new Worker` to first reply median 3.1 ms (max 9 ms); hang, terminate, respawn about 5 ms plus whatever detection delay you choose.

Analysis
- Latency is fine; the structural problem is that the main thread cannot wait. The physics step becomes `await Promise.all(...)`, so a fixed tick no longer runs synchronously inside one rAF callback, and replay and headless loops become async as well.
- SAB plus an `Atomics.load` spin keeps the loop synchronous but burns CPU and still needs COOP/COEP on the production host. The clean SAB design moves the whole simulation into a worker (where `Atomics.wait` is legal) and renders from the main thread: a large architecture change.
- The timeout is wall-clock, so interruption is nondeterministic by construction (a GC pause or a throttled background tab can kill a healthy script). Normal execution stays deterministic if Date and Math.random are shimmed.
- Isolation: no DOM, but a Worker keeps `fetch`, `WebSocket`, `importScripts` and IndexedDB. Deleting globals is porous; a page CSP (`connect-src`) helps but also constrains the game itself.
- Recovery: terminate destroys script state, so the host must hold a serialized copy of state and params, respawn (about 3 ms), re-evaluate the script and restore. Node needs a separate `worker_threads` adapter (`parentPort`, different lifecycle).
- Scorecard: isolation medium; determinism partial (no deterministic interruption); interruptibility strong (kills even regex backtracking); parity needs two adapters; marshaling 12 to 50 us; bundle 0; complexity medium to high (async tick loop); maintenance low risk (platform APIs).

## C. Main-thread execution with source instrumentation (acorn, optional SES)

Facts
- acorn 8.18.0 (2026-07-28; ESM dist 233 KB unminified), acorn-walk 8.3.5, astring 1.9.0 for codegen, magic-string 1.4.1 for in-place edits (https://registry.npmjs.org/acorn/latest, https://registry.npmjs.org/astring/latest, https://registry.npmjs.org/magic-string/latest).
- ses 2.3.0 (2026-08-13), minified `ses.umd.min.js` 238 KB (https://registry.npmjs.org/ses/latest, https://unpkg.com/ses@2.3.0/dist/ses.umd.min.js). `lockdown()` freezes all intrinsics realm-wide; `Compartment` gives each guest its own globalThis and `evaluate(code)` while sharing the frozen intrinsics (https://github.com/endojs/endo/blob/master/packages/ses/README.md).
- SES states it cannot mitigate availability attacks: a guest "can execute for an indefinite amount of time" and "allocate arbitrary amounts of memory" because compartments share one agent (same README).
- In current SES, `Math.random`, `Date.now` and `new Date()` are disabled inside compartments unless endowed; the `dateTaming`/`mathTaming` options are deprecated (https://github.com/endojs/endo/blob/master/packages/ses/docs/guide.md). Good for determinism.

Analysis
- Transform: parse, insert a `__tick()` call at the start of every loop body (for, while, do, for-of, for-in) and every function body; the counter throws a sentinel once past budget. Roughly 200 to 400 lines with acorn-walk plus magic-string. Deterministic by construction.
- Holes the transform cannot close: catastrophic regex backtracking, `'x'.repeat(2**29)`, `new Array(1e9).fill(0)` (a real V8 OOM aborts the tab, uncatchable), long built-in iterations with no user callback, and `Function`/`eval` unless denied. The sentinel is also catchable: `try { for(;;){} } catch {}` swallows it unless the transform rewrites every `catch` to rethrow the sentinel. So "never freeze" is best effort, not guaranteed.
- Isolation without SES: `new Function` inside a `with(proxy)` shim leaks the real realm through any intrinsic, for example `[].constructor.constructor('return this')()`. Not acceptable.
- Isolation with SES: strong object-capability isolation, but `lockdown()` is realm-wide. It freezes intrinsics for the game engine and every library, must run before any other module, and can break code that mutates prototypes or relies on `Error` internals. The physics engine and the Vite HMR client would need to be tested under lockdown before committing.
- Node and browser: identical code path (SES supports both). Marshaling near zero (plain objects). Performance: fastest possible (V8 JIT) plus one counter increment per loop iteration.
- Scorecard: isolation strong only with SES; determinism yes; interruptibility porous; parity excellent; bundle 240 KB SES plus about 230 KB acorn (acorn only needs to run at compile time); complexity medium; maintenance risk medium (SES compatibility surface is large and app-wide).

## D. Other credible options

- quickjs-wasi 3.6.2 (Vercel Labs, published 2026-09-19): quickjs-ng compiled to WASI, runs in browsers and Node using only the standard `WebAssembly` API, has an interrupt handler, and can snapshot and restore the whole VM (linear memory plus job queue) to a `Uint8Array` (https://github.com/vercel-labs/quickjs-wasi, https://registry.npmjs.org/quickjs-wasi). Snapshots would give exact replay checkpoints and cheap population forking for evolutionary search. Its README says the handler runs "approximately once per JS bytecode instruction"; stock quickjs-ng polls every 10,000 poll points, so verify before relying on that claim. Younger and less used than quickjs-emscripten; 1.5 MB unpacked. Best kept as a second backend behind the same interface.
- JS-Interpreter (Neil Fraser, Apache-2.0): ES5 only, `step()`-driven so budgets are exact and deterministic, full state serialization, but documented as about 200x slower than native (https://neil.fraser.name/software/JS-Interpreter/docs.html, https://github.com/NeilFraser/JS-Interpreter). npm `js-interpreter` 6.0.2 is an unofficial wrapper. ES5 plus that speed makes it a poor fit for user-facing robot scripts.
- sval 0.6.12 (MIT): ES2024 interpreter in JS with a sandbox mode, but no step limit, timeout or interrupt is documented (https://github.com/Siubaak/sval). Not interruptible, so not viable alone.
- isolated-vm 7.0.1: V8 isolates with CPU and memory limits, but a native Node addon with no browser build, so it fails parity (https://registry.npmjs.org/isolated-vm/latest).
- ShadowRealm: TC39 stage 2.7, not shipped in browsers, and it offers neither interruption nor memory limits (https://github.com/tc39/proposal-shadowrealm).
- Boa (Rust engine): WASM playground only, no maintained npm distribution (https://github.com/boa-dev/boa). Not credible for this project today.

## Ranked recommendation

1. A, quickjs-emscripten: `quickjs-emscripten-core` plus `@jitl/quickjs-wasmfile-release-sync` (or the quickjs-ng variant for newer ES features and the extra poll sites in Array built-ins). It is the only option that meets every requirement: uncatchable, bytecode-based, deterministic interruption; memory and stack limits; no host reachability; one package for Vite and Node; 6 us per robot per tick measured.
2. D, quickjs-wasi: same engine family, adds whole-VM snapshots. Adopt as a second backend only if replay checkpoints or population forking turn out to matter.
3. B, Workers: only as a future wrapper around A (QuickJS inside a worker) if scripts must leave the main thread. Not as the sandbox itself: wall-clock interruption, async tick loop, network reachable.
4. C, acorn instrumentation plus SES: fastest and deterministic, but cannot guarantee "never freeze" and `lockdown()` touches the whole app. Reasonable only where WASM is unavailable, or as a test-only fast path.
5. JS-Interpreter and sval: not recommended (ES5 and 200x slowdown, or no interruption).

Design decisions for A
- One WASM module per thread (`newQuickJSWASMModule`), one `QuickJSRuntime` per robot (its own memory limit, interrupt counter and crash blast radius), one context per runtime.
- Budget in handler calls per tick, for example 50 (about 1.2 ms worst case of pure looping, 500,000 poll points). On interrupt mark the robot `crashed: budget`. Also `setMemoryLimit` (for example 16 MB) and `setMaxStackSize` (for example 512 KB).
- At context init evaluate a prelude that replaces `Math.random` with a seeded PRNG (world seed plus robot id) and `Date.now`/`Date` with sim time, then freezes them. Nothing else to remove: QuickJS ships no I/O globals.
- Script contract: user code runs once as global code and must define `tick(api)`; an optional `params = { kp: { default: 2, min: 0, max: 10 } }` is read once after load. State persists naturally as script globals or a `state` object; `getState()` runs `JSON.stringify(state)` inside the VM for saves.
- Per tick: reuse a persistent `api` handle; `setProp` sensor numbers and a key bitmask; `callFunction(tick)`; read a fixed-length output array; dispose temporaries in a `Scope`.
- Headless: same code in Node. For hundreds of sims spawn `worker_threads`, each with its own WASM module and N runtimes.

## Suggested interface boundary (ScriptHost)

```ts
export interface ScriptHost {
  init(): Promise<void>;                       // loads WASM, SES, or nothing
  compile(source: string, opts: ScriptLimits & { seed: number }): CompileResult;
}
export interface ScriptLimits { budgetPerTick: number; memoryBytes: number; stackBytes: number }
export type CompileResult =
  | { ok: true; instance: ScriptInstance; params: Record<string, ParamSpec> }
  | { ok: false; error: ScriptError };
export interface ScriptInstance {
  setParams(values: Record<string, number>): void;
  tick(input: TickInput, out: Float64Array): TickResult;   // synchronous by contract
  getState(): string;                                       // JSON for saves and replay checkpoints
  setState(json: string): void;
  dispose(): void;
}
export interface TickInput { tick: number; dt: number; sensors: Float64Array; keys: number }
export type TickResult = { ok: true } | { ok: false; error: ScriptError };
export interface ScriptError { kind: 'budget' | 'memory' | 'stack' | 'throw' | 'compile'; message: string; stack?: string }
export interface ParamSpec { default: number; min?: number; max?: number; step?: number }
```

- `tick` is synchronous on purpose: the physics loop stays a plain loop in browser and Node. A Worker backend cannot honor this contract, which is deliberate; moving off the main thread is a simulation-level decision, not a per-robot one.
- Backends: `QuickJsScriptHost` (A) first; `QuickJsWasiScriptHost` (D) if snapshots are wanted; `InstrumentedScriptHost` (C) for tests or a dev-mode fast path.
- Keep `ScriptError` uniform so the UI, the replay log and the evolutionary fitness code never learn which backend crashed a robot.
