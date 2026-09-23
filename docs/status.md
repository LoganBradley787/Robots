# Status

Updated: 2026-09-23, by a coding session (Opus 5.5), end of M3

- Current milestone: **M3 complete, Gate 3 (robot feel) open.** Plan `docs/plans/M3-control.md`, design `docs/design/11-control.md`.
- Done: M0 (tag `m0`), M1 (tag `m1`, Gate 1 passed), M2 (tag `m2`, Gate 2 passed), M3 T1 to T12 (tag `m3`):
  - Controller per robot: hold, toggle, pulse; sum and clamp; key edges addressed to a robot, logged per tick; held keys and toggles in the hash.
  - Behaviors from part data: wheel as an electric motor that coasts when let go; thrust for thrusters and propellers along the way they point.
  - Tuned headless (`pnpm sim tune`, table in `11`): the car does 6 m/s in 1.6 s and tops out near 17 m/s; double the mass takes about twice as long.
  - Auto controls on by default (wheels D/A, push parts on the key they push toward), per-part and per-blueprint opt-out; type names ("all wheels") as binding targets.
  - App: deploy takes control, `,` cycles, click a robot to control it; robots you leave hold their last input; blur and the builder release keys; keys bar; thruster flame and propeller spin follow throttle.
  - Builder: right-click part menu (tags, auto on or off, rotate, delete) on the selection; eraser tool on `E`; controls panel lists auto controls; values in percent.
  - CLI: `--keys "d:0-3, w:5"`, drive metrics (distance, max altitude, max tilt, top speed), `pnpm sim replay <file>`; CI runs a keyed determinism check.
  - Replays: world toolbar Save replay writes `replays/` (gitignored); a browser session reran in Node with a MATCH.
- In progress: none.
- Next: **Gate 3.** Logan runs `pnpm dev` and plays. Then write `docs/critique/gate-3.md` from his notes, fix it, and plan M4 (power) with M5 (scripting) behind it, since Gate 4 judges them together.

## Gate 3: what to try (for Logan)
- Builder: open `car`, Deploy, drop it. Hold D and A: spin-up, coasting when you let go, braking by holding the other key.
- Deploy `hopper`: tap and hold W. Flames show under the thrusters.
- With two robots out: hold D on one, press `,` to switch; the first keeps driving. Click a robot to take it. Tap a lit key in the keys bar to let go of a latched key.
- Builder: right-click a wheel, untick Auto controls, see the Controls panel change. Box-select several parts and right-click one of them. `E` for the eraser.
- Save replay on the toolbar, then `pnpm sim replay <name>` in a terminal.

## Gate 3: calls Logan may want to overturn
- Driving numbers (wheel 12 N m, coast drag 1 N m, top speed 18 m/s; thruster 120 N, propeller 60 N). All in part defs.
- Coasting means parked robots roll on slopes; there is no parking brake.
- The flat world is tight for 17 m/s: blocks at x = -8 and x = 8 stop a car within a few meters. A longer test track may be wanted.
- A 1 m part in the wheel row rests on the ground (wheels are 0.45 m balls), so put thrusters one row up.
- The keys bar shows keys only, lit while held (including latched keys on a robot you switch back to).
- A new custom control starts on a key auto controls do not use.
- Clicking or cycling to a core-less robot lets go of control; the robot you were driving latches.

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

## Decisions since the plans (newest first)
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

