# 06 Milestones

Status: proposed, 2026-09-23. See "What changed" at the end. Each milestone gets its own plan in `docs/plans/` before code starts. Milestone boundaries are critique gates: Logan plays the layer and tears it apart before the next layer is built on it (see `09`).

## M0: skeleton and deterministic world
- pnpm workspace (`sim-core`, `app`, `cli`), Vite 8, TypeScript 7 strict, Vitest 5 projects. `sim-core` compiled without DOM types.
- Rapier deterministic build initialised in browser and Node from the same module.
- World with flat ground, gravity, a falling box.
- Fixed 60 Hz tick, render interpolation, time scale (pause, single step, 0.25x to 4x).
- Camera: follow target, mouse wheel zoom, free pan.
- Replay log and state hash. Test: run 10 s twice, hashes match.
- Done when: a box falls, the sim can be paused and stepped, and the determinism test passes in CI.

## M1: parts, blueprints, assembly
- `PartDef` registry with the starting set (core, frame, battery, wheel, thruster, propeller, decoupler, warhead as data only).
- Blueprint JSON with `grid` and `legend`, expansion to parts, default legend, validator with the error list from `02`.
- Assembly: attachment graph, flood fill, body groups, compound bodies with real mass distribution, wheels on motor joints.
- Spawn a blueprint from a file into the world.
- Headless harness: `pnpm sim run <blueprint> --seconds 5` prints positions, tilt, and validator output.
- Placeholder PNG generator and texture manifest; sprites drawn at local offsets.
- Done when: a hand-written car blueprint spawns, rests on its wheels, and the headless harness reports its resting pose.
- Gate 1, Look: textures, sprite fit, scale, world look, camera and time controls.

## M2: editor and persistence
- Editor mode: palette, place, rotate, delete, tag parts, grid text box that round-trips with the canvas.
- Bindings panel (data only; keys do nothing until M3). Live validator output.
- Save and load: browser storage plus JSON file export and import. Shipped examples in `blueprints/`.
- Spawn from the editor at a chosen point, and a way back into the editor.
- Done when: a robot built in the editor is saved, reloaded, spawned, and rests in the world without touching a file.
- Gate 2, Builder: placement, rotation, tags, save and load, and the trip between builder and world.

## M3: control
- Channels, tags, bindings (hold, toggle, pulse), input sources, arbitration, latching.
- Keyboard source, replay source, possession cycling.
- Behaviors for wheel, thruster (with flame overlay), propeller (spin animation).
- Headless runner accepts a scripted key timeline and reports distance, max altitude, max tilt.
- Done when: A and D drive the car, a thruster car hops, and the headless runner reproduces the same distance from the same key timeline.
- Gate 3, Robot feel: physics, controls, possession, fun.

## M4: power
- Resource pools, battery part, drain and brownout, `EnergyEmpty`.
- Energy bar in the UI, energy metrics in the headless runner.
- Done when: a thruster car runs dry and stops, and splitting a chunk gives each side only its own batteries.
- No gate of its own; judged with M5 at Gate 4.

## M5: scripting
- `ScriptHost` with the chosen backend, script API, params with sliders, script toggle bindings, crash handling with a visible error.
- Script editor panel (textarea first).
- Headless runner runs scripts.
- Done when: a hover drone holds altitude with the H script, A and D tilt it, and an infinite loop in a script disables the script without freezing the game.
- Gate 4, Power and scripts: energy bar, running dry, script panel, sliders, crash messages, hover feel.

## M6: destruction
- Health, damage pipeline, cell removal, connectivity re-run, splitting with momentum, joint rebuild.
- Decoupler behavior, warhead behavior (detonate, on destroyed, on impact), radius explosion model, debris rules.
- Active core recomputation and latching on split, sub-assembly core wake-up.
- Rotator part if Q5 says so.
- Shipped example `bomb`: a core-less one-part warhead blueprint, spawnable mid-air.
- Done when: Logan's bomb test passes (a long two-wheeled robot drives forward, a bomb dropped on it breaks it cleanly in two, the core-less half keeps its wheel speed latched), and a dumb missile is aimed, lit, decoupled, flies straight, and blows a hole in a target with plausible debris momentum.
- Gate 5, Destruction: explosions, splitting, debris, missiles.

## M7: Claude workflow
- Sub-assembly references in blueprints, mirror helper, `toGrid`.
- Richer headless metrics and a JSON report; a `docs/claude-robot-playbook.md` describing the build, validate, test, iterate loop.
- Shipped examples: car, hover drone, missile drone.
- Done when: "build me a drone with missiles" produces a working blueprint in one session with no manual editing.
- Gate 6, Claude loop, judged from Logan's side.

## What changed from the handoff
- Determinism test and time controls moved into M0. They are cheap to add first and expensive to retrofit.
- Grid layout, validator, and the headless harness moved from M7 into M1 and M3. Every later milestone then has Claude-authored test robots and an automated check, which is the stated reason for those hooks. M7 keeps the polish and the sub-assembly work.
- Milestone order otherwise matches the handoff: look, builder, control, power, scripts, destruction, Claude loop. Each boundary is a critique gate, ordered so each layer is judged before the next is built on it.
- Warhead added to M6 so dumb missiles have something to detonate (Q11).
