# Status

Updated: 2026-09-23, by a coding session (Opus 5.5), end of M3

- Current milestone: **M5 complete (tag `m5`), Gate 4 (power and scripts) open.** Plans `docs/plans/M4-power.md` and `docs/plans/M5-scripting.md`; design `05` and `04` (decisions and as-built notes at the end of each).
- Done: M0 to M3 (Gates 1 to 3 passed), M4 (tag `m4`: energy), M5 (tag `m5`):
  - Air drag: quadratic per robot cell, no spin drag on wheels. The hopper tops out between 50 and 90 m/s; the car lost 1 m/s of top speed.
  - Script sandbox: QuickJS in WASM, one runtime per script, a counting budget, memory and stack limits, seeded random, no Date. Endless loops, throws, deep recursion, and broken output only stop that script.
  - Scripts in the world: a held key beats the script beats the default; H-style key toggles; `setup` on enable; crashes disable the script with a notice; logs; flags in the hash; replays with scripts match.
  - Scripts are `.js` files next to their blueprint; Save writes them, Save As copies them, deploys and replays carry the code inline.
  - Builder: Scripts panel, code editor with a live compile check and params, `script` mode in Controls. World: script keys lit while running, a status and log panel.
  - Examples: `drone` (hover script: holds height, W and S move it, A and D lean, H toggles) and `looper` (an endless loop, contained).
  - Review fixes: the sandbox cannot be broken from inside a script (closure-held internals, shape-checked output, guarded disposal), scripts never share a file, the editor never shows another script's check, Save keeps edits made while saving.
- Next: **Gate 4.** Logan runs `pnpm dev` and plays. Then `docs/critique/gate-4.md`, fixes, and plan M6 (destruction).

## Gate 4: what to try (for Logan)
- Deploy `hopper`: the energy bar on the keys bar drains while you thrust; at 4x speed it runs dry (notice) and drops. Toggle Unlimited energy on the toolbar.
- Builder: stats show energy and full draw ("energy 2100 · full draw 50/s").
- Deploy `drone`: it hovers where you drop it. W and S change height, A and D lean it, H turns the hover off and on (the H key lights while it runs). The log panel bottom left shows the script's state.
- Builder: open `drone`, Scripts, Edit: the code, live errors (type something broken), params `climb` and `lean`. Add a script of your own, bind a key to it in Controls with mode `script`.
- Deploy `looper`: its script stops on the first tick with an error notice; the game keeps running.

## Gate 4: calls Logan may want to overturn
- Energy numbers: core 600, battery 1500, wheel 5/s, thruster 20/s, propeller 10/s, gyro 5/s.
- A gyro on a robot with no energy does nothing (it used to damp spin for free).
- Air drag strength (0.0025 per cell).
- Script API names: `frame` is the tick number (because `tick` is your function); `self` has exact `pos`, `vel`, `angle`, `angVel`, `mass`, `energy`.
- Keys a script reads (the drone's W, A, S, D) do not show on the keys bar, since nothing binds them.
- Known issue: a script that fills huge arrays until it runs out of memory can stall the game for several seconds before it is stopped (ordinary loops and leaks stop in milliseconds).

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

