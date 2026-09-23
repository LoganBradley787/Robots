# M1 Parts, Blueprints, and Assembly Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development. Read `CLAUDE.md`, `docs/START-HERE.md`, and `docs/status.md` first. Tests first inside `sim-core`, one commit per task (`M1 T<n>: <what>`), tree green at every commit, `docs/status.md` updated at session end.

**Goal:** Robots made of grid parts. Parts are JSON data, blueprints are JSON with an ASCII grid, a validator explains what is wrong, the assembler turns a blueprint into compound Rapier bodies with wheels on motor joints, the headless runner reports how a robot comes to rest, and the app draws every part with placeholder sprites in a world that looks like a place. Ends at Gate 1 (Look).

**Written by:** an Opus 5.5 coding session on 2026-09-23. Logan asked this session to write the plan and run straight through M1 to Gate 1 without a separate approval stop. Every judgment call is listed under "Decisions made in this plan" so Logan can overturn any of them at the gate.

**Spec:** `docs/design/02-parts-and-blueprints.md`, `docs/design/03-assembly-physics-destruction.md` (compound bodies, joint parts, solver settings), `docs/design/01-architecture.md` (module map, runtime entities), `docs/design/06-milestones.md` (M1), `docs/design/08-tech-stack.md` (rendering conventions, assets), `docs/research/rapier2d.md` sections 3 and 5, `docs/research/rendering-and-tooling.md` sections 2 to 5.

## Global constraints (in addition to M0's)

- Parts are data. No `if (def.id === 'wheel')` anywhere outside `packages/app/scripts/gen-placeholders.ts` (art is per part by nature). Engine code branches on data fields (`def.joint`, `def.collider.shape`), never on part ids.
- `sim-core` stays pure: no DOM, no Node. JSON is imported with `import x from './defs/x.json'`.
- Rapier types stay inside `sim-core/src/physics/`. Assembly produces plain specs; `PhysicsWorld` turns them into Rapier objects.
- Stable order everywhere: parts in blueprint order (grid reading order: top row first, left to right), body groups in order of their first part, bodies created in that order.
- Coordinates: one cell = 1 m. Grid row 0 is the top (highest y). The bottom row is y = 0. Column 0 is x = 0.
- Rotations are 0, 90, 180, 270 CCW. Face rotation CCW by 90: N to W, W to S, S to E, E to N.
- No em dashes anywhere.

## Decisions made in this plan (Claude's call, overturnable at Gate 1)

1. Part defs are JSON files in `packages/sim-core/src/parts/defs/`, parsed by `parsePartDef` with path-named errors, so a bad def fails loudly at load.
2. Joint parts (wheels) carry a `mountFrame` sprite that is drawn on the parent body, so the axle bracket stays fixed while the tire spins. Generic: any part with `sprite.mountFrame` and a joint gets it.
3. Placeholder textures are 64 px per cell, drawn at 2x the 32 px-per-meter zoom-1 size, linear filtering. Reason: crisp on Retina at zoom 1 and still clean at 2x zoom; `nearest` would drop pixel rows on a 2x downscale. Terrain tiles are standalone PNGs (not in the atlas) so they can repeat. `08` is updated to match.
4. Wheels: ball radius 0.45, friction 1.0, revolute joint with contacts disabled between wheel and parent, `ForceBased` velocity motor with target 0 (acts as a brake), `maxSpeed` 20 rad/s, `maxTorque` 12 N m, `motorFactor` 4. Tuned at Gate 3.
5. Spawn: the primary core (or the first part of a core-less blueprint) lands with its cell center on the given point, rotation 0. The main body's origin is that cell, so the body translation is the core position.
6. Out of M1 scope, reserved in the format: sub-assembly legend tokens (`{ "blueprint": ... }`, M6) give an `UNSUPPORTED` error; `SCRIPT_SYNTAX` waits for QuickJS (M5); `mirror()` waits for the editor (M2). `toGrid()` ships now because the CLI uses it.
7. `World.spawnBox` is removed. The M0 tests and CLI move to blueprints.
8. The app spawns two robots: `car` at the world spawn point and `showcase` (every part in several rotations) 10 m to its right. `C` cycles the camera target. Debug outlines start hidden; `D` shows them. A faint 1 m grid (toggle `G`) sits behind the world to make scale readable.
9. World look: a tiled ground with a lighter top edge, tiled concrete for static boxes and the ramp, a dark blue-gray background. Everything is a PNG through the manifest.

## File structure

