# M7 Claude Workflow Implementation Plan

> **For agentic workers:** Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/design/02-parts-and-blueprints.md` (legend, sub-assemblies, validator, helpers), `04` (active core, wake-up, tags), `10-builder.md`, and `07` (Q1, Q13) first. Tests first for every pure module, one commit per task (`M7 T<n>: <what>`), tree green at every commit, `docs/status.md` updated at session end.

**Goal:** Claude can build working robots from a sentence, and so can Logan by hand with reusable parts. Blueprints can place other blueprints (a missile on a launcher) that keep their own bindings and scripts, which start when that piece breaks off. The headless runner shows Claude what happened. A playbook teaches a fresh session the build, validate, test, iterate loop. Ends at Gate 6 (Claude loop, judged from Logan's side).

**Spec:** `06` M7, `02` (sub-assemblies, helpers), `04` (wake-up), `07` Q1.

**Written by:** an Opus 5.5 session, 2026-09-24, after Logan answered the M7 questions.

## Logan's answers (2026-09-24)
- **Homing missiles: later.** Sensors need their own planning: what they sense (cores, but also batteries and other parts), and who is who. Not in M7.
- **Targeting, recorded for that later plan (Logan's thinking, not decided):** a default sensor could find "heat signatures". It sees cores plus who controls each one (the player, a friendly AI, an enemy AI, nobody), and the script decides what to chase. For testing, a missile would lock onto any core that is not its own robot and not controlled by the player.
- **Builder:** place a saved blueprint as a unit. It shows as one outlined group you can rotate, tag, pick up, and delete. To change the missile itself, open `missile.json`. Its bindings and scripts stay with it.
- **Claude loop:** Claude Code in this repo, guided by `docs/claude-robot-playbook.md`, tests with `pnpm sim`, saves to `blueprints/`; Logan opens the result in the builder. The CLI draws the robot's path so Claude can see what went wrong. No in-app prompt box.

## What exists already (so the plan does not rebuild it)
- `mirrorBlueprint`, `toGrid`, `toFileJson` in `sim-core/blueprint`; `pnpm sim show` prints the grid, mass, bodies, auto controls, bindings.
- `pnpm sim run --json` prints a report with samples every interval, drive metrics, energy, and a destruction line; `--drop` spawns more blueprints; `tune` prints part numbers and blast distances.
- Woken cores (M6): a piece that breaks off with exactly one core wakes with its parts' auto controls only.

## Decisions (Claude's call, overturnable at Gate 6)

1. **File form.** A legend entry (grid form) or a parts entry (parts form) can place a blueprint instead of a part:
   - grid: `"m": { "blueprint": "missile", "rot": 0, "mirror": false, "tags": ["missiles"] }`
   - parts: `{ "blueprint": "missile", "x": 3, "y": 2, "rot": 0, "mirror": false, "tags": ["missiles"], "id": "left" }`
   - The sub-blueprint's primary core (or, without a core, its root part: the same rule spawn uses) lands on the token cell. `rot` turns the sub around that cell, `mirror` flips it first (across the core's column).
   - `blueprint` is a file name in `blueprints/` without `.json`.
2. **Instance ids and part ids.** An instance's id is `<blueprint>@<x>,<y>` (like part ids), or an explicit `id` in the parts form. Its parts get `<instance>/<inner id>`: `missile@3,2/thruster@0,1`. Nested subs nest the prefix.
3. **Tags are hermetic.** Inside a sub, every tag is prefixed with the instance id (`missile@3,2/wheels`), and the sub's own bindings are rewritten to match. The parent's binding on `thrusters` therefore never reaches a missile's thrusters. What the parent can target on a sub:
   - the instance's `tags` from the legend entry (`missiles`), added unprefixed to every part of the instance;
   - the instance id itself (`missile@3,2`), added the same way (like a part's own id tag), so one missile of several can be addressed;
   - any single sub part by its full id.
4. **Resolution happens before the sim, like script files.** New pure `resolveSubassemblies(raw, read)` in `sim-core/blueprint` inlines each referenced blueprint (recursively, its scripts resolved too) as `"inline": { ...file json }` next to `"blueprint"`, and lists missing files. The CLI reads from disk, the app from the dev server. `expandBlueprint` then only ever sees inlined subs, so `sim-core` stays free of file access and a deploy or replay is self-contained (a replay never depends on `missile.json` changing later). `toFileJson` writes the reference only (drops `inline`) unless asked to inline, the same switch scripts use.
5. **Blueprint type.** `Blueprint.parts` stays the full flat list every consumer already uses (validator, assembly, spawn, stats, render). New `Blueprint.subs: SubInstance[]` records each instance: id, blueprint name, cell, rot, mirror, tags, the ids of its parts, its core id, its (rewritten) bindings and scripts, its `autoControls`, and its own `subs`. `toFileJson` writes own parts (those not in any instance) plus one entry per top-level instance. Round trip test: file to blueprint to file is identity.
6. **Validator.** New codes:
   - `MISSING_BLUEPRINT` (error): "legend token 'm' places blueprint 'missile', but blueprints/missile.json was not found".
   - `SUB_CYCLE` (error): "launcher places launcher (launcher > rack > launcher)".
   - `SUB_DEPTH` (error): nesting deeper than 4.
   - `SUB_INVALID` (error): the sub-blueprint has errors of its own; each is repeated with the instance prefix so the message says which file to fix.
   - `SUB_IGNORED` (warning): a core-less sub has bindings or scripts; nothing can run them (a core-less sub is a module, the parent binds it through its tags).
   - `OVERLAP`, `UNATTACHED`, `DISCONNECTED`, `LOCKED_JOINT` work unchanged on the flat list. `UNSUPPORTED` for sub-assemblies goes away.
   - `primaryCore` and `corePriority` name the parent's own parts; the parent's primary core stays the active core (Q1: sub cores are dormant while attached).
7. **Waking with its own controls.** When a piece wakes (exactly one core, M6 rule) and that core is the core of a sub instance (the innermost one), its controller gets that instance's bindings plus auto controls for its parts (by the instance's `autoControls`), and its scripts start with `setup()` on that tick, seeded from the world seed and the new robot id like any script. A woken core that is not a sub core keeps M6 behavior (auto controls only). A decoupler fired in tick `t` wakes the piece in tick `t`; its scripts first run in tick `t + 1` (scripts run before behaviors), which the missile script expects.
8. **Missile example.** `blueprints/missile.json`: core, battery, gyro, thruster (auto off), warhead, as a 1 x 5 column or row that hangs under a rail (exact layout tuned in T3). `missile.guide.js` (starts on deploy, so it runs the moment the missile wakes): throttle 1 on its first tick, gyro holds the heading it had at release (fixes M6's known drift when the turret was still swinging), detonates after `fuse` seconds (param, default 4) so a miss does not fly forever. Keys while possessed: its auto controls plus `x` detonate.
9. **Examples shipped (06):** `car` and `drone` stay as they are. `launcher` is rebuilt on the `missile` sub (F fires; the missile lights itself). New `missile-drone`: the hover drone with two missiles on decoupler rails below, F fires the next one (a small parent script), H hovers. Old launcher CI scenario keeps its name with the new blueprint; snapshots update.
10. **CLI for Claude:**
    - `pnpm sim parts`: every part def as a table (mass, health, faces, inputs, outputs, power, thrust or torque), so nobody reads JSON defs to design.
    - `pnpm sim show` also prints the assembled picture (every cell of the flat robot, sub parts in lowercase with their instance listed below) and each instance's bindings and scripts.
    - `pnpm sim mirror <bp> [--axis <half cells>]` prints the mirrored blueprint JSON (the helper `02` promises).
    - `pnpm sim run` report adds: an ASCII side view of the path (the robot's core track, drawn over the terrain, one mark per sample, pieces that broke off drawn with their own letter), events in order (fired, split, woke, destroyed, exploded, script errors), script `log()` lines with their tick, and final state of every piece. `--json` carries all of it.
    - `--possess <n>` is not needed: a woken missile runs its own script headless.
11. **Builder (Logan's answer):**
    - Palette: a Blueprints section below the parts listing saved blueprints (not the open one, not any that would make a cycle). Clicking one holds it; `R` rotates the held instance, mirror mode mirrors it, left-click places it (one undo step), the ghost refuses overlaps.
    - A placed instance draws its parts with a thin outline around the group. Clicking any of its cells selects the whole instance; erase removes the whole instance; tagging a selected instance sets its instance tags.
    - Part menu on an instance: its name, Rotate, Mirror, Pick up (holds it again: this is move), Open `missile` (asks Save / Don't save / Cancel first), Delete, tags. Its internal parts are not editable from the parent.
    - Sub blueprints are cached by file, loaded when a blueprint opens, and refreshed when any blueprint is saved, so editing `missile` and going back to `launcher` shows the new missile.
    - Stats (mass, center of mass) include instances. Bindings panel targets include instance tags and ids.
    - Save writes references; Deploy inlines (decision 4).
12. **Playbook.** `docs/claude-robot-playbook.md`, written for a fresh session that has read only `CLAUDE.md`: the loop (design on paper, write the grid, `validate`, `show`, `run` with keys, read the path and events, change one thing, repeat, save), the physics numbers that matter (masses, thrust, lift, wheel torque, energy, blast), the legend and rotations with worked examples, sub-assemblies, the script API with two example scripts, known traps (a warhead falls more than about 1.3 m and goes off, decoupler rails, thrust-to-weight for fliers, propellers blocking nothing yet), and "done" checks for common requests (drives, hovers, fires, hits a target). `CLAUDE.md` and `START-HERE.md` point to it for "build me a robot" requests.
13. **Dry run before the gate.** A fresh Opus subagent gets only `CLAUDE.md`, the playbook, and "build me a drone with missiles" (plus one more request, "build me a car that can climb the ramp"). It must produce valid, working blueprints with no help. What it got wrong goes into the playbook, and the run is repeated once. Its robots are deleted afterwards unless they are better than the shipped examples.
14. **Sensors** go to `docs/ideas.md` and a new `07` entry (Q22, open) with Logan's thinking above, so the sensors milestone starts from it.

## Tasks

### T1: sub-assemblies in sim-core (format, resolve, expand, serialize, validate)
- Tests first (`blueprint/subassembly.test.ts`): grid and parts forms; placement at the core cell; `rot` 90/180/270 and `mirror` (cells, part rotations, wheel and thruster directions); core-less sub lands on its root part; nested sub ids (`rack@1,0/missile@0,1/core@0,0`); tag prefixing and binding rewrite; instance tags and instance id tag; parent binding on a sub tag reaches only that instance; round trip file to blueprint to file; `resolveSubassemblies` missing file and cycle; validator codes above; overlap between a sub and a parent part.
- `blueprint/subassembly.ts` (resolve and flatten), changes in `expand.ts`, `types.ts`, `serialize.ts`, `validate.ts`, `toGrid.ts` (own parts only), `index.ts` exports.
- Verify: `pnpm -r test`, `pnpm -r typecheck`.

### T2: woken sub cores run their own bindings and scripts
- Tests first (`destruction.test.ts` or `subassembly.world.test.ts`): a parent with a sub that has a binding and an enabled script; before release nothing of the sub runs; decouple; the piece wakes with the sub's bindings (an input on its key moves its part) and its script's `setup()` and `tick()` run from the next tick; a core-less sub piece latches as before; a woken non-sub core keeps auto controls only; determinism snapshot with a script on a woken missile.
- `World.controllerFor` and the wake path in `rebuildDirty` start a `ScriptRunner` for the instance's scripts; `Robot` gets `sub?: string` (the instance id it runs as). Hash covers it through the runner state already hashed; add the instance id.
- Verify as T1, plus `pnpm sim determinism`.

### T3: missile, launcher, missile-drone
- `missile.json` and `missile.guide.js` (decision 8), `launcher.json` on the sub, `missile-drone.json` and its fire script.
- Done-when tests (`subassemblyDoneWhen.test.ts`): launcher aims with Z, F fires, the missile keeps its release heading within 3 degrees for 1 s even when the turret was swinging, and blows a hole in `wall`; the missile drone hovers with H, fires both missiles one per F press, and stays up; a missed missile detonates on its fuse.
- CI: the launcher step keeps its command; add a missile-drone determinism step.

### T4: CLI for Claude
- Tests first for the pure parts (`packages/cli` or `sim-core/metrics`): path plot for a known track (fixed width, y flipped, terrain drawn), events list, part table rows.
- `parts` command, `show` additions, `mirror` command, run report additions (decision 10), help text.
- Verify: `pnpm sim parts`, `pnpm sim show launcher`, `pnpm sim run launcher --keys "z:1-1.2, f:2" --drop wall@0:-80,5.5 --x -100 --y 1.5` prints a readable path and events.

### T5: builder places blueprints as units
- Tests first for pure editor state (`editorState.test.ts`): hold, rotate, mirror, place (one undo step), erase and select by any cell, pick up, overlap refusal, cycle filtering of the palette list.
- `editorState.ts`, `document.ts` (sub cache and refresh, resolve before validate and deploy), palette section in `BuilderUi.tsx`, `BuilderScene.ts` outline and ghost, `PartMenu.tsx` instance menu, stats, bindings panel targets.
- Verify in the browser at `http://localhost:5180` (Logan runs `pnpm dev`): place two missiles on a car, rotate one, save, reopen, deploy, fire.

### T6: playbook and dry run
- `docs/claude-robot-playbook.md`, pointers in `CLAUDE.md` and `START-HERE.md`.
- Dry run (decision 13) with an Opus subagent; fix the playbook and the tools where it stumbled; repeat once. Record both runs in the plan's As built section.

### T7: docs, review, gate
- `02` (sub-assemblies as built, new validator codes, helpers in the CLI), `04` (waking sub cores), `07` (Q13 note, Q22 sensors open), `10` (blueprints palette), `docs/ideas.md` (sensors), this plan's As built section, `docs/critique/gate-6.md` with what Logan should try.
- Opus review subagent over the milestone diff; fix findings; tag `m7`; status handoff; stop at Gate 6.

## Gate 6 (Logan)
- Open a fresh Claude Code session in the repo and ask for a robot in plain words ("build me a drone with missiles", or anything). It should come back with a blueprint that validates, does what was asked in `pnpm sim`, and works when you open and deploy it, with no manual editing.
- In the builder: place `missile` on something of your own, rotate and mirror it, fire it. Edit `missile`, and see your launcher pick up the change.
