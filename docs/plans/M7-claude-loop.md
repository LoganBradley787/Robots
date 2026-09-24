# M7 Claude Workflow Implementation Plan

> **For agentic workers:** Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/design/02-parts-and-blueprints.md` (legend, validator, helpers; its sub-assembly paragraph is replaced by this plan), `04` (active core, wake-up, tags), `10-builder.md`, and `07` (Q1, Q13) first. Tests first for every pure module, one commit per task (`M7 T<n>: <what>`), tree green at every commit, `docs/status.md` updated at session end.

**Goal:** Claude can build working robots from a sentence, and Logan can build faster by placing saved blueprints (a missile on a launcher) as copies. Every core can carry its own bindings and scripts, which start when its piece breaks off. The headless runner shows Claude what happened. A playbook teaches a fresh session the build, validate, test, iterate loop. Ends at Gate 6 (Claude loop, judged from Logan's side).

**Spec:** `06` M7, `02` (helpers), `04` (wake-up), `07` Q1.

**Written by:** an Opus 5.5 session, 2026-09-24, after Logan answered the M7 questions.

## Logan's answers (2026-09-24)
- **Homing missiles: later.** Sensors need their own planning: what they sense (cores, but also batteries and other parts), and who is who. Not in M7.
- **Targeting, recorded for that later plan (Logan's thinking, not decided):** a default sensor could find "heat signatures". It sees cores plus who controls each one (the player, a friendly AI, an enemy AI, nobody), and the script decides what to chase. For testing, a missile would lock onto any core that is not its own robot and not controlled by the player.
- **Builder:** place saved blueprints on others. Revised before "go": a placed blueprint is a copy that becomes part of the robot, never a live link to its file (see Decisions).
- **Claude loop:** Claude Code in this repo, guided by `docs/claude-robot-playbook.md`, tests with `pnpm sim`, saves to `blueprints/`; Logan opens the result in the builder. The CLI draws the robot's path so Claude can see what went wrong. No in-app prompt box.

## What exists already (so the plan does not rebuild it)
- `mirrorBlueprint`, `toGrid`, `toFileJson` in `sim-core/blueprint`; `pnpm sim show` prints the grid, mass, bodies, auto controls, bindings.
- `pnpm sim run --json` prints a report with samples every interval, drive metrics, energy, and a destruction line; `--drop` spawns more blueprints; `tune` prints part numbers and blast distances.
- Woken cores (M6): a piece that breaks off with exactly one core wakes with its parts' auto controls only.

## Decisions (Claude's call, overturnable at Gate 6)

Revised with Logan before "go" (2026-09-24): placing a blueprint **copies** it. The first draft had blueprints referencing each other by file, so editing `missile` would change every launcher; Logan rejected that ("things could get MAD FUNKY": a longer missile that no longer fits breaks a robot you never touched). A placed blueprint becomes ordinary parts of the robot it was placed on. What travels with it is its core's controls.

1. **Controls belong to a core.** A blueprint file can hold controls for cores other than the primary core:
   - `"cores": { "core@3,2": { "bindings": [...], "scripts": [...], "autoControls": false } }`, keyed by core part id.
   - Top-level `bindings`, `scripts`, and `autoControls` stay the primary core's, so every existing blueprint is unchanged.
   - A core with no entry has no bindings or scripts of its own (its piece wakes with auto controls only, as in M6).
2. **Placing a blueprint copies it.** Builder and a pure `placeBlueprint(target, source, cell, rot, mirror)` in `sim-core/blueprint`:
   - The source's primary core (or, without a core, its root part: the same rule spawn uses) lands on the cell. `mirror` flips it first (across that part's column), then `rot` turns it around that cell.
   - Its parts become the target's parts with ordinary ids (`core@3,2`). Nothing links back to the source file; editing `missile.json` later changes nothing already placed.
   - Its primary core's bindings, scripts, and `autoControls` become that core's entry in `cores`; its other cores' entries come along too (a placed launcher keeps its missiles' brains).
   - Overlap with existing parts is refused (the builder's ghost shows it; `placeBlueprint` returns an error).
3. **Scopes keep the copy and the robot apart** (as built in T1):
   - When the target already has a core, the copy gets a scope, `<name><n>` (`missile1`, the first free number). Every copied part gets the tag `missile1`, and its own tags become `missile1.<tag>`.
   - The copy's controls are stored with that scope and are **not rewritten**: inside the scope, a target resolves against members only, with the prefix stripped, and part types (`warhead`) mean the scope's own parts. So the missile's binding on `motor` and its script's `set('motor', ...)` keep meaning that missile's thruster, and a second missile is `missile2` with its own.
   - The robot's own (unscoped) controls see the prefixed tags, so they reach a copy only through `missile1` or `missile1.<tag>` (or part types and ids, which are global: that is the "built it wrong" case Logan accepted).
   - Bindings that named a part by id are rewritten to the part's new id. Scripts should name parts by tag (the playbook says so).
   - When the target has no core yet, the copy's core becomes the robot's pilot and everything is copied as it is, no scope.
   - Placing also writes the target's `primaryCore` if it had none, because saving writes parts in grid reading order and a missile placed above the pilot would otherwise become the first core.
4. **Script files.** A placed script's code is copied; on save it gets a file named after the robot and the core's scope, `launcher.missile1.guide.js`. Every copy has its own file (Logan chose copies over links, so fixing one missile's script does not change another's). The source's `.js` file is never touched.
5. **Types, serialize, validate.**
   - `Blueprint.cores: Record<string, CoreControls>` (empty when none). `expand`, `toFileJson` (writes `cores` only when non-empty), and script resolution (`resolveScripts`, `scriptFiles`, `assignScriptFiles`) handle scripts under `cores` like top-level ones.
   - Validator: `BAD_CORE_CONTROLS` (error: a `cores` key that is not a core part, or the primary core, which uses the top-level fields). Binding checks (`BAD_TARGET`, `BAD_CHANNEL`, `BAD_KEY`, `BAD_SCRIPT_REF`) run per core, in its scope. `UNSUPPORTED` stays for a legend entry naming a blueprint, with a message pointing at placing instead.
   - Q1 is unchanged: the primary core is the active core; every other core is dormant while attached, even if the pilot dies.
6. **Replays stay self-contained** as today: deploys inline every script, now including those under `cores`.
7. **Waking with its own controls.** When a piece wakes (exactly one core, M6 rule), its controller gets that core's bindings plus auto controls for the piece's parts (by that core's `autoControls`), and its scripts start with `setup()`, seeded from the world seed and the new robot id like any script. A decoupler fired in tick `t` wakes the piece in tick `t`; its scripts first run in tick `t + 1` (scripts run before behaviors), which the missile script expects.
8. **Missile example.** `blueprints/missile.json`: core, battery, gyro, thruster (auto off), warhead, as a 1 x 5 column or row that hangs under a rail (exact layout tuned in T3). `missile.guide.js` (starts on deploy, so it runs the moment the missile wakes): throttle 1 on its first tick, gyro holds the heading it had at release (fixes M6's known drift when the turret was still swinging), detonates after `fuse` seconds (param, default 4) so a miss does not fly forever. Keys while possessed: its auto controls plus `x` detonate.
9. **Examples shipped (06):** `car` and `drone` stay as they are. `launcher` is rebuilt with a `missile` placed on its rail (F fires; the missile lights itself). New `missile-drone`: the hover drone with two missiles on decoupler rails below, F fires the next one (a small parent script), H hovers. Old launcher CI scenario keeps its name with the new blueprint; snapshots update.
10. **CLI for Claude:**
    - `pnpm sim parts`: every part def as a table (mass, health, faces, inputs, outputs, power, thrust or torque), so nobody reads JSON defs to design.
    - `pnpm sim show` also prints each core's controls (bindings, scripts, auto controls).
    - `pnpm sim place <target> <source> --at x,y [--rot r] [--mirror]` prints the target with the source placed (the same `placeBlueprint` the builder uses), so Claude can compose robots from parts of others.
    - `pnpm sim mirror <bp> [--axis <half cells>]` prints the mirrored blueprint JSON (the helper `02` promises).
    - `pnpm sim run` report adds: an ASCII side view of the path (the robot's core track, drawn over the terrain, one mark per sample, pieces that broke off drawn with their own letter), events in order (fired, split, woke, destroyed, exploded, script errors), script `log()` lines with their tick, and final state of every piece. `--json` carries all of it.
    - `--possess <n>` is not needed: a woken missile runs its own script headless.
11. **Builder (Logan's answer, revised):**
    - Palette: a Blueprints section below the parts listing saved blueprints (not the open one). Clicking one holds a copy; `R` rotates it, mirror mode mirrors it, left-click places it (one undo step), the ghost refuses overlaps.
    - Once placed it is ordinary parts: erase, retag, add to it like anything else.
    - Bindings and Scripts panels get a "Controls for" picker (main core, then each other core by name, like `missile1`) whenever the blueprint has more than one core. Adding controls to a core that had none creates its `cores` entry.
    - Stats and the bindings panel's target list include the new tags.
12. **Playbook.** `docs/claude-robot-playbook.md`, written for a fresh session that has read only `CLAUDE.md`: the loop (design on paper, write the grid, `validate`, `show`, `run` with keys, read the path and events, change one thing, repeat, save), the physics numbers that matter (masses, thrust, lift, wheel torque, energy, blast), the legend and rotations with worked examples, placing blueprints and per-core controls, the script API with two example scripts, known traps (a warhead falls more than about 1.3 m and goes off, decoupler rails, thrust-to-weight for fliers, propellers blocking nothing yet), and "done" checks for common requests (drives, hovers, fires, hits a target). `CLAUDE.md` and `START-HERE.md` point to it for "build me a robot" requests.
13. **Dry run before the gate.** A fresh Opus subagent gets only `CLAUDE.md`, the playbook, and "build me a drone with missiles" (plus one more request, "build me a car that can climb the ramp"). It must produce valid, working blueprints with no help. What it got wrong goes into the playbook, and the run is repeated once. Its robots are deleted afterwards unless they are better than the shipped examples.
14. **Sensors** go to `docs/ideas.md` and a new `07` entry (Q22, open) with Logan's thinking above, so the sensors milestone starts from it.

## Tasks

### T1: controls per core, and placing a blueprint (sim-core)
- Tests first (`blueprint/place.test.ts`, `expand` and `serialize` tests): `cores` in grid and parts forms; round trip file to blueprint to file; scripts under `cores` resolve, inline, and get files; `placeBlueprint` at the core cell with `rot` 90/180/270 and `mirror` (cells, part rotations, wheel and thruster directions); core-less source lands on its root part; scope tags, numbering (`missile1`, `missile2`), id targets rewritten; the source's controls land under its core's id; nested cores carried along; overlap refused; validator `BAD_CORE_CONTROLS` and per-core binding checks.
- `blueprint/place.ts`, changes in `types.ts`, `expand.ts`, `serialize.ts`, `scripts.ts`, `validate.ts`, `index.ts` exports.
- Verify: `pnpm -r test`, `pnpm -r typecheck`.

### T2: woken cores run their own controls
- Tests first (`subassembly.world.test.ts`): a parent with a placed missile whose core has a binding and an enabled script; before release nothing of the missile runs; decouple; the piece wakes with its bindings (an input on its key moves its part) and its script's `setup()` and `tick()` run from the next tick; a core without an entry keeps auto controls only; determinism snapshot with a script on a woken missile.
- `World.controllerFor` and the wake path in `rebuildDirty` use `blueprint.cores[coreId]` and start a `ScriptRunner`.
- Verify as T1, plus `pnpm sim determinism`.

### T3: missile, launcher, missile-drone
- `missile.json` and `missile.guide.js` (decision 8), `launcher.json` rebuilt with a placed missile (via `pnpm sim place`), `missile-drone.json` and its fire script.
- Done-when tests (`subassemblyDoneWhen.test.ts`): launcher aims with Z, F fires, the missile keeps its release heading within 3 degrees for 1 s even when the turret was swinging, and blows a hole in `wall`; the missile drone hovers with H, fires both missiles one per F press, and stays up; a missed missile detonates on its fuse.
- CI: the launcher step keeps its command; add a missile-drone determinism step.

### T4: CLI for Claude
- Tests first for the pure parts (`packages/cli` or `sim-core/metrics`): path plot for a known track (fixed width, y flipped, terrain drawn), events list, part table rows.
- `parts` command, `show` additions, `mirror` command, run report additions (decision 10), help text.
- Verify: `pnpm sim parts`, `pnpm sim show launcher`, `pnpm sim run launcher --keys "z:1-1.2, f:2" --drop wall@0:-80,5.5 --x -100 --y 1.5` prints a readable path and events.

### T5: builder places blueprints and edits each core's controls
- Tests first for pure editor state (`editorState.test.ts`): hold a blueprint, rotate, mirror, place (one undo step), overlap refusal; the controls picker reads and writes the right `cores` entry.
- `editorState.ts`, `document.ts` (load the held blueprint with its scripts), palette section in `BuilderUi.tsx`, `BuilderScene.ts` ghost, `BindingsPanel.tsx` and `ScriptsPanel.tsx` picker, stats.
- Verify in the browser at `http://localhost:5180` (Logan runs `pnpm dev`): place two missiles on a car, rotate one, edit one missile's script, save, reopen, deploy, fire.