```
blueprints/car.json                      six-wide car, core in the middle, wheels under the ends
blueprints/showcase.json                 every part type, several rotations, rests on wheels
packages/sim-core/src/
  parts/types.ts                         Face, FootprintCell, ChannelDef, JointSpec, ColliderSpec, SpriteSpec, PartDef
  parts/faces.ts                         rotateFace, faceDir, opposite, rotateCell, rotateVec, attachableFaces
  parts/parsePartDef.ts                  unknown -> PartDef, PartDefError with paths
  parts/defs/*.json                      core, frame, battery, wheel, thruster, propeller, decoupler, warhead
  parts/registry.ts                      PartRegistry { get, has, list }, defaultRegistry()
  blueprint/types.ts                     BlueprintJson, LegendEntry, PlacedPart, Blueprint, Binding, ScriptSpec, Issue
  blueprint/legend.ts                    DEFAULT_LEGEND
  blueprint/expand.ts                    parse raw JSON + expand grid/parts -> { blueprint?, issues }
  blueprint/toGrid.ts                    Blueprint -> { grid, legend } text
  blueprint/validate.ts                  validateBlueprint(raw, registry) -> { blueprint?, issues, ok }
  assembly/assemble.ts                   attachment graph, chunks, body groups, joints (pure, no physics)
  assembly/spawn.ts                      AssemblyPlan + registry + PhysicsWorld -> Robot
  world/Robot.ts                         Robot, Chunk, BodyGroup, PartInstance (runtime entities)
  metrics/robotMetrics.ts                pose, tilt, speed, resting, mass, center of mass
  physics/PhysicsWorld.ts                + createBody, addCollider, createRevoluteJoint, massProperties
packages/cli/src/
  blueprintFiles.ts                      resolve a name or path, read JSON
  commands/run.ts, determinism.ts        blueprint-based
  commands/validate.ts, show.ts          new
packages/app/
  scripts/gen-placeholders.ts            pngjs rasterizer -> public/assets
  public/assets/manifest.json, sheets/parts.{json,png}, sheets/fx.{json,png}, terrain/*.png
  src/render/assetKeys.ts, assets.ts     frame name constants, Assets.init + loadBundle
  src/render/RobotView.ts                one Container per body, one Sprite per part (+ mount sprites)
  src/render/TerrainView.ts              ground and static boxes as tiling sprites
  src/render/GridView.ts                 faint 1 m grid
  src/main.ts                            spawns blueprints, camera targets, keys
```

## Task dependencies

T1 -> T2 -> T3 -> T4. T5 is independent of T1 to T4. T6 needs T3, T4, T5. T7 needs T6. T8 needs T1 only. T9 needs T6 and T8. T10 needs T9.

---

### Task 1: Part types, faces, defs, registry

**Files:** `parts/types.ts`, `parts/faces.ts`, `parts/parsePartDef.ts`, `parts/defs/*.json` (8), `parts/registry.ts`, index exports. Tests: `test/faces.test.ts`, `test/partDefs.test.ts`.

**Types:**
```ts
export type Face = 'N' | 'E' | 'S' | 'W';
export type Rotation = 0 | 90 | 180 | 270;
export interface FootprintCell { x: number; y: number; faces: Face[] }
export interface ChannelDef { name: string; min: number; max: number; default: number }
export interface JointSpec { kind: 'revolute'; mountFace: Face; motor: 'velocity' | 'position' }
export interface ColliderSpec { shape: 'box' | 'ball'; radius?: number; friction?: number }
export interface SpriteSpec { frame: string; mountFrame?: string; animation?: string; overlay?: string }
export interface ResourceSpec { kind: string; capacity: number }
export interface PartDef {
  id: string; name: string; footprint: FootprintCell[]; mass: number; health: number;
  symmetry: 1 | 2 | 4; inputs: ChannelDef[]; outputs: ChannelDef[]; powerDraw: number;
  behavior?: string; behaviorConfig?: Record<string, number>; joint?: JointSpec; collider?: ColliderSpec;
  resource?: ResourceSpec; onDestroyed?: { explode?: { radius: number; impulseRadius: number; impulse: number } };
  sprite: SpriteSpec; defaultTags?: string[];
}
```

**faces.ts:** `FACES = ['N','E','S','W']`; `faceDir(f)` gives the unit cell offset (N = (0,1)); `opposite(f)`; `rotateFace(f, rot)` applies CCW steps (N to W at 90); `rotateCell({x,y}, rot)` rotates an offset CCW (90: (x,y) -> (-y,x)); `rotateVec` same for floats; `rotationRadians(rot)`.

**Defs (values):**

