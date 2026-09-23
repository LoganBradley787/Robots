# M6 Destruction Implementation Plan

> **For agentic workers:** Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/design/03-assembly-physics-destruction.md` (health, removal pipeline, momentum, explosions, and "Joints are multibody joints"), `04` (latching, active core, wake-up), `02` (parts table), and `07` (Q1, Q5, Q11/Q17, Q18) first. Tests first for every pure module, one commit per task (`M6 T<n>: <what>`), tree green at every commit, `docs/status.md` updated at session end.

**Goal:** Things break. Parts have health; warheads explode on a key, when destroyed, or on a hard hit; damage falls off with distance and is blocked by parts in the way; robots split into pieces that keep their momentum; headless pieces keep their last input; decouplers separate; a rotator aims turrets and missile racks. Ends at Gate 5 (destruction: explosions, splitting, debris, missiles).

**Spec:** `03` (removal pipeline, momentum transfer, explosions, debris), `04` (latching, active core, wake-up), `06` M6, `07` Q1, Q5, Q11/Q17, Q18.

**Written by:** an Opus 5.5 planning session, 2026-09-23, after Logan answered the destruction questions.

## Logan's answers (2026-09-23)
- **Damage:** real health per part, and damage falls off with distance from the blast. Frames are tough enough to act as armor; batteries, propellers, and wheels are fragile. Armoring your batteries is a design choice.
- **Weapons:** bombs and missiles only. A cannon comes after Gate 5.
- **Blast size:** punchy. A warhead blows a clear hole about 3 m across, knocks nearby robots over, and throws debris a few meters.
- **Rotator:** in M6.
- Also from Logan (Gate 4): decouplers and warheads must actually work; battery blocks are targets like every other part (no special case: every part has health).

## Spike result (planning session, 2026-09-23)
- Multibody links ignore velocity: a body created with `setLinvel`/`setAngvel`, or set after its joint exists, reads 0 after one step, root included.
- Workaround, verified: for one step, push each new body with `F = m * (v_target - v) / dt` at its center of mass and `tau = I * (w_target - w) / dt`. A parent plus a spinning wheel reached (5.00, 0.71) m/s, 0.505 rad/s, and a wheel spin of 19.6 against targets of (5, 0.67), 0.5, and 20. Velocities read back one step late, so tests check after two steps.
- So every rebuilt body gets its velocity through a one-step "kick", never `setLinvel`.

## Decisions made in this plan (Claude's call, overturnable at Gate 5)

1. **A robot is one connected piece.** Spawned blueprints already are (the validator's `DISCONNECTED` error).
   - A split turns each extra piece into its own `Robot` with a new id.
   - Which piece keeps the original id:
     - the piece holding the active core;
     - if there is none, the piece holding the earliest surviving part in blueprint order.
   - The other pieces get new ids in order of their earliest part.
   - Why: possession, render, energy, and replays already work per robot, and a split-off missile becomes something you can click and watch. `Robot.chunks` stays, always with one entry. `03` and `04` get updated.
2. **Health (part defs):**

   | Part | Health |
   |---|---|
   | frame | 60 |
   | core | 50 |
   | rotator | 40 |
   | battery | 30 |
   | decoupler | 30 |
   | gyro | 30 |
   | thruster | 25 |
   | wheel | 25 |
   | warhead | 20 |
   | propeller | 15 |

   - Damage stays: a hit frame keeps its reduced health until a second hit breaks it.
   - A damaged part looks darker and cracked (render only).
3. **Explosions** (warhead def: `explode: { radius: 3, damage: 100, pushRadius: 5, push: 6 }`):
   - **Damage:** `damage * (1 - d / radius)` to every part whose cell center is within `radius`, where `d` is the distance to the cell center.
     - Every intact part cell or terrain box the straight line crosses on the way halves it (cover).
     - Our own segment-against-box test, not Rapier's query pipeline, which lags behind colliders created or removed this tick.
     - Result: a frame dies within 1.2 m, a battery within 2.1 m, and a propeller within 2.55 m. A battery 1.5 m away behind one frame takes 25 and survives. That is the "hole about 3 m across".
   - **Push:** every robot cell within `pushRadius` gets `push * (1 - d / pushRadius)` N s away from the center, at the cell center.
     - It is applied as a force over the next step (multibody rule), so pieces tumble naturally.
     - No cover for push.
   - Tuning targets, checked with the headless runner:
     - a car whose nearest cell is 2 m from the blast tips over;
     - fresh debris near the blast moves at 5 to 15 m/s;
     - nothing leaves faster than 40 m/s.
   - Terrain is immune (Q21).
4. **Triggers**, all data:
   - A warhead's `detonate` pulse destroys it.
   - Any part with `explode` explodes when destroyed, which gives chain reactions.
   - A part with `impact: { force }` is destroyed when a contact force event on its collider exceeds `force` (Rapier `CONTACT_FORCE_EVENTS`, a per-collider threshold). Tuning targets:
     - a bomb dropped from 3 m onto anything explodes;
     - a car with a warhead on its nose bumping a wall at 3 m/s does not;
     - hitting at 10 m/s does.
   - At most 100 explosions resolve per tick; the rest wait for the next tick and are hashed.
5. **Damage phase:** runs after the physics step, following `03`'s removal pipeline:
   1. impacts;
   2. destroyed parts (health <= 0) lose their colliders;
   3. explosions queue;
   4. detaches;
   5. connectivity re-run;
   6. rebuild;
   7. explosions loop.

   Queued pushes and kicks live in a `pendingForces` list on the world, applied at the start of the next physics step, and hashed. The design's pipeline had removal before explosions; ordering within the loop is stable (robots in id order, parts in blueprint order).
6. **Rebuild on any change to a robot:**
   - A robot that lost a part or a face gets all of its bodies and joints removed and recreated from its live parts.
   - Each new body gets the velocity field of the old body its parts came from, applied by kick: `linvel = v + w x (c - p)`, `angvel = w` (`03`).
   - A wheel keeps its own spin.
   - One path for "unchanged but lighter" and "split", so there is no special case for the remainder.
   - `Robot.version` increments so render rebuilds its sprites.
7. **Live assembly:** `assemble` is generalized to take live parts and each part's cut faces (a fired decoupler's release face).
   - The weld rule changes from "neither part is a joint part" to "the edge does not cross a joint part's mount face", so a rotator can carry parts on its other faces.
   - Wheels come out exactly as before (their only face is the mount).
8. **Latching and cores** (`04`, Q1):
   - A new piece copies the last final channel values of its parts and freezes them. A cut-off half keeps its wheels spinning and a lit missile keeps burning until its pool is empty.
   - Active core destroyed: the robot's controller and scripts stop, and it latches (no takeover).
   - A new piece with exactly one core that is not the active core wakes up and is possessable. It uses auto controls for its parts only. Bindings and scripts on sub-assembly cores wait for M7's sub-assembly references, since today a blueprint's bindings and scripts belong to its primary core.
   - A piece with two or more dormant cores stays headless.
9. **Decoupler:**
   - The def gains `acts: "N"` (its release face) and `behaviorConfig: { separation: 2 }` (N s on each side).
   - `fire > 0` while armed cuts the release face, and the two sides get equal and opposite separation pushes along the face normal. It happens once.
   - `armed` output: 1 until fired, then 0. The decoupler stays welded to the side of its other faces (Q18).
10. **Rotator** (new part, palette key 0, legend `R`, `Rv`, `R<`, `R>`):
    - Mass 1.5, health 40, draw 3 per second at full load.
    - At rotation 0 it mounts on the part **below** (mount face S, so a turret on a roof is the default) and carries parts on N, E, and W. Those parts are welded to the rotator's own body.
    - Input `turn` in [-1, 1] swings its aim at up to 2 rad/s within +-90 degrees. With no input it holds the aim.
    - Output `angle` in [-1, 1] is the aim over the range, for scripts.
    - Position motor: our own torque, like the wheel's. `tau = clamp(kp * (aim - rel) - kd * relW, +-maxTorque)`, with `rel` the child's angle relative to its parent, wrapped. Starting values: `maxTorque` 40, critically damped for a 3-cell arm.
    - Auto controls: Z turns counterclockwise and X clockwise (the rotator's own keys, like the gyro's E and Q).
    - The aim lives on the part instance and is hashed.
11. **Clear debris:** a toolbar button that removes every robot nobody can control (core-less or headless). It is logged in the input log like the unlimited switch, so replays match.
12. **Events** (not hashed, for UI and reports): `partDestroyed`, `explosion {x, y, radius}`, `split {robot, pieces}`, `coreLost`, `coreWoke`.
13. **CLI:**
    - `run --drop <blueprint>@<seconds>:<x>,<y>` spawns another blueprint mid-run; it can repeat.
    - Reports list parts destroyed, pieces, and explosions.
    - `tune` prints the blast numbers (kill distance per part, push at 2 m).
    - CI's determinism job adds the bomb scenario.

## File structure

```
packages/sim-core/src/physics/PhysicsWorld.ts     remove collider/body/joint, kick, contact force events, position motor, pending forces
packages/sim-core/src/assembly/assemble.ts        live parts, cut faces, mount-face weld rule
packages/sim-core/src/assembly/rebuild.ts         rebuild a robot's bodies from live parts with its velocity field (new)
packages/sim-core/src/damage/explosion.ts         falloff, cover (segment vs box), pushes (pure, new)
packages/sim-core/src/damage/phase.ts             damage phase: impacts, destruction, detaches, splits, chain loop (new)
packages/sim-core/src/behaviors/decoupler.ts, warhead.ts, rotator.ts   (new)
packages/sim-core/src/world/World.ts, Robot.ts    pieces as robots, latching, wake-up, clear debris, events, hash
packages/sim-core/src/parts/defs/*.json           health values, explode, impact, decoupler acts, rotator.json
packages/sim-core/src/parts/parsePartDef.ts       explode/impact fields, position joints with carried faces
packages/cli/src/...                              --drop, destruction report, tune blast numbers
packages/app/src/render/...                       sprites follow rebuilds, damage tint, explosion and break effects
packages/app/src/world/...                        possession on core loss and wake-up, Clear debris, notices
blueprints/bomb.json, longcar.json, launcher.json, wall.json
```

## Tasks

### T1: physics primitives
- `PhysicsWorld` gains:
  - `removeCollider`, `removeBody`, and `removeJoint`, keeping the side tables right. Owners become `{robot, part}`, because part ids repeat across robots.
  - `kick(body, v, w)`, contact force events with a per-collider threshold, and position motors.
- Tests:
  - A kicked multibody (parent plus spinning wheel) reaches its targets within 2% after two steps.
  - Removing a body drops its joints and colliders.
  - A contact force above the threshold reports its collider and one below does not.
  - A position motor holds a 3-cell arm within 2 degrees against gravity.
  - Golden hashes stay unchanged, since nothing uses the new calls yet.

### T2: live assembly
- `assemble` takes live parts plus cut faces, and uses the mount-face weld rule.
- `parsePartDef` accepts `explode`, `impact`, and position joints whose other faces carry parts.
- Tests:
  - A cut decoupler face splits a chunk.
  - A removed middle part splits a long robot in two.
  - A rotator's carried parts land in its body group.
  - Every shipped blueprint assembles exactly as before.

### T3: damage phase and splitting
- Health on instances, destruction, connectivity, rebuild with kicks, pieces as robots, latching, active core loss, wake-up, events, and the hash (health, cut faces, aims, pending forces, next robot id).
- Tests:
  - Destroying the middle cell of a moving, spinning robot gives two robots whose velocities match `v + w x (c - p)` within 2%.
  - Total momentum is conserved within 2%.
  - The core-less half latches its wheel speed.
  - A destroyed core stops scripts and control.
  - A split-off piece with one dormant core wakes with auto controls.
  - A replay with splits matches.

### T4: explosions, warheads, decouplers
- `damage/explosion.ts` (pure, tests first): falloff, cover through one and two cells and through terrain, and push falloff.
- Warhead triggers: detonate, destroyed, and impact. Chain reactions and the cap of 100 per tick.
- Decoupler behavior. Health values into the defs.
- Tests:
  - Kill distances per part match the table above.
  - Two touching warheads both explode.
  - A bomb dropped from 3 m explodes, and a warhead bumped at 3 m/s does not.
  - A fired decoupler gives two robots moving apart at about the configured separation.
  - Firing again does nothing.

### T5: rotator
- Def, behavior, and auto controls (Z and X).
- Tests:
  - Holding Z swings it and releasing holds the aim.
  - It stays within +-90 degrees.
  - A missile rack on a rotator stays aimed while the car drives over the 1 m block.

### T6: CLI, blueprints, done-when
- Ship `bomb`, `longcar`, `launcher`, and `wall`:
  - `longcar`: a long two-wheeled robot with the core at one end.
  - `launcher`: a car with a rotator turret carrying a dumb missile of a decoupler, a thruster, and a warhead. F fires: it pulses the decoupler and toggles the missile's thruster on in the same tick. Z and X aim.
  - `wall`: a core-less frame wall with a battery inside.
- `--drop`, the reports, `tune`, and CI.
- Headless done-when tests (Logan's bomb test and the missile):
  - `longcar` drives with D held. A bomb dropped 4 m above its middle explodes on impact and breaks it into at least two robots. The core-less half keeps its wheel speed latched and still rolls forward faster than 2 m/s two seconds later.
  - `launcher` aims at `wall` 20 m away and fires. The missile flies within 5 degrees of its aim, hits, and destroys wall parts. No debris goes faster than 40 m/s.

### T7: app
- Render follows `Robot.version` rebuilds and robots created mid-run.
- Visuals:
  - damage tint and cracks;
  - explosion flash, ring, and smoke;
  - a puff when a part breaks;
  - a spark when a decoupler fires.
- Possession:
  - A lost core releases control with a notice.
  - A woken core can be clicked and cycled with `,`.
- Clear debris on the toolbar. The rotator in the palette. The part menu shows health.
- Browser check, the Gate 5 walkthrough:
  - bomb the moving `longcar`;
  - fire the `launcher` at the `wall`;
  - decouple a piece mid-air;
  - chain two warheads;
  - clear the debris.

### T8: review and Gate 5
- An Opus review subagent over the M6 diff; fix its findings.
- Update `02` (parts table, health), `03` (pieces as robots, rebuild by kick, cover, explosion numbers), `04` (wake-up as built), `07` (Q5, Q11/Q17, Q18 as built), and `status.md`.
- Tag `m6` and stop at Gate 5.

## Task dependencies
T1 then T2 then T3. T4 needs T3. T5 needs T1 and T2. T6 needs T4 and T5. T7 needs T3 (effects need T4). T8 needs all.

## Risks
- **Kick accuracy with contacts:** a kicked piece already touching the ground or another piece shares that step with contact solving. Tests use tolerances, and the done-when judges plausibility, not exactness.
- **Contact force thresholds depend on mass and solver settings.** Tune with the headless runner and record the numbers in `03`.
- **A rebuild changes body ids:** anything in the app keyed by body id (interpolation, click to possess) must follow `Robot.version`.
