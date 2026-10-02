# Titans tournament (Logan, 2026-10-01)

Eight builders each make one MASSIVE robot that runs itself (enemy type, no player). They fight 1 against 1, headless, round robin. Full creativity: 50 fab bays launching drones that launch missiles, 1000 blocks long, whatever works.

Branch: `titans` (off `big-batch-fixes`, which has every part: grapple, jammer, smoke, charge, piston, radio, fins, and so on. `main` does not have them yet).

## How it goes

1. **Planning round.** Each builder reads the playbook and the parts, and comes back with a high-level idea and the rules or limits that would set it back. No files written.
2. **Rules.** Logan and Claude decide which limits to lift, once, for everyone.
3. **Round 1.** Build, then everyone fights everyone.
4. **Round 2.** Each builder gets its own results and what beat it, rebuilds, and they fight again.
5. Maybe later: a round where each builder may design one new part and build around it.

## Rules (decided after the planning round, 2026-10-01)

- **Existing parts only.** No engine changes by builders. Builders write only their own files: `blueprints/titan-<name>.json`, `blueprints/titan-<name>.*.js`, the recipes its fab bays make as `blueprints/titan-<name>-<thing>.json` (and their scripts), and a generator under `tournaments/gen/titan-<name>.mjs` if the blueprint is made by a program.
- **No player.** Everything runs from scripts. Nobody presses a key.
- **Arena.** `worlds/arena.json`: the flat world with no boxes (4000 m wide, ground at y 0). One titan spawns with its main core at x -400 on team 0, the other at x +400 on team 1, flipped left to right. Each titan declares its spawn height: on the ground, or in the air up to 150 m.
- **Bounds.** A titan whose main core goes past x -1000 or x +1000, or above y 250, loses. Radar reaches 1000 m and guns about 295 m, so nobody can run out of sight or sit out of reach.
- **Match.** 240 s (14400 ticks), 3 seeds per pairing, both side assignments.
- **Winning.** A titan loses when its main core (the blueprint's main core, wherever it now is) is destroyed. Other cores do not count. Both gone within 2 s is a draw.
- **Timeout is a draw** (Logan): if both main cores live at 240 s it is a draw, whatever is left of either. Win 1 point, draw half, loss 0. A titan that only tanks does better than one that loses, and worse than one that ends its enemy more often than not.
- **Speed.** No part limit. A titan fighting a copy of itself must average under 16 ms per tick headless on Logan's machine. A short peak (a volley's first seconds) is fine; the 95th percentile is reported as a warning only.
- **Hiding is allowed** (Logan): a titan may keep its core inside jammer bubbles all match. Sensor-led titans need another way to find it (gun sights, the mirrored spawn point, last known place).
- **Ramming is legal.** Crash damage stays as it is for round 1 (it reaches every part of the body that is hit). Logan decides after round 1 whether it is too strong.
- **Limits lifted for everyone:** script budget 200 calls per tick (was 50: about 2 million script steps a tick, not half a million; a script past it is stopped for good); `send` 32 per script per tick and 64 per robot (were 16 and 32).
- **Not changed in round 1:** part stats (gun reach, rotator swing, battery size, wheel torque, jammer and flare times, bay size 10 by 10, build times), nested recipes, one script file per core, scans per tick (4). Recipes are not flipped with the titan: copies must be symmetric or turn themselves.
- **Speed work in the engine** (no behavior change, merged when ready): rebuilding a robot when it loses a part, the parts list handed to every script, `scan` of a big robot, the sensor pass over many robots, the charge check.
- **Wording.** Plain, soft game words in every name, comment and note: "blast" not "shoot", "distance charge" not "proximity mine", no real weapon names. Never use em dashes.

## The eight titans (round 1 plans)

| Titan | Theme | Plan |
|---|---|---|
| `titan-hive` | Carrier | 140 m flying mother ship, 32 fab bays of darts, small gun drones and heavies |
| `titan-bastion` | Fortress | 160 wide ground mesa, armor three deep, 28 bays in armored wells, jammer and flare bays |
| `titan-juggernaut` | Crawler | 22 t armored wedge on wheels pushed by boosters, rams at 45 m/s, 300 fixed roof guns |
| `titan-woodpecker` | Volley | ground base whose roof is 96 big darts, all gone in 2 s, landing on one spot in ranks |
| `titan-palisade` | Gun wall | 190 m tall flying wall of 16 gun panels, about 290 guns |
| `titan-mirage` | Trickster | 130 m flying spar, cores hidden in jammer bubbles, builds darts that fly their last seconds blind |
| `titan-shatter` | Splitter | comes apart on tick 0 into 77 robots: 48 gunships, 24 darts, a king pod with the main core |
| `titan-anvil` | Wildcard | a solid 7 t flying brick of armor that only rams |

## Themes (a starting lean so the eight differ; a builder may leave its theme)

1. **Carrier:** a flying mother ship, many fab bays, clouds of small drones.
2. **Fortress:** a ground base, heavy armor, turrets and silos.
3. **Crawler:** a giant ground machine (wheels, pistons, legs) that comes to you.
4. **Volley:** everything at once in the first seconds, a huge salvo of guided robots.
5. **Gun wall:** a very long or very tall flying wall of aimed guns.
6. **Trickster:** jammers, smoke, flares, decoys, grapples, radio: wins by spoiling the other's sensors and scripts.
7. **Splitter:** comes apart at the start into many pieces that each fight on.
8. **Wildcard:** whatever it thinks wins. The stranger the better.

