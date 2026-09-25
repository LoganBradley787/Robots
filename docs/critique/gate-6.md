# Gate 6: Claude workflow (M7)

What to try, and what to judge. Play it, then write findings below (or tell Claude).

## Try
1. **Claude builds a robot from a sentence.** Open a fresh Claude Code session in the repo and ask for a robot in plain words ("build me a drone with missiles", "a car that can climb the ramp", or anything). It should read `docs/claude-robot-playbook.md`, test with `pnpm sim`, and hand back a blueprint that validates and works when you open and deploy it, with no manual editing. Two dry runs by fresh subagents both succeeded (see the plan's As built).
2. **Place a blueprint in the builder.** Open your own robot (or `car`), click `missile` under Blueprints in the palette, turn it with `R`, flip it with `F`, click to place. Place a second one. Pick `missile2` in the Controls for picker and change its script or a key. Save, reopen, deploy. Editing `missile.json` afterwards leaves your robot alone.
3. **Missile drone.** It hovers from deploy (H turns the hover off), W and S climb and sink, A and D lean, F fires the right missile, then the left. Climb to about 10 m before firing.
4. **Keys bar.** Script keys now show after a divider, dashed: the missile drone shows Q E H, then W A S D F.
5. **Launcher** as before: Z and X aim, F fires.

## Flagged for your call
- **New part `cell`**: a 0.5 kg, 250 J battery (key `-`), made for missiles.
- **Rotator**: 600 N m (was 300), turns only as fast as it can stop what it carries, and its aim never runs more than 0.15 rad ahead of the turret.
- **Missiles**: a flat shot sinks about 3 m before it levels out; a straight-up shot sags about 15 degrees past vertical; they fly nose-up about 20 degrees (27 before the thruster change), so their tail hangs low. No homing (sensors are Q22, open).
- **Missile drone**: after the first shot it tilts up to about 8 degrees and settles in about 3 s, because its hover learns the new balance. The second dry run's drone computed its balance from the part list instead and held 0.5 degrees; the stock drone could do the same if you want it steadier.
- **Placed missiles share the robot's energy** while attached (their cores and cells are in the robot's pool, and the hover drains them).
- The builder at under about 1100 px wide: the side panels cover the grid (known since M2).

## Findings

### 1. Propellers and thrusters too weak (Logan, fixed)
- Logan: the missile drone needed ten propellers "just to keep this relatively light thing afloat"; it should need about 6. And missiles are slow.
- Decided: propeller 60 to 120 N, thruster 120 to 160 N, propeller energy stays 10 J/s (Logan: drones barely last as it is).
- Done: `missile-drone` rebuilt with 6 propellers (about 2 minutes of flight on two batteries); the missile guide's `thrust` param is 160 in every copy; hover scripts (`drone`, `weird-thing`, `missile-drone`) start from a throttle worked out from their mass and propeller count (new `lift` param, 120), so they no longer overshoot on a stronger propeller. Missiles now reach about 105 m/s (80 before).

### 2. A 10-propeller missile drone for agility (Logan, done)
- `missile-drone-10prop`: the missile drone with all 10 propellers (lift about 2.9 times its weight). Leans up to 0.7 rad (40 degrees, param `lean`) instead of 0.3, and its hover divides the throttle by the cosine of its tilt so a steep lean keeps its height. Braking with A and D let go is gentler (param `brake`, 0.04), so the higher speed (about 20 m/s) stops without swinging back. Its scripts are its own copies.

