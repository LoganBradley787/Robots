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
| radar | 1 | 40 | N E S W | on [0, 1] | | M8. Sensor, all around, 1000 m (500 until Logan doubled it, 2026-09-28), 3 energy per second. Legend `O`, key `;`. |
| booster | 1.5 | 25 | N E W | throttle [0, 1] | | Gate 7 (Logan: missiles were big and slow). A thruster for missiles: 400 N, 60 energy per second (a core's 600 is 10 s at full). Legend `K^ Kv K< K>`, key `'`. |
| heavywarhead | 1.5 | 20 | N E S W | detonate (pulse) | | Gate 7. 250 damage falling to 0 at 4 m, push 50 out to 6 m; same fuze as the warhead. Legend `H`, key `/`. Bombs keep the warhead. |
| heavygyro | 1.5 | 30 | N E S W | spin [-1, 1], damp [0, 1] | | Gate 7. 200 N m (the gyro is 40), 15 energy per second. A 6 kg missile swings its nose round in about half a second instead of over two. Legend `Y`, no builder key. The gyro stays 40 so the tuned drone hovers are unchanged. |
| fabbay | 1 per cell (13 at its default) | 150 | outer faces; grips on its hollow | release (lets go) | ready, progress, built | M12. A fabricator bay (see Fabricators): a U open at the top whose hollow is sized where it is placed (`size`, 1 to 8 wide, 1 to 10 tall; default 1 by 5). Builds its recipe (`makes`) from energy. No legend token (it always needs `makes`), no builder key. |
| flare | 0.2 | 5 | S (its base) | ignite (lights it for good) | burning | M11. A decoy (see Decoys): burns 2 s once lit, then is gone without a blast; while it burns, sensors take it for its robot. Legend `Q^ Qv Q< Q>` (the way it points), no builder key. |
| gun | 1 | 25 | S (its base) | fire (while above 0.5) | sight, sightSide, sightId, aim | M13. A gun (see Guns): 10 shells a second out of its front at 300 m/s, 5 damage to the first part each hits (anyone's), 2 N s of kick; its sight looks 150 m straight out of the barrel. No energy. Legend `M^ Mv M< M>` (the way it fires), no builder key. |

Health and blasts are tuned together (M6, `03`): a warhead does 120 at its center, falling to 0 at 3 m, so a lone frame breaks within 1.5 m, a battery within 2.25 m, a propeller within 2.6 m, and every part in the way halves it.

Wheel and propeller shorthand tokens in the default legend cover the common rotations (see below), so authors rarely write rotation numbers.

### Multi-cell parts (M12, as built)
A footprint lists its cells, each with its own faces, and may have a hole: cells inside its bounding box that are not its own (a hollow). Other parts may sit in a hollow. Each cell is a collider with the mass split among them. A blast reaches a multi-cell part at every cell: the part takes its worst cell's damage and the push of all its cells. Its sprite spans its footprint's bounding box (`footprintBox`), turned with the part; the builder's ghost, hover, selection, and eraser cover every cell. Mirroring a footprint that is not symmetric about its origin column is refused (`mirrorProblem`: a mirrored copy would be a different part, not a rotation). A cell may list `grips`: faces that attach only while the part is `holding` (a new PartInstance field, hashed).
- **Stretchy parts (Logan: sized where placed):** a def with `stretch: { shape: "cup", min, max, massPerCell }` has its footprint made from the placed part's `size` (`[w, h]`, the hollow): a U open on its `acts` face, floor and walls one cell thick, grips on the floor under the hollow and the walls' inner faces. Its def lists its default-size footprint. Mass is `massPerCell` per cell; health is the def's at any size. `BAD_SIZE` for a size out of range or on a part that does not stretch. Its sprite is `tiles` (floor, corner, wall, mouth, back), one per cell. Mirroring moves its origin so its cells match (`mirroredShift`).

### Fabricators (M12, as built)
A def with `fabricate: { joulesPerKg, secondsPerKg, separation }` builds things; it needs grips, `acts`, a `release` input, and `ready`, `progress`, `built` outputs. Shipped: `fabbay`.
- **Recipes live in the blueprint:** a part's (or legend entry's) `"makes": "<name>"` names one of the blueprint's `"recipes": { "<name>": <a whole blueprint> }`. Recipe scripts are files named `<host>.<recipe>.<script>.js` (or inline). The validator checks each recipe on its own (`recipe <name>: ...`), that `makes` is on a fabricator (`BAD_MAKES`) and names a recipe (`BAD_MAKES`), and that the recipe fits the hollow and touches a grip (`BAD_RECIPE`). A recipe cannot have recipes of its own.
- **Where it sits:** the recipe as it is (turned only with the bay), its bounding box's bottom-left cell on the hollow's bottom-left cell (`recipePlacement`).
- **Building:** empty, the bay works on its recipe at up to its `powerDraw` (400 J/s): it costs `joulesPerKg` times the recipe's mass plus the energy its containers hold (they start full, so building never makes energy), over `secondsPerKg` times its mass. A `missile-up` (6.8 kg, a core) costs 872 J over 4.1 s. A brownout slows it; an empty pool stops it. `progress` (0 to 1) is hashed.
- **Finishing:** when the hollow is clear (ball probes a little smaller than a cell: the last copy may still be sliding out), the recipe is placed into the live robot as `pnpm sim place` would, with the scope `<the bay's first tag><n>` (`bay1`, `bay2`: n is the bay's `built` count), a sleeping core, full health, warheads unarmed. The bay's `holding` becomes true, the robot is rebuilt, and its controller is rebuilt with the new parts' controls, keeping held keys and toggles (`Controller.carryFrom`). Event `built`.
- **Letting go:** `release` above 0.5 while holding stops the grips; the rebuild splits the copy off as its own piece (its core wakes as a missile let go from a decoupler does), pushed out along `acts` with `separation` N s spread over its parts, the bay the other way. Event `released`. A copy with no motor stays in a bay that points up, and blocks the next.
- **Half-built:** the copy has no body until finished (Logan: a hit is on the bay as a whole). A bay destroyed mid-build loses its progress.

