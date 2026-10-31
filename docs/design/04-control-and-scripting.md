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

**The trace (M16, for the live readout).** `World.setTrace(robotId)` asks the world to keep, for one robot, what its control layer did on the last tick; `World.trace(robotId)` reads it (`ControlTrace`, `control/types.ts`):
- `writes`: every `set()` its scripts made, in order, with the script's id, the target and input as written, the value, and how many parts it reached (0: the name reaches nothing).
- `inputs`: each input a key is bound to or a script wrote: the value the part got, whether a `key`, a `script` or the `default` decided it, every key bound to it with whether it writes now, and the last script that wrote it with what it asked for, whether or not a key beat it. So a readout can say "W is held: the key's 100% beats hover's 54%" exactly.
- It is off unless asked for (`setTrace(undefined)` switches it off again), and then costs nothing: the controller keeps the two small maps only while tracing, and `values()` never reads them. It is not simulation state: it is in no hash, no log and no replay, and a run with it on is the same run tick for tick (`trace.test.ts` compares the hashes). The script runner says whose each write is (`ScriptTickOutput.writesBy`); the writes are applied in the same order either way.
- The app asks for it only while the readout is open, and only for the robot being followed (`world/readout.ts` turns it into sentences).
- Apart from the trace, each script says which keys it has asked about since it was switched on (`World.scripts(id)[i].reads`, kept by the script runner from what `keys.down`, `pressed` and `released` were called with), so the readout can say "hover reads W A S D" for the keys it really reads, a key named by a variable included. It is not simulation state either: it is in no hash.

**The script watch (for timing, 2026-10-19).** `World.watchScripts(watch)` hands the host, once per robot per tick, a `run` that runs that robot's scripts (building its input included), so the host can time each robot on its own clock. The world never reads a clock: the app wraps `run` in `performance.now()` (`WorldScreen`, `app/scriptCosts.ts`, smoothed per robot) for the readout's "scripts 1.4 ms a tick" and the debug overlay's slowest scripts. `run` runs exactly once whatever the watch does (the world calls it after the watch if the watch did not; a second call does nothing), so a run with a watch is the same run (`scriptWatch.test.ts` compares the hashes and logs). The CLI's `bench` keeps timing the script host instead (`timedHost`), which splits a tick into scripts and the rest without per-robot names.

**Skipped ticks (Smooth, 2026-10-19).** The app's Smooth setting (`01`, The app's frame loop) may have a robot's scripts sit out a tick: `World.skipScripts(ids)` before the step, logged as `world.skip: [ids]` (sorted, only robots with scripts at that tick) in the input log. A robot sitting out:
- calls no script and builds no input for them (no frame, no contacts, no `scan`), so it costs nothing;
- keeps what its scripts set: the script layer is cleared every tick (`Controller.endTick`), so a script whose tick did nothing would leave its parts at their defaults (a drone's throttles at 0). Instead each running script's `set()` calls from the last tick it ran are made again, in the same order (`ScriptRunner.repeat`), as if it had repeated that tick's writes. A script switched off while sitting out stops driving its parts at once; one switched on (or woken) has set nothing yet, and runs `setup()` and `tick()` on its next tick that runs;
- keeps its messages waiting in the core's inbox (they are shown on its next tick that runs), its marks on the overlay, and its `state`;
- is not watched (`watchScripts`): nothing of it runs.
- What a script sees when it next runs is the world as it is: `frame`, `time` and `self.age` are real world time, so they jump by the ticks it sat out (at most 3), and timing from them stays right. `dt` stays the tick's length. A script that counts its own calls in `state` counts runs, not ticks; one that integrates with `dt` (a PID's integral) sees one tick's `dt` per run. Scripts that should be exact under Smooth time things with `self.age` or `frame`; none of the stock scripts need changing.

