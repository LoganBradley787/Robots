# 04 Control and scripting

Status: draft, 2026-09-22; control (layers 1 and 2, latching, input sources) built in M3 and decided further in `11-control.md`, which wins where they differ. Items tagged (Q#) depend on an open question in `07-open-questions.md`.

## Layer 1: channels
- A `ChannelDef` is `{ name, min, max, default }`. Parts declare input channels (actuators) and output channels (sensors) in their def.
- Each `PartInstance` holds, per input channel: the final value for this tick, plus the manual-layer and script-layer contributions that produced it.
- Nothing outside `control/` writes a channel directly. Behaviors only read final values.

## Tags and groups
- A group is just a tag. Tags come from the blueprint (legend or part entry) and every part also carries an implicit tag equal to its id.
- Every part also answers to its part type (`wheel`, `thruster`), so "all wheels" needs no tagging (M3, `11`).
- Auto controls (M3, `11`): bindings derived from the parts at spawn, on by default, with per-part and per-blueprint opt-out. They come before the blueprint's own bindings and sum with them like any two bindings.
- A target is a tag string. Writing `set("wheels", "speed", 1)` writes every part in the chunk that has tag `wheels` and an input named `speed`. Parts with the tag but without the channel are skipped silently; the validator warns at design time.
- Tags are resolved within the writer's chunk only. After a split, a binding on the missile core that targets `props` finds nothing unless the missile has props. This makes sub-assemblies compose without scoping rules.

## Layer 2: bindings
Bindings live in the blueprint and belong to a core. Modes:
- `hold`: while the key is down, write `value`. On release, stop writing.
- `toggle`: key press flips the binding on or off. While on, write `value`.
- `pulse`: key press writes `value` for exactly one tick (decoupler fire, warhead detonate).
- `script`: key press toggles a script's enabled flag.
- Two `hold` bindings on the same channel (A gives -1, D gives +1) are the intended way to get an axis.

Manual-layer aggregation: all active manual writers on a channel are summed, then clamped to the channel range. A and D held together give 0. (Q19)

## Layer 3: scripts
- A script runs every tick while enabled. Scripts are attached to a core and only run when that core is the active core of its chunk.
- Enabled state is toggled by a `script` binding or the UI. `setup()` runs on enable, `tick()` every tick. A thrown error or a budget overrun marks the script crashed, shows the error in the UI, and disables it. Re-enabling resets it.
- Script writes go to the script layer.

## Arbitration
Per channel, per tick:
1. If any manual writer is active (held or toggled on), the final value is the manual aggregate. Scripts are ignored on that channel.
2. Else if a script wrote it this tick, the final value is the script value.
3. Else the final value is the channel default.

Scripts can read key state and blend manual input themselves (hover reads A and D to tilt). Both paths work at once because a script reading keys does not create a manual writer. A toggle binding that is on counts as manual and overrides scripts on that channel until toggled off. (Q19)

## Latching (headless chunks, and every robot nobody controls)
- M3 (Logan): a robot you stop controlling also holds its last input. Its held keys and toggles stay as they were until you control it again. See `11`.
- When a chunk has no active core, the final channel values from the last controlled tick are frozen. Behaviors keep reading them, so a thruster stays lit and wheels keep spinning until the pool is empty.
- Nothing can write to a latched chunk. A headless chunk stays headless; latched values are cleared only in a newly split chunk where a dormant core wakes (see below).

## Active core selection (decided, Q1)
- A spawned robot's active core is its primary core: the top-level blueprint's core. Every other core in the same chunk (sub-assembly cores, missile brains) is dormant.
- No takeover. If the active core is destroyed, the chunk goes headless and latches, even if dormant cores remain in it. Logan's rule: shoot the pilot and the jet does not start flying by its missiles.
- A dormant core wakes only when it becomes the sole core in its chunk, which happens when its sub-assembly splits off through a decoupler or damage. On waking, the chunk's latched values are cleared, the core's bindings and scripts start, and `setup()` runs.
- A chunk that splits off with two or more dormant cores and no active core is headless. Authors who want independent missiles give each its own decoupler.
- The player possesses one active core at a time and can cycle through live, possessable ones. The keyboard input source is attached to the possessed core's controller.

## Input sources (pluggable)

As built in M3: the sim takes key edges addressed to a robot, `World.step(inputs: RobotInput[])` with `RobotInput = { robot, pressed, released }`, sampled once per tick and logged. Each robot's controller keeps its own held keys and toggles, so a robot that gets no inputs latches. The `InputSource` shape below is the original sketch; `KeyboardSource` in `packages/app` produces `RobotInput` edges for the controlled robot, and `AiCoreSource` will do the same.

```ts
interface InputSource {
  readonly id: string;
  poll(tick: number): InputFrame;          // called exactly once per tick
}
interface InputFrame {
  down: ReadonlySet<string>;               // keys held this tick
  pressed: ReadonlySet<string>;            // went down this tick
  released: ReadonlySet<string>;           // went up this tick
  channelWrites: ChannelWrite[];           // direct writes, used by AI sources
}
```

- `KeyboardSource` lives in `packages/app` (it touches the DOM) and implements the `sim-core` interface. DOM key events accumulate into the next frame.
- Key ownership (Logan, Gate 2, 2026-09-23): every letter and digit belongs to the robot; A and D are the main drive keys in this side view. World controls use punctuation only: Space pause, `.` step, `[` `]` speed, `\` debug outlines, `` ` `` grid, `,` camera (re-follow, or next robot). Reset has no key; it is on the world toolbar with a confirm. The builder refuses to bind a world key. Binding keys are named from the physical key (`a`, `1`, else the `KeyboardEvent.code`).
- Replays (M3) are files: world, seed, spawns, and the input log; `pnpm sim replay` reruns them and checks the end hash.
- Unpossessed robots get no inputs (no `NullSource` needed).
- `AiCoreSource` (later) presses virtual buttons and writes channels from an AI policy. An AI core refuses possession but can be viewed.
- Every tick's `RobotInput` edges are recorded to the input log with the tick.

## Script API (draft, Q10)
Injected globals inside the sandbox. Everything is plain data; no host objects leak in.

```js
// declared once at top level, registers a slider in the UI and a value in the blueprint
const kp = param("kp", 0.6, { min: 0, max: 5 });
const kd = param("kd", 0.2, { min: 0, max: 5 });

function setup() { state.lastVy = 0; }

function tick() {
  const vy = self.vel.y;
  let throttle = 0.55 - vy * kp - (vy - state.lastVy) / dt * kd;
  if (keys.down("a")) set("leftProps", "throttle", throttle + 0.1);
  set("props", "throttle", clamp(throttle, 0, 1));
  state.lastVy = vy;
}
```

Available inside `tick()`:
- `tick`, `dt`, `time`: integers and seconds.
- `self`: `{ pos, vel, acc, angle, angVel, mass, energy: { stored, capacity } }` for the script's chunk. Provided by the core's built-in sensors (Q2).
- `parts`: array of `{ id, type, tags, pos, angle, health, out }` for the chunk, where `out` holds that part's sensor outputs.
- `set(target, channel, value)`, `get(target, channel)`: write and read channels by tag.
- `keys.down(k)`, `keys.pressed(k)`, `keys.released(k)`.
- `param(name, default, opts)`: tunable parameter; current value comes from the blueprint.
- `state`: persistent object across ticks, cleared on `setup()`.
- `world.robots()`: `[{ id, pos, vel, isSelf }]` for targeting (Q10). Perfect information by design.
- `log(...)`: to the UI console, rate limited.
- `random()`: seeded per script instance.
- `clamp`, `lerp`, `sign`, and the normal `Math` functions except `Math.random`.

Unavailable: `Date`, `setTimeout`, `fetch`, `globalThis`, any DOM.

## ScriptHost interface
The runtime backend is swappable. Backends are compared in `docs/research/script-sandbox.md`; the choice (QuickJS via `quickjs-emscripten`) is recorded in `08-tech-stack.md`.

```ts
interface ScriptHost {
  init(): Promise<void>;                                  // loads the WASM once per thread
  compile(source: string, opts: ScriptLimits & { seed: number }): CompileResult;
}
interface ScriptLimits { budgetPerTick: number; memoryBytes: number; stackBytes: number }
type CompileResult =
  | { ok: true; instance: ScriptInstance; params: Record<string, ParamSpec> }
  | { ok: false; error: ScriptError };
interface ScriptInstance {
  setParams(values: Record<string, number>): void;
  setup(): TickResult;
  tick(input: ScriptInput): TickResult;                   // synchronous by contract
  getState(): string;                                     // JSON, for saves and replay checkpoints
  setState(json: string): void;
  dispose(): void;
}
interface ScriptInput  { tick, dt, time, self, parts, keys, robots }             // plain data
type TickResult = { ok: true; writes: ChannelWrite[]; logs: string[] } | { ok: false; error: ScriptError };
interface ScriptError { kind: "budget" | "memory" | "stack" | "throw" | "compile"; message: string; stack?: string }
interface ParamSpec { default: number; min?: number; max?: number; step?: number }
```

- `tick` is synchronous on purpose so the physics loop stays a plain loop in browser and Node. A Worker-based backend cannot honor that, which is deliberate: moving the whole sim off the main thread is a sim-level decision, not a per-robot one.
- One runtime per robot script: its own memory limit, interrupt counter, and crash blast radius. Budget is counted in interrupt-handler calls (about 10,000 bytecode poll points each), so it is deterministic. Starting limits: 50 calls per tick, 16 MB memory, 512 KB stack.
- The host evaluates a prelude at context creation that replaces `Math.random` with a seeded PRNG and `Date` with sim time, then freezes them. QuickJS ships no I/O globals, so nothing else needs removing.
- `ScriptInput` is built once per chunk per tick and written into a persistent `api` handle inside the VM; `state` never crosses the boundary except through `getState()`.
- Any crash disposes the runtime. Re-enabling recompiles from source and restores params.
- `ScriptError.kind` is uniform across backends so the UI, replay log, and later fitness code never learn which backend crashed a robot.