| id | mass | faces (rot 0) | inputs | outputs | powerDraw | extra |
|---|---|---|---|---|---|---|
| core | 2 | NESW | | posX, posY, velX, velY, accX, accY, angle, spin, energy, energyCapacity | 0 | sprite `part.core` |
| frame | 1 | NESW | | | 0 | symmetry 1, `part.frame` |
| battery | 3 | NESW | | charge [0,1] | 0 | resource energy 600, `part.battery` |
| wheel | 1.5 | N | speed [-1,1] | angularVelocity | 5 | joint revolute mount N velocity; collider ball r 0.45 friction 1.0; behaviorConfig maxSpeed 20, maxTorque 12, motorFactor 4; sprite `part.wheel`, mountFrame `part.wheel.mount` |
| thruster | 1 | NEW | throttle [0,1] | | 20 | behaviorConfig maxForce 60; sprite `part.thruster`, overlay `fx.flame` |
| propeller | 1 | SEW | throttle [0,1] | | 10 | behaviorConfig maxForce 40; sprite `part.propeller`, animation `fx.propeller` |
| decoupler | 1 | NESW | fire [0,1] | armed [0,1] | 0 | behaviorConfig separationImpulse 2, releaseFace N (encode as `joint`? no: `behaviorConfig.releaseFaceIndex` 0 = N); `part.decoupler` |
| warhead | 1 | NESW | detonate [0,1] | | 0 | onDestroyed explode radius 3 impulseRadius 5 impulse 30; `part.warhead` |

Every def: `health` 1, footprint `[{x:0,y:0,faces}]`, `behavior` equal to the id where it will have one later (wheel, thruster, propeller, decoupler, battery, core, warhead), channel defaults 0 (armed default 1). Symmetry: frame 1, battery and core and warhead 4 (their sprites have a marked top), others 4.

**parsePartDef(raw, path):** validates every field with messages like `parts/wheel.json: joint.mountFace must be one of N, E, S, W`. Rejects unknown keys. Checks: footprint non-empty, faces unique, mass > 0, health > 0, channel min <= default <= max, joint.mountFace is in footprint[0].faces, collider ball needs radius in (0, 0.5].

**registry:** `class PartRegistry { constructor(defs: PartDef[]); get(id): PartDef (throws with the list of known ids); has(id); list(): PartDef[] (insertion order) }`, `defaultRegistry()` parses the 8 JSON files once (memoized).

**Tests (write first):**
- rotateFace N at 90/180/270 gives W/S/E; rotateCell (1,0) at 90 gives (0,1); four 90s are identity for every face.
- defaultRegistry lists exactly the 8 ids in table order; each def has health 1 and sprite.frame starting with `part.`.
- wheel def: joint mountFace N, collider ball radius 0.45, faces ['N'].
- parsePartDef rejects: missing mass (message names `mass`), unknown key, default outside range, mountFace not attachable, ball without radius.
- registry.get('nope') throws a message listing known ids.

**Done when:** tests pass, typecheck passes (sim-core still has no DOM or Node types).

---

### Task 2: Blueprint types, default legend, expansion, toGrid

**Files:** `blueprint/types.ts`, `blueprint/legend.ts`, `blueprint/expand.ts`, `blueprint/toGrid.ts`. Tests: `test/expand.test.ts`, `test/toGrid.test.ts`.

**Types:**
```ts
export interface Issue { severity: 'error' | 'warning'; code: string; message: string; cell?: { x: number; y: number }; partId?: string; path?: string }
export interface LegendEntry { part: string; rot?: Rotation; tags?: string[] }   // or { blueprint: ... } -> UNSUPPORTED
export interface PlacedPart { id: string; part: string; x: number; y: number; rot: Rotation; tags: string[] }
export type BindingMode = 'hold' | 'toggle' | 'pulse' | 'script';
export interface Binding { key: string; mode: BindingMode; target?: string; channel?: string; value?: number; script?: string }
export interface ScriptSpec { id: string; enabled: boolean; params: Record<string, number>; source: string | { file: string } }
export interface Blueprint { format: 1; name: string; parts: PlacedPart[]; bindings: Binding[]; scripts: ScriptSpec[]; primaryCore?: string; corePriority?: string[] }
```

**DEFAULT_LEGEND** (token: part, rot):
`C` core 0, `F` frame 0, `B` battery 0, `X` warhead 0,
`W` wheel 0 (mount N, hangs below), `Wv` wheel 180 (mount S), `W<` wheel 270 (mount E, wheel sits left of its parent), `W>` wheel 90 (mount W, wheel sits right),
`T^` thruster 0 (pushes up), `Tv` 180, `T<` 90 (pushes left), `T>` 270 (pushes right),
`P` propeller 0 (lifts up), `Pv` 180,
`D` decoupler 0 (releases up), `Dv` 180, `D<` 90 (releases left), `D>` 270 (releases right).
Arrow tokens point the way the part acts: thrust direction, lift direction, release direction, or the side the wheel sits on. `02` gets this sentence.

