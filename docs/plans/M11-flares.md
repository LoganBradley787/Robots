# M11 Flares Implementation Plan

> **For agentic workers:** Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/design/02-parts-and-blueprints.md` (sensor parts, arming), `04` (Script API: contacts, scan), `docs/plans/M8-sensors-and-homing.md` (how sensing works), `docs/plans/M10-arming-and-enemies.md`, and `docs/claude-robot-playbook.md` first. Tests first for every sim-core change, one commit per task (`M11 T<n>: <what>`), tree green at every commit, commit often and push only at the gate. Plain game terms (M8 wording note).

**Goal:** a way to survive incoming fire that is not firing back. A robot lets go of a flare; while it burns, every sensor that sees it takes it for the robot that let it go. Timed right, whatever is steering at you by its sensors steers at the flare instead. Ends at Gate 10.

**Written by:** an Opus 5.5 session, 2026-09-26, after Logan's answers.

## Logan's answers (2026-09-26)
- **Flares** (not a jammer, for now). Released, not worn: "if it's on your device, it's no fun." Timing matters: too early or too late does not work.
- **They fool sensors, all of them:** seekers and radar. **Rules attach to sensors, never to kinds of robots** (Logan): nothing names missiles or drone bombs; whatever steers by a fooled sensor is fooled as a consequence. The same holds for every later mechanic.
- **Who gets them:** your drones on a key, and enemies (they pop one when they see something coming at them).

## What exists already
- Sensors (M8): a part def with `sensor: { cone, range }`; `World.contactsFor` lists every robot whose reference point (live core, else center of mass) a working sensor sees, with line of sight through terrain; `scan(id)` returns a seen robot's parts. Scripts see only `contacts` and `scan`.
- Releasing things: decouplers (a release impulse of 2 N s), latched channels on a piece that breaks off (`04`, Latching: script-layer values latch, one-tick key pulses do not), arming (M10) as the model for a part with a latched state.
- Threat prediction in `enemy-drone.pilot.js` (`threat()`: closest pass of an incoming light robot).

## Decisions (Claude's call unless marked Logan's, overturnable at Gate 10)

1. **The flare part (data).** `flare`: 0.2 kg, health 5, one cell, attaches on every face, legend `Q`, a builder key. Its def says `decoy: { burn: 2 }` (seconds) and it has an `ignite` input (above 0.5 lights it, for good) and a `burning` output. A new `flare` behavior counts the burn down; when it ends, the part is destroyed quietly (no blast) and falls away as nothing. `PartInstance` gains the burn left and the robot it stands in for (see 2), both in the state hash. The engine reads `decoy`; it never names `flare`.
2. **The sensor rule (Logan: every sensor).** A burning decoy stands in for the robot it was part of when it was lit (`decoyOf`: that robot's id, recorded on the part at ignition). For any robot's sensors that see the decoy's position (cone, range, line of sight, as for any robot), that robot's contact is reported **at the decoy**: the decoy's position and velocity, with the real robot's id, side, core, mass, and part count, whether or not the real robot is also in view. Several of its decoys in view: the nearest to the viewer. `scan(id)` of it returns what the sensor sees there: the decoy's part. The decoy's own piece is not listed separately while it burns. Once burnt out, the contact goes back to the real robot if it is seen.
   - Consequences, not rules: a missile following you by id follows the flare; a launcher's radar reports you at the flare; a drone bomb (radar) chases it; your own robots' sensors see your flare as you too (it fools everyone).
   - The timing window falls out: lit too early, it burns out first and the chaser finds you again; too late, the chaser is already on you (a blast reaches 3 to 4 m) or the flare is outside a narrow seeker's cone.
3. **Lighting and letting go.** A flare lights when its `ignite` input goes above 0.5, attached or not. A rack is flares on decouplers; a rack script sets `ignite` on the flare and fires its grip on the same tick, so the flare leaves burning (the 2 N s release gives a 0.2 kg flare about 10 m/s away from the robot). A key binding can do both too (a pulse on `ignite` and on the grip).
4. **Shipped robots.** Flare racks (six flares, each on its own grip) on `hunter-drone`, `big-drone`, and `carrier`, released by V (pairs: one left, one right, tossed out sideways). `enemy-drone`, `enemy-big-drone`, `enemy-flying-silo`, and `enemy-carrier` get racks too and pop a pair when their threat check predicts something passing within a few meters in about a second (the enemy drone's `threat()`, moved into each pilot). Added with `pnpm sim place` so blueprints stay data.
5. **Look.** A burning flare draws bright with a small glow (a lit frame and the thruster's flame-style overlay while `burning` is 1); a spent one is gone.
6. **Report and overlay.** The run report logs `lit` and `burnt out`; the debug overlay draws a contact line to a decoy as it would to the robot, marked as a decoy (so you can see who is fooled).

## Tasks
### T1: the flare part (sim-core)
- Tests first: lights on `ignite` (key and script), burns 2 s, then is destroyed without a blast; the burn and `decoyOf` are hashed; `burning` output; a flare released burning keeps burning (latched channels); a part without `decoy` is unaffected.
- Def, behavior, `PartInstance` fields, def parser (`decoy` requires `ignite` and `burning`), legend token, builder key, placeholder sprites (unlit, lit).

### T2: the sensor rule (sim-core)
- Tests first: a seeker and a radar both report a robot at its burning flare; nearest of two flares; the flare's own piece not listed while burning; back to the real robot after burnout; `scan` returns the flare; a flare out of a sensor's cone or behind terrain fools nothing; parity and golden hashes unchanged for scenes without flares.
- `World.contactsFor`, `scan`, `sensorView`.

### T3: racks on shipped robots, and the timing (blueprints)
- A `flare-rack` blueprint (six flares on grips) placed on the drones and carriers; rack scripts (V, pairs); enemy pilots pop flares on a predicted pass.
- Done-when tests: a seeker missile fired at a hovering drone is pulled off by a pair lit about 1 s before it arrives, and hits otherwise; lit 4 s early, it hits anyway; lit 0.2 s before, it hits anyway (or the blast reaches); a drone bomb chasing a drone is pulled off by a well-timed pair; an enemy drone survives more of a hunter's volley with its flares than without.
- Tune the burn time and the release so the window is fair, and record the numbers.

### T4: look, overlay, docs, review, gate
- Flare sprites and glow, overlay decoy lines, run report events.
- `02`, `04` (contacts can be decoys: the rule), the playbook (flares, racks, and the rule by sensor), status, As built, `docs/critique/gate-10.md`.
- Opus review subagent; fix findings; golden scenes with flares; tag `m11`, push once, stop at Gate 10.

## Gate 10 (Logan)
- Fly the hunter drone at an enemy drone; when its missile comes, press V at different moments: too early, about right, too late.
- Watch the debug overlay: fooled sensors draw their line to the flare.
- Let a carrier's drone bombs chase you and flare them.
- Fight the enemy drones and silos, which now flare your missiles.

## As built (2026-09-26)
- **T1, the flare.** `flare.json`: 0.2 kg, health 5, `decoy: { burn: 2 }`, `ignite` in, `burning` out, `litFrame`. Lighting and burning are in `World.armParts` (with arming, before behaviors), not a behavior module: the engine reads `decoy`, as it reads `arming`. The burn counts ticks (120). A burnt-out flare emits `burntOut`, then `partDestroyed` with `burntOut: true`; the app shows no puff, the run report does not count it as lost.
- **Changed from the plan:** a flare attaches by its base only (S at rotation 0; legend `Q^ Qv Q< Q>`, not `Q`). With every face, three flares stacked in a rack held each other on. No builder key (none left); palette only.
- **T2, the sensor rule** as planned (`contactsFor`, `burningDecoys`, `scan`, `sensorView`). A set of lit decoys lets worlds that never lit one skip the search (golden hashes and parity unchanged for them); with flares burning, the world is searched once per tick. A decoy whose robot is gone fools nothing and its piece is not listed. Scripts are never told; `sensorView` marks `decoy`.
- **T3, racks.** `flare-rack.json` (three flares on `D<` grips) placed twice (left, and mirrored right) on seven robots, each host first padded with two columns of dots. One script, `flare-rack.flares.js`, copied as `<host>.flares.js`: V pops the next flare of every rack; `auto` 1 (enemies) pops them on a predicted pass within 8 m in 1.2 s. **Changed from the plan:** enemies use this script with `auto` instead of a `threat()` moved into each pilot, so one script serves both.
- **T3, guides.** Measured, flares at first did not work against the seeker guide: its nose flew straight through a 0.2 kg flare (too light to set off the fuze), its 2 m proximity was measured from the core behind the nose, at about 130 m/s it covers 2 m a tick, and its seeker (in the nose) loses a flare it is passing before the core gets close. The guide (all 63 copies) now goes off when its warhead will pass within `proximity` before the next tick, and when it loses sight of what it was about to reach within `near` (5 m). A 3 m proximity also worked for flares but made every missile weaker against real targets (the enemy flying silo stopped killing the hunter), so it stayed 2 m.
- **T3, timing (hunter hovering at (-40, 40), `launcher-seeker` 310 m away):** lit 0.4 to 2.5 s before arrival, the missile goes off at the flare 12 to 30 m out; 3 s or more, it hits; 0.2 s, it hits. Burn 1.5 s gives 0.4 to 1.5 s, burn 1 s gives 0.4 to 1 s; kept 2 s (Gate 10 question).
- **T3, side effects fixed:** `carrier` and `enemy-carrier` drone bombs get `clearWidth` 24 (the deck is 4 wider); `enemy-carrier.pilot.js` lets bombs go only while climbing or sinking slower than `rise` (2 m/s), since it flew up into the bomb it had just let go. `enemyFlyingSiloDoneWhen` now checks 25 hunter parts lost rather than its core in 20 s (the racks shield its sides).
- **T3, done-when tests** (`flaresDoneWhen.test.ts`): the seeker timing (1 s saves, 4 s and 0.2 s do not); a drone bomb goes off at a pair lit 1 s ahead (12 m or more out) instead of on the drone; an enemy drone with `auto` flares loses under half what it loses without (0 against 28 as measured).
- **T4.** Lit sprite and a flickering glow; the overlay rings a decoy contact in orange; the run report's `lit` and `burnt out`; golden scene `hunter-flares` (21 scenes).
