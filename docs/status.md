# Status

Updated: 2026-09-23, by a coding session (Opus 5.5)

- Current milestone: M2 complete, plan `docs/plans/M2-builder.md`, design `docs/design/10-builder.md`. **Gate 2 (Builder) is open.** No M3 work until Logan's punch list is empty.
- Done: M0 (tag `m0`), M1 (tag `m1`, Gate 1 passed), M2 T1 to T10 (tag `m2`): builder screen, pick-then-paint, erase, rotate, select and tag, undo and redo, mirror mode, live stats and center of mass, live validator with outlined cells, controls (bindings) panel, blueprint files in `blueprints/` with explicit Save and Save As, unsaved-changes prompts, deploy with a spawn ghost.
- In progress: none
- Next: Logan plays Gate 2 and drops notes in `docs/critique/inbox.md` or in chat. A session turns them into `docs/critique/gate-2.md` and fixes them one at a time. Then the M3 plan (control: keybinds drive wheels, thrusters, propellers; possession).

## Gate 2: what to look at

Run `pnpm dev`, open http://localhost:5180. The app opens in the builder.

- Build something from blank: pick parts (palette or 1 to 8), click and drag to paint, right-drag to erase, `R` to rotate, `M` for mirror mode.
- Select parts (click, or drag a box with nothing held) and tag them; add controls in the side panel (they do nothing until M3).
- Save As, open another blueprint from the dropdown, come back, Save. Try to lose work: every path should ask first.
- Deploy: the ghost turns green where it fits and red where it does not; click to drop. `Tab` goes back and forth.
- Judge: is building intuitive, does the trip between builder and world suck, does anything feel slow or fiddly.

## Demo checklist results (2026-09-23)
- Built a robot from blank, tagged its wheels, added two controls, Save As `test-bot`, reopened it from the dropdown with tags and controls intact, deployed it (no prompt, nothing unsaved), dropped it mid-air, it fell and rested. Test file deleted afterwards.
- Opened `car`, added a battery, Deploy asked Save / Don't save / Cancel; Don't save deployed the edited car; `Tab` back showed the same draft still marked unsaved; `blueprints/car.json` unchanged on disk.
- Save As `Car Test` wrote `car-test.json` and left `car.json` untouched; Delete (with confirm) removed it (since the review fix, what's on screen stays as an unsaved blueprint).
- Undo and redo across drags; mirror mode placed flipped thrusters; box select and tagging; the ghost refuses the ground, the underground, and existing robots.

## Known issues
- For M3: robot bindings and world keys overlap. New bindings default to `w`, `a`, `s`, `d`, ... while the world uses `D` (debug), `F`, `C`, `R`, `G`, Space, `.`, `[`, `]`. The M3 plan must decide which wins while a robot is possessed (likely: world keys move to modifiers or the possessed robot's bindings take priority) and add a validator warning for bindings on reserved keys.
- A save round trip rewrites parts in grid reading order; with two or more cores and no `primaryCore`, the root core could change after reopening. Deploy is unaffected (it goes through the same file form).
- Mirror mode's axis defaults to the core's column. On an asymmetric robot (the car: core in cell 2 of 6) mirroring overwrites parts on the far side. Alternative for Logan to judge: default to the center of the robot's bounding box.
- The app is desktop-sized; panels overlap the canvas below about 1100 px wide.
- Multi-cell parts (none exist yet) would draw one cell-sized sprite and count mass at the anchor cell in `pnpm sim show`.
- Propeller spin and thruster flame animations are not played until channels exist (M3).

## Decisions since the plans (newest first)
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

- Next gate: Gate 2 (Builder), open now.
