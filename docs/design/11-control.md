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

### Tuned numbers (Gate 3, after the switch to multibody joints and Logan's "the torque is too low", `pnpm sim tune`, flat ground, D held)
Wheel: `maxTorque` 20 N m, `motorFactor` 0.6 (full torque up to about 7.5 m/s), `maxSpeed` 50 rad/s (22.5 m/s at the rim), `coastTorque` 0.3 N m. Thruster `maxForce` 120 N, propeller 60 N. Part cells without their own friction slide at 0.3.

| robot | mass | 1.5 s | 4 s | 8 s | to 6 m/s |
|---|---|---|---|---|---|
| car (6 cells, 2 wheels) | 12 kg | 8.6 m/s | 16.2 | 18.7 | 1.05 s |
| heavy car (double) | 24 kg | 5.1 | 11.8 | 16.6 | 1.8 s |
| car with one wheel, body dragging | 11 kg | | 1 s: 2.3, 6 s: 11.0 | | 2.7 s |

- Why 20 N m: at 12 a one-wheel car dragging its body did 0.8 m/s after 1 s ("maxed out at 2 mph"). Above about 20 a single wheel slips at its grip limit, so more torque buys nothing there.
- Coasting from 16 m/s loses 15% in 2 s. Holding A from there stops the car in 2.6 s.
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

## Calls made while building M3 (Claude's, overturnable at Gate 3)
- Switching back to a robot that is still holding a key shows that key lit in the keys bar. Tap the key to let go of it (the press is ignored because it is already held, the release goes through).
- A new custom control starts on the first key that neither a custom nor an auto control uses, so it never doubles up on the wheels. Gate 2's "new controls default to D, then A" still holds when auto controls are off.
- Auto controls come first in each robot's binding list, so the keys bar shows W A S D before custom keys.
- The effect a part shows (flame length, propeller spin speed) follows its first input channel, so new parts get it from data.
- Right-click opens the part menu with any tool held; left-click with the eraser erases, one undo step per drag, mirrored in mirror mode.
- Robots are placed and clicked with direct collider tests (Rapier's query index lags behind new colliders).

## Gyro (Gate 3, Logan)
- A reaction wheel part for steering in the air. Q turns counterclockwise and E clockwise (auto controls, like KSP's roll keys), with a fixed torque per gyro (40 N m), so heavy robots need more gyros.
- With no Q or E it only damps spin: a small torque (at most 15 N m) that stops turning. It never levels the robot or holds an angle; Logan: that is a script's job, and a gyro that flies for you is no fun. A hard spin overpowers it.
- `damp` (0 to 1, default 1) turns the damping off with a custom binding. The keys an axis part uses and how the builder names its two directions are data in the part def (`autoControl.keys`, `autoControl.labels`).
