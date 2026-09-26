# M9 Script Speed Implementation Plan

> **For agentic workers:** Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/design/04-control-and-scripting.md` (Script API, sandbox), `docs/ideas.md` ("Script performance"), and `packages/sim-core/src/script/` (all five files) first. Tests first, one commit per task (`M9 T<n>: <what>`), tree green at every commit, commit often and do not push until the gate, `docs/status.md` updated at session end.

**Goal:** robot scripts cost about a tenth of what they do now, with no change to what any script sees or does. 100 hovering scripted drones fit in one 16.7 ms frame (today about 25). Every existing run gives the same final hash before and after. Ends at Gate 8.

**Written by:** an Opus 5.5 session, 2026-09-25, after Logan answered the M9 questions.

## Logan's answers (2026-09-25)
- **Scope:** script plumbing only (the plan in `docs/ideas.md`). No Web Worker, no sensor speedups. It is a milestone of its own, so if something breaks it is easy to trace.
- **Target:** 100 `missile-drone-10prop` hovering, headless on Logan's Mac, under 16.7 ms per tick on average.
- **At the gate:** an in-app readout (ms per tick split into scripts and the rest, frame rate), shown with the debug overlay, plus a Stress test button that drops a grid of scripted drones.
- **Bench stays local:** `pnpm sim bench` is not run in CI (noisy shared machines, Actions minutes). CI keeps its determinism runs, plus the golden hash test from T1.

## Measured before planning (2026-09-25, Node, Logan's Mac)
- Hovering `missile-drone-10prop` (hover and fire scripts running): 1 drone 0.51 ms per tick, 10 drones 4.9 ms, 25 drones 11.7 ms (worst ticks 15 ms). A profile of 25 drones: 82% of the tick is `runScripts`, 77% inside the QuickJS calls.
- One script call on the 38-part drone, measured one piece at a time:
  - an empty call into the sandbox: about 1 us;
  - today's path (the host turns the input into JSON text, the sandbox parses it into 38 part objects): **about 180 us**, of which the host's `JSON.stringify` is about 18 us;
  - the numbers that move (162 of them) as one binary block, written into part objects the sandbox kept from before: **about 12 us** (15 times faster);
  - the same block, but building new part objects every tick: about 44 us (4 times faster).
- The host building the input (`World.scriptInput`), once per robot per tick: about 18 us for the 38-part drone, about 123 us for the 132-part `flying-silo`. After the sandbox fix this is the next biggest cost on big robots.
- Found while reading: `partOutput`, `energy`, and `runScripts` each look robots up with `this.robots.find`, once per part output per tick. With 100 robots that grows with the square of the robot count.

## What exists already
- `ScriptRunner` (`script/runner.ts`), one per robot, runs its enabled scripts in blueprint order; the input is built once per robot per tick (`built ??= input()`) and handed to each script.
- `QuickJsInstance.call` (`script/quickjs.ts`): `JSON.stringify(input)`, `ctx.newString`, and `callFunction` into the prelude's `tick(json)`, which runs `JSON.parse` and sets the globals `frame`, `dt`, `time`, `self`, `parts`, `contacts`, `inbox`. The result comes back as JSON text (`writes`, `logs`, `marks`) and is checked by `readResult`.
- One QuickJS runtime per script (its own memory limit, budget, crash radius). Two scripts on one robot cannot share objects, so the block is copied into each runtime; that copy is cheap.
- `Robot.version` goes up on every rebuild (a split, a decoupler, a part destroyed: `assembly/rebuild.ts`).
- `quickjs-emscripten-core` 0.32 has `ctx.newArrayBuffer`; QuickJS has typed arrays (`Float64Array`).
- CI runs `pnpm sim determinism` on 10 scenes (`.github/workflows/ci.yml`); these compare two runs of the same code, so they cannot show that the new code matches the old. T1 adds that check.

## Decisions (Claude's call unless marked Logan's, overturnable at Gate 8)

1. **Nothing a script sees changes.** Same globals, same names, same values, same order of parts, same keys present in `in` and `out`, bit for bit what `JSON.parse(JSON.stringify(input))` gives today. That includes JSON's quirks: `-0` arrives as `0`, `NaN` and `Infinity` arrive as `null`, a missing value means a missing key. No script, blueprint, or playbook example changes.
2. **One exception, documented:** part objects (`parts[i]`, its `pos`, `in`, `out`) are the same objects from tick to tick, with their numbers updated in place. A script that keeps a part object in `state` sees it change; one that writes into it has that overwritten next tick. `parts` itself is a new array each tick (sorting it is safe), `tags` arrays are frozen, and `self`, `contacts`, `inbox`, and `keys` are new every tick (small, and `state.home = self.pos` is a pattern worth keeping safe). No shipped script keeps or writes part objects (checked with grep). The playbook and `04` say: "treat `parts` as read-only; copy what you keep". This is where most of the speed comes from (12 us against 44 us).
3. **The input crosses in three pieces.**
   - **Layout** (JSON text): each part's id, type, tags, mass, and the names of its `in` and `out` values, in order. Sent to a script only when it changes. It changes when the robot is rebuilt (`Robot.version`), when its primary core changes, or when the set of present values changes; the host keeps a small layout record per robot and a layout number that goes up whenever it is rebuilt, and each script instance remembers the last layout number it was given.
   - **Numbers** (one `Float64Array`, built once per robot per tick into a buffer kept between ticks): `frame`, `dt`, `time`, `self` (position, velocity, angle, spin, mass, energy stored and capacity), then per part in layout order `pos.x`, `pos.y`, `angle`, then its `in` values, then its `out` values.
   - **Extras** (JSON text, or empty when all are empty): `keys`, `contacts`, `inbox`. Usually empty for a hovering drone; small when not.
   - JSON's quirks from decision 1 are applied when the numbers are written (the host turns `-0` into `0`; a value that is not finite is marked in the layout as `null` for that tick, which changes the layout, which is rare and correct).
4. **The world only knows `ScriptHost` and `ScriptInstance`.** Their `setup` and `tick` take a `ScriptFrame` (`{ layout: { id, json }, numbers, extras }`) instead of a `ScriptInput`. `ScriptInput` stays as the documented shape of what the script sees, and a `frameToInput` helper (used by tests and by any future backend) turns a frame back into it.
5. **Proof that nothing changed: golden hashes (T1) and a parity test (T2).**
   - T1, before any change, records the final state hash of about 15 scenes into `packages/cli/test/golden-hashes.json`: the 10 CI determinism scenes, plus `flying-silo` hovering, `silo` firing a volley at two enemy drones, a 6 against 6 enemy drone battle (teams 1 and 2), `big-launcher` firing, and a drone losing parts to a bomb (splits and a missile waking mid-run). A cli test runs them all and compares. `UPDATE_GOLDEN=1 pnpm test` rewrites the file (for later milestones that change the sim on purpose; the commit says why).
   - T2's parity test runs every shipped scripted blueprint through those scenes and, on every tick, compares what the sandbox actually holds (read back through a host-only entry that scripts cannot reach) against `JSON.parse(JSON.stringify(oldInput))` from the old `scriptInput`, kept in the test.
6. **The result path stays JSON.** Writes, logs, and marks are a few short arrays; measured after T2, and only changed if they are more than 10% of what is left.
7. **Timing is measured outside sim-core** (it never reads a clock). The app and the CLI each wrap the `ScriptHost` they pass in, timing every `setup` and `tick` with `performance.now()`; "the rest" is the whole step minus that. About 25 lines in each, duplicated on purpose rather than giving sim-core a clock.
8. **`pnpm sim bench`** (CLI, Logan: local only). Scenes:
   - `hover` (default): `missile-drone-10prop` with hover and fire running, at 1, 10, 25, 50, 100 drones (`--n` for one count);
   - `big`: one `flying-silo` hovering;
   - `battle`: N `enemy-drone` on team 1 against N flipped on team 2 (default 6), 20 s, so missiles launch and their guides wake;
   - `debris`: 500 loose parts, no scripts (physics alone).
   - It warms up 1 s, then prints per scene: ms per tick average, 95th percentile, and worst; scripts ms and the rest; script calls per tick; and the final hash, so a bench run also spot-checks determinism. `--seconds` and `--json` (a machine-readable line, for comparing runs by hand).
   - The world for `hover` is widened in the bench (drones 30 m apart need 3000 m of ground); nothing assumes 1000 m.
9. **Host-side plumbing (T3), not sensors (Logan).** A robot id map in `World` replaces the per-part `robots.find` lookups on the script path; `scriptInput` computes each body's state once per group, not once per part; the layout, the scope's tag view, and the part list are cached per layout. Target: the 132-part `flying-silo` input under 20 us. Sight checks and ray casts are left as they are.
10. **In-app readout (Logan).** Drawn with the debug overlay (`\`), top left: frames per second, ticks run this frame, sim ms per tick (average over the last second) split into scripts and the rest, draw ms, robots and scripts running. Plain text, updated twice a second.
11. **Stress test (Logan).** A world toolbar button, "Stress", with a small menu: "Hover: 10 / 25 / 50 / 100 drones" (`missile-drone-10prop`, hover and fire scripts running, yours) and "Battle: 6 vs 6" (`enemy-drone`, teams 1 and 2, the second flipped). It places them in a grid around the camera, skipping spots `canPlace` refuses, at a height clear of the ground under each spot (read from the world, not assumed flat). They are ordinary robots: Clear robots removes them, and they go in the replay like any deploy. Claude's call: team 2 draws with the enemy tint too.

## Tasks

### T1: golden hashes and the bench (before any speed change)
- The golden scene list (decision 5) as data in `packages/cli/test/goldenScenes.ts`, a test that runs each and compares with `golden-hashes.json`, and `UPDATE_GOLDEN=1` to rewrite it. Generate the file with today's code and commit it before T2 starts.
- `pnpm sim bench` (decision 8) with the timed host wrapper (decision 7) in the CLI. Tests: argument parsing and the report format with a tiny scene (1 drone, 0.2 s).
- Record the before numbers from `pnpm sim bench` in this plan's As built.
- Verify: `pnpm -r test`, `pnpm -r typecheck`, the bench runs every scene.

### T2: layout once, numbers as a block (sim-core)
- Tests first:
  - the prelude builds part objects from a layout and fills them from a block; a second tick with a new block updates the same objects; a new layout replaces them; `parts` is a new array each tick; `tags` is frozen; `self` is new each tick;
  - JSON quirks: `-0`, `NaN`, `Infinity`, a value missing on one tick and present on the next;
  - an instance given the same layout number twice is sent the layout once;
  - the parity test (decision 5) over every shipped scripted blueprint and the golden scenes;
  - the existing script tests pass unchanged (`scriptHost`, `worldScripts`, `messages`, `sensors`, the done-when tests).
- `types.ts` (`ScriptFrame`, `frameToInput`), `prelude.ts` (a `load(layoutJson, buffer, extrasJson)` in place of `load(json)`, a host-only `__debugInput` entry that returns the stringified globals for the parity test), `quickjs.ts` (`newArrayBuffer`, layout sent only when its number changes), `runner.ts`, `World.scriptInput` split into the layout record and the number block.
- Verify: golden hashes match; `pnpm sim bench` shows the drone script call near 12 us; record the numbers.

### T3: host-side plumbing (sim-core)
- Tests first: the robot id map stays right through spawn, split, wake, and removal (compare against `robots.find` over a destruction scene).
- Decision 9. Then profile `bench hover --n 100` and fix whatever plumbing shows at the top (not sight checks). Measure the result path (decision 6).
- Verify: golden hashes match; 100 drones under 16.7 ms average; record the numbers.

### T4: readout and stress test (app)
- Tests first: the timed host wrapper's sums; the readout's averaging; the stress grid's spot picking (pure: given a camera box, a ground height function, and a `canPlace`, the list of spots) including a world that is not flat and one narrower than the grid.
- Decisions 10 and 11. Warn Logan before editing (his `pnpm dev` on 5180 reloads). Check in the browser with `.claude/launch.json` config `app-verify` (port 5181): the readout shows, Stress 100 hovers and the numbers are sane, Battle launches missiles; stop the server after.
- Verify: `pnpm -r test`, `pnpm -r typecheck`, screenshots.

### T5: docs, review, gate
- `04` (Script API: `parts` objects are kept between ticks, copy what you keep), the playbook (same note, in Traps), `docs/ideas.md` (script performance: done, with the after numbers; Web Worker stays an idea), `docs/status.md`, this plan's As built.
- Opus review subagent over the whole M9 diff; fix its findings. Golden hashes match, CI determinism scenes match.
- Commit, tag `m9`, push once (branch and tag), stop at Gate 8.

## Gate 8 (Logan)
- Turn on the overlay (`\`) and read the readout with nothing running, then with Stress: Hover 25, 50, 100. It should stay smooth at 100 (the old code stuttered past about 25).
- Stress: Battle 6 vs 6 and watch the numbers while missiles are flying.
- Fly your own drones and fire missiles as before: nothing should behave differently.
- Optional: `pnpm sim bench` prints the numbers the As built quotes.

## Risks
- **A value that differs in the last bit** between JSON and the block would change a hash. The block carries the exact bits the host has; JSON text round-trips exactly in JavaScript. The golden hashes are the check; if one differs, the parity test finds the tick and the value.
- **A layout that goes stale** (a change to parts or present values that does not rebuild it) would hand a script wrong numbers. The parity test covers splits, decouplers, destroyed parts, and missiles waking; the layout also rebuilds whenever the count of numbers would differ.
- **Stress 100 in the browser** may be slower than headless (drawing 100 drones, QuickJS in the browser build). If it misses 60 frames per second, the readout says where the time goes and that becomes a Gate 8 note, not a blocker.

## As built

### Bench before any change (T1, 2026-09-25, Logan's Mac, `pnpm sim bench`)
| scene | n | avg ms | p95 | worst | scripts | rest | calls/tick |
|---|---|---|---|---|---|---|---|
| hover | 1 | 0.53 | 0.69 | 1.42 | 0.44 | 0.09 | 2 |
| hover | 10 | 4.58 | 5.21 | 7.05 | 4.03 | 0.56 | 20 |
| hover | 25 | 11.22 | 12.23 | 13.79 | 9.88 | 1.34 | 50 |
| hover | 50 | 22.83 | 24.05 | 25.72 | 20.17 | 2.66 | 100 |
| hover | 100 | 46.21 | 49.35 | 64.00 | 40.59 | 5.62 | 200 |
| big (flying-silo) | 1 | 1.89 | 2.08 | 3.49 | 1.38 | 0.51 | 2 |
| battle (6 vs 6, 20 s) | 6 | 7.27 | 8.69 | 18.52 | 5.50 | 1.77 | 15.7 |
| debris | 500 | 0.83 | 1.78 | 2.95 | 0 | 0.83 | 0 |

"scripts" is time inside the sandbox calls (including the host's `JSON.stringify`); "rest" is everything else, including `World.scriptInput`.