**Sleeping scripts (`sleep(n)`, 2026-10-22).** A script that need not run every tick (a missile far from its target) calls `sleep(n)` in its tick: for the next n ticks of the world it is not called, and wakes on its own on the tick after. It is Smooth's skip asked for by the script itself, so it costs what a skip costs: nothing (no frame, no contacts, no `scan`); a profile of the bastion's darts found their frames, not their logic, were most of their cost.
- n is whole ticks: a fraction is cut (`2.9` is 2), 0 or less is no sleep, more than `SLEEP_MAX` (30, half a second) is 30, and anything not a number is no sleep with one log line. The last call of the tick wins, so `sleep(0)` takes back an earlier one; called in `setup()` and `tick()` on the same tick, the longer counts. `pnpm sim validate` and the builder warn about a plain number over 30 (`SCRIPT_SLEEP`).
- While it sleeps its `set()` calls from the tick it called `sleep` are made again every tick, in the same order, and its marks stay up (`ScriptRunner.tick`, as `repeat` does for Smooth). Its other scripts on the same robot run as usual.
- Nothing wakes it early: not a message, a hit, a rebuild, or a split. Wake rules would be one more thing to keep deterministic and to explain, and a short sleep does the job: a script that must answer quickly sleeps 1 to 3 ticks, not 30. Key presses made while it sleeps are missed (it sees keys held when it wakes); messages wait in the core's inbox and reach it when it wakes, unless another script of the same robot that ran meanwhile took them first (the inbox is the core's).
- When it wakes it runs normally on the world as it is: `frame`, `time` and `self.age` are real and have jumped by n + 1, `dt` is one tick. A script that steers by elapsed time reads `time`; one that counts its calls counts runs.
- Smooth: a robot whose running scripts are all asleep next tick is not in `World.scriptedRobots()`, so Smooth never spends a skip on it and its every-4th-tick floor never wakes it. A tick Smooth skips uses up a tick of sleep like any other: sleep counts the world's ticks.
- State: the ticks it has left are simulation state, in `World.scripts(id)[i].asleep` and hashed while above 0 (a world with no sleeping script hashes as before). A replay needs nothing logged: the script asks again when it runs again.
- A script switched off, crashed, or switched on again is awake.

**A script's parts list (`parts` on a script entry, 2026-10-23).** A big robot's frame hands every script every part's numbers each tick: the bastion's pilot read 2269 parts (7410 numbers) a call, though it uses its bays, guns and anchors. A script entry may list the part types and tags its code reads:

```json
{ "id": "pilot", "parts": ["fabbay", "gun", "anchor"], "source": { "file": "titan-bastion.pilot.js" } }
```

- When every script of a core lists its parts, the frame carries only the parts whose type or one of whose tags (as the script sees tags, through its scope) is in any of the lists: `parts` holds just those, in the usual order, and `get()` finds only those. A part not listed is still the robot's: `set()` reaches it, it counts in `self.mass` and `self.energy`, and its sensors see for the robot (`contacts`).
- A core with any script that lists nothing gives all its scripts every part, as before; a core whose scripts list different parts gives each of them all the listed parts. So a script that lists its parts sees at least those, and adding the list to a script that never reads the others changes nothing it does.
- Not inferred from the code: a script that walks `parts` (`for (const p of parts)`) and picks parts by a computed test cannot be read for what it needs. The list is the author's promise; the validator checks it where it can (`SCRIPT_PARTS`, a warning): a listed name that reaches no part, and a plain `get()` target (`get('jl', ...)`) whose parts the list leaves out. A type or tag test (`p.type === 'core'`) is not checked: it may be about a scanned robot's parts, which the list does not limit.
- `pnpm sim validate` rejects a list that is not a non-empty list of names (`BAD_SCRIPT`). The builder's script reference says so under `parts`.
- The titans: the bastion's pilot lists `fabbay`, `gun`, `anchor`, the juggernaut's `booster`, `rotator`, `heavyrotator`, `laser`, `gun`; their fights are the same tick for tick (self-duel hashes unchanged). The mirage's helm and the hive's pilot weigh every part for their center of mass and inertia, so they keep the whole list.

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

As built (M16, part strengths): every part object also carries `spec`, its definition's static numbers, so a script can add up what its engines can do and adapt when one is added or removed, instead of carrying "lift 120 per propeller" as a constant its owner must keep right by hand.

- `part.spec.in.<input>`: `{ min, max, default }` for each input (`p.spec.in.throttle.max`).
- `part.spec.config`: the numbers of the definition's `behaviorConfig`: a thruster's or propeller's `maxForce` (N), a gyro's `maxTorque` (N m), a rotator's `range` (radians) and `turnSpeed`, a wheel's `maxSpeed`, a piston's `stroke`. `{}` for a part without one.
- `part.spec.powerDraw` (J/s at full use) and `part.spec.maxHealth`.
- Every other block of the definition that holds numbers, under the definition's own name, with only its numbers: `p.spec.gun.speed` (a shell's speed, for leading a target), `p.spec.gun.range`, `p.spec.sensor.range`, `p.spec.resource.capacity`, `p.spec.joint.maxTorque`, `p.spec.cannon.charge`. Text, lists, and blocks inside blocks are left out. `pnpm sim parts --json` shows each definition.
- One rule for every part (`script/partSpec.ts`), never per part type: a new part's numbers show up without engine work.

```js
// Full lift, read off the parts: right for 2 propellers or 12, and for a thruster swapped in for one.
let lift = 0;
for (const p of parts) if (p.tags.includes('lift')) lift += p.spec.config.maxForce;
set('lift', 'throttle', clamp(self.mass * 9.81 / lift, 0, 1));
```

