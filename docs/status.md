# Status

Updated: 2026-09-25, by an Opus 5.5 session, M9 planned

- Current milestone: **M8 (sensors, teams, homing) done, stopped at Gate 7** for Logan to play. What to try: `docs/critique/gate-7.md`. Plan and As built (every change from the plan and why): `docs/plans/M8-sensors-and-homing.md`.
- What M8 shipped:
  - Teams (a number per robot, picked at deploy with the world toolbar's Deploy as: Yours / Enemy, sticky); only your own robots can be taken over; enemies tinted red.
  - Deploy flip (`F`) and quarter turns (`R`) while placing, sticky; CLI `--team`, `--flip`, `--rot`, and drop suffixes `:enemy :flip :rot90`.
  - `seeker` and `radar` parts; scripts get `contacts`, `scan(id)`, `send(to, data)`, `inbox`, `mark(x, y)`. Debug overlay draws cones, contact lines, and marks; the run report shows sight, sends, marks, and time per tick.
  - Homing: `missile-seeker` + `launcher-seeker`, `missile-arc` + `launcher-arc` (climbs and comes down on the target), `missile-up` (stands on drones).
  - `hunter-drone` (yours: F launches at the nearest enemy) and `enemy-drone` (flies itself: tracks, launches, dodges).
  - Fast hover fix for a load that swings off center.
- Gate 7 closed (2026-09-25, Logan: "I'm happy with everything we got"). After the review fixes it added the `booster`, `heavywarhead`, `heavygyro`, and `densebattery` parts, a rebuilt seeker guide (climb clear, arc or straight per shot), `big-missile` and `big-launcher`, `silo`, and a hover for Logan's `flying-silo`. See `docs/critique/gate-7.md`.
- Wording note (2026-09-25): writing the homing missile tripped Opus's safety classifier several times. Logan and Claude agreed to write in plain game terms (no real weapon names or tactics talk in code or docs), to build in small steps, and to switch models for that part if it keeps happening. The Javelin is the `arc` option.
- Next steps, in order (Logan's order, 2026-09-25; script speed separately so a break is easy to trace):
  1. Next: **M9, script speed**, planned in `docs/plans/M9-script-speed.md` (Logan's answers in it). Waiting for Logan's go on the plan; then start at T1 (golden hashes and `pnpm sim bench`, before any speed change).
  2. Candidates after that: fabricator bay (missiles that do not run out), debris cleanup, multi-cell parts, GitHub Pages static build. Later: radio part, impact damage, air drag, wheel suspension, propeller spin-up time, a ground-seeing scanner part, the rotator holding its angle under load, a native port bake-off.
  - Details and measurements: `docs/ideas.md`, "After Gate 6".
- `blueprints/battery-drone*` (untracked) is Logan's; he keeps it on the old hover by choice.
- Lessons from builds are in the playbook (Traps, and the new Sensors section); keep adding there.

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