### 3. Slow weight-shift correction and slow rotation (Logan, fixed)
- Logan: after a missile leaves, the drone took 10+ s to level out; and the 10-prop drone "should be THROWING ITSELF at correction": full torque (one side's propellers at full, the other off, plus the gyro), then braking at the last moment.
- Why it was slow: the lean trim crept at 0.05 per second against a lean gain of 0.5, a time constant of 0.5 / 0.05 = 10 s.
- Both missile drones now work out the off-center weight from the parts list (every part's `mass` and position) and cancel it at once: the 6-prop drone tilts about 5 degrees after a shot and levels within about 2 s; the 10-prop drone stays within 0.2 degrees, and its second missile flies flat.
- `missile-drone-10prop` leans time-optimally: each tick it works out its moment of inertia from its parts and its full turning torque each way, drives its spin toward the fastest spin it can still stop from (v squared = 2 a d, planned on 70 percent of the torque, param `margin`), and hands the torque to the gyro first and the propellers for the rest. 0 to 38 degrees in about 0.7 s, a full swing from -40 to +38 in about 1.1 s, about 2 degrees of overshoot, and it keeps its height. Planning on more of the torque gained 0.05 s and overshot up to 9 degrees.


### 4. More lean, and settings you can read (Logan, done)
- Logan: it holds its height so easily at 40 degrees that it can lean further. `missile-drone-10prop`'s `lean` is now in degrees, default 50 (up to 70); at 50 degrees both sides hover near 0.55 throttle, so there is room left, and it reaches the lean in under a second.
- Logan saw the left propellers "off the whole time" through full swings. A log shows each swing is two halves: one side full to throw it over, then the other side full to brake, then both near half while it holds the lean. Five propellers at 0.9 lift 540 N against 412 N of weight, so it stays up. It feels too perfect because sensing is exact and propellers change thrust instantly; real propellers take time to spin up (an idea for later: a spin-up time in the propeller's data).

### 5. Up and down were sluggish next to the new turning (Logan, done)
- Logan: "you can tilt fully left to fully right in the same amount of time it takes to go up like 2 ft." Height still used the original drone's gentle control (W and S slid a target height at 3 m/s).
- `missile-drone-10prop` now climbs the way it turns: W and S ask for a climb or sink speed (param `climb`, 10 m/s), it gets there with all its spare push (about 0.6 s), and letting go stops it at the height it can stop at soonest (gravity brakes a climb, the propellers brake a fall), within about half a meter.
- Turning comes first: the height gets the throttle that leaves room for the whole left-right split, so climbing while leaning 60 degrees no longer wobbles or overshoots (it overshot to 68 before); a hard turn can cost a meter or two of height.
- `lean` default is 60 degrees (Logan's pick after trying 70, which flipped it into the 2 m box).

### 6. The fresh-session test: a turret drone (Logan's challenge, passed)
- Logan asked a fresh Claude Code session for a drone with a missile on a turret that aims and fires left, right, and down. With only `CLAUDE.md` and the playbook it built `turret-drone` (a hanging rotator, the missile nose down in the hinge column gripped from the side, a turret script so Z aims left), tested left, right, and down shots, a sweep while hovering, a wall hit, and a ground deploy, and every run was deterministic. Logan flew 15 to 20 of them against each other: "Honestly, I am impressed."
- What it had to look up outside the playbook, now in it (a Turrets section): where the hinge is, that a turret does not collide with its base, how `turn` works, which way Z swings a downward barrel, a recipe for a nose-down missile, deploying a tall robot. `turret-drone` is in the playbook's examples.
- Run report additions it asked for: each rotator's aim in degrees every second, and the robot's tilt on every decoupler event.
- Open, carried forward: (1) the fast hover (`missile-drone-10prop.hover.js`) overshoots leaning toward a load that has swung off center (74 degrees at a 60 degree lean) and falls short leaning away; the turret drone uses a gentler lean for now. Its guess at the cause (the turn planner assumes full torque while some is spent holding the weight) needs checking. (2) Logan: a missile fired at a downward angle falls well below its line before recovering, slowly: the guide holds its heading and cancels drift but does not steer back to the line. Homing and Javelin guidance (steering toward a point) replace this in M8.

Gate 6 closed (Logan, 2026-09-25): everything is working.

### 7. Missile v2: steer back onto the line (Logan's idea, done)
- Logan: the missile knows its position and heading at launch, so it can project a line and correct for how far it is off it, not only for drift.
- `missile-v2` does that (a spring on the distance off the line, v1's damper on drift). From a turret 60 m up: flat shot ends about 1 m off its line (v1: 4 m low); 30 degrees below level recovers from 4 m low to 2.5 m (v1 stays 5 m low). Stiffer settings made the flat shot swing wide or dive (the missile's 40 N m gyro turns its nose too slowly for a tighter loop). Both still sag in the first second, while the missile has no speed; a stronger gyro, or aiming the thrust above the line at release, would help, and M8's homing and Javelin guidance build on the same idea. `missile` (v1) is unchanged, so every placed copy is too.

