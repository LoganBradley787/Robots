# Status

Updated: 2026-09-24, by a coding session (Opus 5.5), during M7

- Current milestone: **M7 (Claude workflow) in progress.** Plan `docs/plans/M7-claude-loop.md` (approved; revised with Logan before "go": placing a blueprint copies it, no live links between files).
- Done in M7 so far:
  - T1: controls per core. A blueprint file can hold `cores: { "<core id>": { scope, bindings, scripts, autoControls } }`. `placeBlueprint` (sim-core) copies one blueprint onto another: parts get the scope tag (`missile1`) and `missile1.<tag>`; the copy's controls go under its core with that scope; ids in bindings are renamed. Scoped controls see members' tags without the prefix, and every part by id and type (so a hand-replaced warhead still works).
  - T2: a woken core runs its own controls (bindings, scripts with `setup()` the tick after waking, its own auto controls switch).
  - T3 part 1 (Logan tested and happy): `missile` (`M g E C X`: thruster, gyro, cell, core, warhead at the tip) with `missile.guide.js` (steers the thrust vector to hold the line it was released on, 10 s fuse, parts found by type). `launcher` rebuilt with a placed missile: tall turret, missile hanging under a `Dv` rail, long base (Logan: tipped over otherwise), one row taller (Logan: flat shots scraped the ground). New `cell` part (0.5 kg, 250 J, health 10, legend `E`, builder key `-`). Rotator 600 N m; it turns only as fast as it can stop the turret, and the aim never runs more than 0.15 rad ahead of a heavy turret (it used to swing far past). `pnpm sim place <target> <source> --at x,y [--rot] [--mirror] [--save name]`.
- T4 in progress (paused for the night, tree green). Done: `pnpm sim run` now prints an events list (keys, drops, decouplers, splits, wakes, parts lost, blasts, script logs with repeats folded, crashes), every piece's final state by letter, and an ASCII side view of every piece's path (`packages/cli/src/report/trace.ts`, `plot.ts`); `--json` carries `events`, `pieces`, `plot`. No more "key does nothing" warning for keys a script reads. `partRows`/`formatParts` in `packages/cli/src/commands/parts.ts` (tested). `mirrorBlueprint` now renames id references (bindings, primaryCore, corePriority, cores).
- Next (start here): finish T4: wire `pnpm sim parts` (and `--json`) into `cli/src/main.ts`; `show` prints each core's controls (bindings, scripts, auto controls) with a test; `pnpm sim mirror <bp> [--axis half-cells] [--save name] [--force]` (default axis keeps the bounding box in place; warn that scripts are copied unchanged); USAGE help text. Then T3 part 2 (`missile-drone`) with the new run report, then T5, T6, T7.
- Lessons from the launcher (for the playbook): a missile resting on top of a tilted rail tips off its end, so hang it under a `Dv` rail; keep a turret's weight near the hinge or on a strong rotator; a heavy turret on a short car tips the car; a flat shot needs about 3 m of drop room; a missile needs thrust well above its weight (the 3 kg battery made T/W 1.5, the cell makes it 2.2).
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

