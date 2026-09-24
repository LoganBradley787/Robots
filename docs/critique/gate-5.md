# Gate 5 punch list (destruction)

From Logan's first play session, 2026-09-23. **Closed the same day: nothing to fix.** Logan: "this is GOLD. the missiles work so well!!!! and the frames are a durability that makes sense." "These are all very good mechanics. I like them."

## What Logan tried
- Launcher against the wall: missiles fly and blow holes.
- Two `drone`s against a launcher: several misses, then a hit on the battery; the drone could not stabilize and went down. A center hit on the second drone knocked its battery off and damaged the core and insides; it kept flying on the core's reserve until it ran dry.
- A bomb on the side of a drone knocked out two propellers; it spun out of control.
- Built an armored car (saved over `car.json` by accident; now `blueprints/armored-car.json`, and `car` is restored because the tests and CI use it).

## 1. A rotator's turret passes through its own robot (decided: keep)
- Logan: "parts with a rotator can clip through each other.... is this intended?" In his screenshot the arm swung through the robot's own frame column.
- Cause: contacts are off between a rotator's turret body and the body it is mounted on, so the rotator can turn on its mount without jamming. Other robots, pieces, and terrain still collide.
- Logan chose to keep it (turrets need no clearance). A bomb held in a bay on the base side needs a decoupler, since the doors pass through it. Recorded in `03` and `07` Q5.

## Noted for later
- "These missiles are hard to aim. This is why I need homing missiles." Homing needs a sensor part (the finder, `02`) and `world.robots()` in the script API. In `docs/ideas.md`.
- A bomb dropped from too low (under about 1.3 m) does not go off: the impact fuze needs 5 m/s. Working as designed; lower `impact.speed` if dropped bombs should be more forgiving.
