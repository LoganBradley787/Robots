# Gate 3 punch list (robot feel)

From Logan's first play session, 2026-09-23. Overall: "A couple minor issues, but overall, not terrible." Driving acceleration is fine ("took a while to accelerate, which I'm not upset about"); thrusters make sense.

## 1. Collisions are bouncy; a car bounced higher every bounce and left the world (done)
- Logan: drove off the 1 m block with one wheel on it, the car got bouncier every bounce and fell out of the world. Hitting blocks gave an "insane" impulse.
- Cause: impulse joints under a driven wheel that slips and lands feed energy back into a pitching oscillation. Reproduced headless: 6 flips in 23 stress drives, one drive at 26 m/s (past the wheels' 18 m/s).
- Fix: wheels are multibody joints with our own motor (`03`). Same drives: no flips, no overspeed. `test/stability.test.ts` fails on the old joints and passes on the new ones.

## 2. Stuck car: right wheel on the ground but not spinning (done)
- Logan: after ramming the block, the car sat with one wheel in the air and the other on the ground, not turning.
- Cause: the bodies fell asleep while the key was held (the motor had nothing to change, so nothing woke them).
- Fix: a motor that pushes wakes its bodies every step.

## 3. Lost after flying off the world (done)
- Logan: "I don't even know where I am to place a new robot. Is there any way to reset the camera?"
- Fix: a Home button on the world toolbar puts the camera back at the drop point. `,` with no robots and Clear robots do the same. The flat world's ground is 1000 m wide instead of 400 m, so driving off the edge takes about 30 s at top speed.

## 4. Steering in the air: the gyro (done)
- Logan: the hopper tilts until it flips; wanted "some kind of piece you can put down that's just like reaction wheels" and A/D-style control of rotation.
- Logan's answers (2026-09-23): no levelling or angle holding ("I don't want it to be self-driving"; that is what scripts are for). With no input it only damps spin, a small fixed correction that a hard spin overpowers. Torque is fixed per gyro, so bigger robots need more. Its own keys: Q and E, not A and D.
- Built: the gyro part (palette key 9, `G` in grids). E turns clockwise and Q counterclockwise with 40 N m. With no key it damps rotation with at most 15 N m, settling in about 0.3 s when it can. Its `damp` channel (default on) can be switched off with a custom binding. The shipped hopper has one on top of its core and now climbs straight.

## 5. Car caught by one frame corner on a block (done)
- Logan's second session, with a screenshot: after running into the block, the car's left frame corner sat on the block's top edge, the left wheel hung in the air, and the right wheel, on the ground, could not pull it off.
- Cause: a stall, not a slip. The grounded wheel pushed with about 27 N, and the corner's friction on the block (Rapier's default 0.5) was about the same. The wheel did not even turn.
- Fix: part cells without a friction of their own use 0.3 (steel sliding on ground). The car now drives off from any overlap. A box robot still holds on the 18 degree ramp. `test/stability.test.ts` covers the screenshot pose and fails at 0.5.
- Not the same as high-centering (the body fully on the 1 m block with both wheels in the air). That is real geometry (0.95 m clearance), kept as is.

## Noted, not changed
- Driving mechanics: fine as they are. Retuned after the joint change to keep the same feel (`11`).
- Thrusters and propellers have no top speed (no air drag), so a propeller car keeps accelerating. Flag for Gate 4 or later.
