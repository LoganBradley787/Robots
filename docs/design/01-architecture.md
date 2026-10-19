# 01 Architecture

Status: draft, 2026-09-22. Items tagged (Q#) depend on an open question in `07-open-questions.md`.

## What the architecture must serve
- Deterministic simulation (replays now, evolution later).
- The sim runs headless in Node and in the browser from the same code, unchanged.
- Parts are data. The engine has no part-specific code paths.
- The AI hooks (validator, grid layout, headless runner) are first-class and stay green.
- Later phases (AI cores, Claude-authored blueprints, mutation) are additions, not restructures.

## Layering

pnpm workspace with three packages (details in `08-tech-stack.md`):

```
packages/sim-core/   pure TypeScript. Deterministic. No DOM, no PixiJS, no browser globals.
                     Compiled with no DOM types, so any DOM use fails to build.
packages/app/        browser: src/render (PixiJS), src/ui (Preact panels), src/main.ts (game loop, keyboard capture).
packages/cli/        headless runner and replay checker for Node. Imports sim-core only.
```

Dependency rule: `sim-core` imports nothing from the other packages. `app` and `cli` import `sim-core`. Inside `app`, `render` reads sim state each frame and never writes it; `ui` sends commands to the sim and never mutates sim objects.

## Module map inside `packages/sim-core/src/`
- `parts/`: `PartDef` type, the registry, and behavior modules (one file per behavior: thruster, propeller, wheel, decoupler, battery, core, warhead). A behavior implements `init`, `tick`, `onDestroyed`. See `02`.
- `blueprint/`: `BlueprintJson` types, validator, grid layout expansion (ASCII rows to parts), sub-assembly expansion, mirror helper, format migration. See `02`.
- `assembly/`: cell graph, attachment rules (faces), flood fill connectivity, partition into body groups (cut at joint parts). See `03`.
- `physics/`: thin wrapper over Rapier. Creates and destroys bodies from body groups, joints, force application, queries, contact events. Nothing outside this module imports Rapier types.
- `control/`: channels, tags, bindings, input sources, arbitration, per-chunk controller. See `04`.
- `script/`: `ScriptHost` interface plus backends, script API construction. See `04`.
- `resources/`: resource pools (energy first), drain requests, brownout. See `05`.
- `damage/`: health, damage application, explosion model (pluggable), cell removal pipeline. See `03`.
- `world/`: `World`: terrain, robots, chunks, spawn and despawn, tick orchestration, typed event bus.
- `replay/`: input log, state hash, replay runner.
- `metrics/`: collectors for the headless runner (altitude, tilt, distance, energy, parts alive).

## Runtime entities
- `PartDef`: static data for a part type. Loaded once into the registry.
- `Blueprint`: static design. Validated, then expanded (grid, sub-assemblies) into a flat part list.
- `Robot`: a spawned blueprint instance. Keeps the spawn record (which blueprint, when, where) for metrics and cleanup. After a split, a robot owns several chunks.
- `Chunk`: a connected set of `PartInstance`s. Owns a resource pool, a controller (active core or headless latch), and one or more body groups. Chunks are the live unit of control, power, and splitting.
- `BodyGroup`: the part instances that share one rigid body. A chunk with no joint parts is one body group. Each wheel is its own body group joined to its parent group.
- `PartInstance`: a placed part: def, cell, rotation, health, tags, channel state, behavior state.

## Fixed tick (dt = 1/60 s)
1. Input. Each input source is polled once. Produces button states (down, pressed, released) and direct channel writes. Appended to the replay log.
2. Control. For each chunk with an active core: run enabled scripts (script layer), evaluate bindings (manual layer), arbitrate to final channel values. Headless chunks keep their latched values.
3. Behaviors. Each part behavior reads its final channel values, requests resources from its chunk pool, and applies forces or motor targets through `physics/`.
4. Physics step.
5. Damage. Collect contacts and queued damage, apply it, remove dead cells, re-run connectivity on touched chunks, split bodies, fire queued explosions. Loops until no new removals, with a cap.
6. Sensors. Refresh sensor outputs from physics state for the next tick.
7. Bookkeeping. Metrics sample, state hash every N ticks, events flushed to subscribers.

Rendering runs on `requestAnimationFrame` and interpolates between the last two tick states. Time scale is expressed as ticks per frame (0 means paused, single step supported). `dt` never changes. (Q8)

The app's frame loop (`WorldScreen.frame`): the fixed-step accumulator (`FixedStepper`, at most 16 ticks a frame) says how many ticks the frame owes, and `runWithin` steps them until 10 ms of wall time are spent (Gate 10), dropping the rest, so a scene too heavy for the speed asked runs slower instead of dragging the frame rate down. Then views, effects and the UI, then Pixi draws.

**Smooth (2026-10-19, the Sandbox menu, off by default).** Lag is mostly robot scripts, so with Smooth on the app may have slow scripts sit out ticks:
- Before each tick, `ScriptScheduler.plan` (`app/scriptScheduler.ts`, pure) picks the robots whose scripts run. Fair order: those that have waited longest go first (ties in the world's order); each runs if its measured cost (`ScriptCosts`, per robot, from `World.watchScripts`, `04`) fits what is left of the tick's script budget, else it sits out; smaller ones after it may still fit. A robot that has sat out 3 ticks in a row runs whatever it costs (`SMOOTH_FLOOR` 4: every robot's scripts run at least every 4th tick, so a missile never flies blind for long). A robot not measured yet runs. The choice is per robot: a robot's scripts run or sit out together.
- The budget is worked out on the app's clock (`scriptBudget`): Smooth aims for 60 frames a second, one drawn per tick of real time. A frame may spend on the sim a tick (or, in a browser that holds the window to fewer frames, one frame: `FramePace`) less one frame's drawing (measured from the start of `frame` to after Pixi's render) and a 2 ms margin; that is split between the ticks of the window (4 at 4x), and what the rest of a tick takes (physics, behaviors, damage) is taken off. When physics and drawing alone fill the frame the budget is 0, every script runs only at the floor, and the world slows down as it would without Smooth: skipping scripts cannot make physics cheaper.
- With Smooth on, the stepper also catches up at most one tick a frame past the speed asked, and `runWithin` gets the frame's sim budget and does not start a tick it expects to end past it. After a hitch the world runs a little slower instead of stepping a burst of over-budget ticks. Measured in Chrome on an M3 Pro (120 Hz): 100 hovering drones at 1x went from 39 fps and 39 ticks a second to 69 fps and 60 (full speed), scripts running about 1 tick in 3; the Anvil against a lance drone plus a 6 against 6 battle at 4x went from 34 to 38 fps (34 to 63 ticks a second) to 55 to 66 fps (54 to 66), its 10 ms of drawing a frame leaving no room for 4x at 60 fps.
- The engine only takes the list: `World.skipScripts(ids)` for the next tick, logged in the input log as `world.skip` like a key press, so a replay of a Smooth fight reproduces exactly (`04`, Skipped ticks). Off, nothing is logged and nothing changes: every golden hash is the same. A fresh run with Smooth on may not repeat a run before it (the machine's speed decides the skips), but its replay does.

## Determinism rules
- Fixed `dt`. No wall-clock reads inside `sim`.
- One seeded PRNG in `World`. Scripts get a seeded `random()`; `Math.random` and `Date` are unavailable in the sandbox.
- Iterate arrays in creation order. Where order affects floating point sums (resource pools, impulses), sort by stable part ids first.
- One Rapier build everywhere: `@dimforge/rapier2d-deterministic-compat`, the same bytes in browser, tests, and CLI. Bodies and colliders are created and removed in a stable order, because handles are index plus generation and get reused.
- Poses are set through `RigidBodyDesc` at creation, not `setRotation` afterwards (an open Rapier issue reports determinism loss after `setRotation` following a snapshot restore).
- State hashes are computed from the tick, the RNG state, and per-body position and velocity as exact float bits (not quantized: the deterministic build should be bit-identical, and any drift should show at once), never from raw snapshot bytes, which differ across Rapier build variants.
- Script interruption uses an instruction budget where the backend supports it (see `04` and `docs/research/script-sandbox.md`).
- Replay = world file + blueprint set + input log. A CI test simulates, replays, and compares state hashes.
- No host `Math` function the engine may approximate (M16). ECMAScript lets each engine compute `Math.sin`, `cos`, `atan2`, `asin`, `hypot`, `log2`, `pow` and `**` its own way, and they do: Chrome 155's `Math.cos` is correctly rounded, Node 24's is fdlibm (and Node for arm64 fuses fdlibm's multiply-adds, so it differs again in about 1 call in 200), each one unit in the last place apart now and then. That was enough for a fight to part at tick 35 between Chrome and Node. `sim-core` calls its own `sin`, `cos`, `atan`, `atan2`, `asin`, `hypot` and `powInt` from `src/math/fdlibm.ts`: a port of fdlibm (the library V8 ships) written only with `+ - * /`, `Math.sqrt`, `Math.abs`, `Math.floor`, integer ops and a double's bits, which are exact in every engine. They give what Node for x64 gives, bit for bit (no difference in 14.4 million samples). `test/hostMath.test.ts` fails on any other `Math` call, `Math[...]`, or `**` in `sim-core/src` (comments aside); the exact ones it allows are `abs`, `ceil`, `clz32`, `floor`, `fround`, `imul`, `max`, `min`, `round`, `sign`, `sqrt`, `trunc` and the constants. Rapier and QuickJS do their math inside their wasm, which is the same bytes and exact IEEE operations everywhere, so robot scripts' `Math` is the same in every engine already.
- Checking another engine tick by tick: `pnpm sim hashes arena --save replays/arena.hashes.json` (or `battle`, the Sandbox menu's 6 against 6, or any replay file) runs the scene in Node and saves its replay with the state hash after every tick. To run it in a browser, start the dev server (`pnpm dev`) and paste into the page's console, with `<repo>` the checkout's absolute path:
  ```js
  const core = await import('/@fs<repo>/packages/sim-core/src/index.ts');
  const qjs = (await import('/@id/@jitl/quickjs-singlefile-browser-release-sync')).default;
  const saved = await (await fetch('/@fs<repo>/replays/arena.hashes.json')).json();
  const got = await core.replayHashes(core.parseReplay(saved.replay), await core.createQuickJsHost(qjs));
  const at = got.findIndex((h, i) => h !== saved.hashes[i]);
  at < 0 && got.length === saved.hashes.length ? `same at all ${got.length} ticks` : `differs from tick ${at + 1}`;
  ```
  `pnpm sim hashes --against <file>` does the same in another Node (another machine, x64 against arm64). There is no browser in CI, so this is run by hand after a change to how the sim does math. Last run (2026-10-18): Chrome 155 and Node 24.4.1 (arm64) the same at all 1260 ticks of `arena` (ending `c121f204`) and all 1200 of `battle` (ending `aa64c5b1`).

## Events
Typed event bus on `World`: `RobotSpawned`, `PartDestroyed`, `ChunkSplit`, `ExplosionFired`, `CoreDied`, `CoreActivated`, `EnergyEmpty`, `ScriptCrashed`. Render and UI subscribe. Sim modules also use it to stay decoupled (damage publishes, assembly reacts).

## Non-goals for v1
- Networking, multiplayer.
- Mobile layout.
- Save states mid-simulation (replay covers this).
