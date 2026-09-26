# Script Memory Limit Plan

> **For agentic workers:** a self-contained task, separate from the milestones. Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/design/04-control-and-scripting.md` (the sandbox), and `packages/sim-core/src/script/` (all files) first. Tests first, one commit, tree green, no push unless Logan asks. Logan's decision (2026-09-25): plan it now, start it later, possibly in another session.

**Goal:** a robot script's memory limit holds however the script allocates, so one script can never grow the whole tab or process until it dies. A script past its limit crashes with `kind: 'memory'` (like today's big allocations) and the world keeps running.

**Written by:** an Opus 5.5 session, 2026-09-25, from the M9 review's finding.

## The problem (found by the M9 review, older than M9)
- `packages/sim-core/src/script/quickjs.ts` gives each script its own QuickJS runtime with `runtime.setMemoryLimit(limits.memoryBytes)` (`DEFAULT_LIMITS.memoryBytes` is 16 MB, `script/types.ts`).
- A single big allocation trips it: `new Array(5e5)` fails with out of memory, and the script crashes with `kind: 'memory'`.
- Many small ones do not. With `memoryBytes` at 4 MB, this script ran 2000 ticks, kept 40,000 arrays, and the Node process grew by about 356 MB with no error:
  ```js
  var keep = [];
  function tick() { for (var i = 0; i < 20; i++) keep.push(new Array(1000).fill(1)); }
  ```
- Every script's runtime lives in the same WebAssembly module (`quickjs-emscripten-core` 0.32; `@jitl/quickjs-wasmfile-release-sync` in Node, `@jitl/quickjs-singlefile-browser-release-sync` in the browser), so one script can grow the shared heap until the tab or process dies. Only a buggy or hostile script does this; no shipped script comes close.

## Steps
1. **Reproduce** in a test (`packages/sim-core/test/scriptHost.test.ts`), with `limits: { ...DEFAULT_LIMITS, memoryBytes: 4 * 1024 * 1024 }` and the script above, run for a few hundred ticks. Record what `runtime.computeMemoryUsage()` (or `dumpMemoryUsage()`) reports against the limit as it grows, and whether `malloc_size` or `memory_used_size` passes the limit without the runtime refusing.
2. **Find why** the limit is missed. Candidates to check, in order:
   - QuickJS checks `malloc_limit` in `js_def_malloc` only for some paths, or the emscripten build's allocator does not report sizes (`malloc_usable_size`) the way QuickJS's accounting expects, so small blocks are undercounted.
   - Garbage kept alive by the script is legitimately live (it is: `keep` holds it), so the limit should have fired; check whether `setMemoryLimit` is applied to the runtime the script actually runs in, and after `newContext`.
   - The WebAssembly memory grows for other reasons (fragmentation, the host's handles not being disposed): compare the runtime's own count with `module`-level memory.
3. **Fix**, whichever holds:
   - If QuickJS's own count is right but not enforced: after each `setup`/`tick` call, read the runtime's memory use (a counted number, deterministic for the same script and inputs) and crash the script with `kind: 'memory'` past the limit. Deterministic: the same inputs give the same allocations, so replays and the golden hashes hold. Measure its cost per call; it must stay small against the 19 us floor (M9).
   - If the count itself is wrong: the smallest change that makes it right (an allocator setting in how the module is created, or a newer `quickjs-emscripten` variant, researched and recorded in `docs/research/script-sandbox.md`).
4. **Tests:** the script above crashes with `kind: 'memory'` within its limit (give or take the check's granularity), the host keeps working (compile and run another script after), and the shipped scripts are unaffected (all tests pass, golden hashes and parity unchanged).
5. **Measure:** `pnpm sim bench` before and after; record both in `docs/status.md` with the fix.

## Constraints
- sim-core stays pure: no clock, no DOM. Memory checks count, never time.
- The error wording stays as today (`used too much memory`), so the UI and reports need no change.
- Do not raise the limit to hide the problem.
