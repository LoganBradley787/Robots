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

## Determinism rules
- Fixed `dt`. No wall-clock reads inside `sim`.
- One seeded PRNG in `World`. Scripts get a seeded `random()`; `Math.random` and `Date` are unavailable in the sandbox.
- Iterate arrays in creation order. Where order affects floating point sums (resource pools, impulses), sort by stable part ids first.
- One Rapier build everywhere: `@dimforge/rapier2d-deterministic-compat`, the same bytes in browser, tests, and CLI. Bodies and colliders are created and removed in a stable order, because handles are index plus generation and get reused.
- Poses are set through `RigidBodyDesc` at creation, not `setRotation` afterwards (an open Rapier issue reports determinism loss after `setRotation` following a snapshot restore).
- State hashes are computed from the tick, the RNG state, and per-body position and velocity as exact float bits (not quantized: the deterministic build should be bit-identical, and any drift should show at once), never from raw snapshot bytes, which differ across Rapier build variants.
- Script interruption uses an instruction budget where the backend supports it (see `04` and `docs/research/script-sandbox.md`).
- Replay = world file + blueprint set + input log. A CI test simulates, replays, and compares state hashes.

## Events
Typed event bus on `World`: `RobotSpawned`, `PartDestroyed`, `ChunkSplit`, `ExplosionFired`, `CoreDied`, `CoreActivated`, `EnergyEmpty`, `ScriptCrashed`. Render and UI subscribe. Sim modules also use it to stay decoupled (damage publishes, assembly reacts).

## Non-goals for v1
- Networking, multiplayer.
- Mobile layout.
- Save states mid-simulation (replay covers this).
