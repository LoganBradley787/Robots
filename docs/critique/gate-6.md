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
- **Missiles**: a flat shot sinks about 3 m before it levels out; a straight-up shot sags about 15 degrees past vertical; they fly nose-up about 27 degrees, so their tail hangs low. No homing (sensors are Q22, open).
- **Missile drone**: after the first shot it tilts up to about 8 degrees and settles in about 3 s, because its hover learns the new balance. The second dry run's drone computed its balance from the part list instead and held 0.5 degrees; the stock drone could do the same if you want it steadier.
- **Placed missiles share the robot's energy** while attached (their cores and cells are in the robot's pool, and the hover drains them).
- The builder at under about 1100 px wide: the side panels cover the grid (known since M2).

## Findings
(none yet)