**expandBlueprint(raw): { blueprint?: Blueprint; issues: Issue[] }** (shape and expansion only, no registry):
- `raw` must be an object with `format: 1` (`BAD_FORMAT` otherwise, with `path`), `name` string, exactly one of `grid` (string[]) and `parts` (array).
- Unknown top-level keys: `BAD_FORMAT` error naming the key and the allowed keys.
- Grid: each row trimmed and split on `/\s+/`; empty row is allowed (no cells). Row i maps to y = rows.length - 1 - i. Token `.` is empty. Token `=` is a continuation cell (checked in T4). Other tokens resolve against `{ ...DEFAULT_LEGEND, ...raw.legend }`; missing gives `UNKNOWN_TOKEN` "grid token 'Q' at row 1 column 3 is not in the legend" with `cell`.
- Legend entry with `blueprint` key: `UNSUPPORTED` "sub-assemblies arrive in M6".
- Parts list form: each `{ id?, part, x, y, rot?, tags? }`; x, y integers; rot in {0,90,180,270} else `BAD_ROTATION`.
- Ids default to `<part>@<x>,<y>`. Tags: legend tags, then entry tags, then the implicit id tag, deduplicated in that order. (Def `defaultTags` are added in T4 where the registry is known.)
- Bindings and scripts: shape-checked (`BAD_BINDING`, `BAD_SCRIPT` with path), carried through. Missing arrays default to `[]`.
- Output parts are in reading order for grids and list order for parts lists.

**toGrid(bp): { grid: string[]; legend: Record<string, LegendEntry> }**: bounding box of all parts, one row per y from max to min, tokens from the default legend where `(part, rot)` matches and tags are only the implicit id tag; other parts get generated tokens `a`, `b`, ... with explicit legend entries. Columns padded to the widest token. Parts must not overlap (caller validates first).

**Tests (write first):**
- Car grid `["F F C B F F", "W . . . . W"]` expands to 8 parts; `wheel@0,0` is at (0,0) rot 0; `core@2,1` at (2,1); ids and implicit tags correct; reading order.
- `W<` gives wheel rot 270; `T>` gives thruster rot 270; `D<` gives decoupler rot 90.
- Custom legend overrides `F` and adds `m` with tags; tags merge in order.
- Errors: unknown token with row/column/cell; both grid and parts; neither; `format: 2`; unknown top-level key; bad rotation in a parts list; sub-assembly entry is `UNSUPPORTED`.
- toGrid round trip: expand(toGrid(expand(car))) has the same parts.

**Done when:** tests pass.

---

### Task 3: Assembly plan (pure)

**Files:** `assembly/assemble.ts`. Test: `test/assemble.test.ts`.

**Interface:**
```ts
export interface AttachEdge { a: string; b: string }                     // part ids, a before b in blueprint order
export interface GroupPlan { index: number; partIds: string[]; originId: string; joint?: { partId: string; parentGroup: number } }
export interface ChunkPlan { partIds: string[]; groups: number[] }
export interface AssemblyPlan { edges: AttachEdge[]; chunks: ChunkPlan[]; groups: GroupPlan[]; attachedFaces: Map<string, number> }
export function assemble(bp: Blueprint, registry: PartRegistry, rootId?: string): AssemblyPlan
```

**Algorithm:**
1. Occupancy: for each part, each footprint cell rotated by `rot` plus `(x, y)`; key `"x,y"`. (Overlaps are rejected by the validator before this runs; `assemble` assumes none.)
2. Edges: for each part p, each footprint cell, each attachable face f (rotated): neighbor cell = cell + faceDir(f). If a different part q occupies it and q's cell there has `opposite(f)` attachable, add edge (p, q) once. Count attached faces per part.
3. Chunks: BFS over edges, seeds in blueprint order, neighbors visited in blueprint order.
4. Body groups: joint parts (`def.joint` set) are singleton groups. Non-joint parts form groups by BFS over edges whose endpoints are both non-joint. A joint part's `parentGroup` is the group of the part across its mount face (rotated). Group order is the blueprint order of each group's first part. Joint groups come after the group they hang from if their first part comes later, which the blueprint order already gives; do not reorder.
5. Group origin: the root part if the group contains it (the primary core, or `rootId`), else the group's first part in blueprint order.

**Tests (write first):**
- Car: 1 chunk; groups: main (6 parts, origin core@2,1), wheel@0,0 (joint, parent 0), wheel@5,0 (joint, parent 0); 7 edges (5 in the top row, 2 wheel mounts).
- A thruster whose nozzle faces a frame is not attached through the nozzle.
- Wheel `W` below an empty cell: 0 attached faces, its own chunk.
- Two frames side by side with a gap: two chunks.
- A wheel mounted sideways (`W>` to the right of a frame, rot 90, mount W) attaches.
- Deterministic: running twice gives deep-equal plans.