## Results

### Round 1 (2026-10-01, seed 1, both sides, 56 matches; full report in `tournaments/round1/results.md`)

| # | Titan | Wins | Draws | Losses | Points |
|---|---|---|---|---|---|
| 1 | `titan-juggernaut` (ground ram) | 13 | 1 | 0 | 13.5 |
| 2 | `titan-anvil` (flying ram) | 10 | 3 | 1 | 11.5 |
| 3 | `titan-palisade` (gun wall) | 10 | 0 | 4 | 10 |
| 4 | `titan-shatter` (splitter) | 5 | 2 | 7 | 6 |
| 5 | `titan-woodpecker` (volley) | 3 | 5 | 6 | 5.5 |
| 6 | `titan-mirage` (trickster) | 2 | 6 | 6 | 5 |
| 7 | `titan-bastion` (fortress) | 2 | 5 | 7 | 4.5 |
| 8 | `titan-hive` (carrier) | 0 | 0 | 14 | 0 |

- Ramming took first and second. Nothing beat the juggernaut.
- The gun wall beat every titan that is not a ram, twice each.
- Hiding the main core on a pod did not work: the rams and the wall found the pods with gun sights. The hiders mostly drew with each other.
- Speed check: `titan-shatter` 26.7 ms and `titan-woodpecker` 17.1 ms a tick against themselves, over the 16 ms rule. The rest passed (5.3 to 13.9 ms).
- No script was stopped in any match.

### Round 2 (2026-10-01, seeds 1 to 3, both sides, 168 matches; full report in `tournaments/round2/results.md`)

Local crash damage, the engine speed work, and each builder's rebuild.

| # | Titan | Wins | Draws | Losses | Points (of 42) |
|---|---|---|---|---|---|
| 1 | `titan-juggernaut` (pushes out of bounds, 20.4 t) | 27 | 14 | 1 | 34 |
| 2 | `titan-palisade` (gun wall) | 22 | 10 | 10 | 27 |
| 3 | `titan-bastion` (roped fortress, buried core) | 10 | 31 | 1 | 25.5 |
| 4 | `titan-anvil` (flying brick) | 16 | 16 | 10 | 24 |
| 5 | `titan-mirage` (trickster) | 10 | 15 | 17 | 17.5 |
| 6 | `titan-hive` (carrier) | 6 | 23 | 13 | 17.5 |
| 7 | `titan-shatter` (splitter) | 0 | 25 | 17 | 12.5 |
| 8 | `titan-woodpecker` (volley) | 2 | 16 | 24 | 10 |

- 75 of 168 matches were draws (45 percent; round 1 had 11 of 56, 20 percent). Local crash damage and ground ropes stopped the rams from ending things, and nothing replaced them for buried cores.
- The juggernaut is still first, now by pushing: it beat the four fliers that are not the anvil in 22 of 24, the anvil 5 to 1, and drew all 12 with the two roped ground bases.
- The bastion lost once in 42 and won only 10: nothing gets in, and its darts miss anything that was moving at launch (see the watch notes).
- The woodpecker's still keep fell to darts and guns: 24 losses. The splitter won nothing after slimming to pass the speed rule.
- Every titan passed the speed rule (6.4 to 12.0 ms a tick against itself, alone). No script was stopped.

## Round 2 (decided by Logan after round 1)

- **Crash damage becomes local.** A crash used to hurt every part of the body that was hit, however deep, so a heavy ram erased a buried core in one tick. Now the damage falls off with distance from the contact (full at the contact, none past about 6 m), so depth protects. The jolt still sets off impact fuzes and crash fuzes anywhere on the body. This is an engine change for the whole game, not a tournament rule.
- **Existing parts only, as in round 1.** Every other rule above stands.
- **3 seeds**, both sides: 168 matches.
- **Allowed and now known to all:** the two starting robots get ids 1 and 2, and every piece or copy a higher one, so `contacts` with id 1 or 2 is the other titan's main robot (the piece that holds its main core).
- **Engine speed work merged before the round:** rebuilding a robot on part loss (5 to 8 times cheaper), the sensor pass, radio sharing, the charge check, and the parts list a script re-reads when its robot loses a part.

## Watch notes for the next rebuild (Logan watching in the browser, round 2 builds)

- **`titan-bastion` against `titan-juggernaut`:** while the juggernaut drives in, the bastion's darts do not go at it: they head off past it and keep going until their 12 s `fuse` ends them (Logan: "the darts just head off into infinity"). Likely cause (from the dart guide, not traced): the base hands each dart the target's point and speed at launch; the dart only replaces them when its own seeker sees the robot, and until then it never clears the speed (the "lost track" reset needs a first sighting). Its aim point is the launch point plus speed times time to go, and time to go is distance over closing speed with a floor of 20 m/s, so as the dart flies past, the aim point moves away faster than the dart closes on it. A target standing still at launch gets hit; one moving at launch is never reached. To check: whether the dart's seeker sees anything at all while it is inside the base's own jammer bubble.
- **`titan-juggernaut` against a roped base:** one push, one back-off, one run at 30 m/s (slow to turn and to get going at 20.4 t), then it retires to the far corner for good and the match is a draw. Its mast was cut off by darts on the way. Logan: "show some gumption".
