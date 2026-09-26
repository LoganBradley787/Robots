# 02 Parts and blueprints

Status: draft, 2026-09-22. Updated 2026-09-23 for M1 as built (defs in `packages/sim-core/src/parts/defs/`, `role`, `mountFrame`, legend arrows, validator codes), and 2026-09-24 for M7 (the `cell` part, rotator changes, placing blueprints as copies, `cores`, CLI helpers). Items tagged (Q#) depend on an open question in `07-open-questions.md`.

## Coordinates
- Physics frame: meters, x right, y up. One grid cell = one tile = 1 m (Q7).
- Grid cells are integer coordinates in the same frame.
- Rotation is 0, 90, 180, 270 degrees counterclockwise. Faces are N, E, S, W at rotation 0 and rotate with the part.
- In an ASCII grid, the first row is the top (highest y). Column 0 is x = 0.

## PartDef (data)
One JSON object per part type in `packages/sim-core/src/parts/defs/`, parsed by `parsePartDef` (unknown keys and bad values are errors naming the file and field). The authoritative type is `packages/sim-core/src/parts/types.ts`. Sketch:

```ts
interface PartDef {
  id: string;                       // "thruster"
  name: string;
  footprint: FootprintCell[];       // cells relative to origin at rotation 0. v1: one cell. (Q4)
  mass: number;                     // kg, whole part
  health: number;                   // v1: 1
  symmetry: 1 | 2 | 4;              // 1: all rotations identical (frame). 4: all distinct (thruster).
  inputs: ChannelDef[];             // { name, min, max, default }
  outputs: ChannelDef[];            // sensor channels this part publishes
  powerDraw: number;                // energy units per second at full command, scaled by |command|
  role?: "core";                    // control brain: roots the robot, owns bindings and scripts
  behavior?: string;                // behavior module id
  behaviorConfig?: Record<string, number>;
  joint?: JointSpec;                // moving parts: kind, mount face, collider of the moving body
  collider?: ColliderSpec;          // default: box filling the footprint
  resource?: { kind: "energy"; capacity: number };   // containers (battery)
  onDestroyed?: { explode?: { radius: number; impulse: number } };
  sprite: SpriteSpec;               // frame, mountFrame (joint parts: drawn on the parent body), animation, overlay (flame)
  defaultTags?: string[];
}
interface FootprintCell { x: number; y: number; faces: Face[] }   // faces that accept attachment
```

Behavior modules are tiny and generic: `init(instance)`, `tick(instance, ctx)`, `onDestroyed(instance, ctx)`. `ctx` exposes the chunk pool, physics force and motor calls, and the event bus. A behavior never knows about other part types.

## Starting parts
Numbers are first guesses to be tuned in one place (Q7). Faces listed are attachable faces at rotation 0.

| Part | Mass | Health | Faces | Inputs | Outputs | Notes |
|---|---|---|---|---|---|---|
| core | 2 | 50 | N E S W | | position, velocity, acceleration, angle, angular velocity, energy stored and capacity | Required for control. Scripts and bindings attach here. Built-ins decided (Q2) so nobody places accelerometers or battery monitors. Holds 600 energy. |
| frame | 1 | 60 | N E S W | | | Structural, and the armor: toughest per kilogram. |
| battery | 3 | 30 | N E S W | | charge fraction | Energy container, 1500 units (M4). A target: shoot it and the robot runs dry. |
| wheel | 1.5 | 25 | N (mount only) | speed [-1, 1] | angular velocity | Rotation 0 mounts to the cell above. Own body, revolute motor joint. |
| thruster | 1 | 25 | N E W | throttle [0, 1] | | Rotation 0: nozzle S, pushes +y. 160 N (Gate 6, was 120), 20 energy per second. Force at part position. Flame overlay when throttle > 0 and the robot has energy. |
| propeller | 1 | 15 | S E W | throttle [0, 1] | | Rotation 0: lift +y. 120 N (Gate 6, was 60), 10 energy per second. Spin sprite animation speed tied to throttle. The most fragile part. |
| decoupler | 1 | 30 | N E S W | fire (pulse) | armed | Rotation 0: release face N (its `acts`). On fire, N stops attaching once and both sides get 2 N s apart. Acts before other parts that tick (M6). |
| warhead | 1 | 20 | N E S W | detonate (pulse) | | Explodes on detonate, when destroyed (chains), or when a hit changes its body's speed by more than 5 m/s in one step. A one-part core-less blueprint of it is the bomb. |
| gyro | 1 | 30 | N E S W | spin [-1, 1], damp [0, 1] | | Reaction wheel (Gate 3): E and Q turn the robot, otherwise it damps spin. |
| rotator | 1.5 | 40 | N E S W | turn [-1, 1] | angle [-1, 1] | M6 (Q5). Rotation 0 mounts on the part below (S) and carries parts on N, E, W in its own body. Z and X swing its aim at up to 2 rad/s within +-90 degrees; it holds the aim otherwise. Position motor, 600 N m (M7, was 300). M7: it swings only as fast as it can stop what it carries (`sqrt(0.2 * maxTorque / inertia)`), and its aim never runs more than 0.15 rad ahead of the turret, so a heavy turret no longer swings far past where it was aimed. |
| cell | 0.5 | 10 | N E S W | | charge fraction | M7. A small battery, 250 units, legend `E`, builder key `-`. Made for missiles: the launcher's missile flew at thrust-to-weight 1.5 on a battery and 2.2 on a cell (3 since Gate 6's 160 N thruster). |
| seeker | 0.3 | 20 | E S W | on [0, 1] | | M8. Sensor, 90 degree cone, 300 m, 1 energy per second (see Sensor parts). Legend `S^ Sv S< S>`, key `=`. |
| radar | 1 | 40 | N E S W | on [0, 1] | | M8. Sensor, all around, 500 m, 3 energy per second. Legend `O`, key `;`. |
| booster | 1.5 | 25 | N E W | throttle [0, 1] | | Gate 7 (Logan: missiles were big and slow). A thruster for missiles: 400 N, 60 energy per second (a core's 600 is 10 s at full). Legend `K^ Kv K< K>`, key `'`. |
| heavywarhead | 1.5 | 20 | N E S W | detonate (pulse) | | Gate 7. 250 damage falling to 0 at 4 m, push 50 out to 6 m; same fuze as the warhead. Legend `H`, key `/`. Bombs keep the warhead. |
| heavygyro | 1.5 | 30 | N E S W | spin [-1, 1], damp [0, 1] | | Gate 7. 200 N m (the gyro is 40), 15 energy per second. A 6 kg missile swings its nose round in about half a second instead of over two. Legend `Y`, no builder key. The gyro stays 40 so the tuned drone hovers are unchanged. |

Health and blasts are tuned together (M6, `03`): a warhead does 120 at its center, falling to 0 at 3 m, so a lone frame breaks within 1.5 m, a battery within 2.25 m, a propeller within 2.6 m, and every part in the way halves it.

Wheel and propeller shorthand tokens in the default legend cover the common rotations (see below), so authors rarely write rotation numbers.

### Sensor parts (M8, as built)
A def with `sensor: { cone, range }` (degrees, 360 for all around, and meters) is a sensor, facing its `acts` face. The engine reads the field; no part type is special-cased. A `sensor` behavior draws power while the `on` input is above 0.5; switched off or unpowered, it sees nothing.
- `seeker` (legend `S^ Sv S< S>`, builder key `=`): 0.3 kg, health 20, 90 degree cone, 300 m, 1 J/s. Missiles carry one at the nose.
- `radar` (legend `O`, builder key `;`): 1 kg, health 40, all around, 500 m, 3 J/s.
- A robot is seen when its reference point (its live core, else its center of mass) is inside a working sensor's cone and range and a ray to it crosses no terrain or static block. Other robots never block. Scripts get what their robot's sensors see as `contacts` (see `04`).
- Still ideas, not built: a `scanner` that reports what is directly in front of it (for landing and terrain following: scripts cannot see the ground today), and a heat seeker that ranks targets by thruster heat.

## Blueprint JSON (canonical)

```json
{
  "format": 1,
  "name": "hover-drone",
  "grid": [
    ".  P  .  .  P  .",
    "F  F  C  B  F  F",
    "W  .  .  .  .  W"
  ],
  "legend": {
    "P": { "part": "propeller", "tags": ["props"] },
    "W": { "part": "wheel", "tags": ["wheels"] }
  },
  "bindings": [
    { "key": "a", "mode": "hold", "target": "wheels", "channel": "speed", "value": -1 },
    { "key": "d", "mode": "hold", "target": "wheels", "channel": "speed", "value": 1 },
    { "key": "f", "mode": "toggle", "target": "props", "channel": "throttle", "value": 1 },
    { "key": "h", "mode": "script", "script": "hover" }
  ],
  "scripts": [
    { "id": "hover", "enabled": false, "params": { "kp": 0.6, "kd": 0.2 }, "source": { "file": "hover.js" } }
  ]
}
```

- `grid` plus `legend` is the ASCII layout. Tokens are whitespace separated, `.` is empty. Multi-character tokens are allowed (`T>`).
- `parts` is an explicit list `{ id, part, x, y, rot, tags }` and may be used instead of `grid`. The editor saves `parts`. The loader accepts either and expands `grid` into `parts`. The editor can show and accept the grid form in a text box.
- Part ids default to `<part>@<x>,<y>` (for example `wheel@0,0`). Validator messages use these ids and the cell.
- Every part gets an implicit tag equal to its id, so binding and script targets are always a tag string.
- `source` is an inline string in memory and browser storage. On disk it may be `{ "file": "hover.js" }` relative to the blueprint file; loaders inline it. This keeps scripts as real `.js` files that Claude and editors handle well.
- `primaryCore` (optional part id) defaults to the first core in reading order. `corePriority` (optional list) orders takeover (Q1).
- Parts that need arming (M10): a def with `"arming": true` has an `arm` input (above 0.5 arms it for good) and an `armed` output; unarmed, its `onDestroyed.explode` and `impact` do not apply and its behavior may ignore its triggers (a warhead's `detonate`). Both warheads have it. A legend entry or part may carry `"armed": true` to start armed (the validator's `BAD_ARMED` refuses it on other parts); `toFileJson`, `place`, `mirror`, and `orient` keep it. The def's sprite may name an `armedFrame`, drawn while armed.
- `cores` (M7, optional): controls of cores other than the primary core, keyed by core part id: `"cores": { "core@8,6": { "scope": "missile1", "bindings": [...], "scripts": [...], "autoControls": false } }`. They start when that core's piece breaks off and wakes (`04`). Top-level `bindings`, `scripts`, and `autoControls` stay the primary core's. Script files for a core are named `<blueprint>.<scope or core id>.<script id>.js`, with anything but letters, digits, and dashes turned into dashes (`core@8,6` becomes `core-8-6`, `launcher1.missile1` becomes `launcher1-missile1`).

## Default legend
Shipped with the parts (`packages/sim-core/src/blueprint/legend.ts`). Blueprints can override or extend it. Arrow tokens point the way the part acts: thrust direction, lift direction, release direction, the side the wheel sits on relative to what it mounts to, or the side a rotator carries its turret on. So on the left end of a robot a thruster that attaches is `T>` (nozzle outward, pushes right), and a wheel hanging off the right side is `W>`.

```
C   core            F   frame           B   battery         X   warhead
W   wheel, mount up (hangs below)        W^  mount down (sits above)   W<  mount right (sits left)   W>  mount left (sits right)
T^  thruster pushing up (nozzle down)    Tv  pushing down    T<  pushing left    T>  pushing right
P   propeller lifting up                 Pv  lifting down
D   decoupler releasing up               Dv  releasing down  D<  releasing left  D>  releasing right
G   gyro
R   rotator carrying up (mounts below)   Rv  carrying down   R<  carrying left   R>  carrying right
```

### Placing a blueprint on another (M7, as built)
The first design had a legend token naming another blueprint file, so editing `missile` would change every launcher. Logan rejected live links: a placed blueprint is a **copy** that becomes ordinary parts of the robot. `placeBlueprint(target, source, at, registry, { rot, mirror })` in `sim-core/blueprint/place.ts` (used by `pnpm sim place` and the builder):
- The source's root part (primary core, else first core, else first part) lands on `at`. `mirror` flips it across that part's column first, then `rot` turns it around that cell. Overlaps with the target's parts are refused.
- Copied parts get ordinary position ids; bindings that named a part by id are renamed to its new id. Scripts must be loaded; they lose their `file` so the target saves them under its own names.
- When the target has a core, the copy gets a scope, `<name><n>` (`missile1`, the first free number). Every copied part is tagged `missile1`, its own tags become `missile1.<tag>`, and the source's controls move to its core's entry in `cores` with that scope. The target's `primaryCore` is written if it had none (saving writes parts in grid reading order, which would otherwise make a core placed higher up the pilot). A placed robot's own `cores` come along with nested scopes (`launcher1.missile1`).
- Scoped controls (`control/target.ts`, `scopedView`): every part answers to its id and its part type; members of the scope also answer to their `scope.<tag>` tags without the prefix; other parts' tags are hidden. So a missile's `set('thruster', ...)` reaches its own thruster only, and a warhead replaced by hand in the builder (no scope tags) is still found by type. The robot's own controls see the prefixed tags, so they reach a copy by `missile1`, `missile1.<tag>`, part type, or id.
- When the target has no core, everything is copied as it is, no scope. A core-less source's controls are dropped with a warning.
- The legend token that names a blueprint is still refused (`UNSUPPORTED`), with a message that points at placing.

Multi-cell footprints (Q4): the token marks the origin cell and each other covered cell is written as `=`. The validator checks coverage.

## Validator
Runs on load, on every editor change, and in the headless runner. Returns a list of `{ code, message, cell?, partId? }`. Errors block spawning; warnings do not. Examples:
- `NO_CORE`: "blueprint has no core; it will spawn as debris" (warning).
- `UNATTACHED`: "wheel@0,0 has no attached face (its mount face N touches nothing)".
- `DISCONNECTED`: "5 parts are not connected to the primary core: frame@4,0, ...".
- `LOCKED_JOINT` (M6): a rotator that cannot turn, because what it carries also touches its base another way, or a second joint carries the same parts (multibodies are trees).
- `OVERLAP`: "propeller@1,2 overlaps frame@1,2".
- `BAD_TARGET`: "binding key 'a' targets tag 'wheels' but no part has that tag".
- `BAD_CHANNEL`: "binding key 'f' writes channel 'speed' on tag 'props' but propeller has no input 'speed'".
- `UNKNOWN_TOKEN`: "grid token 'Q' at row 1 column 3 is not in the legend".
- `SCRIPT_SYNTAX`: "script 'hover' line 12: unexpected token" (M5, needs QuickJS).
- `BAD_CORE_CONTROLS` (M7): a `cores` key that is not a core in the blueprint, or the primary core (whose controls are the top-level fields). Binding checks (`BAD_TARGET`, `BAD_CHANNEL`, `BAD_KEY`, `BAD_SCRIPT_REF`) run for each core in its own scope, with messages prefixed `core <id> (<scope>): `.
- Also shipped in M1: `BAD_FORMAT`, `BAD_ROTATION`, `UNKNOWN_PART`, `EMPTY`, `DUPLICATE_ID`, `BAD_CONTINUATION`, `BAD_PRIMARY_CORE`, `BAD_CORE_PRIORITY`, `CHANNEL_SKIPPED` (warning: some tagged parts lack the channel), `BAD_SCRIPT_REF`, `BAD_BINDING`, `BAD_SCRIPT`, and `UNSUPPORTED` (sub-assembly legend entries until M6). The root part (primary core) is never reported `UNATTACHED`; the parts that fail to reach it are.

## Helpers for authors
- `mirror(blueprint, axis)`: reflects the grid and rotations, fixes wheel and thruster tokens.
- `toGrid(blueprint)`: renders a `parts` blueprint back into `grid` plus `legend` text for display or copy.
- Both are pure functions in `blueprint/` with tests, so Claude can call them from the CLI.
- As built (M7): `mirrorBlueprint(bp, axisHalfCells)` also renames everything that names a part by id (binding targets, `primaryCore`, `corePriority`, `cores`); scripts are copied unchanged. The CLI (`docs/claude-robot-playbook.md` has the full list): `pnpm sim parts` (every part def as a table), `show` (grid via `toGrid`, mass, bodies, every core's controls), `mirror <bp> [--axis] [--save]`, `place <target> <source> --at x,y [--rot] [--mirror] [--save]`, and `run`, whose report lists events in order, every piece's final state, and an ASCII side view of every piece's path.