**Done when:** tests pass.

---

### Task 4: Validator

**Files:** `blueprint/validate.ts`. Test: `test/validate.test.ts`.

**Interface:** `validateBlueprint(raw: unknown, registry: PartRegistry): { blueprint?: Blueprint; plan?: AssemblyPlan; issues: Issue[]; ok: boolean }`. `ok` means no errors. `class BlueprintError extends Error { issues: Issue[] }` and `loadBlueprint(raw, registry): { blueprint; plan }` which throws it. `formatIssues(issues): string` gives one line per issue, `error CODE: message`.

**Checks, in order** (stop after expansion errors; otherwise collect all):
- `UNKNOWN_PART` "legend token 'Z' names part 'zap', which does not exist (known: core, frame, ...)".
- `EMPTY` error when there are no parts.
- `DUPLICATE_ID`.
- `OVERLAP` "propeller@1,2 overlaps frame@1,2".
- `BAD_CONTINUATION` for a `=` cell no multi-cell part covers, and for a multi-cell footprint cell not marked `=` (v1 parts are all 1x1, so only the first can fire; the check is written generally).
- Def default tags are appended to each part's tags here.
- `BAD_PRIMARY_CORE` when `primaryCore` is not a core part id. Primary core = `primaryCore` or the first core in blueprint order.
- `NO_CORE` warning "blueprint has no core; it will spawn as debris".
- `UNATTACHED` error for a part with zero attached faces when the blueprint has more than one part: "wheel@0,0 has no attached face (its mount face N touches nothing)"; name the attachable faces after rotation.
- `DISCONNECTED` error "5 parts are not connected to the primary core: frame@4,0, ..." (root is the first part when there is no core). List at most 8 ids then "and N more".
- Bindings: `BAD_TARGET` error when no part has the target tag; `BAD_CHANNEL` error when no tagged part has an input with that name; `CHANNEL_SKIPPED` warning listing tagged parts that lack it; `BAD_SCRIPT_REF` when a script binding names a missing script id.

**Tests (write first):** the car validates with zero issues; one test per code with the exact message; a core-less single warhead validates with only `NO_CORE`; `loadBlueprint` throws `BlueprintError` whose `issues` hold the errors; `formatIssues` output.

**Done when:** tests pass.

---

### Task 5: PhysicsWorld compound bodies, colliders, joints

**Files:** `physics/PhysicsWorld.ts`. Test: `test/PhysicsWorld.compound.test.ts`.

**Interface additions (Rapier stays inside):**
```ts
export interface BodySpec { x: number; y: number; angle?: number; kind: 'dynamic' | 'fixed' }
export type ShapeSpec = { shape: 'box'; hx: number; hy: number } | { shape: 'ball'; radius: number };
export interface ColliderPlacement { offsetX: number; offsetY: number; angle?: number; mass: number; friction?: number }
export interface MotorSpec { model: 'force' | 'acceleration'; targetVelocity: number; factor: number; maxTorque: number }
export type JointId = number;
createBody(spec: BodySpec): BodyId
addCollider(body: BodyId, shape: ShapeSpec, place: ColliderPlacement, owner?: string): void   // owner = part id, kept in a side table keyed by collider handle
createRevoluteJoint(parent: BodyId, child: BodyId, anchorParent: {x,y}, anchorChild: {x,y}, motor?: MotorSpec): JointId  // contacts between the two bodies disabled
setMotorVelocity(joint: JointId, targetVelocity: number): void
massProperties(body: BodyId): { mass: number; comX: number; comY: number }   // world center of mass
ownerOfCollider(handle: number): string | undefined   // internal use by later queries; handle stays opaque
```
`createFixedBox` and `createDynamicBox` are rewritten on top of `createBody` + `addCollider` so there is one code path. Body ids and joint ids come from our own counters.

**Tests (write first):**
- 3x3 grid of 0.5 m cells with masses 1 to 9 (row-major from bottom-left) on one body: mass 45 (tolerance 1e-3), world COM matches (0.567, 0.700) relative to the body origin at the bottom-left cell center (the research numbers; recompute the expected value in the test from the masses).
- A body with a ball collider rolls down a 20 degree fixed ramp (x increases, y decreases after 60 steps).
- Revolute joint: a free wheel body jointed to a fixed body, motor `force` target 5 rad/s factor 4 maxTorque 12: angular velocity approaches 5 within 60 steps and never exceeds it by more than 1 percent. With target 0 on a spinning wheel, it slows.
- Joint anchors: after 60 steps under gravity with a dynamic parent, the distance between the parent anchor point in world space and the child body center stays below 0.01.
- Hash still identical across two identical worlds with joints.

**Done when:** tests pass, the M0 tests still pass.

