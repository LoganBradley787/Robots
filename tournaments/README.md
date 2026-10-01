# Tournaments

Rosters for `pnpm sim tournament <roster.json>`. The rules are in `docs/plans/titans-tournament.md`.

- A roster is `{ "titans": [{ "name": "titan-x", "y": 40 }] }`: `name` is a blueprint in `blueprints/`, `y` its main core's spawn height (left out: on the ground).
- `pnpm sim duel <a> <b> [--ya <m>] [--yb <m>] [--seed <n>]` runs one match and prints who won and why; `pnpm sim help` has every flag.
- Results go to `tournaments/out/` (`results.md`, `results.json`) unless `--out` says otherwise.

How the commands read the rules where a rule left room (the constants are at the top of `packages/cli/src/commands/duel.ts` and `tournament.ts`):

- **Main core.** The robot's primary core at spawn, followed as the same part wherever it goes. Destroyed means no robot in the world holds it any more.
- **Bounds.** Checked on the main core's own position every tick. Pieces, copies, and the rest of the body may be anywhere.
- **Draws.** A match stops 2 s after the first loss; if the other side has lost by then, it is a draw. Time running out is a draw.
- **Spawn.** On the ground means the lowest part touching y 0, so a tall titan's core may be far up. A height over 150 m, a spot below the ground, or one that overlaps something ends the duel with exit 1 and the reason. The tournament lists such a match under "Matches that did not run"; it counts for nobody.
- **Scripts.** Every top level script is turned on (nobody presses the key that would start one). Scripts of other cores and of recipes run as written. Every script that stops is listed: which, on which robot, when, and why.
- **Share of parts left.** Information only. Starting parts still in the world, over the starting parts less those that ended themselves (destroyed with a blast of their own, or burnt out). Parts gone with faded debris count as lost. Copies never count.
- **Speed.** Timed from tick 0, every tick counted. The first tick compiles the scripts, which shows in the worst tick only. Matches run side by side take up to twice as long per tick as a match alone, and so does anything else busy on the machine, so only the speed check (alone, first) is judged.
- **Left and right.** Each pairing runs both ways on each seed, and the two ways do differ: the robot on the left is robot 1, so scripts' random numbers and the order things run in are not the same.
