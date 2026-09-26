# M10 Arming and New Enemies Implementation Plan

> **For agentic workers:** Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/claude-robot-playbook.md`, `docs/design/02-parts-and-blueprints.md`, `03` (destruction, explosions, the fuze), `docs/plans/M8-sensors-and-homing.md` (As built: the seeker guide, the enemy drone pilot), and `docs/plans/M9-script-speed.md` (golden hashes) first. Tests first for every sim-core change, one commit per task (`M10 T<n>: <what>`), tree green at every commit, commit often and push only at the gate. Write in plain game terms (M8 wording note).

**Goal:** warheads are safe until something arms them, so a fight is no longer won by one hit that sets off every missile a drone carries. New things to fight: a small drone bomb that chases its target and goes off on it, an enemy flying silo, and an enemy launcher truck. Ends at Gate 9.

**Written by:** an Opus 5.5 session, 2026-09-25, after Logan's Gate 8 requests and answers.

## Logan's answers (2026-09-25)
- **Arming is generic, not tied to release.** "It should work for anything": a car made of bombs is driven to its target, armed ("okay, let's arm this thing"), then set off. So arming is a key or a script, never "the missile was released". Latched: once armed, it stays armed (no disarm).
- **An unarmed warhead is a normal part:** destroyed without exploding, a hard hit does nothing, `detonate` does nothing until armed. An armed warhead looks different (a lit red light).
- **Armed at start is a per-part setting chosen when placing it** ("a stock bomb we'd want armed by default"). A carrier can arm a carried bomb itself and drop it; the bomb needs no core of its own.
- **Drone bomb:** a tiny drone with a heavy warhead that reaches its target and goes off. Slower than a missile, but it follows the target and cannot really miss or overshoot: you outrun it or shoot it down. As fast as it can go while still able to slow down and hit a drone. It runs on its own when its core is awake (deployed alone, it goes at once), like a missile: carried on something bigger later, its core sleeps until it is released.
- **Enemies to build now:** enemy flying silo, the drone bomb (deployed as Enemy), enemy launcher truck.
- **Later (ideas):** a MASTER DRONE with four seeker missiles, a big missile, and two drone bombs.
- **Memory limit:** write a plan (`docs/plans/script-memory-limit.md`) for a separate agent; do not start it.

## What exists already
- `warhead` and `heavywarhead` defs: input `detonate`, behavior `warhead` (a detonate pulse sets health 0), `onDestroyed.explode` (the world queues a blast for any destroyed part that has it), `impact.speed` 5 (the fuze: a hit that changes the body's velocity by more than 5 m/s destroys it). `World.destroyDeadParts` and the impact check read those def fields; no part type is special-cased.
- Per-part blueprint flags: `auto: false` on a legend entry or parts-list entry (`blueprint/types.ts`), shown and toggled in the builder's part menu (`app/src/ui/PartMenu.tsx`).
- Every shipped missile has a guide script on its own core (it wakes on release); the drone and silo fire scripts send the handoff, then pulse the grip decoupler.
- Golden hashes (`packages/cli/test/golden.test.ts`) and the parity test (M9).

## Decisions (Claude's call unless marked Logan's, overturnable at Gate 9)

1. **Arming is data (sim-core).**
   - A def may say `"arming": true`. Such a part has an `arm` input (0 to 1, default 0) and an `armed` output (0 or 1). When its `arm` value is above 0.5 on any tick, the part is armed from then on (`PartInstance.armed`, in the state hash, kept through splits because it lives on the part).
   - For a part with `arming`, the world applies `onDestroyed.explode` and `impact` only while it is armed, and the warhead behavior ignores `detonate` until armed. Parts without `arming` are unchanged. Both warhead defs get `arming: true` (Logan: generic, for anything).
   - Blueprint: `armed: true` on a legend entry or parts-list entry starts that part armed (Logan). The validator refuses it on a part without `arming` (`BAD_ARMED`, saying which parts can be armed). `toFileJson`, `place`, `mirror`, and `orient` keep it, like `auto`.
2. **Arming in controls.** `arm` is an ordinary input channel, so a key binding (`pulse arm 1` on a key) or a script (`set('heavywarhead', 'arm', 1)`) arms it. A carrier arms a carried bomb through its own controls before dropping it (the bomb is its part until then).
3. **Shipped blueprints keep working.**
   - Every missile's guide arms its warheads on its first tick awake (one line in each guide file; the per-missile copies are regenerated from `missile-seeker.guide.js` and the other shared guides). Their warheads are no longer set off by a hit on the drone, silo, or launcher carrying them.
   - `bomb` gets `armed: true` (a stock bomb is live, Logan). Other blueprints with warheads (`armored-car`, `big-guy`, `weird-thing`, `showcase`, and any found by grep) are checked one by one: a warhead meant to go off on contact gets `armed: true`; one meant to be set off by a key gets an `arm` key binding. Each choice is listed in As built.
   - Golden hashes are rewritten once, in T1's commit, with the reason (the sim changed on purpose: unarmed warheads). The parity test is unaffected.
4. **Look.** An armed warhead draws with a lit red light: the def's sprite gets an optional `armedFrame` (generic: any `arming` part), the app draws it when the part's `armed` output is 1. New frames in `gen-placeholders.ts`.
5. **Builder and CLI.** The part menu gets an "Armed at start" switch for parts with `arming` (all selected, like the auto switch). `pnpm sim show` marks armed parts; `pnpm sim parts` lists the `arm` input. The run report says when a warhead is armed (a new `armed` event: tick, robot, part).
6. **Drone bomb (`drone-bomb`, Logan).**
   - Small: about 4 propellers, a gyro, a radar, one heavy warhead, a battery. The pilot (`drone-bomb.pilot.js`) runs from the moment its core is awake: it arms its warhead, finds the nearest enemy robot with a live core, and flies at it.
   - Flying: the hunter hover's time-optimal leaning, asking for a velocity toward where the target will be (a short lead from its velocity), capped by what it can still brake from (its thrust, mass, and distance), so it goes as fast as it can and still stops on a moving drone. The last few meters it matches the target's velocity and closes; within about 1.5 m, or on contact (the impact fuze, now armed), it sets its warhead off.
   - It cannot see the ground (no scanner part), so it keeps at least a few meters above the robot it chases and the height it started at until close, then comes in from above or level. Flagged at the gate: "navigating choppy terrain" needs a ground-seeing part (in `ideas.md`).
   - With nothing tracked it holds position (hovers) and waits.
   - Done when (tests): it reaches and damages a parked car 60 m away; it catches and damages a hovering drone; a drone flying away faster than it escapes (it keeps chasing and never overshoots wildly, checked by its path); deployed as Enemy it goes for team 0.
7. **Enemy flying silo (`enemy-flying-silo`).** Logan's `flying-silo` airframe (boosters, heavy gyros, dense batteries, 12 missile-ups) with a pilot built from the enemy drone's: holds a spot about 80 m to the side and 20 m above its target, capped by a ceiling over where it started; launches a missile every 1.5 s at the tracked enemy sent the fewest so far (the silo's spreading), straight or arc per shot as the flying silo does. It does not dodge. Done when: it spots a parked car, holds its spot, and its missiles hit; it fights a hunter drone without crashing.
8. **Enemy launcher truck (`enemy-truck`).** A wheeled cart with a radar and a row of standing arc missiles (the silo's layout, about 4 to 6). Its pilot drives toward the nearest enemy until within about 150 m, stops (brakes with its wheels), and launches one missile every 3 s; it backs off if something gets within 40 m. Ground only: it reads the terrain by its own tilt, and stops if it tips past about 30 degrees. Done when: it drives to a parked car, stops in range, and hits it.
9. **All three are ordinary blueprints** deployable from the palette with Deploy as Enemy (or Yours), and droppable in `pnpm sim run --drop`. Their numbers are `param()`s.
10. **The playbook and docs** get arming (a new Trap: "arm your warhead in the guide"), the three robots as examples, and `02`/`03` the arming rule.

## Tasks

### T1: arming (sim-core)
- Tests first: a warhead with `arming` and no `armed` flag: destroyed by damage without a blast; a hard hit leaves it whole; `detonate` does nothing; after `arm` 1 (by a key binding and by a script), each of those sets it off; armed stays armed after `arm` returns to 0 and through a split; `armed: true` in a blueprint starts it armed; the `armed` output; the hash differs armed vs unarmed; the validator's `BAD_ARMED`; `toFileJson`/`place`/`mirror`/`orient` round trips keep `armed`; a part without `arming` behaves as before.
- Defs, `PartInstance.armed`, the warhead behavior, the explode and impact checks in `World`, blueprint types, validator, serializer, legend parsing, the `armed` event, CLI `show` and `parts`.
- Rewrite golden hashes (`UPDATE_GOLDEN=1`) in this commit only, and say why.

### T2: shipped blueprints arm themselves
- Every guide arms on its first tick awake; `bomb` gets `armed: true`; every other blueprint with a warhead checked (list in As built).
- Verify: `pnpm sim run` each launcher, drone, silo, and the bomb scenes: missiles still hit and explode; a bomb dropped on the longcar still breaks it; a missile hit on a loaded drone no longer sets off its missiles (a new test: the hunter's missile hits the enemy drone and the enemy drone's other missiles do not explode). Rewrite golden hashes again if T2 changes them (it will: the guides now arm).

### T3: builder and look (app)
- Part menu "Armed at start"; `armedFrame` sprites; the app draws armed warheads lit. Warn Logan before editing (his `pnpm dev` reloads). Check in the browser (`app-verify`, port 5181), stop the server after.

### T4: drone bomb
- The playbook loop: blueprint, `validate`, `show`, `run`, done-when tests (decision 6).

### T5: enemy flying silo
- Decision 7, with done-when tests.

### T6: enemy launcher truck
- Decision 8, with done-when tests.

### T7: docs, memory plan, review, gate
- Playbook, `02`, `03`, `ideas.md` (MASTER DRONE, drone bomb carriers, a ground-seeing part for terrain), `docs/plans/script-memory-limit.md`, status, As built, `docs/critique/gate-9.md`.
- Opus review subagent over the whole M10 diff; fix its findings. CI determinism steps for one new enemy (the truck against a car, and the drone bomb against a hovering drone).
- Commit, tag `m10`, push once, stop at Gate 9.

## Gate 9 (Logan)
- Shoot a loaded enemy drone: its missiles should not all go off. It keeps firing until you take it apart.
- Build a car of bombs, give it an arm key, drive it into something, arm, detonate.
- Deploy a drone bomb as Enemy and run from it; then shoot one down.
- Fight the enemy flying silo and the enemy truck.

## As built (2026-09-25)

### What shipped
- **T1+T2 (one commit, so the tree stayed green):** arming as data (`arming` in a def; `arm` input, `armed` output, `PartInstance.armed` in the hash; unarmed parts break without a blast, their fuze is off, the warhead ignores `detonate`); `armed: true` in blueprints (validator `BAD_ARMED`, kept by the file form, grid form, place, mirror, orient, and `setPartsArmed`); an `armed` world event in the run report; `pnpm sim show` marks parts armed at start. Every shipped guide (49 files) arms its warheads in `setup()`; `bomb`, `showcase`, and `weird-thing` start theirs armed. Golden hashes rewritten once, on purpose.
- **T3:** the part menu's "Armed at start" switch; `armedFrame` sprites (a lit red light; an unarmed warhead shows a dark socket there) in the builder, the deploy ghost, and the world.
- **T4:** `drone-bomb` and its pilot. **T5:** `enemy-flying-silo`. **T6:** `enemy-truck`. Each with done-when tests.
- **T7:** three new golden scenes (drone bomb against a hovering drone, the truck against a car, the enemy flying silo against a hunter drone), docs, the memory limit plan (`docs/plans/script-memory-limit.md`, not started), the review.

### Changes from the plan (Claude's call unless noted)
- **No new CI steps:** the three new golden scenes run in CI with every `pnpm test` and check the same thing (a run ends in exactly the recorded state), without extra Actions minutes.
- **The drone bomb closes at up to 30 m/s relative to its target** (param `speed`), braking-limited, so it reaches 20 to 45 m/s over the ground. A drone can only escape it by fleeing flat out (with no drag, a drone holding a lean keeps speeding up, past 80 m/s); a short dash does not escape. Measured from its warhead, not its core: measured from the core it sat on a car without going off.
- **The drone bomb targets only robots of 10 kg or more** (param `minMass`), like the enemy drone, so it does not chase missiles. It is 12 kg itself, so an enemy drone treats it as a robot to shoot at, not a missile to dodge.
- **The enemy flying silo waits 10 m above where it was deployed** with nothing tracked (param `idle`); going back to its launch height it settled on a box and stayed there.
- **The truck's arc choice is by height above it** (param `high`, 8 m): ground targets get the arc, drones above it a straight shot.
- **The truck brakes by asking for the other direction:** a wheel at speed 0 coasts.

### Measurements
- Drone bomb: hits a parked car 60 m away at 4.8 s (4 parts off), a drone hovering 20 m up at 4.3 s (3 propellers off); catches a hunter drone after a 1 s dash at 4.3 s.
- Enemy flying silo: its first missile hits a parked car 100 m away at 5.0 s; it takes a hovering hunter drone apart within 20 s; about 420 J/s in flight (roughly 70 s of flight on 28 kJ).
- Enemy truck: stops 149 m from a car 250 m away after about 20 s and kills its core with the first missile.
- A hit on a loaded drone now makes one blast (the hit), not one per missile: a bomb dropped on a parked `missile-drone-10prop` makes 1 explosion (was 3).
