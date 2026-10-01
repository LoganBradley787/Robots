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

(filled in after each round)
