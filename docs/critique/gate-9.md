# Gate 9: arming and new enemies (M10)

What to try, and what to judge. Play it, then write findings below (or tell Claude).

## Try
1. **Arming.** Deploy an `enemy-drone` as Enemy and shoot it with your `hunter-drone`: a hit on its rack should knock missiles off or break them, not set them all off. It keeps fighting with what it has left. Armed warheads show a lit red light (a missile lights up when it launches); unarmed ones a dark socket.
2. **Your bomb car.** Build a car with a few warheads, give it an arm key and a detonate key (bindings: `pulse`, target `warhead`, channels `arm` and `detonate`), drive it into something, arm, detonate. Try detonate before arming: nothing. Crash it into a wall unarmed: nothing. Right-click a warhead for **Armed at start**.
3. **Drone bomb.** Deploy `drone-bomb` as Enemy, then your hunter drone. Run from it (holding a direction flat out escapes it), then turn and shoot it down. Deploy one of yours near an enemy. It comes down on its target from above and goes off on it (fixed after your first try: it used to brake to a stop and push). Its warhead lights up once it has a target. If your builder had it open before the fix, reopen it from the dropdown so the builder has the new pilot.
4. **Enemy flying silo.** Deploy `enemy-flying-silo` as Enemy on the ground in open space (left of the boxes), then something of yours 100 m or more away. It climbs, holds 80 m off and 20 m up, and fires every 1.5 s.
5. **Enemy truck.** Deploy `enemy-truck` as Enemy, then a car of yours in open ground (left of the boxes: ground robots cannot see through them). It drives until 150 m away, stops, and fires arcs.

## Flagged for your call
- **The drone bomb is fast** (up to about 45 m/s; "as fast as it can while it can still slow down and hit a drone"). You only outrun it by flying flat out, since nothing has drag. `speed` is a param if it feels too hard.
- **It cannot see the ground,** so it keeps 6 m over its target until close and comes in from above. Real terrain-following needs a ground-seeing part (in `ideas.md`).
- **The enemy flying silo lasts about 70 s in the air** on its batteries.
- **Enemies skip anything under 10 kg** (they treat it as a missile), so a car shot down to a light wreck is left alone.
- **Old replays** recorded before M10 will not replay exactly: their warheads were live from the start.

## Known issues
- A script's memory limit does not cap many small allocations (planned in `docs/plans/script-memory-limit.md`, not started).

## Findings
