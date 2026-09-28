# Gate 12: guns (M13)

What to try, and what to judge. Play it, then write findings below (or tell Claude).

## Try
1. **Missiles against guns.** Deploy `gun-drone` (yours) and hover. Deploy `enemy-fab-drone` or `enemy-flying-silo` as Enemy 150 m or more away. Watch the turrets swing onto each missile and shoot it down. Turn on Debug (`\`): each gun draws its sight line (green nothing, red an enemy, blue a friend, yellow its own robot).
2. **Get shredded.** Fly `hunter-drone` at an `enemy-gun-drone`. Fire your missiles at it from far off, then get within 100 m and watch it take your flares, grips, and propellers apart. It holds 40 m beside you and 15 m up.
3. **Drone bombs against guns.** Let an `enemy-carrier` or `enemy-bomb-fab-drone` send drone bombs at your `gun-drone`.
4. **Escort.** Your `gun-drone` next to your `fab-drone` against enemy fab drones: the gun drone picks off their missiles while yours go out. G switches your turrets off and on (to compare).
5. **Gun duel.** `gun-drone` against `enemy-gun-drone`, side by side at the same height, then one above the other.

## Flagged for your call
- **Damage 5, 10 shots a second (your picks).** Enough as it stands: missiles die 60 m or more out, because the turrets start pointing at anything within 400 m and fire within 250 m. Tracking only from 150 m, one missile climbing from below got within 4 m and its blast took 9 parts of the drone. `gun` in `packages/sim-core/src/parts/defs/gun.json` (`damage`, `rate`), and the turret script's `track` and `reach`.
- **Gun drones duel by shooting each other's guns off.** Each aims at the other's core; the facing gun (health 25, 5 hits) is on the line, so whoever lands 5 hits first wins in about half a second. More gun health, or a frame in front of the gun, would change that.
- **Friends beyond 150 m are not seen.** The sight looks 150 m, the turret fires to 250 m. A friend 200 m away on the line would be hit. No test hit one.
- **Shells hit everything,** including the shooter's own robot; the turret script holds fire when its sight shows its own robot, a friend, or the ground nearer than the target. A player-built gun pointed into its own robot shoots itself.
- **Shells are not bodies** (Claude's call, see the plan): they do not bounce, do not hit each other, and radars do not see them.
- **No builder key for the gun** (none left); pick it from the palette. Legend `M^ Mv M< M>`.
- **Turrets are on the ends,** as you picked; flare racks moved under the middle of the gun drones to keep each turret's swing clear.

## Known issues
- Everything open at Gate 11 (`gate-11.md`) is still open: debris in a bay blocks it; balance of the fab drones.
- A script's memory limit does not cap many small allocations (planned in `docs/plans/script-memory-limit.md`, not started).

## Findings