- It is the same frozen object for every part of a type, the last key of a part (`id, type, tags, pos, angle, mass, in, out, rot, on, spec`), and read-only like the rest: a write to it is ignored.
- It never changes, so it is not in the numbers sent every tick. The world hands every layout one JSON text for all part types (`ScriptLayout.specs`), and a script is sent it once, before its first layout; a part gets its type's object when it is made. A tick costs what it did.
- Existing scripts are unaffected and no golden hash changed. The one thing a script written before M16 can notice is the new key itself (`Object.keys(part)`, `JSON.stringify(part)`); no stock script lists a part's keys. The parity test now compares the spec too, on every part of every script call.
- The numbers are what the definition says, not what the part is doing: a damaged or unpowered thruster still reads its full `maxForce`.

As built (M16, which way a part acts and what carries it): three more things a script could not work out from positions, added for the shared behaviors below. They are sent with the layout like a part's tags, never per tick, and no golden hash changed.

- `part.rot`: how the part was built turned, in degrees counterclockwise (0, 90, 180, 270), as in its blueprint. `part.angle` is the angle of the body the part is on and says nothing of the part's own turn.
- `part.spec.acts`: for a part that acts along one of its faces (it pushes, fires, looks that way), that way when built unturned, in degrees counterclockwise from its body's x axis (90: up the grid). So the way a part acts in the world is `p.angle + (p.rot + p.spec.acts) * Math.PI / 180`: which way a propeller pushes, on any robot. Absent for a part that acts along no face.
- `part.spec.tip`: with `acts`, where the end it acts from is (a barrel's end), from the part's own position when built unturned: `{ x, y }` in meters. In the world: `pos` plus `tip` turned by `angle + rot` degrees. It is worked out as the world places a barrel's end (half a cell out of the middle of the cells farthest along `acts`), so a script no longer carries "the cannon's barrel is 3.5 m long and half a cell to the right" as params. From the definition's footprint: a stretchy part placed at another size still reads its default.
- `part.center` (M16 review, 2026-10-18): where the part's middle is, the middle of its cells, which each carry an equal share of its weight: `{ x, y }` in meters from the part's own position when built unturned, `0, 0` for a part of one cell (one shared frozen object). In the world: `pos` plus `center` turned by `angle + rot` degrees. `pos` is the part's first cell, which for a cannon is 1.6 m from its middle and for a fabricator bay meters, so Hover and Guide took their robot's center of mass to be off by that share (the hunter carrier 0.77 m, the cannon drone 0.51, the fab drone 0.48) and leaned and turned about the wrong point. It is per part, not in `spec`, because a stretchy part's middle depends on the size it was placed at (the carrier's bay is 10 by 4, its middle 4.5 m right of and 1 m above its first cell; the bay's default is 0, 2.3): the layout entry carries `[x, y]` after `rot` and `on` when it is not 0, 0 (`partCenter` in `World.ts`). `test/partCenter.test.ts` checks that the parts' middles give the world's center of mass on those three robots. No golden hash changed.
- `part.on`: the id of the joint part that carries the part, `''` for none: the joint whose turning or sliding side it is bolted to, through any number of welded parts. For a joint part itself it is the joint that carries what it is mounted on, so a chain (a gun on a hinge on a hinge) is walked one `on` at a time. This is how a script pairs each gun with the hinge that aims it, however the turret was built and whatever it is called. A joint that is locked, or lost its base, carries nothing. One rule for every joint part (`carriedBy` in `World.ts`), worked out again whenever the robot is rebuilt.
- `self.age` (M16): seconds since this robot was put in the world, or since its piece broke off what carried it (`Robot.spawnTick`). `time` is the world's clock, which in the app has been running long before any deploy, so "just deployed" is `self.age < 0.5`, never `time < 0.5`. Hover found this out: it took `time` for its age, climbed to its height in every headless test (those worlds start with the robot) and held where it was dropped in the app. It is the last number of `self` in the frame (`SELF` is 10), sent every tick; a script that lists the keys of `self` sees one more.
- `rot`, `on` and `center` come after `out` and before `spec`. Like `spec`, they are read-only, and the one thing an older script can notice is the new keys themselves. A layout built by hand without them (tests) gives parts without the keys. The parity test compares them on every part of every script call.

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
- `self`: `{ pos, vel, acc, angle, angVel, mass, energy: { stored, capacity } }` for the script's chunk. Provided by the core's built-in sensors (Q2). Under Unlimited energy a pool reads as full (`05`).
- `parts`: array of `{ id, type, tags, pos, angle, health, out }` for the chunk, where `out` holds that part's sensor outputs.
- `set(target, channel, value)`, `get(target, channel)`: write and read channels by tag.
- `keys.down(k)`, `keys.pressed(k)`, `keys.released(k)`.
- `param(name, default, opts)`: tunable parameter; current value comes from the blueprint.
- `state`: persistent object across ticks, cleared on `setup()`.
- `world.robots()`: `[{ id, pos, vel, isSelf }]` for targeting (Q10). Perfect information by design.
- `log(...)`: to the UI console, rate limited.
- `sleep(n)` (2026-10-22): skip the next n ticks; see Sleeping scripts below.
- `random()`: seeded per script instance.
- `clamp`, `lerp`, `sign`, and the normal `Math` functions except `Math.random`.

Unavailable: `Date`, `setTimeout`, `fetch`, `globalThis`, any DOM.

## Shared behaviors (M16)

A shared behavior is an ordinary script kept on a shelf: one `.js` file per behavior in `behaviors/` at the repo root (`hover.js`, `aim-and-fire.js`, `guide.js`). Adding one to a robot copies the file into the blueprint as that robot's own script. It must work on any robot with the right kind of parts, with no numbers typed in by hand, and keep working when the owner adds or removes a part. The pure functions are in `sim-core/src/script/shelf.ts`.

**The header.** Line comments at the top of the file; the header ends at the first line that is not blank or a `//` comment.

```js
// @behavior Hover
// @about Holds a height and stays level, on anything that lifts.
// @version 1
// @slot lift throttle "what lifts/pushes" required many owns guess up
// @slot level spin "what levels" optional many
// @needs sensor "something that sees, such as a radar"
// @note Anything worth telling whoever adds it.
```

- `@behavior <name>`, `@about <one line>`, `@version <whole number from 1>`, any number of `@note <text>`.
- `@slot <group> <input>[|<input>...] "<label>" [required|optional] [one|many] [owns] [guess <hint>...]`. Defaults: required, many.
  - A slot is a group (a tag) the builder puts on the parts the owner picked. It is typed by input, never by part type: any part with one of the inputs may fill it, so a behavior works on parts that did not exist when it was written.
  - `owns`: the behavior drives these parts every tick, so filling the slot takes them off their auto keys (a key held on an input beats a script, `Arbitration` above).
  - `guess` hints narrow the first guess the builder shows, never what may fill the slot: `up` (the part acts upward as built), `has:<output>` (it reports that output), `carries:<slot>` (a joint part that carries something guessed for that slot), `on:<slot>` (carried by something guessed for that slot). A turret is "a part with a fire input and a sight, on a joint with a turn input", said as `turn ... guess carries:fire` and `fire ... guess has:sightSide`.
- `@needs <block> "<label>"`: the robot must have a part whose definition has that block (`sensor`: something that fills `contacts`).
- `@from <shelf id> <version> [<sum>]`: only in a copy on a robot. See the copy and mark rule.
- `parseBehaviorHeader(source)` gives the name, the line about it, the version, the slots, the needs and the notes, and a list of problems in plain words with line numbers. Text with no `@behavior` line is an ordinary script: no header, no problems. Unknown `@` lines are reported and skipped.

**Slots on a robot.** `fitBehavior(blueprint, registry, header)` says for each slot which parts could fill it (they have one of its inputs), a first guess of which should, which are in the group already, and whether the behavior can work here at all, with the reason in words that follow its name ("needs something with a throttle input"). It reads inputs, outputs, how parts were built turned, and what carries what; never a part's type name. Parts of a placed copy that has its own core (a missile on a rail) are left out of the main robot's guess. `fillSlot(blueprint, registry, slot, ids)` makes the group exactly those parts. For a placed copy's own core, both work inside that core's scope (the tag is `missile1.push`).

**The copy and mark rule.** `attachBehavior(blueprint, shelfId, source)` adds a script entry whose code is the robot's own copy of the shelf file. The copy carries one more header line, `// @from hover 2 1d3ae929`: the shelf behavior and version it came from, and a check sum of the text as it was copied (`textSum`: FNV-1a over the text without the `@from` line, line ends as `\n`, blank lines at the end left out). `behaviorEdited(source)` says whether a copy still has that sum, so the builder can warn before an update replaces edits made on the robot; a mark written by hand without a sum reads as "cannot be told". The mark lives in the script's own text, not in the blueprint format, so it goes wherever the script goes (its `.js` file, a deploy, a replay, Save As) and `ScriptSpec` and the file format are unchanged. The copy has no file until the next save, which writes it next to the blueprint under the robot's name (`drone.hover.js`). Editing one robot's copy never changes the shelf or another robot. `behaviorOrigin(source)` reads the mark back; the shelf has a newer version when its `@version` is higher.

**What a behavior's code may do.** Anything a script may. To live up to "any robot, no numbers by hand" the first three follow these rules:
- Find parts by group, `p.tags.includes('lift')`, and check the input is there (`p.in.throttle !== undefined`). Drive each part by its id, `set(p.id, 'throttle', v)`.
- Read strengths from `p.spec`, places from `p.pos`, directions from `p.angle + p.rot + p.spec.acts`, the joint that carries a part from `p.on`, the robot's weight from `self.mass`. Work the rest out every tick, so an edit to the robot needs no retuning.
- Tell kinds of part apart by what they report and what their definition says (a `charged` output means charge and release; a `speed` in the block that says how its shot flies means lead the target), never by `p.type`.
- `param()` only for what a person would want to set. Every param has a `min` and a `max`, so the builder can draw a slider.
- When a slot is empty or the robot cannot do the job, say so once in the log in plain words ("Hover: the lifters hold 73 kg and this robot weighs 117 kg. It needs more lift.").

**The first shelf.**
- **Hover** (version 3: it goes by `self.age`, and uses lifters that push sideways): slots `lift` (throttle, required, owns; the guess is everything with a throttle, whichever way it points) and `level` (spin, optional). Params `height` (m it climbs when deployed, then holds), `hold` (how firmly), `climb` (m/s with W and S), `lean` (degrees with A and D), `keys` (0 switches W A S D off). Lifters in the group that point down push down when cutting the lift is not enough. Ones that point sideways push it along with A and D and brake its sideways speed with the keys let go, held back to what it can still level (a quarter of its turning power) and what its lift can carry; on the test robot that is 60 m/s after 3 s of D against 25 by leaning alone, and a stop in 4 s against 12. With nothing that levels it runs one side harder.
- **Aim and fire**: slots `turn` (turn, optional, owns, guess carries:fire) and `fire` (fire, required, guess has:sightSide); needs a sensor. Params `auto` (1 fires by itself, 0 fires only while F is held; aiming is always automatic) and `range` (m). Each firing part is aimed by the nearest joint up its `on` chain that is in `turn`; one on no joint fires when an enemy crosses its own sight. Shells and bolts are led by the `speed` of the part's own shot and raised by their drop; a part with no `speed` is a beam and fires only while its sight shows an enemy; a part with a `charged` output is held until it is full and let go on target. It never fires with its own robot or a friend first on a part's sight. It aims at the target's core; the stock turret scripts' choice of the best part to hit is not carried over.
- **Guide**: slots `push` (throttle, required, owns), `steer` (spin, swivel, or deflect; required, owns), `blast` (detonate, optional); needs a sensor. Params `fuse`, `clear`, `clearDist`, `proximity`. The arc over the top of the stock seeker guide is not carried over. It has one flight test (`shelfGuideDoneWhen.test.ts`): on three stock missiles it gets as near a block as each missile's own guide does, and the seeker missile reaches it. It has not been tried from a launcher's handoff, on a drone, or with swivels and fins, so it is the least proven of the three.

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
- One runtime per robot script: its own memory limit, interrupt counter, and crash blast radius. Budget is counted in interrupt-handler calls (about 10,000 bytecode poll points each), so it is deterministic. Starting limits: 50 calls per tick (200 since the titans tournament, 2026-10-01), 16 MB memory, 512 KB stack (64 KB since review D2, see As built).
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
- Sandbox: `createQuickJsHost(variant)` in `sim-core/src/script/quickjs.ts`; the app passes the single-file browser build, the CLI and tests the wasm-file build. One runtime per script, 200 interrupt calls per tick (50 until the titans tournament), 16 MB of memory, 64 KB of stack (256 until review D2, 512 before that; see the stack overflow note below). `Date` is not created; `Math.random` and `random()` are seeded per script from the world seed, the robot, and the script's place in the list.
- The API differs from the draft above in one name: the tick number is `frame`, because `tick` is the function the script defines. Scripts get `frame`, `dt`, `time`, `self` (`pos`, `vel`, `angle`, `angVel`, `mass`, `energy`), `parts` (id, type, tags, pos, angle, `in` channel values from the last tick, `out` outputs), `keys.down/pressed/released`, `set`, `get`, `state`, `param`, `log`, `random`, `clamp`, `lerp`, `sign`. `self.acc` and `world.robots()` wait until something needs them (M6 targeting).
- Order in a tick: key edges, then scripts (they see this tick's keys and last tick's channels and write the script layer), then channel values (manual beats script beats default), then behaviors and energy, then physics.
- Lifecycle: `enabled` starts a script at deploy (default on); a `script` binding flips it; turning on runs `setup()` with fresh `state`, then `tick()` on the same tick. A crash (budget, memory, stack, throw) disables it, emits a `scriptCrashed` event, and shows in the world; turning it on again recompiles. Enabled and crashed flags are hashed; the VM's own memory is not, and replays reproduce it by rerunning the same code from the same inputs.
- Logs: `log()` keeps at most 5 lines per call, 20 per robot per second, the last 200 in the world; the app shows the controlled robot's last 5.
- Files: `ScriptSpec.file` is the `.js` file in `blueprints/`. `toFileJson` writes `{ file }` references on save and inline code for deploys (`inlineScripts`), so the spawn log and replays carry the code. Save writes every script file, then the blueprint; Save As copies scripts to files named after the new blueprint (`drone-two.hover.js`) and leaves the originals. File names are handed out from one list for the whole blueprint, its other cores and its recipes, so a core scoped `child` and a recipe named `child` with a `guide` script each get `mother.child.guide.js` and `mother.child.guide-2.js`; and nothing is written while two scripts name one file (review E2).
- Known issue: a script that fills large arrays until it runs out of memory can stall for several seconds before it is stopped (QuickJS collects garbage on every allocation near the limit, and `fill` has no interrupt point). Endless loops, deep recursion, single huge allocations, and ordinary leaks stop within milliseconds. A wall-clock guard would break determinism, so it is not used.
- Stack overflow is always fatal (review D2, 2026-10-19). A script has 64 KB of QuickJS stack, about 340 plain calls deep. Past it the script crashes with `recursed too deep (stack overflow)`, even when it catches the error: the host fills the 8 KB past the limit with a known word before each call and looks at it after the call, at every interrupt, and in `send`, so a caught overflow is stopped by the (uncatchable) interrupt, sends nothing, and the tick ends as a stack crash. Before, QuickJS's own error could be caught while the host's own stack running out stopped the script, and which came first depended on how deep the host's stack already was: 256 KB of script stack took about 60% of Node's and Chrome's stack, so the same replay could end two ways. At 64 KB plain recursion takes about a quarter of the host's stack, and `stackOverflow.test.ts` steps a world from 60% down the host's stack, with both QuickJS builds, to the same hash. The script's stack lives in the wasm memory, so its depth is the same on every host.
- Known limit (D2): nesting that QuickJS walks in C uses far more host stack per level than script calls, so it can still run the host's stack out first. `JSON.stringify` of an array nested about 2,000 to 4,000 deep, deeply nested source given to `eval` or `Function` (a few hundred brackets), and `JSON.parse` of nesting in the thousands from a deep host stack. That is the same stack crash, but the depth at which it comes can differ by host. Each such crash also leaves the wasm stack pointer lower for good (the error unwinds past the code that restores it), by at most 72 KB: the host sets every script's stack from where the wasm stack starts now, so other scripts keep their full 64 KB, and after a megabyte of such crashes in one session every script stops with `too many scripts ran the stack out in this session: reload to run scripts again` rather than run into the memory below the stack.
- Review hardening (M5): the host's buffers, param specs, and `JSON` functions live in a closure captured before user code runs, and the host keeps its own handles to the entry functions, so reassigning globals only breaks the script. Output is shape-checked and capped (1000 writes, 5 logs of 300 characters per tick). Disposal is guarded: a stack overflow inside a built-in leaves QuickJS unable to free its runtime, so the runtime is abandoned (leaked) rather than let the error reach `World.step`.
- Replays are exact across V8 (Chrome, the desktop app, Node). Rotations use JavaScript's `Math.sin` and `Math.cos`, which other engines may round differently, so a replay saved in Safari or Firefox is not guaranteed to match.

## As built (M8, 2026-09-25): teams, sensors, messages
- **Teams:** `Robot.team` is a number (0 Logan's, 1 the enemy; a number so more sides need no format change). `spawnBlueprint(raw, at, { team })`; pieces keep their robot's team; the spawn log, replays, and the state hash carry it (a replay without it loads as 0). Scripts never see team numbers, only `side` in `contacts`.
- **Possession:** the app only takes over team 0 robots with a live core (`canPossess`). `,` and clicks skip enemies; clicking one follows it with the camera ("watching enemy") and shows its readout, read-only (`11`, Possession). Enemy robots run their scripts; their keys are never pressed.
- **Script API additions** (every tick, before the robot's scripts run, from positions after the last physics step, robots in spawn order):
  - `contacts`: `[{ id, side, core, pos, vel, center, mass, parts, distance, by }]`, nearest first (ties by id), for every robot its sensor parts see (`02`, Sensor parts). `side` is `enemy`, `friend`, or `none` (debris, headless). `pos` is the core's position (the center of mass's without one), `vel` the velocity of the body the core is on. A robot never sees itself; its attached missiles are its own parts, and released ones are friends.
  - `scan(id)`: a seen robot's parts (`id, type, pos, angle, health, maxHealth`) or null; a host call, so the cost is paid only on use; at most 4 per script per tick.
  - `scan(id, opts)` (M16, `script/scanOptions.ts`): picks parts on the host, so the script receives only what it asked for. Measured: a QuickJS context parsing the Anvil's 3094 parts took about 9 ms a call, and 6 lance drones scanning it every tick ran 58 ms a tick; asking for 150 parts (and later 1) brought the scene to 9 ms. Plain `scan(id)` is unchanged (its text made once per robot per tick). Options, read strictly (an unknown key or a wrong kind of value returns null and logs the reason once, since a quiet fallback would hand back every part again):
    - `near: { x, y }` with `most: n`: the n parts nearest the point, ties in blueprint order. `near` defaults to `from`; `most` with neither is an error.
    - `of: [names]`: parts whose id, type, or one of whose tags is a name (the `set()` target rule). `has: [names]`: parts whose definition has one of these inputs or outputs (`throttle`). Both must hold when both are given; `most` applies after them. A single name may be given without the list. Engine code never names a part type here; scripts do.
    - `from: { x, y }` and `wide` (default 0.5 m, at most 3: `WIDE_MAX`): each returned part is a copy with `cover` (summed health) and `coverParts` (count) of the robot's other parts whose middle is within `wide` of the line from the point to the part's middle, more than 0 and less than the part's distance minus 0.3 m along it (`COVER_GAP`: neighbours at the same depth do not count). Counted over every part the scan sees, not only those returned. Sums are added in blueprint order; many parts asked about are found by sorting every part by its angle from the point and looking only within the angle the line's width can take up, which gives the same parts as trying every one.
    - `acts: true` (M16, for the lifter hunter): each returned part that acts along one of its faces (it pushes, fires, or looks that way) is a copy with `acts`, the way it does so in the world in radians counterclockwise: its body's `angle` plus how it was built turned plus its definition's face, the same number as `angle + (rot + spec.acts) * Math.PI / 180` of a script's own part. Without it a script looking at another robot could not tell a thruster that lifts from one that pushes sideways or down, nor which way a fixed gun points. Off, nothing changes: a plain scan and every option before it return what they did.
    - Returned parts stay in blueprint order, so a robot smaller than `most` scans exactly as plain `scan(id)` (the stock scripts pass options only to a robot of more than `huge`, 600, parts, which keeps every golden hash). A robot seen at a decoy scans as the decoy's one part, options or not (`cover` 0). Options count toward the 4 calls. The host's work is bounded, not metered: picking is a few passes over the robot's parts, cheap next to a parse, and `cover` tests each part asked about against the parts that may be in front of it, which grows with the parts asked about times those near the line. So before testing any, the host counts the pairs, and past 250,000 (`COVER_TESTS_MAX`) the call returns null and logs why once (review 2026-10-18: four calls a tick for every part of the Anvil with `wide` 1e6, from beside it, took 2.3 s a tick). The stock scripts test at most about 15,000 pairs a call; every part of a 3000-part titan from 60 m off is about 200,000.
    - The prelude sends the options as JSON text (at most 4 KB) next to the id; the host answers with the parts' JSON or a line starting with `!` that the prelude logs.
    - Extremes cost one part each: the lowest part is the one nearest a point far under the robot (`near: { x, y: y - 1e6 }, most: 1`). The titan pilots that size up a huge enemy (`titan-juggernaut`, `titan-woodpecker`) take its four extremes this way; `titan-anvil` and `titan-palisade` still scan the whole robot every 2 s or so, since they read its rows, columns, and bands.
  - Fabricated copies (M12): a bay's finished copy is a placed copy made at run time, with the scope `<bay tag><n>` (the bay's `built` output is n), so a fire script sends it its target with `send('bay' + get('bay', 'built'), data)` and lets it go with `set('bay', 'release', 1)` on the same tick; the copy reads the message in `setup()` when it wakes.
  - Decoys (M11): a burning decoy (a flare, `02`) stands in for the robot it was part of when lit. When any of a robot's sensors sees one, that robot's contact is reported at the decoy: `pos` and `vel` are the decoy's (`center` keeps the robot's offset from it), `id`, `side`, `core`, `mass`, and `parts` the robot's, whether or not the robot itself is also in view; of several in view, the one nearest the viewer. A decoy still on its robot is just one of its parts. `scan(id)` of it returns what the sensor sees there: the decoy's part (so a careful script can notice it is looking at a flare, though not where the robot really is). A piece whose parts are all burning decoys for another robot is not listed as itself; a piece with anything else on it is. Contacts carry no decoy flag (the debug overlay marks them). The rule is on sensors, never on kinds of robots: whatever steers by contacts (a missile's guide, a drone bomb's pilot, a launcher's aim) is fooled as a consequence, a friend's sensors too.
  - Wheel spin: a wheel's `angularVelocity` output (`get('wheels', 'angularVelocity')`) is its spin against the body it is mounted on, radians a second, counterclockwise positive, after the last physics step: rolling forward (+x) is clockwise, so it reads negative, about -50 (`maxSpeed`) flat out. 0 for a wheel with no joint of its own. Before 2026-10-23 it was never filled in.
  - Gun sights (M13): a gun part's outputs, read with `get('gun', 'sight')` or `part.out`: `sight` (meters to the first thing straight out of its barrel, 100 for nothing; 150 until M15), `sightSide` (0 nothing, 1 its own robot, 2 a friend, 3 an enemy, 4 nobody's, 5 terrain), `sightId` (that robot's contact id), `aim` (the barrel's world angle, radians). From positions after the last physics step, like contacts. Shells hit whatever is in the way, friends and the shooter's own robot included: check the sight before firing.
  - Charged guns (M15): a cannon or a lance has the same four sight outputs (250 m and 400 m) plus `charged` (0 to 1). Hold `fire` to charge, let go at 1 to fire; letting go below 1 drains it. The sight is straight and the bolt drops, so at range a script aims above the target and cannot wait for the sight to show it.
  - Laser sights (M14): a laser part has the same four outputs, looking 300 m from its barrel's end (`get('laser', 'sightSide')`). A beam burns the first thing on that line, whoever's it is.
  - `send(to, data)`: `to` is a scope, a tag, or a core part id of a core attached to the sender's robot right now (no radio). JSON up to 1 KB, 16 calls per script per tick (counted before the data is turned into text) and 32 per robot; `sent` events are reported at most once a second per sender and receiver. The message waits on the core's `PartInstance` (so it survives splits, and it is hashed) and is shown in that core's `inbox` from the next tick; a dormant core keeps it (at most 16, oldest dropped) until it wakes, so `setup()` reads a launcher's handoff.
  - `mark(x, y, label)`: up to 4 points per tick for the debug overlay and the CLI side view. Not simulation state. Non-finite points are skipped, and `set()` ignores a NaN or infinite value with one log line (M8 review; both used to stop the script).
  - `contacts` and `inbox` are host-set globals, like `parts` and `self`: a script's own variable with that name is overwritten every tick.
  - `arena` (2026-10-22): the edge of a match's ground, fixed for the whole run: `{ x, y }` in meters, meaning a robot is in while `Math.abs(pos.x) <= arena.x && pos.y <= arena.y`, or `null` when there is none. `pnpm sim duel` and `tournament` give their bounds (`{ x: 1000, y: 250 }` by default, `--bounds 800,200` for others, `null` with `--bounds off`); the app's `?duel=a,b` page gives the same default; a plain sandbox world, the app's or `pnpm sim run`'s, gives `null`. The object is frozen and the global cannot be assigned (a write is ignored, a TypeError in strict mode); a script's own top level `let` or `const arena` still compiles and hides it. It is a world option (`WorldOptions.arena`, `world/arena.ts`), handed to each script when it is compiled, and carried by replays (`arena` in the file, absent for none). The world does nothing else with it: the CLI duel judges a main core out of bounds, and the app's duel page by the same rule (`inArena`). A titan that keeps away from the edge reads `arena` instead of carrying its own guess, and stays free in the sandbox when it is `null`.
  - A sensor sees nothing until it has been powered once (its first tick after deploy).
