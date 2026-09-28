# M13 Guns Implementation Plan

> **For agentic workers:** Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/design/02-parts-and-blueprints.md`, `04` (Script API), `docs/plans/M11-flares.md` (the latest part added end to end), `docs/plans/M12-fabricator-bay.md`, and `docs/claude-robot-playbook.md` first. Tests first for every sim-core change, one commit per task (`M13 T<n>: <what>`), tree green at every commit, commit often and push only at the gate. Plain game terms: "gun", "shell", "turret", no real weapon names.

**Goal:** a gun part that fires real flying shells, and a gun drone (enemy and player) with a turret on each end that shoots the closest enemy thing it can see: missiles and drone bombs coming at it, and robots that get close. Ends at Gate 12.

**Written by:** an Opus 5.5 session, 2026-09-27, after Logan's answers.

## Logan's answers (2026-09-27)
- **A real flying shell,** not an instant beam: you can watch it, it drops a little, it can miss, anything in the way stops it.
- **5 damage per hit, 10 shots a second.** No ammo, no energy per shot ("running out of power is boring"). Balance does not matter; fun does.
- **Low damage on purpose:** you shoot a missile's armed warhead (health 20, four hits) or a drone's propellers (15, three hits); a frame block (60, twelve hits) takes a long time.
- **The gun sees in a straight line** out of its barrel, about 150 m, and says what it is pointing at: whose robot, how far. Aiming ahead of a moving target and allowing for drop is the turret script's job, from the radar; the sight is the last "clear to shoot" check.
- **Turrets on the left and right ends** of the drone (the propellers on top would block a top turret), each sweeping from straight up to straight down on its side.
- **An enemy gun drone and a player one** (you fly it, its turrets aim and fire by themselves).

## What exists already (surveyed 2026-09-27, HEAD 1148bbb)
- Parts are data (`parts/defs/*.json`, strict parser `parts/parsePartDef.ts`, `DEF_KEYS`), behaviors in `behaviors/` registered in `BEHAVIORS`, ticked in `World.runBehaviors` with a `BehaviorContext`.
- `World.step`: scripts, channels, `armParts`, early behaviors, `rebuildDirty`, behaviors, `applyPendingForces`, `physics.step`, `damagePhase` (impact fuzes, `destroyDeadParts`, blasts).
- Damage is written straight to `part.health`; `destroyDeadParts` handles anything at 0 (and sets off armed warheads, which is how shooting a missile blows it up).
- Pushes go through `pendingPushes` as one-step forces (impulses are lost on multibody links); a body pushed in the last 2 ticks is skipped by impact fuzes.
- Rapier: no CCD, no ray casts, no collision groups anywhere yet. The query index refreshes only during a step (see `overlapsShapes`).
- Script outputs: `outputOf` asks the behavior's `output()`; an output must always return a number or the M9 frame relays out every tick.
- Rotators: `turn` is a rate; `angle` reports the commanded aim, not the real joint angle (droops about 0.5 degrees under load).
- Free legend letters: A I J L M N U V. No builder keys left (palette only, like the flare).

## Decisions (Claude's call unless marked Logan's, overturnable at Gate 12)

1. **Shells are not robots and not Rapier bodies.** A shell is a point the world moves each tick: position, velocity, owner (robot and side), age. Each tick it moves `v * dt` with gravity, and the world casts a ray along that step against every collider; the first hit takes the shell's damage and a small push, and the shell is gone. Why:
   - At 300 m/s a shell moves 5 m a tick against 1 m cells; a Rapier ball would tunnel through without CCD.
   - As robots, shells would show up on every radar, in `contacts`, in every per-robot loop, and in the tracer letters; loose bodies also get air drag (225 N at 300 m/s) and unowned boxes count as terrain cover.
   - A ray per shell per tick is cheap and exact, and deterministic (Rapier's deterministic build, fixed order).
   - What this gives up: shells do not bounce or hit each other. They hit everything else: robots of every side (friendly fire is real), flares, debris, the ground.
2. **The gun part (data).** `gun`: 1 kg, health 25, one cell, attaches by its base (like a flare), fires out of its front face; legend `M^ Mv M< M>`; palette only. Def block `gun: { speed: 300, damage: 5, rate: 10, life: 1, recoil: 2, range: 150 }` (m/s, per hit, shots a second, seconds, N s pushed back per shot, meters of sight). Input `fire` (above 0.5: fires every `60 / rate` ticks while held). No power draw. The engine reads `gun`, never names the part.
3. **Recoil:** each shot pushes the gun's body back `recoil` N s through `pendingPushes`. 2 N s at 10 shots a second averages 20 N, a nudge on a 30 kg drone.
4. **The sight (outputs on the gun):** one ray from the barrel's front face along its real pose (not the rotator's `angle`), `range` long, cast right after `physics.step` (the query index is fresh then) and stored on the part. Outputs, always numbers:
   - `sight`: distance to the first thing hit, `range` when nothing.
   - `sightSide`: 0 nothing, 1 its own robot, 2 a friend, 3 an enemy, 4 no one's (debris, a coreless bomb), 5 ground or terrain.
   - `sightId`: the hit robot's id as `contacts` report it, 0 for none.
   - Scripts read them with `get('gun', 'sight')`, etc. Derived from physics each tick, so not hashed.
5. **What is hashed:** each gun's cooldown and every live shell (position, velocity, owner, age), added only when guns or shells exist, so every existing golden hash stays the same.
6. **Events:** no event per shot (10 a second per gun would flood `world.events` over a run). `shellHit` per hit (part, robot, damage), folded in the run report like repeated `log()` lines. The app reads live shells straight from `World` each frame.
7. **The turret script** (`gun-turret.turret.js`, one file copied per host as usual), params `side` (1 right, -1 left), `speed` 300, `range` 150, `hold` 0.5:
   - Target: the closest `enemy` contact within `range` whose aim point lies in its turret's half (its side, from straight up to straight down). Everything with a core counts: missiles, drone bombs, drones, cars.
   - Aim: lead the target from its position and velocity (time of flight at `speed`, solved twice), plus gravity drop over that time; turn the rotator toward it (`turn = clamp(k * err)`).
   - Fire while the aim error is under about 2 degrees and the sight is clear: an enemy on the line, or nothing nearer than the target. A friend, its own robot, or terrain on the line holds fire; blocked for `hold` seconds, it moves to the next target.
8. **The robots:**
   - `gun-turret.json`: a rotator carrying a gun (placed with `pnpm sim place`, blueprints stay data).
   - `enemy-gun-drone.json`: a drone with a radar, auto flares, and a turret on each end (rotators pointing out, so each sweeps from straight up to straight down on its side). Its pilot: an existing enemy drone pilot (a copy of `enemy-fab-drone.pilot.js`, which fires nothing without a bay), holding about 60 m off its target so it is in gun range.
   - `gun-drone.json`: the player version: your hover and flight keys, the same turrets aiming and firing by themselves, a key to switch them off and on, and flares on V.
9. **Look:** a gun sprite (barrel), shells drawn as short bright streaks (interpolated between ticks), a small spark where one hits. The debug overlay draws each gun's sight line, colored by `sightSide`.

## Tasks

### T1: spike (throwaway, then notes here)
- A `castRay` right after `physics.step` sees every collider, including those of a robot rebuilt in the last tick's `damagePhase` (a missile just released, a bay copy just built); if not, try `propagateModifiedBodyPositionsToColliders` or casting only against bodies we list.
- Mapping a hit collider to its part and robot (the private `owners` map, plus a new body to robot lookup).
- Same results run twice, and on a replay.
- Cost: 200 live shells, one ray each per tick (`pnpm sim bench` scene).

### T2: the gun and its shells (sim-core)
- Tests first: fires on `fire`, at `rate`, from the front face along the barrel; a shell drops under gravity; it hits the first part on its line and takes `damage` off it; an armed warhead shot 4 times explodes, an unarmed one breaks; it hits friends and its own robot; it stops on the ground; it is gone after `life`; recoil pushes the gun back; nothing tunnels at 300 m/s through a one-cell wall; hashed only when present (golden hashes unchanged).
- Def, parser block (`gun` requires a `fire` input and the three sight outputs), behavior (cooldown, a new `fire` on the context), `World` shells (step, ray, damage, push, removal), `shellHit` event, `PartInstance` fields, spawn and `finishBuild` defaults, hash.

### T3: the sight (sim-core)
- Tests first: reads nothing, own robot, friend, enemy, no one's, terrain, with the right distance and id; follows the real barrel pose on a drooping rotator; a flare on the line reads as the robot it stands in for (flares fool sensors, and the sight is one); parity test reference updated.
- Ray after `physics.step`, stored on the part, `output()`.

### T4: turret, drones, done-when (blueprints)
- `gun-turret.json` and its script; `enemy-gun-drone.json` (pilot, radar, flares, two turrets); `gun-drone.json` (player).
- Done-when tests, with the numbers measured and recorded here:
  - A gun drone hovering, a `launcher-seeker` missile fired straight at it: shot down short of the drone in most of a few seeds.
  - A drone bomb chasing it: shot down.
  - An enemy gun drone against a hovering `hunter-drone` within 60 m: breaks its propellers.
  - A turret with a friend in its line holds fire (no friendly parts lost to shells in a 2v2 of gun drones and fab drones).
  - A turret never shoots its own robot.
- **Risk to measure:** a missile at about 130 m/s head-on closes at about 430 m/s with the shells, so from 150 m there is about half a second of fire, about 5 shots, and the warhead needs 4 hits. If shootdowns are rare, the numbers are data (Logan does not care about balance): try damage 10 or rate 20 and report what each does at the gate rather than silently changing Logan's picks.

### T5: look, report, tools
- App: gun sprites (`gen-placeholders.ts`, `assetKeys` test), a `ShellsView` layer next to `Effects`, hit sparks from `shellHit`, sight lines in the debug overlay.
- CLI: `pnpm sim parts` gun line; the run report counts shots and hits per robot and folds `shellHit`; the side view draws live shells.
- Legend `M^ Mv M< M>`, palette entry, the parts tests (palette order, health map).

### T6: docs, review, gate
- `02` (gun row, shells), `04` (the sight outputs), the playbook (the gun, the turret script, "shells hit friends: check the sight"), status, As built, `docs/critique/gate-12.md`.
- Opus review subagent; fix findings; golden scene `gun-drone-vs-missile`; tag `m13`, push once (with the unpushed M12 work), stop at Gate 12.

## Gate 12 (Logan)
- Fly the gun drone at an enemy fab drone: watch its turrets pick off the missiles coming at you.
- Fly the hunter at an enemy gun drone: fire missiles at it, then get close and watch it shred your propellers.
- A mixed fight: gun drones with missile and bomb fab drones on both sides.
- Open questions for the gate: damage and rate (5 and 10, or more), sight range, whether turrets should prefer things coming at them over the closest.
