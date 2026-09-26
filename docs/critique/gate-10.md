# Gate 10: flares (M11)

What to try, and what to judge. Play it, then write findings below (or tell Claude).

## Try
1. **Timing a pair.** Deploy `hunter-drone` (yours) and hover. Deploy `enemy-flying-silo` or `enemy-drone` as Enemy 100 m or more away. When a missile comes, press **V** (one flare out each side, burning). Try it at different moments: as soon as it launches, about a second before it arrives, and at the last instant. Each press lets go of the next pair; there are three.
2. **See who is fooled.** Turn on Debug (`\`): a sensor's line to a robot it sees ends in an orange ring when it is seeing a flare instead. A missile's line swings to the flare when it is fooled.
3. **Drone bombs.** Let a `carrier` (or `enemy-carrier`) send drone bombs at you and flare them. They brake slowly, so a flare thrown straight at one gets overshot: pop early and fly off.
4. **Enemies flare too.** Fire the hunter's missiles at an `enemy-drone`: it pops a pair by itself when one is about to pass within 8 m. Try waiting until its three pairs are spent.
5. **Your other racks.** `big-drone` and `carrier` have racks on V as well.

## Flagged for your call
- **Burn time 2 s** (the plan's number). Measured against a seeker missile at about 130 m/s: lit 0.4 to 2.5 s before it arrives saves you; 3 s or more early, or 0.2 s or less, it hits. A 1.5 s burn narrows that to 0.4 to 1.5 s, 1 s to 0.4 to 1 s. Shorter is more skill, but at these speeds a missile is on screen for well under a second before it arrives. `decoy.burn` in `flare.json`.
- **Enemies flare very well.** With `auto` flares an enemy drone took no damage from the hunter's four-missile volley (28 parts lost and dead without them). Make them worse with the enemy's `flares` params (`ahead` 1.2 s, `miss` 8 m, `gap` 1.5 s), fewer flares, or a random miss.
- **Racks are armor.** They stick out 2 cells on each side, and a hit from the side often lands on a rack instead of the drone (a drone bomb homes on the nearest part it scans, which is now a flare). The hunter now outlasts the enemy flying silo's first 20 s (the test checks 25 parts lost instead of its core). Racks under the drone would avoid that but drop flares toward missiles from below.
- **Missiles got a little better at near misses:** a seeker missile now also goes off when it loses sight of what it was about to reach within 5 m, and measures from its warhead over the next tick (it covered 2 m a tick and flew through flares).
- **V is the flare key** on all three of your racked robots.
- **No builder key for the flare** (no free key left); pick it from the palette.

## Known issues
- A script's memory limit does not cap many small allocations (planned in `docs/plans/script-memory-limit.md`, not started).

## Findings

### 1. Big battle (Logan, 2026-09-26)
Five of Logan's carriers (enemy-carrier blueprints on his team, 30 drone bombs) against four enemy trucks, an enemy flying silo, and an enemy big drone, at quarter speed.
- Flares worked: a missile pulled off by a flare, one that missed and redirected; drone bombs soaked up missile fire. "Not enough" alone under a heavy volley.
- The carriers were deployed too close: they collided, stacked in a cluster, and some drone bombs could not launch. They fell when their energy ran out.
- A truck's missile hit the enemy flying silo overhead (friendly fire).
- Trucks backing away from drone bombs do not fire; they fire only when stopped. Out of missiles, they just sit.
- **No clear winner:** battles end with damaged robots out of ammo, still flying or wrecked. "Did anyone really win?" Wants a fabricator bay (missiles and drone bombs that do not run out).
- **4x speed drops to 10 fps** (1x and 2x hold 120). Cause (Claude): the app runs up to 16 ticks per frame to keep up; when a tick costs more than the frame has (a big battle), frames get longer, which asks for more ticks per frame, until each frame runs 16 ticks. Fix: cap the sim's time per frame (say 10 ms), so a heavy scene runs slower than 4x but stays smooth.
  - Fixed (2026-09-26): the app gives the sim at most 10 ms per frame (`app/tickBudget.ts`). 100 hovering drones at 4x now hold 40 to 48 fps, running about one tick per frame (slower than 4x, but smooth).
- **Decided (Logan):** fabricator bay next (M12). "Drones run out of firepower long before they run out of the ability to survive"; with a bay there is something worth armoring (even a rotator wall that opens to launch). No scoreboard: too limiting.
