# Robots

A 2D robot sandbox that runs in the browser. You build robots out of grid parts, give them keys or small scripts, and drop them into a physics world to drive, fly, and fight.

This was a fun project I made with Claude in my spare time.

![48 guided darts leaving a ground base at once](docs/images/titan-volley.png)

*A 3 tonne ground base lets go of 48 guided darts in the first two seconds of a match.*

## What is in it

- **A builder.** Paint parts on a grid: frames, wheels, propellers, boosters, batteries, gyros, rotators, pistons, radars, seekers, fabricator bays, grapples, and more (30 parts). Bind keys, or write a script.
- **A deterministic physics world.** Fixed timestep, seeded randomness, and the same result every run. Every part has health, robots break into pieces, and pieces with a core keep going.
- **Scripts.** Each robot can run small JavaScript programs in a sandbox, once per tick, with its sensors as input. Enemy robots fly, aim, and build copies of other robots all by script.
- **A headless runner.** Everything the app does also runs from the command line, so robots can be built and tested without opening a browser.
- **Robots that build robots.** A fabricator bay builds a copy of another blueprint from the robot's energy and lets it go.
- **Titans.** Eight huge robots that run themselves (800 to 5200 parts each), built for a round robin tournament. The rules, both result tables, and notes from watching the fights are in `docs/plans/titans-tournament.md`.

![A 20 tonne machine with a tall mast driving at a ground base](docs/images/titan-ram.png)

*The tournament winner, a 20 tonne machine of 5165 parts, closing on that base at 55 m/s while the darts land on its nose. Its mast carries a gun deck 110 m up.*

![The builder with a twelve turret drone open](docs/images/builder.png)

*The builder, with a twelve turret drone open.*

## Run it

- `pnpm install`
- `pnpm dev` runs the app at http://localhost:5180
- `pnpm test` runs all tests, `pnpm typecheck` checks every package

To watch two robots fight, put them in the page address: `http://localhost:5180/?duel=titan-juggernaut,titan-woodpecker`. Add `&ya=` or `&yb=` for a flier's starting height (`&yb=150`). The left robot is yours, so its script log shows.

## Headless runner

Blueprints live in `blueprints/` (JSON with an ASCII grid). Pass a name or a path.

- `pnpm sim run car --seconds 5` spawns the car, prints the core position, tilt, and resting state once per second
- `pnpm sim show showcase` prints the grid, legend, mass, center of mass, and body structure
- `pnpm sim parts` prints every part and what it does
- `pnpm sim validate car` prints validator issues (exit 1 on errors)
- `pnpm sim determinism car --seconds 10` runs twice and compares state hashes
- `pnpm sim duel titan-anvil titan-bastion --ya 60` runs one match between two robots that run themselves
- `pnpm sim tournament tournaments/titans.json` runs every pair of a roster and writes a ranking
- Flags: `--world <path>`, `--seconds <n>`, `--seed <n>`, `--x <n> --y <n>`, `--json`. `pnpm sim` alone lists everything.

## Builder

The app opens in the builder. `Tab` switches between the builder and the world (the world pauses while you build).

- Pick a part in the palette or press its key, then click or drag to paint it. Right-click or right-drag erases. `R` rotates (`Shift+R` the other way), `Esc` drops the part.
- With nothing held, click selects a part, drag selects a box, Shift adds. `Delete` removes the selection, `R` rotates it. The side panel edits tags, controls, and scripts.
- `M` mirrors everything you place across the dashed axis (`[` and `]` move it). `Cmd+Z` undo, `Shift+Cmd+Z` redo. Space+drag or middle-drag pans, the wheel zooms.
- Blueprints are files in `blueprints/`. **Save** overwrites the open one, **Save As** makes a new one and leaves the original alone. Anything that would lose unsaved changes asks first.
- **Deploy** checks for errors, asks about unsaved changes, then puts a ghost of the robot on your cursor in the world: green fits, red does not. Click to drop, `Esc` to cancel.

## World controls

Every letter and digit belongs to your robot (A and D drive). World controls are on the toolbar at the bottom and on punctuation keys: Space pause, `.` single step, `[` and `]` time scale (0.25x to 4x), `,` camera (follow again, or next robot), `\` debug outlines, `` ` `` grid. Clear robots is a toolbar button that asks first. Mouse wheel zooms, drag pans.

## How it is put together

- `packages/sim-core`: the simulation. Pure TypeScript, no browser code, runs unchanged in Node. Physics is Rapier 2D; scripts run in QuickJS.
- `packages/app`: the browser game (PixiJS, Preact, Vite).
- `packages/cli`: the headless runner.
- `blueprints/`: every robot, as JSON plus its script files. `worlds/`: the terrain files.
- `docs/`: design docs in `docs/design/` (start with `00-index.md`), plans in `docs/plans/`, and a guide to building robots in `docs/claude-robot-playbook.md`.

Parts are data: adding one means adding a definition file, and nothing in the engine knows a part by name. Golden state hashes in the tests pin the simulation, so a change that is not meant to alter it cannot do so quietly.

## Art

Placeholder sprites are generated: `pnpm --filter @robots/app gen:assets` writes `packages/app/public/assets/`. Real art replaces those PNGs and sheet JSON files; code only knows frame names.
