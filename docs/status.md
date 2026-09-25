# Status

Updated: 2026-09-24, by a coding session (Opus 5.5), end of M7

- Current milestone: **M7 (Claude workflow) done, tagged `m7`. Stopped at Gate 6** for Logan to play. What to try and what to judge: `docs/critique/gate-6.md`. Plan and As built (both dry runs, the review): `docs/plans/M7-claude-loop.md`.
- What M7 shipped:
  - Placing a blueprint on another copies it (Logan: never links). The copy's core keeps its own controls in `cores` with a scope (`missile1`); they start when its piece breaks off. `placeBlueprint` in sim-core, `pnpm sim place`, and the builder's Blueprints palette (R turns, F flips, mirror mode places a twin) all use it. The Controls and Scripts panels have a Controls for picker.
  - Examples: `missile` (`M g E C X`, guide script holds its release line, 10 s fuse), `launcher` (rebuilt, Logan-tested), `missile-drone` (hover leans by propeller throttle, F fires right then left).
  - New `cell` part; rotator 600 N m that turns only as fast as it can stop.
  - CLI for Claude: `run` prints events in order, every piece's final state by letter, and a side view of paths and shapes; `parts`; `show` with every core's controls; `mirror`; `place`.
  - `docs/claude-robot-playbook.md`: how a fresh session builds a robot from a sentence. Two dry runs by fresh Opus subagents both produced working robots; what they tripped on is fixed.
  - Keys bar shows keys the running scripts read (dashed, after a divider). Scripts see each part's `mass`.
- Gate 6 so far (`docs/critique/gate-6.md`): five findings from Logan's play, all fixed (stronger propellers and thrusters, `missile-drone-10prop`, instant weight-shift balance, time-optimal leaning and climbing, lean 60 degrees). Logan: "Everything's working!" Still to try from the checklist: a fresh Claude Code session asked for a robot in plain words.
- Next: close Gate 6 with Logan, then plan M8. Logan's goal and Claude's recommendations are written up in `docs/ideas.md`, "After Gate 6": sensors and homing missiles with teams, then an AI missile drone that tracks, fires homing missiles, and dodges; the script performance fix (measured, planned, Logan agreed) as its first task; then a fabricator bay (missiles that do not run out), debris cleanup, multi-cell parts. The same section has the scale measurements and the native-port question.
- Lessons from M7 builds are in the playbook (Traps); keep adding there.
- Logan's notes for a later sensors milestone: `docs/ideas.md` (sensors, targeting, teams, possession by team).

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
- M7: the missile drone tilts up to about 8 degrees after its first shot while its hover learns the new balance (settles in about 3 s). The second dry run's drone computed its balance from `parts` and held 0.5 degrees; the stock drone could do the same.
- M7: missiles fly nose-up about 20 degrees to hold their weight, so their tail hangs about 1 m below the core and can clip a box on a low flat shot; a flat shot sinks about 3 m before leveling; a straight-up shot sags about 15 degrees past vertical.
- M7: a placed missile's core and cell share the robot's energy pool while attached, and the hover drains them.
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