---

### Task 6: Runtime entities and spawning

**Files:** `world/Robot.ts`, `assembly/spawn.ts`, `world/World.ts` (add `registry`, `robots`, `spawnBlueprint`; remove `spawnBox`), `blueprints/car.json`, `blueprints/showcase.json`, index exports. Tests: `test/spawn.test.ts`, update `World.test.ts` and `determinism.test.ts`.

**Runtime entities:**
```ts
export interface PartInstance { id: string; def: PartDef; x: number; y: number; rot: Rotation; tags: string[]; health: number;
  group: number; localX: number; localY: number }                  // offset from its group's origin cell
export interface BodyGroup { index: number; bodyId: BodyId; originId: string; partIds: string[];
  joint?: { partId: string; parentGroup: number; jointId: JointId; anchorParentX: number; anchorParentY: number } }
export interface Chunk { partIds: string[]; groups: number[]; coreId?: string }
export interface Robot { id: number; name: string; blueprint: Blueprint; spawnTick: number; spawnX: number; spawnY: number;
  parts: Map<string, PartInstance>; groups: BodyGroup[]; chunks: Chunk[]; primaryCoreId?: string }
```

**spawnRobot(physics, registry, blueprint, plan, at, id, tick): Robot:**
1. Root cell = primary core cell (or the first part). World position of cell (cx, cy) = `at + (cx - rootX, cy - rootY)`.
2. For each group in plan order: body at the world position of its origin cell, angle 0, dynamic. For each part in the group: collider per footprint cell. Box: `hx = hy = 0.5`, offset = cell minus origin, angle = rot, mass = def.mass / footprint length. Ball (joint parts): radius from def, offset 0, friction from def. Owner = part id.
3. For each joint group: `createRevoluteJoint(parentBody, wheelBody, anchorParent = wheelCell - parentOrigin, anchorChild = (0,0), motor = { model: 'force', targetVelocity: 0, factor: cfg.motorFactor, maxTorque: cfg.maxTorque })`. Motor values come from `behaviorConfig`; if missing, no motor.
4. Chunks record their first core in blueprint order as `coreId`.

**World:** `World.create(opts, file, registry = defaultRegistry())`; `readonly robots: Robot[]`; `spawnBlueprint(raw: unknown, at: {x,y}): Robot` validates with `loadBlueprint` (throws `BlueprintError`) and spawns. `spawnBox` is deleted; M0 tests that used it spawn a one-frame blueprint `{ format: 1, name: 'box', grid: ['F'] }` instead (same 1 m, 1 kg box).

**Blueprints:**
- `car.json`: `["F  F  C  B  F  F", "W  .  .  .  .  W"]`, legend `W` with tag `wheels`, no bindings yet (M3 adds them).
- `showcase.json`: rests on its wheels and shows every part: propellers on top, a thruster pointing each way on the sides, a battery, a decoupler, a warhead, a core. Must validate with no errors and at most the warnings the test expects.

**Tests (write first):**
- Car spawned at (0, 3) on the flat world: 3 bodies, 2 joints, 8 part instances; after 4 s it is at rest (every body speed < 0.05); the core body angle is within 0.01 rad of 0; core y within 0.02 of 1.45 (wheel center 0.45 plus 1 cell); both wheels' y within 0.02 of 0.45.
- Total robot mass from `massProperties` over its bodies equals the def sum (4 frames + core + battery + 2 wheels = 4 + 2 + 3 + 3 = 12 kg) within 1e-3.
- `spawnBlueprint` with an invalid blueprint throws `BlueprintError` and creates no bodies.
- Showcase validates and comes to rest upright (|angle| < 0.05) within 5 s.
- Determinism: add a golden hash for 10 s of the car on the flat world (new snapshot), keep the box golden test using the one-frame blueprint (its hash changes because the frame is a blueprint body now; update that snapshot in this task, deliberately, and say so in the commit).

**Done when:** tests pass, `pnpm sim` still runs (update the CLI in T7; in this task only keep it compiling by pointing it at the one-frame blueprint).

---

### Task 7: Metrics and CLI

**Files:** `metrics/robotMetrics.ts`, `packages/cli/src/blueprintFiles.ts`, `commands/run.ts`, `commands/determinism.ts`, `commands/validate.ts`, `commands/show.ts`, `main.ts`. Tests: `sim-core/test/robotMetrics.test.ts`, `cli/test/run.test.ts` (rewrite), `cli/test/validate.test.ts`.

