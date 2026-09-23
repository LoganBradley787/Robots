# 11 Control

Status: decided with Logan, 2026-09-23 (before the M3 plan). Adds to `04`; where they differ, this doc wins.

## Possession
- Deploying a robot puts it under your control, and the camera follows it.
- `,` re-follows if the camera was panned away. Otherwise it moves control and camera together to the next robot you can control.
- Clicking a robot in the world takes control of it. A click is a press and release that moves less than a few pixels, so it never fights drag-to-pan.
- Only robots with a core can be controlled. Core-less robots (a dropped bomb, later) are skipped.
- You control one robot at a time. Its keys are the robot's own bindings; letters and digits belong to the robot, world keys are punctuation (`04`).

## Robots you stop controlling hold their last input (Logan)
- When control moves away, the robot keeps whatever it was doing. Keys held at that moment stay held, toggles stay as they are. A car you leave while holding D keeps driving off.
- This is the same latching `04` gives headless chunks, applied to every robot nobody controls.
- To park a robot, let go of its keys before switching.
- Claude's call: the robot you switch to starts with no keys held. A key you were already holding only counts once you press it again. Otherwise holding D and pressing `,` would drive both robots.
- Claude's call: losing window focus or switching to the builder releases every key on the controlled robot, so a key is never stuck down by a missed key-up.

## Driving feel (Logan: heavy enough to feel like a machine, weight must matter)
Logan's words, summarized:
- Not too snappy. It should feel like driving a giant machine, but not so heavy that it is boring.
- A little spin-up, then more acceleration still available: robots can get going really fast, and then they are hard to stop. Braking with a thruster or propellers should be a real tactic.
- Weight has to matter. A car three times heavier must not accelerate the same. Stacking armor has a cost.
- A robot of 15 or more cells must still move properly. Big robots get more wheels.

What that becomes:
- A wheel is an electric motor with a torque curve: full torque from standstill up to a knee speed, then torque falls off toward a high top speed. Early acceleration is quick, the top end keeps building slowly.
- Acceleration is force over mass: each wheel adds a fixed push, so a heavier robot accelerates slower, and more wheels (or thrusters) make up for it. Top speed stays the wheel's top speed; heavier robots take longer to reach it.
- Letting go coasts. The wheel's motor goes nearly slack (a small rolling drag), so a fast robot keeps its momentum.
- Braking is pressing the opposite key (the motor pushes backward), or thrust. There is no automatic brake. Parked robots on a slope can roll.
- All numbers live in the part defs, so tuning never touches engine code.

### Tuned numbers (M3 T4, `pnpm sim tune`, flat ground, D held)
Wheel: `maxTorque` 12 N m, `motorFactor` 0.4 (knee near 10 rad/s), `maxSpeed` 40 rad/s (18 m/s at the rim), `coastTorque` 1 N m. Thruster `maxForce` 120 N (was 60: two could not lift a 14 kg car), propeller 60 N (was 40).

| robot | mass | 1.5 s | 4 s | 8 s | to 6 m/s |
|---|---|---|---|---|---|
| car (6 cells, 2 wheels) | 12 kg | 5.8 m/s | 12.1 | 16.1 | 1.6 s |
| heavy car (double) | 24 kg | 3.1 | 7.8 | 12.5 | 2.9 s |
| 14 frames, 2 wheels | 18 kg | | 5 s: 11.1 | | 5 m/s in 1.9 s |
| 14 frames, 4 wheels | 21 kg | | 5 s: 14.2 | | 5 m/s in 1.2 s |

- Coasting from 12 m/s loses 5% in 2 s. Holding A from 12 m/s stops the car in 2.9 s.
- The hopper (`blueprints/hopper.json`: two upward thrusters in the body row, 12 kg) is off the ground 0.2 s after W and climbs about 20 m in 2 s of holding: tap W to hop.
- A part in the wheel row rests on the ground: wheels are 0.45 m balls and a box cell reaches 0.05 m lower, so a thruster between the wheels drags. Put such parts one row up.

## On-screen keys panel (Logan)
- A small bar in the world shows every key the controlled robot has (bound or auto), as the key letter only: bind K and a K button appears. No descriptions, because one key can drive wheels, a propeller, and later a script, and no label can say all of that. A fuller "what does each key do" view can come later.
- A key lights up while it is held. A toggle key shows whether it is on.
- The buttons act as the keys: press and hold the button to hold the key, click to tap it. A toggle flips on the click.
- Editing controls stays in the builder.

## Replays
- Every run in the world can be saved as a replay file: the world, every spawn, and every key press and release, by tick. `pnpm sim replay <file>` reruns it headless and checks it ends in the same state. This is how Logan can hand Claude a bug ("it flips when I do this").

## Auto controls (Logan, 2026-09-23)
Binding every wheel by hand (Logan's `le-car`) is tedious, so robots control themselves by default:
- **On by default** for every blueprint, and derived from the parts whenever the robot is deployed, so a part added later just works. A blueprint can turn auto off entirely (`"autoControls": false`).
- **Per part:** any part can opt out (`"auto": false` on the part). 31 wheels on auto and one special wheel is one checkbox, not 31 bindings.
- **Wheels:** D drives right, A drives left, whatever the wheel's rotation. A wheel's forward is rolling toward +x.
- **Thrusters and propellers:** the key for the direction the part pushes. Up W, down S, right D, left A. So S fires down-facing propellers and top thrusters, and D fires right-pushing thrusters together with the wheels.
- Parts are data: which channel a part's auto control drives, and whether it is an axis (wheels) or follows the push direction (thrust), is in the part def (`autoControl`). The engine never names a part.
- Custom bindings sit on top (K for a warhead). Auto and custom writers on the same channel sum and clamp, like any two bindings.
- The builder's controls panel lists the auto controls as read-only lines, grouped by key, so it is visible what every key does.

## Group tags
- Every part carries an implicit tag for its type (`wheel`, `thruster`, `propeller`), so "all wheels" is a binding target without tagging anything. User tags remain for finer groups.
- Channel values show as percent in the builder: `speed +100%` is full forward, `-100%` full reverse.

## Builder: part menu and eraser (Logan, 2026-09-23; changes `10`)
- **Right-click a part** opens a small menu next to it, in the spirit of Kerbal Space Program's part menu. It edits the selection when the clicked part is selected (box-select 5 wheels, right-click one, all 5 change), else just that part. Contents: tags (add, remove, pick an existing group), auto controls on or off, rotation, delete. It replaces the side selection panel.
- **Erasing** is a tool: press `E` (or click the eraser in the palette) and left-click or left-drag to erase. Right-click no longer erases. Delete still removes the selection.
