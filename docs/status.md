# Status

Updated: 2026-09-23, by a coding session (Opus 5.5)

- Current milestone: M1 complete, plan `docs/plans/M1-parts-and-assembly.md`. Gate 1 (Look) passed 2026-09-23; punch list `docs/critique/gate-1.md` is done.
- Done: M0 T1 to T10 (tag `m0`). M1 T1 to T10 (tag `m1`): part defs as JSON, blueprint format with ASCII grid, validator, pure assembly plan, compound bodies with jointed motor wheels, `spawnBlueprint`, robot metrics, blueprint CLI (`run`, `show`, `validate`, `determinism`), placeholder art generator, sprite rendering per body, tiled terrain, 1 m grid.
- In progress: none
- Next: write the M2 plan (editor: place, rotate, delete parts, save and load, spawn by click) from `docs/design/02`, `07` (Q3, Q9, Q20), and `08` (UI and persistence conventions). Gate 2 (Builder) is at the end of M2.

## Gate 1: what Logan looked at

Run `pnpm dev`, open http://localhost:5180.

- Two robots: `car` (follows by default) and `showcase` (every part type). `C` switches the camera between them.
- Judge: textures (every part), sprite fit (press `D` to overlay physics outlines), scale (a 1 m grid is behind everything, `G` toggles it; one cell = 1 m), world look (ground, blocks, ramp, background), camera (wheel zoom, drag pan, `F` re-follow), time controls (Space, `.`, `[`, `]`, `R`).
- Nothing drives yet. Driving, keybinds, and physics feel are Gate 3.
- Headless: `pnpm sim run car`, `pnpm sim show showcase`.

## Demo checklist results (2026-09-23)
- `pnpm sim run car --seconds 5`: resting at 2 s, core (-0.003, 1.450), tilt 0.00, mass 12 kg. `pnpm sim run showcase`: resting, tilt 0.00, 21 kg.
- Browser: both robots rest level on their wheels, every part type visible, sprites match debug outlines, art clean at about 3x zoom, grid readable, pause, step, speed, follow, pan, and `C` work, no console errors.
- Determinism: same hash twice in one process, browser matches Node, and CI on Linux matches the golden hashes recorded on macOS.

## Known issues
- Multi-cell parts (none exist yet) would draw one cell-sized sprite and count mass at the anchor cell in `pnpm sim show`; fix when the first multi-cell part arrives.
- The HUD help line runs off narrow windows.
- Propeller spin and thruster flame animations exist in the fx sheet but are not played until channels exist (M3).
- Dynamic world-file boxes would not be drawn (none exist; `TerrainView` draws static ones only).

## Decisions since the plans (newest first)
- M1 review fixes: joint motor settings (`maxTorque`, `motorFactor`) live in the part's `joint` block, and a joint part may only attach through its mount face; `position` motors are rejected until M6. A chunk's core honors `primaryCore` and `corePriority`. `toGrid` keeps parts at their cells and returns null when a grid cannot express the blueprint (the CLI then prints the parts list). Legend lookups use a Map. The mount-down wheel token is `W^` (it sits above its parent), not `Wv`; `02` updated.
- M1: solver iterations raised to 8 and internal PGS iterations to 8 (from 4 and 1). The defaults let the car's 9 kg body rebound off its 1.5 kg jointed wheels at 4.3 m/s after a 1.5 m drop. Measurements in `docs/design/03`.
- M1: the core is identified by a def field `role: "core"`, not by its id, so no engine code names a part.
- M1: the root part (primary core) is never reported `UNATTACHED`; the parts that cannot reach it are.
- M1: textures are 64 px per cell with linear filtering (not `nearest`); `docs/design/08` updated.
- M1: the showcase spawns 13 m left of the car on clear ground (10 m right put it on the box and ramp).
- M1: the ground is drawn 40 m deep for looks; physics keeps the 2 m slab.
- M1: this session (Opus) wrote the M1 plan and ran through without a separate approval stop, at Logan's request. Every judgment call is listed in the plan under "Decisions made in this plan".
- M0: root `sim` script has no trailing `--`; pnpm 11 `allowBuilds` for esbuild; dev port 5180 (Docker holds 5173); keys fall back to `event.key`; world hash includes RNG state; strict world file keys; tick cap per frame in the fixed stepper; `packageManager` pins pnpm 11.1.3.

- Next gate: Gate 2 (Builder) at the end of M2.
