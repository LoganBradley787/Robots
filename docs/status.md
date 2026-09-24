# Status

Updated: 2026-09-23, by a coding session (Opus 5.5), end of M6

- Current milestone: **M6 complete (tag `m6`), waiting at Gate 5 (destruction: explosions, splitting, debris, missiles).** Plan `docs/plans/M6-destruction.md` (with an As built section); design `03`, "Destruction as built", is the reference.
- Done: M0 to M5 (Gates 1 to 4 passed), M6:
  - Health per part (frame 60 down to propeller 15; table in `02`), damage stays. Damaged parts look darker.
  - Warheads explode on a key (`detonate`), when destroyed (chains), or on a hit that changes their body's speed by more than 5 m/s. Blast: 120 damage falling to 0 at 3 m, halved per part or terrain box in the way; push 40 N s per cell up and out to 5 m.
  - Robots break into pieces that keep their motion; each piece is its own robot. A piece keeps its last input (a cut-off half drives on while its battery lasts); losing the core stops control; a piece with one core wakes with auto controls.
  - Decouplers separate (once, 2 N s each side, before other parts act that tick). Rotator (key 0, `R`): Z and X aim a turret, holds its aim, 300 N m.
  - Clear debris (toolbar), explosion and break effects, notices for lost and woken cores.
  - New blueprints: `bomb`, `longcar` (Logan's bomb test robot), `launcher` (turret with a missile under a decoupler rail: Z/X aim, F fires), `wall` (a target with a battery inside).
  - CLI: `pnpm sim run <bp> --drop bomb@2:-77,4.95` spawns another blueprint mid-run; the report lists what broke; `tune` prints kill distances and push. CI checks both destruction scenarios for determinism.
  - Rapier findings worth knowing (`03`): multibody links ignore velocity writes (kicks instead), reset angles on joint creation (invisible helper root and pivots), and report no contact forces; face-to-face pieces snag (part boxes are now 0.49 m).
- **Gate 5 walkthrough for Logan** (builder, pick from the Blueprint dropdown, Deploy, click to drop):
  1. Deploy `longcar`, hold D to drive, Tab to the builder, pick `bomb`, Deploy it a few meters above the car. It breaks in two; the half without the core keeps driving.
  2. Deploy `wall`, then `launcher` about 20 m to its left. Hold Z a moment to aim up (about 25 degrees), press F. The missile drops off its rail, flies, and blows a hole in the wall.
  3. Try Clear debris, a bomb next to (not on) a car, two warheads side by side, and your own designs: armor a battery with frames and bomb it.
  4. Write what felt wrong in `docs/critique/gate-5.md` (or tell Claude and it will).
- Next: Logan plays Gate 5 and files a punch list. After that, M7 (the Claude workflow: sub-assembly references, which also give woken missile cores their own bindings and scripts).
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
- M6: a rebuilt robot's velocity reads 0, then about 75%, for the two ticks after a split (Rapier reports kicked multibody links late). Scripts on a robot that just lost a part see that.

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