### Guns (M13, as built)
A def with `gun: { speed, damage, rate, life, recoil, range }` is a gun; it needs `acts` (the way it fires), a `fire` input, and `sight`, `sightSide`, `sightId`, `aim` outputs (the parser refuses one without). The engine reads the field; no part type is special-cased. Shipped: `gun` (300 m/s, 5, 10 a second, 1 s, 2 N s, 150 m).
- **Spread** (Logan, after Gate 12): each shell leaves up to `spread` degrees (0.5 on the gun) off the barrel's line, center weighted (two draws averaged). The draws are a hash of the world's seed, the tick, the robot, and the gun, not a random stream: nothing new to keep or hash, and a gun firing changes nothing else's numbers. The sight stays the barrel's straight line.
- **Firing:** right after the physics step, a gun whose `fire` input is above 0.5 fires once every `1 / rate` seconds (`PartInstance.cooldown`, ticks, hashed). A wreck (no core in charge) fires nothing. The shell leaves the middle of its front face at `speed` along the barrel plus the velocity of that point, and the gun gets `recoil` N s back.
- **Shells are not bodies:** a shell is a point the world keeps (`World.liveShells()`: position, velocity, owner, ticks left; hashed only while any exist). Each tick it falls under gravity and moves one step along a Rapier ray: the first collider on the way, anyone's but its own gun's (friends and its own robot too), takes `damage` and a push of `recoil` N s along its path, and the shell is gone; terrain just stops it. The ray also reaches 10 m (600 m/s times dt) behind where the shell was, and a hit there counts when that body moved toward the shell enough this tick to have been ahead of it at the start (rays see bodies where they end the tick; without it a missile closing at 130 m/s let one shell in six through). Why not bodies: at 5 m a tick a ball would pass through 1 m cells without continuous collision, and as robots shells would show up on every radar. They do not bounce or hit each other. Casting right after the step matters: Rapier's query index is fresh then (a spike, M13: a collider made after the step is missed until the next one).
- **Pushes that do not unsettle:** a gun's kick and a shell's push are marked quiet: they are too small to trip a fuze, and a robot under fire keeps its fuzes (other pushes switch the impact check off for two ticks).
- **The sight** (a sensor, straight): each tick after the step, a ray from the barrel's end along its real pose (not the rotator's `angle`, which is the commanded aim), `range` long, skipping its own collider. `sight` is the distance to the first thing (`range` for nothing), `sightSide` what it is (0 nothing, 1 its own robot, 2 a friend, 3 an enemy, 4 nobody's, 5 terrain: the rule contacts use), `sightId` that robot's contact id, `aim` the barrel's world angle. A burning flare let go by a robot reads as that robot. Derived each tick, not hashed. Aiming ahead of a moving target and allowing for drop is the script's job, from contacts; the sight is the last "clear to shoot" check.
- **Events:** `shellHit` per hit (part, robot, shooter, damage); no event per shot (`World.shotsBy(robot)` counts them for reports).

### Decoys (M11, as built)
A def with `decoy: { burn }` (seconds) is a decoy; it needs an `ignite` input and a `burning` output (the parser refuses one without). The engine reads the field; no part type is special-cased. Shipped: `flare`.
- Its `ignite` input above 0.5 lights it for good, attached or not, before behaviors run: a grip let go on the same tick lets it go burning. It records the robot it was part of (`decoyOf`) and burns `burn` seconds counted in ticks (`PartInstance.burn`, both in the state hash), then is destroyed without a blast (`partDestroyed` with `burntOut: true`, after a `burntOut` event).
- While it burns, every sensor that sees it takes it for that robot (the rule is in `04`, contacts). A flare attaches only by its base (its S face at rotation 0), so flares stacked in a rack do not hold each other on.
- The sprite's `litFrame` is drawn while it burns; the app adds a glow.

### Sensor parts (M8, as built)
A def with `sensor: { cone, range }` (degrees, 360 for all around, and meters) is a sensor, facing its `acts` face. The engine reads the field; no part type is special-cased. A `sensor` behavior draws power while the `on` input is above 0.5; switched off or unpowered, it sees nothing.
- `seeker` (legend `S^ Sv S< S>`, builder key `=`): 0.3 kg, health 20, 90 degree cone, 300 m, 1 J/s. Missiles carry one at the nose.
- `radar` (legend `O`, builder key `;`): 1 kg, health 40, all around, 1000 m (500 before 2026-09-28), 3 J/s.
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
