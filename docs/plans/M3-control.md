# M3 Control Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development. Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/design/04-control-and-scripting.md`, and `docs/design/11-control.md` first. Tests first for every pure module, one commit per task (`M3 T<n>: <what>`), tree green at every commit, `docs/status.md` updated at session end.

**Goal:** Keys drive robots, with auto controls from the parts (W A S D) plus custom bindings. A and D drive the car with weight that matters, a thruster car hops, you take control of the robot you deploy and can switch between robots, robots you leave hold their last input, a small keys bar shows the controlled robot's keys, and the headless runner reproduces a drive from a key timeline or from a replay saved in the browser. Ends at Gate 3 (robot feel).

**Spec:** `docs/design/11-control.md` (Logan's decisions), `04` (channels, bindings, arbitration, latching), `06` M3, `07` Q3, Q8, Q19.

**Written by:** an Opus 5.5 coding session, 2026-09-23, after Logan answered the control questions.

## Global constraints (in addition to M0 to M2)

- Control, behaviors, and the replay format live in `sim-core` and are pure and deterministic. The app only turns DOM events into key presses and releases addressed to a robot.
- Parts are data. Behaviors are looked up by the def's `behavior` string in a registry; the engine never names a part. Every tuning number is in a part def.
- The sim only changes through `World.step(inputs)` and `World.spawnBlueprint`. Inputs are consumed once per tick and logged.
- No em dashes anywhere.

## Decisions made in this plan (Claude's call, overturnable at Gate 3)

1. **Inputs are key edges, addressed to a robot.** `RobotInput = { robot: number; pressed: string[]; released: string[] }`. Each robot's controller keeps its own held keys and toggle states and changes them only when an input for it arrives. That is latching for free: a robot nobody sends inputs to holds its last state. The input log stores these edges, so it stays sparse (a drive of a minute is a few dozen entries). This replaces M0's `InputFrame { sourceId, down, pressed, released }` and `04`'s per-source `poll()` shape; `04` is updated to match.
2. **Control state is in the state hash.** Held keys and toggles change the future, so two worlds with the same bodies and different held keys must hash differently. Golden hashes are regenerated once in T2 (and again in T3 because the wheel's idle behavior changes); the regenerations are called out in the commit messages.
3. **Controllers belong to the robot's primary core.** A robot without a core has no controller and cannot be controlled. Tags resolve within the controlled chunk (every robot is one chunk until M6, but the code goes through the chunk).
4. **Arbitration as in `04`:** manual writers summed and clamped; scripts slot in at M5; otherwise the channel default. Pulse writes for exactly the tick of the press. Toggle flips on press.
5. **Wheel drive model** (`11`, Driving feel). Per tick, with throttle `t` in [-1, 1]:
   - `t != 0`: motor target `t * maxSpeed`, gain `motorFactor`, torque cap `|t| * maxTorque`. The velocity motor gives torque `min(cap, gain * (target - w))`: flat up to a knee, then falling to zero at top speed, like an electric motor.
   - `t == 0`: target 0 with a small cap `coastTorque` (rolling drag), so the robot coasts.
   - Starting numbers: `maxSpeed` 40 rad/s (18 m/s at the rim), `maxTorque` 10 N m, `motorFactor` 0.4 (knee near 15 rad/s, 7 m/s), `coastTorque` 0.3 N m. T4 measures and tunes against the targets below.
6. **Thrusters and propellers** push with `throttle * maxForce` along the direction the part acts (the arrow in its legend token), at the part's cell center, as a per-tick impulse. No energy drain until M4.
7. **Possession lives in the app**, not the sim: the sim only sees which robot each input is for. Possession changes are therefore implicit in the log (inputs switch robot id). The app never sends a robot inputs for keys it did not see pressed while that robot was controlled (the rule from `11`).
8. **Clicking a robot** tests the click point against every collider directly (`forEachCollider` plus `containsPoint`), the same way `canPlace` avoids Rapier's query index.
9. **Replay files** are JSON: `{ format: 1, world, seed, spawns: SpawnRecord[], inputs: LoggedTick[], endTick, endHash }`. The app saves them to `replays/` in the repo through the dev server (same safety rules as `blueprints/`), and `replays/` is gitignored except files Logan chooses to commit. `pnpm sim replay <file>` reruns and fails loudly if the end hash differs.
10. **Key timeline for the CLI:** `--keys "d:0-3, a:3.5-4, w:5"` (key, seconds held from start to end; a single time is a tap of one tick), or `--keys path.json` with `[{ "key": "d", "down": 0, "up": 3 }]`. Timelines address the one robot the command spawns.

## Driving targets (T4 measures these headless; Gate 3 judges them by feel)

- Car (`blueprints/car.json`, about 10 kg, two wheels), holding D on flat ground: noticeable spin-up, about 6 m/s after 1.5 s, still gaining at 4 s, top speed above 15 m/s.
- The same car with 10 extra frame cells (about double the mass) reaches 6 m/s roughly twice as slowly. A test asserts heavier is slower by a clear ratio.
- A 15-cell robot with two wheels still passes 5 m/s within 5 s. With four wheels it is clearly quicker.
- Letting go at speed coasts: the car loses less than a third of its speed in 2 s on flat ground. Holding the opposite key stops it in about the time it took to reach that speed.
- The hopper (car with upward-pushing thrusters on W) leaves the ground within half a second of holding W.

## File structure

```
packages/sim-core/src/control/types.ts          RobotInput, ControlState
packages/sim-core/src/control/controller.ts     key edges -> held and toggle state; bindings -> manual layer; arbitration -> final channel values
packages/sim-core/src/control/autoControls.ts   auto bindings from part defs and blueprint flags
packages/sim-core/src/control/timeline.ts       parse "d:0-3, a:3.5-4" and JSON timelines into per-tick RobotInputs
packages/sim-core/src/behaviors/registry.ts     behavior id -> apply(ctx); unknown behaviors do nothing
packages/sim-core/src/behaviors/wheel.ts        throttle motor model
packages/sim-core/src/behaviors/thrust.ts       thruster and propeller (same module, config differs)
packages/sim-core/src/physics/PhysicsWorld.ts   + setMotor(joint, target, gain, cap), applyImpulseAt(body, ix, iy, px, py), bodyAtPoint(x, y)
packages/sim-core/src/replay/InputLog.ts        edge-shaped entries
packages/sim-core/src/replay/replayFile.ts      build, parse, and run a replay
packages/sim-core/src/world/World.ts            step(inputs), controllers, channel values for render, hash includes control state
packages/sim-core/src/metrics/robotMetrics.ts   + drive metrics: distance, max altitude, max tilt
packages/cli/src/commands/run.ts                + --keys, drive metrics in the report
packages/cli/src/commands/replay.ts             pnpm sim replay <file>
packages/app/src/control/KeyboardSource.ts      DOM keys and panel buttons -> edges for the controlled robot; release on blur and screen switch
packages/app/src/control/possession.ts          pure: controlled robot, cycle, click, deploy
packages/app/src/ui/KeysBar.tsx                 the keys bar
packages/app/src/ui/PartMenu.tsx                right-click part menu (replaces SelectionPanel)
packages/app/src/render/RobotView.ts            flame scaled by throttle, propeller spin by throttle
packages/app/vite-plugins/replayStore.ts        POST replays into replays/
blueprints/car.json                             bindings removed (auto controls drive it)
blueprints/hopper.json                          new: car with upward-pushing thrusters on W
```

## Tasks

### T1: controller (sim-core, pure)
- Tests first: hold writes while down and stops on release; toggle flips on press; pulse writes on the press tick only; two holds on one channel sum and clamp (A and D together give 0); tags reach only parts with the channel; unknown keys do nothing; the final value is the channel default with no writer.
- `Controller` per robot: `apply(input)`, `tickValues()` returning final values per part and channel, `state()` for hashing and inspection (sorted, stable).

### T2: world integration, latching, log, hash
- `World.step(inputs: RobotInput[] = [])`: inputs for unknown or core-less robots are rejected with an error (a bug, not a player action). Inputs are applied, then channel values are computed, then behaviors run, then physics steps.
- Controllers are created at spawn for robots with a primary core. Robots with no inputs keep their state (tests: hold D, send nothing for 100 ticks, the wheels still drive).
- Input log keeps `{ tick, inputs }` and is replayable into a fresh world; test: record a drive, replay it, same hash every 60 ticks.
- Hash includes every controller's state. Regenerate golden hashes.
- `world.channelValue(robotId, partId, channel)` for render and UI (read-only).

### T3: behaviors
- `PhysicsWorld.setMotor`, `applyImpulseAt`, `bodyAtPoint` (direct collider test).
- Behavior registry keyed by `def.behavior`; `wheel` and `thrust` (thruster and propeller both use it, reading `maxForce`). Part defs gain `coastTorque`; the wheel joint's `motorFactor` and `maxTorque` and `behaviorConfig.maxSpeed` get the starting numbers above.
- Tests: the car with D held moves right, with A moves left, with nothing held coasts; a thruster pointing up lifts a light robot; a thruster's force acts at its cell (an off-center thruster spins the robot).
- Regenerate golden hashes (the idle wheel no longer brakes).

### T4: drive tuning
- A headless tuning script (`packages/cli/src/commands/tune.ts` or a Vitest bench, Claude's pick) prints the targets above for the car, the heavy car, a 15-cell two-wheel robot, a four-wheel one, and the hopper.
- Adjust numbers in the part defs until the targets hold; record the final numbers and measured table in `docs/design/11-control.md`. Add the heavy-is-slower ratio test.
- Add `hopper.json` (thrusters under the body pushing up, so W hops once auto controls land in T5; until then it binds W itself).

### T5: auto controls and group tags (sim-core)
- Part defs gain `autoControl`: `{ "channel": "speed", "kind": "axis" }` on the wheel (D +1, A -1), `{ "channel": "throttle", "kind": "push" }` on the thruster and propeller (key from the direction the part pushes after rotation: up W, down S, right D, left A). The push direction comes from the def (`acts`, a face in the unrotated frame), not from code.
- Blueprint gains `autoControls` (default true) and per-part `auto` (default true), in both file forms; `toGrid` and `serialize` keep them; the validator checks their types.
- `autoBindings(blueprint, registry)` (tests first: 31 of 32 wheels on auto; a part opted out is skipped; `autoControls: false` gives none; every rotation of thruster and propeller maps to the right key; a custom binding on the same channel sums).
- Implicit type tags (`wheel`, `thruster`) resolve as binding targets, in the validator and the controller.
- The controller takes custom plus auto bindings; `car.json` drops its manual wheel bindings (auto covers them).

### T6: CLI
- Timeline parser (tests first, in `sim-core/control/timeline.ts`, with actionable errors: `--keys "d:3-1"` says the end is before the start).
- `pnpm sim run car --keys "d:0-3"` prints the drive metrics: distance (core x from spawn), max altitude (core y above its spawn resting height), max tilt, top speed.
- `pnpm sim show` lists the auto controls by key.
- `pnpm sim determinism car --keys "d:0-4, a:5-6"` runs twice and compares, and CI runs that too.

### T7: keyboard and possession in the app
- `KeyboardSource`: letter and digit keys (by `KeyboardEvent.code` naming from `bindings.ts`) and keys bar buttons become press and release edges for the controlled robot, drained once per tick. Held keys are tracked per source (keyboard, mouse) so the key is down while either holds it. Window blur and switching to the builder send releases for every held key. A possession change sends nothing to the old robot (it latches) and starts the new one with nothing held.
- `possession.ts` (pure, tested): deploy takes control; `,` re-follows or cycles to the next controllable robot, skipping core-less ones; clicking a robot takes control; clearing robots drops control.
- HUD line shows the controlled robot and its speed.

### T8: builder: part menu, eraser, controls panel
- Eraser tool: `E` or a palette button; left-click or drag erases (one undo step per drag, mirrored in mirror mode). Right-click no longer erases.
- Part menu on right-click (with no part held): opens beside the part; edits the selection if the clicked part is in it, else that part. Tags (add, remove, pick an existing group), auto controls checkbox (shows what auto gives it, like "D / A drive"), rotate, delete. Every change is one undo step. The side selection panel is removed. Esc or a click elsewhere closes it.
- Controls panel: an "Auto controls" switch for the blueprint, read-only auto lines grouped by key ("D: 4 wheels drive, 1 thruster"), custom bindings below. Targets list type groups ("all wheels") and user tags. Values edit and show as percent.
- Pure parts (menu target resolution, grouping auto lines) in `builder/` with tests.

### T9: part animation
- Thruster flame overlay shown when throttle is above zero, scaled and alpha by throttle, cycling flame frames. Propeller animation speed follows throttle, static sprite at zero. Wheels already turn with their bodies.

### T10: keys bar
- A small bar above the world toolbar: one button per distinct key the controlled robot has (auto and custom), in key order (auto keys first: W A S D, then custom in binding order). Lit while held; toggle keys show an on dot. Pointer down on a button presses the key, pointer up or leave releases it. Buttons never take focus. Hidden when nothing is controlled.

### T11: replays
- `replayFile.ts` (tests first: build from a world, run it, same end hash). Dev endpoint writes `replays/<name>.json` atomically, names slugged; world toolbar gets **Save replay**, which names the file with the date and robot and shows where it went.
- `pnpm sim replay <file>` prints the drive metrics for every robot and checks the end hash.

### T12: review and gate prep
- Opus review subagent over the whole M3 diff; fix findings.
- Browser check: deploy the car, drive with A and D, coast, brake; deploy the hopper, switch with `,` and by clicking, leave a robot driving; keys bar by mouse; part menu on a selection, one wheel opted out of auto; eraser; save a replay and rerun it with the CLI.
- Update `04` (input shape, latching of unpossessed robots, auto controls), `07` Q3 (the panel shows keys only), `status.md`; tag `m3`.

## Task dependencies

T1 then T2. T3 needs T2. T4 needs T3. T5 needs T1. T6 needs T2 and T5. T7 needs T2. T8 needs T5. T9 needs T3. T10 needs T7. T11 needs T2 and T7. T12 needs all.

## Gate 3 (robot feel), what Logan will be asked to judge

- Does the car feel like a machine: spin-up, momentum, coasting, braking with the opposite key? Does weight matter enough, or too much?
- Is holding the last input the right call for robots you leave, in practice?
- Possession: auto on deploy, `,`, and click.
- Auto controls: do W A S D do what you expect on your robots? The part menu and the eraser.
- The keys bar: size, place, and behaving like the keyboard.
- Thruster flame and propeller spin.