- **Checked before a run** (review 2026-10-09): `pnpm sim validate` compiles every script the way the world does and warns about one that would stop at t=0 (no `tick`, a syntax error, a throw at the top level), and about plain string targets and channels in `set()` and `get()` that reach nothing (`02`, Validator).
- **Reading a script without running it** (M16, `script/reading.ts`, pure, shared by the builder and `validate`): `readScript(source)` lists the plain quoted names a script uses with the line, column, and offsets of each (targets of `set()` and `get()` with their input or output name, `tags.includes('x')`, `.type === 'x'`, `.id === 'x'`) and flags targets built in code (`'grip' + k`, `set(p.id, ...)`, a template string), since the list is then not the whole story. From it: what each name reaches under the script's own core scope (`scriptReach`), names that reach nothing (`deadNames`, with the real names nearest first), parts that look like they belong to a script but are in none of its groups (`undrivenParts`, silent whenever the script builds a target in code or names the type), and what drives one part (`partDrivers`, for a swap). Since M16 `validate` warns (`SCRIPT_TARGET`) for a plain `set()` or `get()` name that reaches nothing: any tag, and a part type the robot lacks unless the script drives it as one of several (the same call on another name that does reach a part with that input: `NameReach.spare`); before, it spoke only for a near misspelling. What copies of one script share is said once with the count (`foldScriptIssues`; `02`, Validator). Names in a script's own tests are not judged (a `p.type === 'core'` may be about a robot it is looking at), and a target built in code is never guessed at.
- **Checks without running** (M16, `script/checks.ts`, pure, shared by the builder's script view and `validate`): `scriptChecks(source, blueprint, registry, scope)` gives, each with its exact spot in the text and the names that could stand there: a `set()` or `get()` name that reaches nothing; an input or output the named parts do not have; `contacts` or `scan` used when nothing on the robot (or, under a scope, on that placed copy) sees, decided by `robotSees` from the definitions' `sensor` and `radio` blocks, never from a part's name; and no `tick()`. `validate` says the third as `SCRIPT_SEES` (no stock robot has one); the others it already said through `scriptNameIssues` and the sandbox.
- **An AI is scripts:** `enemy-drone` has no engine AI; its pilot script flies, aims, launches, and dodges from `contacts`. `AiCoreSource` above is not needed.