### T6: playbook and dry run
- `docs/claude-robot-playbook.md`, pointers in `CLAUDE.md` and `START-HERE.md`.
- Dry run (decision 13) with an Opus subagent; fix the playbook and the tools where it stumbled; repeat once. Record both runs in the plan's As built section.

### T7: docs, review, gate
- `02` (placing blueprints and `cores` as built, replacing the reference design; new validator code; helpers in the CLI), `04` (controls per core, waking), `07` (Q13 note, Q22 sensors open), `10` (blueprints palette), `docs/ideas.md` (sensors), this plan's As built section, `docs/critique/gate-6.md` with what Logan should try.
- Opus review subagent over the milestone diff; fix findings; tag `m7`; status handoff; stop at Gate 6.

## Gate 6 (Logan)
- Open a fresh Claude Code session in the repo and ask for a robot in plain words ("build me a drone with missiles", or anything). It should come back with a blueprint that validates, does what was asked in `pnpm sim`, and works when you open and deploy it, with no manual editing.
- In the builder: place `missile` on something of your own, rotate and mirror it, change its script through the Controls picker, fire it. Editing `missile.json` afterwards leaves your robot alone.

## As built (2026-09-24)

### What shipped
- **T1, T2:** `cores` in blueprint files, `placeBlueprint` with scopes (decision 3 as built: a scoped core sees its members' tags without the prefix and every part by id and type, so a hand-replaced part is found), `BAD_CORE_CONTROLS`, per-core script files; a woken core runs its own bindings, auto controls, and scripts (first run the tick after release).
- **T3:** `missile` is `M g E C X` (thruster, gyro, cell, core, warhead at the tip, so the blast kills its own core). `missile.guide.js` steers the thrust vector to hold the release line and cancel gravity; fuse 10 s (the plan said 4; Logan found 4 too short); parts found by type. `launcher` rebuilt with the missile hanging under a `Dv` rail, a tall turret, a long base, one row taller (all from Logan's play tests). `missile-drone`: 11 wide, two missiles on `left` and `right` rails, `F` fires the right one then the left (`missile-drone.fire.js`), the hover leans by left and right propeller throttle and learns its trim, its own gyro is tagged `stab`, two batteries (about a minute of flight).
- **New part `cell`** (0.5 kg, 250 J, legend `E`, key `-`): the missile needed thrust-to-weight above 2. **Rotator** 600 N m, turns only as fast as it can stop, aim lead 0.15 rad, motor fed the aim rate (the launcher's heavy turret swung far past its aim and tipped the car).
- **T4, CLI:** `run` reports events in order (keys, drops, decouplers, splits, wakes, scripts turning on and off, parts lost, blasts, logs folded, crashes), every piece's final state by letter, and a side view of every piece's path and final shape; `parts`; `show` prints every core's controls and keeps the file's own grid letters; `mirror`; `place` (stdout is the json, notes on stderr, `--save` takes a name or a path); `--help` everywhere; no "does nothing" warning for keys a script reads.
- **T5, builder:** Blueprints section in the palette (hold a copy, `R` turns, `F` flips, mirror mode places a twin, one undo step, the ghost turns red on an overlap); Controls for picker in the Controls and Scripts panels; the script editor edits the picked core's script.
- **T6:** `docs/claude-robot-playbook.md`, pointed to from `CLAUDE.md` and `START-HERE.md` (robot requests skip the milestone docs).

### Changes from the plan (Claude's call unless noted)
- Builder flips a held blueprint with `F` (the plan had mirror mode do it); mirror mode places a mirrored twin, as it does for parts.
- Keys bar shows the keys running scripts read, after a divider, dashed (Logan found the missile drone's W A S D and F missing from it).
- Scripts see each part's `mass` in `parts` (dry run 2 wanted it to compute balance).
- `missile-drone`'s hover is a new script, not the `drone` hover: gyros alone could not lean an 11-wide 42 kg drone.
- The side view scales x and y separately (a 600 m flight still shows height) and draws the ground solid.

### Dry runs (decision 13)
- **Run 1** (fresh Opus subagent, only `CLAUDE.md` and the playbook): both robots worked. Car first try; a missile drone with one missile each way hit two walls after 4 iterations. It stumbled on: conflicting start instructions, capturing `place` output, `show` re-lettering the grid, the tilted second shot (its missile slid 300 m along the ground unexploded), hover gains, the stock hover grabbing missile gyros by type, keys in the app, shared energy totals, the ramp's size. All fixed in the tools or the playbook.
- **Run 2** (fresh subagent, updated playbook): both robots worked. Its drone used the playbook's gain formulas and computed its balance from `parts`, holding 0.5 degrees through both shots. It stumbled on: the 3 m gap between the box and the ramp (its 7-wide car got stuck), integral windup, part masses (added), `parts` coordinates, `place --mirror --at`, an unexplained explosion (a tail grazing a box), dropped walls missing from the side view (fixed), `show` hiding `auto: false` (fixed). The playbook now covers each.

