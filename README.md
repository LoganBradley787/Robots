# Robots

2D side-view robot sandbox. Design docs in `docs/design/`, start with `docs/design/00-index.md`. Sessions start at `docs/START-HERE.md`.

- `pnpm install`
- `pnpm dev` runs the app at http://localhost:5180
- `pnpm test` runs all tests, `pnpm typecheck` checks every package

## Headless runner

Blueprints live in `blueprints/` (JSON with an ASCII grid). Pass a name or a path.

- `pnpm sim run car --seconds 5` spawns the car, prints the core position, tilt, and resting state once per second
- `pnpm sim show showcase` prints the grid, legend, mass, center of mass, and body structure
- `pnpm sim validate car` prints validator issues (exit 1 on errors)
- `pnpm sim determinism car --seconds 10` runs twice and compares state hashes
- Flags: `--world <path>`, `--seconds <n>`, `--seed <n>`, `--x <n> --y <n>`, `--json`

## Controls

Space pause, `.` single step, `[` and `]` time scale (0.25x to 4x), F follow, C next robot, D debug outlines, G grid, R reset, mouse wheel zoom, drag to pan.

## Art

Placeholder sprites are generated: `pnpm --filter @robots/app gen:assets` writes `packages/app/public/assets/`. Real art replaces those PNGs and sheet JSON files; code only knows frame names.
