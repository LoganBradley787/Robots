# Gate 7: sensors, teams, and homing (M8)

What to try, and what to judge. Play it, then write findings below (or tell Claude).

## Try
1. **A duel.** Deploy `enemy-drone` with the toolbar's **Deploy as: Enemy** (press `F` while placing to face it the other way if you like). Switch back to **Yours** and deploy `hunter-drone`. Fly (W S A D). The enemy should come to a spot about 50 m beside you and 12 m above, launch a missile every 3 s (four in all), and climb, drop, or slide out of the way of missiles aimed at it. Press F to launch yours: they go up, tip over, and come down on the nearest enemy.
2. **The debug overlay** (`\`): sensor cones and ranges, a line to everything each robot sees (red enemy, blue friend, grey debris), and each missile's marked target point.
3. **Launchers.** Deploy `launcher-seeker`, then a `car` as Enemy 60 to 100 m away. F swings the turret up toward the car, fires, and the missile homes on it. `launcher-arc` does the same but climbs and comes down on it from above.
4. **Flip and turn.** Deploy two `launcher`s facing each other, one as Enemy. `R` turns a held robot too.
5. **Possession.** `,` and clicks never put you in an enemy; clicking one only follows it.

## Flagged for your call
- The launchers tilt the turret up 12 degrees above the target before firing (a level launch scrapes the ground). `loft` is a param.
- Drone missiles stand nose up on top of the drone; dropping them nose down from below only worked above about 25 m.
- The enemy drone's numbers are params on `enemy-drone.pilot.js` (standoff, height, reload, dodge distances), editable in the builder.
- Only your own robots can be taken over; enemies can be watched.
- Script cost: the duel runs about 1.1 ms per tick on this machine. Several enemy drones at once are fine; twenty will be slow until the script speed milestone.

## Known issues
- A placed missile shares its drone's energy while attached (the hover drains it). After 40 s of hovering a missile still has about 60 percent.
- The stock `missile-drone` still tilts a few degrees after its first shot (slow learned trim); the new drones compute their balance from their parts.
- Scripts cannot see the ground, so the enemy drone only dodges downward when it is well above the robot it tracks.

## Findings

### 1. Missiles are big and slow; the arc barely clears the target (Logan)
- Logan: the arc "goes barely above a target and then flips downwards", so the target sees it right above, stays still, and it is easy to dodge. Needs to go higher and faster, with a stronger motor.
- Decided (Logan's picks): a new `booster` part for missiles (400 N, 1.5 kg, 60 J/s; the thruster stays for everything else); the arc climbs about 60 m above the target and comes down at about 50 m/s; a heavier warhead part for missiles (about 250 damage out to 4 m; bombs keep theirs).

### 2. Two enemy drones, one per team (Logan's play log)
- Both launched; first missiles missed, circled back (homing), and one hit on the way back; one exploded in mid-air just before reaching its target.
- Missiles from the two drones collided in mid-air several times (missiles are robots; they collide).
- A third missile turned before it was clear of its drone (slow motor) and hit the missile beside it.
- A missile that hit did almost nothing ("it just goes pop"): blast damage halves for every part in the way, and a drone's side is frames.
- After their missiles were gone both drones climbed forever. Cause: each holds a spot 12 m above the robot it tracks, so two of them chase each other upward.
- Fixes planned: missiles climb until clear of their launcher before turning; no going off at an empty last-known point (impact does it for ground targets); a height ceiling for the enemy drone; the booster and heavier warhead from finding 1.

### 3. Review findings (Opus review of the M8 diff)
- `send()` cap could be bypassed through a `toJSON` on the data; `sent` events had no rate limit; `mark()` or `set()` with NaN disabled the script with a misleading error; a sensor saw on its first tick before it had power; deploying an enemy let go of the robot you were driving with its keys held; `contacts` and `inbox` are reserved names; docs said "16 sends per tick" (it is per script) and "core velocity" (it is the core body's).