**Metrics:**
```ts
export interface RobotSample { tick: number; time: number; coreX: number; coreY: number; tiltDeg: number; speed: number;
  massKg: number; comX: number; comY: number; resting: boolean; bodies: number; parts: number; chunks: number }
export function sampleRobot(world: World, robot: Robot): RobotSample
```
Core position = the core part's world position (body transform applied to its local offset). Without a core, use the root part. `tiltDeg` = core body angle in degrees normalized to (-180, 180]. `resting` = every body of the robot has linear speed < 0.05 and |angvel| < 0.05. Mass and COM summed over the robot's bodies.

**CLI:**
- `pnpm sim run <blueprint> [--world p] [--seconds n] [--seed n] [--x n --y n] [--json]`: validates, prints issues, exits 1 on errors. Spawns at `--x/--y` or the world spawn. Prints one line per second: `t=  1.00  core x=0.000 y=1.451 tilt=0.00  speed=0.012  resting=no`, then `final: ticks=300 hash=... resting=yes mass=12.000 com=(0.083, 1.221)`.
- `pnpm sim validate <blueprint>`: prints `ok` or the issues; exit 0 when no errors, 1 otherwise.
- `pnpm sim show <blueprint>`: the grid (via `toGrid`), the legend, part count, total mass, static COM from defs, chunks and body groups (`group 0: 6 parts origin core@2,1`, `group 1: wheel@0,0 joint -> group 0`).
- `pnpm sim determinism <blueprint> [--seconds n]`: as in M0.
- Blueprint argument: a path to a `.json` file, or a bare name resolved to `blueprints/<name>.json` from the repo root. Unknown name lists the available blueprints.
- Unknown command prints usage, exit 2.

**Tests (write first):** run the car for 3 s: 3 samples, final `resting` true, core y close to 1.45; determinism on the car equal; validate on an inline broken blueprint returns issues with codes; blueprint name resolution finds `car`.

**Done when:** tests pass and these commands print sensible output: `pnpm sim run car --seconds 4`, `pnpm sim show showcase`, `pnpm sim validate car`, `pnpm sim determinism car --seconds 10`.

---

### Task 8: Placeholder art and asset manifest

**Files:** `packages/app/scripts/gen-placeholders.ts`, `packages/app/tsconfig.scripts.json`, `packages/app/public/assets/**` (generated, committed), `src/render/assetKeys.ts`. Test: `packages/app/test/assetKeys.test.ts`. Dev deps: `pngjs@7.0.0`, `@types/pngjs`, `tsx`. Script: `"gen:assets": "tsx scripts/gen-placeholders.ts"`.

**Generator:** a tiny rasterizer over an RGBA buffer: `fillRect`, `strokeRect`, `fillCircle` and `fillRing` with 4x4 supersampling for smooth edges, `line` with thickness, a seeded noise fill for terrain. 64 px per cell. Draw each part at rotation 0 (the renderer rotates):
- core: near-black `#1b1d23` square, 3 px lighter bevel, a cyan eye in the middle, small notch on the top edge so rotation is visible.
- frame: gray `#7d838d`, darker 3 px border, diagonal cross brace, four rivets.
- battery: green `#3fae5a`, darker border, a terminal nub on the top, a white plus sign.
- wheel: black tire circle radius 0.45 cell (28.8 px) with a dark gray tread ring, lighter hub, three bolt dots so spin is visible. `part.wheel.mount`: gray bracket from the center to the top edge, 12 px wide, with an axle cap.
- thruster: gray body 40 px wide full height minus the nozzle, darker nozzle bell at the bottom (south).
- propeller: hub housing in the bottom half, mast, and a wide blade across the top. `fx.propeller` frames 0 to 3: blade at full, 70 percent, 30 percent width, and a blurred disc.
- decoupler: gray body with a yellow and black hazard band along the top (release) face.
- warhead: dark red body, lighter nose band at the top, a black and yellow hazard circle.
- `fx.flame` frames 0 to 2: orange to yellow flame, anchored at the top edge, pointing down.
Atlas: frames in a grid with 2 px transparent padding and 1 px edge extrusion so linear filtering never bleeds. Writes `sheets/parts.png` + `parts.json` and `sheets/fx.png` + `fx.json` (PixiJS JSON hash, `animations` for `fx.propeller` and `fx.flame`), and standalone `terrain/ground.png`, `terrain/ground-top.png`, `terrain/block.png` (64 x 64, seamless). `manifest.json` has bundles `parts`, `fx`, `terrain`.

**assetKeys.ts:** `PART_FRAMES` is not hand-written: frame names come from part defs. The file exports `FX_ANIMATIONS = { propeller: 'fx.propeller', flame: 'fx.flame' }` and `TERRAIN = { ground: 'terrain.ground', groundTop: 'terrain.groundTop', block: 'terrain.block' }`.

