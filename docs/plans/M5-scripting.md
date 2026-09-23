# M5 Scripting Implementation Plan

> **For agentic workers:** Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/design/04-control-and-scripting.md` (script API, ScriptHost, and "Decisions with Logan before M5"), `08` (script sandbox packaging), and `docs/research/script-sandbox.md` first. Tests first for every pure module, one commit per task (`M5 T<n>: <what>`), tree green at every commit, `docs/status.md` updated at session end.

**Goal:** Robots run JavaScript. A script attached to a robot's core reads exact sensor data and keys, writes channels, and runs every tick in a sandbox that cannot freeze the game. Scripts live in `.js` files next to their blueprint and are edited in the builder. Air drag gives flight a top speed. Done when a hover drone holds altitude with its script, A and D tilt it, and an infinite loop disables the script without freezing the game. Ends at Gate 4 (power and scripts).

**Spec:** `04` (script API, arbitration, ScriptHost, Logan's M5 decisions), `05` (energy the script can read), `07` Q10, Q12, Q15, `08` (packaging), `docs/research/script-sandbox.md` (verified QuickJS facts).

**Written by:** an Opus 5.5 coding session, 2026-09-23, after Logan answered the scripting questions.

## Decisions made in this plan (Claude's call, overturnable at Gate 4)

1. **Air drag** acts on every robot body, per tick: `F = -k * cells * |v| * v` with `k = 0.0025` per cell (quadratic, so slow cars barely notice), plus a small angular drag.
   - Targets: the hopper under full thrust tops out around 60 to 80 m/s, and the car's top speed drops by less than 1 m/s.
   - `k` is one engine constant, applied the same to every cell, and recorded in `03`.
2. **Sandbox** as `08` says:
   - `quickjs-emscripten-core` 0.32.0 with the release-sync variant: `@jitl/quickjs-singlefile-browser-release-sync` in the app, `@jitl/quickjs-wasmfile-release-sync` in Node.
   - `sim-core` exposes `createQuickJsHost(variant)` and never imports a variant itself, so it stays free of DOM and Node.
   - Each script gets its own runtime: a budget of 50 interrupt calls per tick, 16 MB of memory, and 512 KB of stack.
   - A prelude seeds `Math.random` from the world seed and robot id and removes `Date`.
3. **Script contract** (from `04`, trimmed to what M5 needs):
   - Global code runs once. It may call `param(name, default, { min, max })` and must define `tick()`; `setup()` is optional.
   - Inside `tick` the script has `tick`, `dt`, `time`, and `self`:
     - `pos`, `vel`, `angle`, `angVel`: the core's body, exact.
     - `mass`.
     - `energy: { stored, capacity }`.
   - It also has `parts` (id, type, tags, pos, angle, outputs), `keys.down/pressed/released`, `set(target, channel, value)`, `get(target, channel)`, `state`, `log(...)`, `random()`, and `clamp`, `lerp`, `sign`.
   - `world.robots()` waits until something needs it (M6 targeting).
4. **Arbitration** as `04`: a channel that a held key or an on toggle writes ignores the script. Otherwise the script's value wins, else the default. A script reading keys does not create a writer, so a hover script can read A and D while nothing binds them to the propellers.
5. **Lifecycle:**
   - Scripts run only on a robot's active core (the primary core).
   - `enabled` (default on) starts a script at deploy; a `script` binding toggles it with a key.
   - Enabling runs `setup()` with fresh `state`.
   - A throw, budget overrun, memory, or stack error marks the script crashed, disables it, and shows the error in the world. Enabling it again recompiles from source.
   - Script enabled and crashed flags go into the hash. Replays reproduce scripts because the source rides inline in the spawn log.
6. **Files:**
   - A blueprint's `scripts` entry is `{ id, enabled, params, source: { file: "hopper.hover.js" } }`, and the file sits in `blueprints/`.
   - The dev endpoint serves `.js` files there with the same safety rules.
   - The CLI reads them from disk.
   - Before spawning, the app and CLI inline the sources (`resolveScripts`), so the world, replays, and hashes never read files.
   - Save As copies each script to a new file named after the new blueprint.
7. **Builder UI:** a Scripts section in the side panel:
   - Add, remove, and rename a script.
   - An "on at deploy" checkbox.
   - Its params as number fields.
   - A textarea editor that opens large over the canvas, with a monospace font and Tab inserting two spaces.
   - Compile errors show under the editor as you type (a syntax check in the sandbox).
   - Save writes the blueprint and its script files.
   - The Controls panel gains the `script` mode (key toggles script).
8. **World UI:**
   - The keys bar shows a script key lit while its script runs.
   - A crash shows a notice with the error, and a small log panel shows the controlled robot's last `log()` lines, rate limited to 20 per second.
9. **Shipped examples:**
   - `blueprints/drone.json`: core, battery, two propellers, a gyro.
   - `blueprints/drone.hover.js`: holds altitude on H, tilts with A and D, and climbs and sinks with W and S by moving its target height.
   - `blueprints/looper.json`: its script is `while (true) {}`, to prove the budget.

## File structure

```
packages/sim-core/src/physics/PhysicsWorld.ts    + air drag per body in step (forces)
packages/sim-core/src/script/types.ts            ScriptHost, ScriptInstance, ScriptError, ParamSpec, ScriptInput
packages/sim-core/src/script/quickjs.ts          createQuickJsHost(variant): runtime per script, prelude, budget, limits, marshaling
packages/sim-core/src/script/prelude.ts          the in-VM prelude and API shim (plain JS source)
packages/sim-core/src/script/runner.ts           per-robot script state: enable, setup, tick, crash, writes into the script layer
packages/sim-core/src/control/controller.ts      + script layer and arbitration
packages/sim-core/src/blueprint/scripts.ts       resolveScripts(raw, read): inline file sources
packages/sim-core/src/world/World.ts             scripts per robot, sensors, hash, events (scriptCrashed, log)
packages/cli/src/...                             host with the Node variant, resolve files, scripts in run and replay
packages/app/vite-plugins/blueprintStore.ts      .js files in blueprints/
packages/app/src/ui/ScriptsPanel.tsx, ScriptEditor.tsx, ScriptLog.tsx
blueprints/drone.json, drone.hover.js, looper.json, looper.loop.js
```

## Tasks

### T1: air drag
- Tests first:
  - A falling body reaches a terminal speed.
  - The hopper under full thrust tops out in the target range.
  - The car loses less than 1 m/s of top speed.
- `tune` prints hopper top speed.
- Regenerate golden hashes.

### T2: sandbox host (sim-core `script/`)
- Install the packages.
- Tests first, in Node with the wasmfile variant:
  - `tick` runs and returns writes.
  - `while (true) {}` stops with `budget` in both runs, at the same point.
  - A throw gives `throw` with the message.
  - An allocation loop gives `memory`; deep recursion gives `stack`.
  - `Math.random` is seeded and repeats per seed.
  - `Date` and `fetch` are absent.
  - A syntax error gives `compile` with a line number.
  - `param()` specs come back from compile.
- Handles are disposed inside the host only.

### T3: scripts in the world
- Controller gains the script layer.
- The runner enables scripts on deploy and toggles them by binding. Sensors are built from the core body and the energy pool.
- A crash disables the script and emits a `scriptCrashed` event with the error. `log` lines become events.
- The hash includes the flags.
- `World.create` takes an optional `scripts` host. Scripts in a world without one are reported, not silently ignored.
- Tests:
  - A script holds a channel.
  - A held key overrides the script on that channel.
  - A toggle key turns a script on and off, and `setup` runs again.
  - An infinite loop disables only that script; the world keeps stepping.
  - A replay with scripts matches.

### T4: files and validation
- `resolveScripts` (pure, tests first).
- The validator checks script ids, file names, and `script` bindings.
- The dev endpoint serves `.js` files. The CLI resolves from disk.
- Save and Save As write script files (the document flow in `builder/document.ts`, with tests).

### T5: builder UI
- Scripts section and editor, live compile check, params, the `script` binding mode, and Save.

### T6: world UI
- Script keys lit on the keys bar, crash notices, and the log panel.

### T7: examples and done-when
- Ship the drone and its hover script, and the looper.
- Headless tests:
  - With H held, the drone stays within 0.5 m of its target altitude for 20 s.
  - A and D move it sideways and it recovers.
  - The looper's script crashes on its first tick and the drone next to it keeps hovering.
- CLI: `pnpm sim run drone --seconds 20` shows the hover.

### T8: review and Gate 4
- Opus review subagent over the M5 diff; fix findings.
- Browser check: build and edit a script in the builder, deploy the drone, hover, tilt, run it dry, break a script on purpose.
- Update `04`, `07` (Q10 as built), `status.md`; tag `m5`; stop at Gate 4.

## Task dependencies
T1 is independent. T2 then T3. T4 needs T3. T5 needs T4. T6 needs T3. T7 needs T3 and T4. T8 needs all.
