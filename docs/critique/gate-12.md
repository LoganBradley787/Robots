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

### 1. First play (Logan, 2026-09-28)
- **Gun drone against gun drone:** they shoot fast and shoot each other's guns off; "not smart enough to flip around", so the fight ends there.
  - Fixed: the fab pilot (all its copies) takes the side of its target its remaining guns face, crossing over or under it (headless: two enemy gun drones that used to sit disarmed at their ceiling now fight on; one wins, 1 part lost against 27).
- **Enemy gun drone against enemy flying silo** at 0.25 speed: the gun hits missiles all over (thruster, gyro) but not smart enough to land on the warhead; flares pulled two missiles off; the silo won with two missiles left. It kept firing at the wreck after its core was gone (missiles already on their way).
- **Enemy bomb fab drone against a gun drone:** the gun drone won easily from far off: flares first, then the bay, a drone bomb in the air, the batteries, the core. At 92 percent power at the end.
- **Enemy fab drone against a gun drone:** the fab drone won: it took out the left gun and the left propellers, and the gun drone fell with its other gun pointing the wrong way.
- **"That bullet just flew through this thing"** (the fab drone). Not reproduced. Likely through a fab bay's empty hollow (the U is open when its missile is out) or between a flare and its grip; shells now also check behind them for things coming at them (the Gate 12 review fix).
- **Warning:** "pilot: set(lprop, throttle): the value is not a number; ignored": fixed (every hover and pilot divided by zero lift once every propeller was gone).
- **Aim at parts, not the core:** Logan unsure (guns, lift, core? a gun war is the meta; hidden guns behind a wall that opens would be cool, not now). Built: turrets score each part of a big target by worth over the shells to break it and everything in front of it (guns and warheads most, then core, radar, lift). Missiles and drone bombs are still aimed at their middle.
- **Firing looked inconsistent** (pauses, then fast): on target was within 1.5 m of the aim point, so at range it flickered on and off. Now 1 m or 0.012 rad to start, twice that to keep firing.
- **Everything is close quarters:** radars see 500 m, guns reach 250 m, so once two robots see each other they are in gun range; fab drones 730 m apart never saw each other. Decided (Logan): test designs first; spread for shells, or longer range radars and missiles, later.
- **Design, not parts?** Built three drones to find out: `enemy-armored-gun-drone` (guns off the core's line), `enemy-fab-gun-drone` (a walled-in missile bay plus guns), `enemy-many-gun-drone` (12 guns). Results so far are in the playbook's examples.

### 2. Second play (Logan, 2026-09-28)
- **Fab gun drone against many-gun drone:** multi-target tracking; the many-gun drone shot missiles and shredded the fab gun drone.
- **"Turrets stopped: ran too long for one tick"** (the many-gun drone against the enemy flying silo): all twelve turrets scored every part of the 100-part silo on the same tick. Fixed: at most one turret picks its part per tick, and scoring stops once no part left can beat the best (test).
- **Gun drone against enemy flying silo:** the silo won with one missile to spare; missiles with their seeker shot off still flew on to the last point they knew and hit.
- **Many-gun against many-gun** at 0.25 speed: a real gun war; one lost all its facing guns, tried to cross over, and the other (below it) took its propellers, guns, and core. The winner kept most of its guns.
- **Many-gun against fab gun drone** (on the many-gun's damaged side): the fab gun drone's missiles got through once its guns were down and took the many-gun drone's core. The fab gun drone then drifted to a spot and waited.

### 3. Range (Logan, 2026-09-28)
- Tried before any bigger change: shells spread up to 0.5 degrees (center weighted, deterministic), and radar range doubled to 1000 m.
- Measured, 600 m apart, 60 s: the enemy fab drone now beats the enemy gun drone (2 parts lost against 24; it fires from outside gun range); the many-gun drone still beats the fab drone and the fab gun drone; the enemy flying silo beats the gun drone. Missile shootdowns in the done-when tests still hold (4 or more hits, nothing lost). The 2v2 friendly fire check now allows a stray shell in twenty.

