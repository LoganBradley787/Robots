# 02 Parts and blueprints

Status: draft, 2026-09-22. Updated 2026-09-23 for M1 as built (defs in `packages/sim-core/src/parts/defs/`, `role`, `mountFrame`, legend arrows, validator codes). Items tagged (Q#) depend on an open question in `07-open-questions.md`.

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

| Part | Mass | Faces | Inputs | Outputs | Notes |
|---|---|---|---|---|---|
| core | 2 | N E S W | | position, velocity, acceleration, angle, angular velocity, energy stored and capacity | Required for control. Scripts and bindings attach here. Built-ins decided (Q2) so nobody places accelerometers or battery monitors. |
| frame | 1 | N E S W | | | Structural. |
| battery | 3 | N E S W | | charge fraction | Energy container, capacity 600 units. |
| wheel | 1.5 | N (mount only) | speed [-1, 1] | angular velocity | Rotation 0 mounts to the cell above. Own body, revolute motor joint. |
| thruster | 1 | N E W | throttle [0, 1] | | Rotation 0: nozzle S, pushes +y. Force at part position. Flame overlay when throttle > 0. |
| propeller | 1 | S E W | throttle [0, 1] | | Rotation 0: lift +y. Spin sprite animation speed tied to throttle. |
| decoupler | 1 | N E S W | fire (pulse) | armed | Rotation 0: release face N. On fire, N becomes non-attachable and a small separation impulse is applied. |
| warhead | 1 | N E S W | detonate (pulse) | | Decided (Q11). Explodes on detonate, on destruction, or on hard impact. A one-part core-less blueprint of it is the test bomb. |

Wheel and propeller shorthand tokens in the default legend cover the common rotations (see below), so authors rarely write rotation numbers.

### Deferred sensor parts (Logan's spec, not in v1)
Sensor parts are ordinary parts with output channels, mass, and power draw. Nothing in the engine changes when they arrive.
- `scanner`: reports what is directly in front of it: `hit` (0 or 1), `distance`, and a `kind` code (terrain, part, core).
- `finder`: a cone of 30 or 60 degrees (a def parameter) that locks the nearest enemy core in range and reports `found`, `distance`, and `bearing` relative to the part's facing. Several defs at different power levels (range against power draw) are just more data.
- Heat seeker: the finder variant that ranks targets by thruster heat instead of distance, once thrusters emit heat.

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

## Default legend
Shipped with the parts (`packages/sim-core/src/blueprint/legend.ts`). Blueprints can override or extend it. Arrow tokens point the way the part acts: thrust direction, lift direction, release direction, or the side the wheel sits on relative to what it mounts to. So on the left end of a robot a thruster that attaches is `T>` (nozzle outward, pushes right), and a wheel hanging off the right side is `W>`.

```
C   core            F   frame           B   battery         X   warhead
W   wheel, mount up (hangs below)        W^  mount down (sits above)   W<  mount right (sits left)   W>  mount left (sits right)
T^  thruster pushing up (nozzle down)    Tv  pushing down    T<  pushing left    T>  pushing right
P   propeller lifting up                 Pv  lifting down
D   decoupler releasing up               Dv  releasing down  D<  releasing left  D>  releasing right
```

A sub-assembly is placed with a legend token: `"m": { "blueprint": "missile", "rot": 0, "mirror": false, "tags": ["missiles"] }`. The sub-blueprint's primary core lands on the token cell. Its parts merge into the parent with an id prefix (`m1/thruster@0,1`). Its bindings and scripts attach to its own core. Overlaps are validation errors.

Multi-cell footprints (Q4): the token marks the origin cell and each other covered cell is written as `=`. The validator checks coverage.

## Validator
Runs on load, on every editor change, and in the headless runner. Returns a list of `{ code, message, cell?, partId? }`. Errors block spawning; warnings do not. Examples:
- `NO_CORE`: "blueprint has no core; it will spawn as debris" (warning).
- `UNATTACHED`: "wheel@0,0 has no attached face (its mount face N touches nothing)".
- `DISCONNECTED`: "5 parts are not connected to the primary core: frame@4,0, ...".
- `OVERLAP`: "propeller@1,2 overlaps frame@1,2".
- `BAD_TARGET`: "binding key 'a' targets tag 'wheels' but no part has that tag".
- `BAD_CHANNEL`: "binding key 'f' writes channel 'speed' on tag 'props' but propeller has no input 'speed'".
- `UNKNOWN_TOKEN`: "grid token 'Q' at row 1 column 3 is not in the legend".
- `SCRIPT_SYNTAX`: "script 'hover' line 12: unexpected token" (M5, needs QuickJS).
- Also shipped in M1: `BAD_FORMAT`, `BAD_ROTATION`, `UNKNOWN_PART`, `EMPTY`, `DUPLICATE_ID`, `BAD_CONTINUATION`, `BAD_PRIMARY_CORE`, `BAD_CORE_PRIORITY`, `CHANNEL_SKIPPED` (warning: some tagged parts lack the channel), `BAD_SCRIPT_REF`, `BAD_BINDING`, `BAD_SCRIPT`, and `UNSUPPORTED` (sub-assembly legend entries until M6). The root part (primary core) is never reported `UNATTACHED`; the parts that fail to reach it are.

## Helpers for authors
- `mirror(blueprint, axis)`: reflects the grid and rotations, fixes wheel and thruster tokens.
- `toGrid(blueprint)`: renders a `parts` blueprint back into `grid` plus `legend` text for display or copy.
- Both are pure functions in `blueprint/` with tests, so Claude can call them from the CLI.
