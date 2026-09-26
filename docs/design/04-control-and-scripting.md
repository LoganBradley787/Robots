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
- As built (M6): a piece that breaks off is its own robot. If it has exactly one core, that core wakes with its parts' auto controls only, because a blueprint's bindings and scripts belong to its primary core until M7's sub-assembly references give sub-assembly cores their own. The robot that keeps the old id never wakes a dormant core, even when its pilot dies (Q1). A latched piece keeps its parts' last channel values, minus that tick's pulses, so a one-tick press is not repeated forever.
- As built (M7): a core's own controls live in the blueprint's `cores` (`02`). A piece that wakes with exactly one core gets that core's entry: its bindings, auto controls for the piece's parts (unless its `autoControls` is false), and its scripts, which start through `setup()` and first run on the tick after the split (scripts run before behaviors, so a decoupler fired in tick t wakes the piece in tick t). Scoped controls see the scope's parts by their own tags, and every part by id and type (`scopedView`). A core with no entry wakes with auto controls only, as in M6. The keys bar shows the woken core's own keys. The player can switch only into their own cores (a released missile included), never into another team's robots (as built in M8, below).
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

As built (M9, script speed): what a script sees is unchanged, but it crosses into the sandbox in three pieces (`script/frame.ts`): a layout (each part's id, type, tags, mass, and the names of its `in` and `out` values) sent only when the robot changes, one binary block of every number that moves, and a small JSON text for keys, contacts, and inbox. Part objects are built once per layout and refilled in place every tick; their fields other than the numbers are read-only, so a script copies what it keeps. JSON's quirks are kept (`-0` arrives as `0`, `NaN` and `Infinity` as `null`). A parity test checks every script call in 15 scenes against the old JSON path, and golden hashes (`packages/cli/test/golden-hashes.json`) check that no run changed. Part objects are sealed and their non-number fields read-only: a write to them is ignored (a TypeError in strict mode), `tags` is frozen, and `get()` reads the parts as sent, whatever a script does to its own `parts` array.

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

## Decisions with Logan before M5 (2026-09-23)
- **Scripts are separate `.js` files** next to the blueprint (`blueprints/hopper.hover.js`), referenced from its `scripts` list. Readable in an editor and in git diffs, and Claude reads and writes them directly. The builder edits the same files. Deploys and replays carry the source inline so a rerun never depends on files that changed since.
- **Everything is edited in the builder**: code and params. No live sliders in the world. Logan: a hover is not a tuned constant but a feedback rule on exact data ("if velocity y is positive, thrust down... because we can just KNOW the position and velocity"). `param()` stays in the API; params are number fields in the builder.
- **Each script says whether it starts on deploy** (`enabled`, default on). A `script` binding toggles it with a key (for example H), shown on the keys bar.
- **Air drag arrives with M5**: without it a hopper that holds W for its whole battery climbs about 20 km at 450 m/s, and a hover script has nothing to settle against.

## As built (M5, 2026-09-23)
- Sandbox: `createQuickJsHost(variant)` in `sim-core/src/script/quickjs.ts`; the app passes the single-file browser build, the CLI and tests the wasm-file build. One runtime per script, 50 interrupt calls per tick, 16 MB of memory, 256 KB of stack (512 overflowed the host's stack before QuickJS noticed). `Date` is not created; `Math.random` and `random()` are seeded per script from the world seed, the robot, and the script's place in the list.
- The API differs from the draft above in one name: the tick number is `frame`, because `tick` is the function the script defines. Scripts get `frame`, `dt`, `time`, `self` (`pos`, `vel`, `angle`, `angVel`, `mass`, `energy`), `parts` (id, type, tags, pos, angle, `in` channel values from the last tick, `out` outputs), `keys.down/pressed/released`, `set`, `get`, `state`, `param`, `log`, `random`, `clamp`, `lerp`, `sign`. `self.acc` and `world.robots()` wait until something needs them (M6 targeting).
- Order in a tick: key edges, then scripts (they see this tick's keys and last tick's channels and write the script layer), then channel values (manual beats script beats default), then behaviors and energy, then physics.
- Lifecycle: `enabled` starts a script at deploy (default on); a `script` binding flips it; turning on runs `setup()` with fresh `state`, then `tick()` on the same tick. A crash (budget, memory, stack, throw) disables it, emits a `scriptCrashed` event, and shows in the world; turning it on again recompiles. Enabled and crashed flags are hashed; the VM's own memory is not, and replays reproduce it by rerunning the same code from the same inputs.
- Logs: `log()` keeps at most 5 lines per call, 20 per robot per second, the last 200 in the world; the app shows the controlled robot's last 5.
- Files: `ScriptSpec.file` is the `.js` file in `blueprints/`. `toFileJson` writes `{ file }` references on save and inline code for deploys (`inlineScripts`), so the spawn log and replays carry the code. Save writes every script file, then the blueprint; Save As copies scripts to files named after the new blueprint (`drone-two.hover.js`) and leaves the originals.
- Known issue: a script that fills large arrays until it runs out of memory can stall for several seconds before it is stopped (QuickJS collects garbage on every allocation near the limit, and `fill` has no interrupt point). Endless loops, deep recursion, single huge allocations, and ordinary leaks stop within milliseconds. A wall-clock guard would break determinism, so it is not used.
- Review hardening (M5): the host's buffers, param specs, and `JSON` functions live in a closure captured before user code runs, and the host keeps its own handles to the entry functions, so reassigning globals only breaks the script. Output is shape-checked and capped (1000 writes, 5 logs of 300 characters per tick). Disposal is guarded: a stack overflow inside a built-in leaves QuickJS unable to free its runtime, so the runtime is abandoned (leaked) rather than let the error reach `World.step`.
- Replays are exact across V8 (Chrome, the desktop app, Node). Rotations use JavaScript's `Math.sin` and `Math.cos`, which other engines may round differently, so a replay saved in Safari or Firefox is not guaranteed to match.

## As built (M8, 2026-09-25): teams, sensors, messages
- **Teams:** `Robot.team` is a number (0 Logan's, 1 the enemy; a number so more sides need no format change). `spawnBlueprint(raw, at, { team })`; pieces keep their robot's team; the spawn log, replays, and the state hash carry it (a replay without it loads as 0). Scripts never see team numbers, only `side` in `contacts`.
- **Possession:** the app only takes over team 0 robots with a live core (`canPossess`). `,` and clicks skip enemies; clicking one follows it with the camera ("watching enemy"). Enemy robots run their scripts; their keys are never pressed.
- **Script API additions** (every tick, before the robot's scripts run, from positions after the last physics step, robots in spawn order):
  - `contacts`: `[{ id, side, core, pos, vel, center, mass, parts, distance, by }]`, nearest first (ties by id), for every robot its sensor parts see (`02`, Sensor parts). `side` is `enemy`, `friend`, or `none` (debris, headless). `pos` is the core's position (the center of mass's without one), `vel` the velocity of the body the core is on. A robot never sees itself; its attached missiles are its own parts, and released ones are friends.
  - `scan(id)`: a seen robot's parts (`id, type, pos, angle, health, maxHealth`) or null; a host call, so the cost is paid only on use; at most 4 per script per tick.
  - Decoys (M11): a burning decoy (a flare, `02`) stands in for the robot it was part of when lit. When any of a robot's sensors sees one, that robot's contact is reported at the decoy: `pos`, `center`, and `vel` are the decoy's, `id`, `side`, `core`, `mass`, and `parts` the robot's, whether or not the robot itself is also in view; of several in view, the one nearest the viewer. `scan(id)` of it returns the decoy's part. A piece made only of burning decoys is not listed as itself. Scripts are never told a contact is a decoy (the debug overlay marks it). The rule is on sensors, never on kinds of robots: whatever steers by contacts (a missile's guide, a drone bomb's pilot, a launcher's aim) is fooled as a consequence, a friend's sensors too.
  - `send(to, data)`: `to` is a scope, a tag, or a core part id of a core attached to the sender's robot right now (no radio). JSON up to 1 KB, 16 calls per script per tick (counted before the data is turned into text) and 32 per robot; `sent` events are reported at most once a second per sender and receiver. The message waits on the core's `PartInstance` (so it survives splits, and it is hashed) and is shown in that core's `inbox` from the next tick; a dormant core keeps it (at most 16, oldest dropped) until it wakes, so `setup()` reads a launcher's handoff.
  - `mark(x, y, label)`: up to 4 points per tick for the debug overlay and the CLI side view. Not simulation state. Non-finite points are skipped, and `set()` ignores a NaN or infinite value with one log line (M8 review; both used to stop the script).
  - `contacts` and `inbox` are host-set globals, like `parts` and `self`: a script's own variable with that name is overwritten every tick.
  - A sensor sees nothing until it has been powered once (its first tick after deploy).
- **An AI is scripts:** `enemy-drone` has no engine AI; its pilot script flies, aims, launches, and dodges from `contacts`. `AiCoreSource` above is not needed.

