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

## Builder

The app opens in the builder. `Tab` switches between the builder and the world (the world pauses while you build).

- Pick a part in the palette or press 1 to 8, then click or drag to paint it. Right-click or right-drag erases. `R` rotates (`Shift+R` the other way), `Esc` drops the part.
- With nothing held, click selects a part, drag selects a box, Shift adds. `Delete` removes the selection, `R` rotates it. The side panel edits tags and controls.
- `M` mirrors everything you place across the dashed axis (`[` and `]` move it). `Cmd+Z` undo, `Shift+Cmd+Z` redo. Space+drag or middle-drag pans, the wheel zooms.
- Blueprints are files in `blueprints/`. **Save** overwrites the open one, **Save As** makes a new one and leaves the original alone. Anything that would lose unsaved changes asks first.
- **Deploy** checks for errors, asks about unsaved changes, then puts a ghost of the robot on your cursor in the world: green fits, red does not. Click to drop, `Esc` to cancel.

## World controls

Every letter and digit belongs to your robot (A and D drive). World controls are on the toolbar at the bottom and on punctuation keys: Space pause, `.` single step, `[` and `]` time scale (0.25x to 4x), `,` camera (follow again, or next robot), `\` debug outlines, `` ` `` grid. Clear robots is a toolbar button that asks first. Mouse wheel zooms, drag pans.

## Art

Placeholder sprites are generated: `pnpm --filter @robots/app gen:assets` writes `packages/app/public/assets/`. Real art replaces those PNGs and sheet JSON files; code only knows frame names.
