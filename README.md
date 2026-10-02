# Robots

Robots is a 2D robot sandbox game for the browser. You make robots from parts on a grid. You control them with keys or with scripts. Then you put them in a physics world, where they move, fly, and fight.

This was a fun project I made with Claude in my spare time.

![A ground base releases 48 guided darts](docs/images/titan-volley.png)

*A ground base releases 48 guided darts in the first two seconds of a match. The base has a mass of 3 tonnes.*

## Contents of the game

- **Builder.** You put parts on a grid to make a robot. There are 30 types of parts. Examples are frames, wheels, propellers, boosters, batteries, gyros, radars, and fabricator bays. You can assign keys to parts. You can also write a script.
- **Physics world.** The simulation is deterministic. It uses a fixed time step and seeded random numbers. The same input always gives the same result. Each part has health. A damaged robot breaks into pieces. A piece that has a core continues to operate.
- **Scripts.** A robot can run small JavaScript programs. The programs run in a sandbox, one time for each tick. The sensors of the robot give the input data. Enemy robots use scripts to fly, to aim, and to make copies of other robots.
- **Headless runner.** The command line can do all that the app can do. As a result, you can make and test a robot without a browser.
- **Fabricator bay.** A fabricator bay uses the energy of the robot to make a copy of a different blueprint. Then it releases the copy.
- **Titans.** The titans are eight very large robots that operate without a player. Each titan has between 800 and 5200 parts. They are for a round-robin tournament. Refer to `docs/plans/titans-tournament.md` for the rules and the results.

![A machine with a tall mast moves toward a ground base](docs/images/titan-ram.png)

*The winner of the tournament moves toward the base at 55 m/s. It has 5165 parts and a mass of 20 tonnes. Darts hit its front. Its mast holds a gun deck at a height of 110 m.*

![The builder with a drone that has twelve turrets](docs/images/builder.png)

*The builder shows a drone that has twelve turrets.*

## How to run the game

- Run `pnpm install` to install the dependencies.
- Run `pnpm dev` to start the app. Then open http://localhost:5180 in a browser.
- Run `pnpm test` to do all the tests.
- Run `pnpm typecheck` to check the types in each package.

## Headless runner

The blueprints are in the `blueprints/` folder. A blueprint is a JSON file that contains an ASCII grid. Give the name of a blueprint or the path to a file.

- `pnpm sim run car --seconds 5` puts the car in the world. Each second, it shows the position of the core, the tilt, and if the robot is at rest.
- `pnpm sim show showcase` shows the grid, the legend, the mass, the center of mass, and the body structure.
- `pnpm sim parts` shows each part and its function.
- `pnpm sim validate car` shows the problems in a blueprint. The exit code is 1 if there are errors.
- `pnpm sim determinism car --seconds 10` runs the simulation two times and compares the state hashes.
- `pnpm sim duel titan-anvil titan-bastion --ya 60` runs one match between two robots that operate without a player.
- `pnpm sim tournament tournaments/titans.json` runs a match for each pair of robots in a roster. Then it writes a ranking.
- The flags are `--world <path>`, `--seconds <n>`, `--seed <n>`, `--x <n> --y <n>`, and `--json`.
- Run `pnpm sim` to see the full list of commands.

## Builder

The app opens in the builder. Press `Tab` to go between the builder and the world. The world stops while you use the builder.

- To add a part, click it in the palette or press its key. Then click or drag on the grid.
- To remove a part, right-click it. You can also right-drag across parts.
- Press `R` to turn a part. Press `Shift+R` to turn it in the opposite direction. Press `Esc` to release the part.
- When you hold no part, click a part to select it. Drag to select an area. Hold `Shift` to add to the selection.
- Press `Delete` to remove the selected parts. Press `R` to turn them.
- Use the side panel to change the tags, the controls, and the scripts.
- Press `M` to set mirror mode to on or off. In mirror mode, each part that you add also appears on the opposite side of the dashed axis. Press `[` or `]` to move the axis.
- Press `Cmd+Z` to undo. Press `Shift+Cmd+Z` to redo.
- To move the view, hold `Space` and drag. You can also drag with the middle mouse button. Turn the mouse wheel to zoom.
- Blueprints are files in the `blueprints/` folder. **Save** replaces the open blueprint. **Save As** makes a new blueprint and does not change the initial one.
- The app asks for confirmation before you lose changes that are not saved.
- **Deploy** does a check for errors. Then it shows an outline of the robot at the cursor in the world. A green outline shows that the robot fits. A red outline shows that it does not fit.
- Click to put the robot in the world. Press `Esc` to cancel.

## World controls

The letter keys and the digit keys control your robot. For example, `A` and `D` move a robot that has wheels.

The toolbar at the bottom has the world controls. These keys also operate them:

- `Space`: pause or continue.
- `.`: do one step.
- `[` and `]`: change the time scale. The range is 0.25x to 4x.
- `,`: make the camera follow your robot again, or go to the subsequent robot.
- `\`: show or hide the debug outlines.
- `` ` ``: show or hide the grid.

The **Clear robots** button on the toolbar removes all the robots. It asks for confirmation first.

Turn the mouse wheel to zoom. Drag to move the view.

## Structure of the project

- `packages/sim-core` contains the simulation. It is TypeScript and has no browser code. It runs in Node.js without changes. It uses Rapier 2D for physics and QuickJS for scripts.
- `packages/app` contains the browser game. It uses PixiJS, Preact, and Vite.
- `packages/cli` contains the headless runner.
- `blueprints/` contains each robot as a JSON file and its script files.
- `worlds/` contains the terrain files.
- `docs/` contains the documents. The design documents are in `docs/design/`. Start with `00-index.md`. The plans are in `docs/plans/`.
- `docs/claude-robot-playbook.md` tells you how to make robots.

Parts are data. To add a part, you add a definition file. The engine code does not refer to a part by its name.

The tests keep hashes of the simulation state. If a change causes a different result, a test fails.

## Art

The sprites are placeholders. A script makes them. Run `pnpm --filter @robots/app gen:assets` to write them to `packages/app/public/assets/`.

To use real art, replace the PNG files and the sheet JSON files. The code uses only the frame names.