**Test:** import `public/assets/sheets/parts.json` and `fx.json` and `manifest.json`; every def in `defaultRegistry()` has its `sprite.frame` and `mountFrame` in parts.json; every `animation` and `overlay` in fx.json animations; every `TERRAIN` alias in the manifest. This test makes a missing texture a red build, which is the art-swap contract.

**Done when:** `pnpm --filter @robots/app gen:assets` writes the files, the test passes, and the PNGs look right when opened (check two or three with the Read tool).

---

### Task 9: Robot rendering in the app

**Files:** `src/render/assets.ts`, `src/render/RobotView.ts`, `src/main.ts`, `src/app/keys.ts` (add `C` cycle target, `G` grid). Tests: `test/RobotView.test.ts` for the pure layout function.

- `assets.ts`: `TextureStyle.defaultOptions.scaleMode = 'linear'` before loading; `Assets.init({ manifest: '/assets/manifest.json' })`, `loadBundle(['parts', 'fx', 'terrain'])`.
- Renderer layers (from the M0 review): `bodies` container below `debug`, so debug outlines always draw on top.
- `RobotView`: `layoutRobot(robot): BodyLayout[]` (pure, tested): per group `{ bodyId, sprites: { frame, x, y, rotation }[] }` in meters and radians, including mount sprites on the parent group at the joint part's anchor with the part's rotation. The Pixi class builds one `Container` per body (wheel bodies added first so the main body and mount brackets draw on top), one `Sprite` per entry with `anchor 0.5`, size one cell (`TEXTURE_SCALE = PIXELS_PER_METER / 64`), position `toScreen(local)`, rotation `toScreenAngle(rad)`. `sync(world, alpha)` sets each container from `interpolateState(prevState, state, alpha)`.
- `main.ts`: registry, world, spawn `car` at the world spawn and `showcase` 10 m to the right (both imported JSON). Camera follows the target robot's core, interpolated. `C` cycles targets. Debug starts hidden. HUD adds the target robot's name, core position, tilt, and resting flag from `sampleRobot`.
- `layoutRobot` tests: car gives 3 bodies; the main body has 6 part sprites plus 2 mount sprites; a sprite's position is its local offset; a `T>` thruster has rotation `3 * PI / 2`.

**Done when:** typecheck and tests pass, and in the browser both robots are drawn with sprites that line up with the debug outlines (toggle `D`), wheels sit on the ground, the camera follows and `C` switches robots, and the console has no errors.

---

### Task 10: World look, grid, docs, CI, tag

**Files:** `src/render/TerrainView.ts`, `src/render/GridView.ts`, `main.ts`, `index.html` (background), `README.md`, `docs/status.md`, design doc edits (`02` legend sentence and `mountFrame`, `08` texture decision), `.github/workflows/ci.yml` if needed.

- `TerrainView`: the ground as a `TilingSprite` of `terrain.ground` across its width and thickness with a one-cell `terrain.groundTop` strip along the surface; each static box and the ramp as a `TilingSprite` of `terrain.block`, rotated by its angle. Tile scale matches one cell per 64 px texture.
- `GridView`: one static `Graphics` with 1 m lines over x in [-60, 60], y in [-2, 30], color white at alpha 0.05, pixelLine, drawn once, below terrain. `G` toggles it.
- Background `#141a22`.
- README controls: add `C` cycle robot, `G` grid, and `pnpm sim run car` style commands.
- Final checks: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build && pnpm sim determinism car --seconds 10`.
- Demo checklist (record results in `docs/status.md`):
  - `pnpm sim run car --seconds 5` ends resting with tilt near 0.
  - Browser: car and showcase rest on their wheels; every part type is visible; sprites match debug outlines; zoom to 4x and the art stays clean; the grid makes 1 m readable; pause, step, speed, follow, pan, and `C` all work; no console errors.
- Commit, `git tag m1`, push, watch CI.

**Done when:** CI is green and the status file says Gate 1 is open with instructions for Logan (what to run, what to look at).

---

## Self-review notes

- Spec coverage against `06` M1: PartDef registry with the 8 parts (T1), blueprint JSON with grid and legend, expansion, default legend, validator (T2, T4), attachment graph, flood fill, body groups, compound bodies with real mass, wheels on motor joints (T3, T5, T6), spawn from a file (T6, T7), headless harness reporting pose, tilt, validator output (T7), placeholder PNG generator and manifest, sprites at local offsets (T8, T9). Done-when (a car spawns, rests on its wheels, the harness reports its pose) is T6's test plus T7's command.
- Gate 1 items: textures (T8), sprite fit (T9 with debug overlay), scale (grid, T10), world look (T10), camera and time controls (M0, plus `C` in T9).
- Carried from the M0 review: `removeBody` is not needed until M6 (nothing is removed in M1); an `EventQueue` is not created in M1; the golden jointed-robot scene is T6.
