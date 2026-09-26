# Gate 11: the fabricator bay (M12)

What to try, and what to judge. Play it, then write findings below (or tell Claude).

## Try
1. **Watch a build.** Deploy `fab-drone` and hover. The bay on top builds a guided missile in about 4 s: its parts appear one by one, bottom first, with a progress bar across the bay's floor; then it is solid.
2. **Fire.** Deploy an enemy (a car, an `enemy-drone`, an `enemy-flying-silo`) 100 m or more away. Press or hold F: each missile goes as soon as it is built, at the nearest tracked enemy. Watch the energy bar: about 870 J a missile, some 20 missiles on its four dense batteries.
3. **Hit the bay.** Let an enemy shoot at you: a bay destroyed mid-build builds nothing more; one holding a finished missile leaves it a dud in the wreck (unarmed).
4. **Build your own.** Put a Fabricator bay (the last part in the palette) on something, right-click it, Makes, and pick a saved blueprint. It must fit the 1 by 5 hollow and touch its inner walls; the issues list says if not. A copy with no motor stays in a bay pointing up; point the bay sideways or down to drop things.
5. **Guard it.** Try a rotator wall over the bay's mouth that swings open to launch.

## Flagged for your call
- **Cost and speed:** 40 J per kg plus the energy the copy holds (872 J for a missile), 0.6 s per kg (4.1 s). `fabricate` in `fabbay.json`.
- **One bay size** (fits `missile-up`). Big missiles and drone bombs need bigger bays: more defs, the same fields.
- **The push out is small** (4 N s): a missile flies itself out, a lump does not. Bigger would kick the drone.
- **Enemies have no bays yet** (you asked for one drone first). An enemy fab drone is a small step: the enemy drone's pilot with this bay.
- **Multi-cell parts:** the bay is the first. A lopsided multi-cell part (none yet) cannot be mirrored.
- **No legend token and no builder key** for the bay (it always needs `makes`, and every key is taken); pick it from the palette.

## Known issues
- A script's memory limit does not cap many small allocations (planned in `docs/plans/script-memory-limit.md`, not started).

## Findings
