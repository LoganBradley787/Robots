# Status

Updated: 2026-09-26, by an Opus 5.5 session, end of M12 (fabricator bay)

- Current milestone: **M12 (fabricator bay) done, stopped at Gate 11** for Logan to play. What to try: `docs/critique/gate-11.md`. Plan and As built: `docs/plans/M12-fabricator-bay.md`. Gate 10 (M11, flares) findings are in `docs/critique/gate-10.md` (the 4x speed fix is in).
- What M12 shipped:
  - **Multi-cell parts finished:** a footprint can have a hollow, blasts reach every cell, sprites and builder ghosts span the footprint, and mirroring refuses a lopsided footprint.
  - **The fabricator bay** (`fabbay`, a U open at the top whose hollow is sized where placed, 1 to 8 wide and 1 to 10 tall, Hollow +/- in its part menu): it builds a copy of a blueprint (its recipe, carried in the robot's own file) inside itself out of energy, refills itself, holds the finished copy, and lets it go on its `release` input. A guided missile costs 872 J and 4.1 s. The builder's part menu picks what a bay makes; the app shows the build part by part.
  - **`fab-drone`:** the hunter's airframe with one bay making guided missiles, four dense batteries, flares on V; hold F to fire each as it is built (about 20 on its batteries).
- M11 (before): flares (a burning flare stands in for its robot to every sensor that sees it), racks on your drones (V) and on enemies (automatic); seeker guides go off on a near miss.
- Golden hashes: any change that should not change the sim must keep them; one that changes it on purpose runs `UPDATE_GOLDEN=1 pnpm test` and says why (START-HERE). 24 scenes since the fab drones.
- Next steps, in order:
  1. **Done (2026-09-26): fab drones.** `enemy-fab-drone` (missiles), `bomb-fab-drone` (yours: a 4 by 3 bay making drone bombs, F held), `enemy-bomb-fab-drone`. Pilot `enemy-fab-drone.pilot.js` (holds still after a release, never climbs under a friendly robot). Tests `enemyFabDroneDoneWhen.test.ts`, golden scenes `enemy-fab-drone-vs-cars` and `bomb-fab-drones` (24 scenes). The run report now prints `buildBlocked`. Found: debris landing in an open bay blocks it for good (Known issues; a question for Logan).
     - After Logan played them: the fab drones build `heavy-drone-bomb` (a warhead on each corner, chained: wrecks a car outright); every drone bomb now climbs 15 m at full power, then flies straight in from any side (never below the target's bottom, and over friendly robots on the way); the fab drone pilot stays off the line (nothing within 12 m sideways and 20 m up or down). Golden hashes rewritten on purpose: `drone-bomb-vs-drone`, `enemy-carrier-vs-hunter`, `enemy-fab-drone-vs-cars`, `bomb-fab-drones`. Still slow-ish: 8.7 s to build, about 7 s to fly 90 m (four propellers on 14.5 kg).
  2. Logan plays Gate 11 and files findings in `docs/critique/gate-11.md`. Open questions there: cost and speed, whether a destroyed bay's held missile should be a dud, resizing mirrored pairs.
  3. Candidates after that (`ideas.md`): a bomber (flies over and drops bombs), a jammer, MASTER DRONE, debris cleanup, a ground-seeing part, GitHub Pages static build, a Web Worker for the sim. Later: radio part, impact damage, air drag, wheel suspension, propeller spin-up time, the rotator holding its angle under load, a native port bake-off.
  - The script memory limit fix is planned in `docs/plans/script-memory-limit.md` for a separate agent; not started (Logan).
  - Details and measurements: `docs/ideas.md`.
- Wording note (2026-09-25, M8): writing the homing missile tripped Opus's safety classifier several times. Write in plain game terms (no real weapon names or tactics talk in code or docs), build in small steps. The Javelin is the `arc` option.
- `blueprints/battery-drone*` (untracked) is Logan's; he keeps it on the old hover by choice.
- Lessons from builds are in the playbook (Traps, and the Sensors section); keep adding there.

## How Logan works (read before asking anything)
- Build a whole milestone without stopping, then stop at its gate for Logan to play. Do not stop after small tasks to ask "continue?".
- Before planning a milestone, ask a few taste questions (AskUserQuestion, recommendation first); decide technical things yourself and record them as "Claude's call" in the plan so Logan can overturn them at the gate.
- An Opus review subagent reads the diff at the end of each milestone (and in batches during it); fix its findings before tagging. Subagents are always model opus, never Fable.
- Logan runs `pnpm dev` in his own terminal. If you start a preview server on port 5180, stop it before handing back.

## Demo checklist results (2026-09-23)
- Built a robot from blank, tagged its wheels, added two controls, Save As `test-bot`, reopened it from the dropdown with tags and controls intact, deployed it (no prompt, nothing unsaved), dropped it mid-air, it fell and rested. Test file deleted afterwards.
- Opened `car`, added a battery, Deploy asked Save / Don't save / Cancel; Don't save deployed the edited car; `Tab` back showed the same draft still marked unsaved; `blueprints/car.json` unchanged on disk.
- Save As `Car Test` wrote `car-test.json` and left `car.json` untouched; Delete (with confirm) removed it (since the review fix, what's on screen stays as an unsaved blueprint).
- Undo and redo across drags; mirror mode placed flipped thrusters; box select and tagging; the ghost refuses the ground, the underground, and existing robots.

## Known issues
- M10: replays recorded before M10 do not replay exactly (their warheads were live from the start); `pnpm sim replay` says MISMATCH.
- M12: a copy with no motor stays in a bay pointing up and blocks the next build (the push out is 4 N s).
- M12: any piece that lands in an open bay's hollow (debris from a nearby blast) blocks it for the rest of the fight. Seen with the enemy bomb fab drone before its pilot stopped flying into its own drone bombs. Possible fix (Logan's call): a bay pushes loose pieces with no core out of its hollow, or a lid part.
- M12: `canPlace` probes each cell with 0.5 half extents (colliders are 0.49); unchanged, noted for multi-cell parts.
- M11: flare racks stick out 2 cells a side and soak up side hits (a drone bomb homes on the nearest part it scans). Gate 10 question.
- M11: a drone bomb (brakes at 7 m/s^2) overshoots a flare thrown toward it; flares against it work popped early, or with flying off.
- M10: robots cannot see the ground: the drone bomb keeps its lowest part 1 m over the target's lowest part, and the truck only knows a step by getting stuck on it.
- M9 review: a script's memory limit does not cap many small allocations (a script keeping 40,000 small arrays grew the process by 356 MB); it only catches big ones. Older than M9.
- M9: Stress drones run out of energy after tens of seconds unless Unlimited energy is on.
- M8: an attached missile shares its robot's energy pool while attached, so a hovering drone drains its missiles (about 60 percent left after 40 s).
- M8: scripts cannot see the ground (no scanner part yet); the enemy drone only dodges downward with room above the robot it tracks.
- M7: the stock `missile-drone` tilts up to about 8 degrees after its first shot while its hover learns the new balance (settles in about 3 s). `missile-drone-10prop`, `hunter-drone`, and `enemy-drone` compute their balance from `parts` and hold level.
- M7: missiles fly nose-up about 20 degrees to hold their weight, so their tail hangs about 1 m below the core and can clip a box on a low flat shot; a flat shot sinks about 3 m before leveling; a straight-up shot sags about 15 degrees past vertical.
- A save round trip rewrites parts in grid reading order; with two or more cores and no `primaryCore`, the root core could change after reopening. Deploy is unaffected (it goes through the same file form).
- Mirror mode's axis defaults to the core's column. On an asymmetric robot (the car: core in cell 2 of 6) mirroring overwrites parts on the far side. Alternative for Logan to judge: default to the center of the robot's bounding box.
- The app is desktop-sized; panels overlap the canvas below about 1100 px wide.
- Multi-cell parts (none exist yet) would draw one cell-sized sprite and count mass at the anchor cell in `pnpm sim show`.
- A part with auto controls off looks the same as the others on the builder grid; only its part menu and the Controls panel show it.
- A world reset (Clear robots) starts a new replay: robots cleared earlier are not in a saved replay.
- M6: a robot with a warhead explodes if dropped more than about 1.3 m (its fuze), including when you deploy it in mid-air. The showcase has one.
- M6: Clear debris also removes bombs waiting to fall, walls, and anything else nobody can control.
- M6: a missile's heading drifts slightly if the turret is still swinging when it fires (the missile keeps the turret's spin).
- M6: the damage tint only darkens a part; the plan's "cracked" look is not drawn.
- M6: a rebuilt robot's velocity reads 0, then about 88%, for the two ticks after a split (Rapier reports kicked multibody links late). The sim corrects for it; scripts on a robot that just lost a part still see it.
- M6: the CLI report's piece count misses pieces of a piece whose parent robot was later removed.

## Decisions since the plans (newest first)
- M12: see `docs/plans/M12-fabricator-bay.md`, As built: the sprite box and the hollow come from the footprint (no def fields), the def field `fabricate` plus an early `fabricate` behavior, a bay names its copy `<tag><n>`, `placeBlueprint` got `scope` and `reservedIds`, `Controller.carryFrom`.
- Gate 10 (after M11): the app gives the sim at most 10 ms per frame, so a heavy scene at 4x runs slower instead of dropping to 10 fps.
- M11: see `docs/plans/M11-flares.md`, As built: flares mount by their base (`Q^ Qv Q< Q>`), lighting and burning live with arming in `World.armParts`, one `flares` script with `auto` for enemies, guides go off on a near miss, 2 s burn kept.
- M10: see `docs/plans/M10-arming-and-enemies.md`, As built: golden scenes instead of new CI steps, the drone bomb measures from its warhead and closes at 30 m/s relative, the enemy flying silo waits 10 m up, the truck brakes by reversing.
- M9: see `docs/plans/M9-script-speed.md`, As built: `inputToFrame` instead of `frameToInput`, part objects sealed with read-only fields (a TypeError under `'use strict'`), `get()` reads the parts as sent, team 2 draws blue, `canPlace` prefilter.
- M8: see `docs/plans/M8-sensors-and-homing.md`, As built: launchers loft 12 degrees before firing, arcing missiles hold 30 m/s and turn down early, drone missiles stand nose up, 14-propeller drone airframe, dodging picks the widest gap and only drops with room, hovers tell left from right by position.
- M6: see `docs/plans/M6-destruction.md`, As built: warhead damage 120 and push 40 up and out, velocity-change fuze, rotator 300 N m, decouplers act first, part boxes 0.49 m, helper bodies for Rapier multibody angles, the largest piece keeps the id when the core is gone.
- M3 review fixes: key edges keep their order within a tick (release then re-press stays held; two toggle taps flip twice); part menu Rotate turns the menu's parts, not the held part; validator refuses binding keys that can never fire (`BAD_KEY`) and part ids equal to a part type (`BAD_ID`); CLI warns on timeline keys a robot does not have; a Cmd chord releases the robot's keys (macOS drops those keyups); mirror keeps `auto: false`.
- M3: inputs are key edges addressed to a robot (`RobotInput`), replacing M0's `InputFrame`; possession lives in the app. Thruster force 60 to 120 N, propeller 40 to 60 N, wheel 12 N m with a torque curve and coast drag. Hopper thrusters sit in the body row.
- Gate 2 item 1 (Logan): letters and digits belong to the robot; A and D drive. World keys are punctuation (`\` debug, `` ` `` grid, `,` camera, Space, `.`, `[`, `]`), reset is a toolbar button with a confirm, the world has a clickable toolbar, the builder refuses world keys, and new controls default to D then A. Recorded in `docs/design/04`.
- M2 review fixes: Save As always asks before replacing an existing file, including the open one; a blueprint that could not be reopened is never written; Delete keeps what is on screen as an unsaved blueprint; Save As renames every undo step; binding targets are only tags whose parts have input channels; binding keys are named from the physical key (`KeyboardEvent.code`); Esc, `Tab`, and window blur close an open drag; undo and redo are ignored mid-drag; Enter in a dialog presses the focused button; Cmd+S never opens the browser's Save Page; blueprint files are written atomically (temp file then rename).
- M2: Preact without `@preact/preset-vite` (it needs Babel as a peer); Vite's built-in JSX transform with `jsxImportSource: preact`. Panel edits reload the page instead of hot swapping.
- M2: `World.canPlace` tests each collider directly with `Shape.intersectsShape`; Rapier 0.20's scene queries only see colliders after a step, so they missed robots just spawned and the ground in a paused new world. Placement below the ground surface (y < 0) is refused even under the 2 m physics slab.
- M2: new bindings get the first unused key (`w`, `a`, `s`, `d`, ...) so a saved blueprint never has an empty key (which would not reopen). Key names come from the physical key: `a` and `1` for letters and digits, else the `KeyboardEvent.code` (`Space`, `ArrowUp`).
- M2: the browser's own "leave page?" prompt guards closing or reloading with unsaved changes.
- M2: UI buttons and dropdowns give focus back after use, so builder keys and Space never trigger them.
- M1: solver iterations 8 and internal PGS iterations 8 (from 4 and 1); measurements in `docs/design/03`.
- M1: the core is identified by `role: "core"`; joint motor settings live in `joint`; a joint part attaches only through its mount face; `toGrid` keeps cells; `W^` is the mount-down wheel token.
- M1: textures 64 px per cell with linear filtering; ground drawn 40 m deep; static blocks drawn behind the ground; ramp flush with the surface.
- M0: `sim` script without a trailing `--`; pnpm 11 `allowBuilds` for esbuild; dev port 5180; world hash includes RNG state; tick cap per frame.

