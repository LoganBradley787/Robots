# 11 Control

Status: decided with Logan, 2026-09-23 (before the M3 plan). Adds to `04`; where they differ, this doc wins.

## Possession
- Deploying a robot puts it under your control, and the camera follows it.
- `,` re-follows if the camera was panned away. Otherwise it moves control and camera together to the next robot you can control.
- Clicking a robot in the world takes control of it. A click is a press and release that moves less than a few pixels, so it never fights drag-to-pan.
- Only robots with a core can be controlled. Core-less robots (a dropped bomb, later) are skipped.
- (M8, Logan) Only your own team's robots. Enemies are tinted red, skipped by `,`, and a click on one follows it with the camera without taking control.
- (Logan, 2026-10-22) Any robot can be clicked and inspected, an enemy included: the camera follows it and the readout (`10`, The live readout) shows its position, speed, energy, parts and mass, its scripts and their last log lines. Another team's robot is tagged with its team's name in its color in the readout and the time panel, and is only watched: no keys show, nothing drives it. The keys bar shows the followed robot's energy, and its keys only when you control it. The world keeps each robot's last 20 log lines (`World.logsOf`), so in a fight of hundreds of scripted robots the followed one's lines are still there.
- You control one robot at a time. Its keys are the robot's own bindings; letters and digits belong to the robot, world keys are punctuation (`04`).

## Robots you stop controlling hold their last input (Logan)
- When control moves away, the robot keeps whatever it was doing. Keys held at that moment stay held, toggles stay as they are. A car you leave while holding D keeps driving off.
- This is the same latching `04` gives headless chunks, applied to every robot nobody controls.
- To park a robot, let go of its keys before switching.
- Claude's call: the robot you switch to starts with no keys held. A key you were already holding only counts once you press it again. Otherwise holding D and pressing `,` would drive both robots.
- Claude's call: losing window focus or switching to the builder releases every key on the controlled robot, so a key is never stuck down by a missed key-up.
- (2026-10-23) Clicking a robot you can only watch (an enemy, a core-less robot) releases every key on the robot you were driving too, the same way: it lets go of control without moving it to a robot of yours, and your robot should not drive off unseen while you watch. The releases are ordinary key edges, so the replay has them. Switching to another robot of yours still latches the old one, as above.

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
Wheel: `maxTorque` 20 N m, `motorFactor` 0.6 (full torque up to about 7.5 m/s), `maxSpeed` 50 rad/s (22.5 m/s at the rim), `coastTorque` 0.3 N m. Thruster `maxForce` 120 N, propeller 60 N. Part cells without their own friction slide at 0.3. Wheel friction 1.5, which Rapier averages with the ground's 0.5 to 1.0, rubber on pavement (Logan: "a little slippery for being rubber tires"; at 0.75 the wheels skidded at 8 m/s when braking with the opposite key, now 1 m/s).

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

## The world bar (M16, as built)
- A small bar in the middle of the bottom edge: Builder (Tab), the **Team** button, **Remove**, then two menus.
- **Team** shows which side the next robot you deploy joins: "Yours" in plain text; a click makes it "Enemy" in the enemy's tint (#ff8a80), a click again makes it Yours. Only these two. It sticks across deploys and reloads (`world/deploySettings.ts`). It has no key.
- **Remove** (orange, as everything that takes something away) arms a remove cursor, like holding a robot to drop. Pointing at a robot outlines all of it in orange (every body of it, its turrets and wheels too; a piece that broke off is a robot of its own); a click removes it, and the cursor stays armed for the next. Esc, a right click, or Remove again puts it away; so do Tab and picking a robot to drop. Any robot can go, one you control included: control is dropped, as when its core is lost. While armed, the line under the time panel says so and names the robot under the cursor.
- **View**: follow or next robot (,), home, grid (`), debug overlay (\), sound, volume, far sounds arrive late.
- **Sandbox**: unlimited energy, smoke and jammers do nothing, **Smooth: slow scripts may skip ticks** (off by default; kept across Reset world and across reloads, in local storage as `robots.smooth`; while on, the time panel says SMOOTH and the readout says how often the viewed robot's scripts run: "scripts 4.2 ms a run, runs 1 tick in 3"; `01`, Smooth), stress test (hovering drones 10, 25, 50, 100; a battle of 6 against 6), clear debris, remove far away, remove all of a team, save replay, reset world (it asks first).
  - **Smoke and jammers do nothing** (off by default, under Unlimited energy): smoke clouds block no sensor and weaken no laser, and jammers blind and hide nothing; both still go off and show. Flares still fool sensors. Like Unlimited energy it is logged (`world.noSmokeOrJam`), survives Reset world, and is not kept across reloads. `pnpm sim run`, `determinism` and `duel` take `--no-smoke-jam` for it (world files have no settings).
  - **Clear debris** removes every robot nobody can control: debris, robots that lost their core, bombs let go. A piece whose own core woke (a missile) has a controller and stays.
  - **Remove far from camera** removes every robot whose core (or, for a piece with none, its middle) is farther than 1, 2 or 5 km from the camera's center (the middle of the screen), so the fight you watch off to one side stays (Logan, 2026-10-22: it is for runaway missiles and robots that left the arena; it used to measure 250, 500 or 1000 m from the middle of the world, and took the robots he was watching). The distance is picked in the row (2 km at first) and kept in the browser; a saved choice that is gone (250, 500) reads as 2 km. The row says how many are past it now. A notice says how many went. The camera is not part of the sim: the replay holds the ids that went, never the distance.
  - **Remove all yours**, **Remove all Enemy**, **Remove all Blue** (`teamName`), each shown only while that team has robots, with the count. A piece keeps the team of what it broke off, so a team's debris and its missiles go with it. A notice says how many went.
  - Every removal goes through the world's input log (`World.removeRobots`, logged as `world.remove` with the ids that went, at the start of the next tick), so a replay removes the same robots. The screen picks the ids; the engine never names a team or a distance. The removed robots disappear from the screen at once, so a removal while paused shows.
- Every menu row shows its state now and its key. A row that only flips something leaves the menu open, so the new state shows. Esc or a press anywhere else closes a menu. Every world key works as before; the key caps on the bar are read from the world key table (`app/keys.ts`).
- **The time panel** (top left, after Kerbal Space Program's time warp; `ui/TimePanel.tsx`) always shows the clock, PAUSED while paused, the speed when it is not x1 (x1/4, x1/2, x2, x4), and who you control or watch ("controlling drone", "watching blue enemy-drone"), in the team's color when the robot is not yours. Hovering it, or the keyboard's focus in it, drops it down to Play or Pause (Space), Step (.), and five arrows, one per speed (1/4, 1/2, 1, 2, 4), lit up to the speed it runs at; a click on an arrow goes straight to that speed (`TimeControls.setScale`). `[` and `]` still step the speed down and up. A click on its buttons leaves no focus on them, so the panel folds when the mouse leaves and Space stays the world's key. The clock reaches the panel apart from the rest of the world's view, so only the panel redraws as it ticks.
- Under the panel: while a robot is held for dropping, a line says how to place it; with Debug on, the raw text (tick, hash, fps, timing, hints).
- **The 6 against 6 battle** puts team 1 (red, called Enemy) against team 2 (blue, called Blue). Neither side is yours, and a notice says so as it starts: "A battle: Red against Blue. Neither side is yours, so you only watch."
- The keys bar (below) sits just above the bottom bar: energy as a bar, then the keys as key caps. For a robot you only watch it shows the energy alone.

## Replays
- Every run in the world can be saved as a replay file: the world, every spawn, and every key press and release, by tick. `pnpm sim replay <file>` reruns it headless and checks it ends in the same state. This is how Logan can hand Claude a bug ("it flips when I do this").
- (M8) Each spawn carries its team; a replay saved before M8 plays as all team 0.
- (M16) Robots removed by hand are in the input log too (`world.remove: [ids]` on the tick they went); a replay without any reads exactly as before.
- (Smooth, 2026-10-19) Robots whose scripts sat out a tick are in the input log as `world.skip: [ids]` on that tick, so a replay of a Smooth fight reruns exactly (`pnpm sim replay` MATCHes: checked on a 2274-tick Anvil and 6 against 6 fight with 11,295 skips). A replay without any reads exactly as before; the format stays 1.
- The Sandbox rule Smoke and jammers do nothing is logged as `world.noSmokeOrJam: true` or `false` on the tick it changed; a replay without it reads exactly as before.

## Auto controls (Logan, 2026-09-23)
Binding every wheel by hand (Logan's `le-car`) is tedious, so robots control themselves by default:
- **On by default** for every blueprint, and derived from the parts whenever the robot is deployed, so a part added later just works. A blueprint can turn auto off entirely (`"autoControls": false`).
- **Per part:** any part can opt out (`"auto": false` on the part). 31 wheels on auto and one special wheel is one checkbox, not 31 bindings.
- **Wheels:** D drives right, A drives left, whatever the wheel's rotation. A wheel's forward is rolling toward +x.
- **Thrusters and propellers:** the key for the direction the part pushes. Up W, down S, right D, left A. So S fires down-facing propellers and top thrusters, and D fires right-pushing thrusters together with the wheels.
- Parts are data: which channel a part's auto control drives, and whether it is an axis (wheels) or follows the push direction (thrust), is in the part def (`autoControl`). The engine never names a part.
- Custom bindings sit on top (K for a warhead). Auto and custom writers on the same channel sum and clamp, like any two bindings.
- The builder shows every auto key where it acts: as a greyed row on the part's input, and as an outlined key on the drawn keyboard (see "Keys in the builder"). A click makes it yours.

## Keys in the builder (M16, as built)
Two places edit the same binding list. The file format (`key`, `mode`, `target`, `channel`, `value`, or `script`) and how bindings are arbitrated did not change. Every edit is one undo step; a slider drag is one step.

**Words.** The builder says "while held", "on and off" and "tap once". The file keeps `hold`, `toggle` and `pulse`. A value shows as a percent, with a sign only where the input goes both ways.

**Bind from the part (the Part tab).** Every input of the selected part is a row: its name, its range in plain words, a `+ key` cap, then everything that drives it today.
- Click `+ key`, press a key: a binding is made for this one part, while held, at the input's full value. Esc, or a click on the waiting cap, calls the wait off. A key the world keeps is refused with the reason and the wait goes on.
- A key of yours is a line with its cap (click it to change the key), what it does in a few words, and **who it drives** as a segmented control: this part, all parts of this kind, or one of the part's groups. While the pointer is on a choice, the parts it would reach light up on the board (the same blue as what a script drives).
- "more" on the line gives the mode, the value as a slider over the input's range, and remove.
- An auto key is a greyed line marked auto. A click makes it yours: auto goes off for that part and the keys the game gave it are written as plain bindings, so the robot drives exactly as before. One undo step.
- A script that writes the input is a line too; a click shows it in the Behaviors tab.
- A robot with several cores: the rows edit the keys of the core the Keys tab is on, and say so.

**The Keys tab.** A drawn keyboard: digits, letters, Space and the arrows, laid out like a keyboard, with the world's keys drawn where they sit.
- Keys are lit by owner: yours (solid yellow), auto (yellow outline), switches a script on and off (blue, with a bar under it), the world's (hatched, cannot be bound). A key bound in the file that is not drawn (`Semicolon`) is listed after the keyboard.
- A key that does two unrelated things has an orange corner. That is shown, never refused. Two things are unrelated when they are different inputs, or a script switch beside anything else. Keys only the game chose never count (D driving the wheels and a sideways thruster is how auto keys are meant to work).
- With no key picked, "Everything bound" lists every key and what it does. Resting the pointer on one lights up its parts.
- Click a lit key to see everything it does, one sentence a row ("F, tap once: all Launchers, fire 100%"). "more" on a row of yours changes who it drives (a group, a kind, a single part), which input, the mode and the value, or removes it. The cap moves it to another key. An auto row has "make them mine", which claims those parts (one binding for the whole kind when every part of the kind is claimed alike).
- Click a free key to add to it: pick what it drives (it takes that target's first input, while held, at full), or pick a script for the key to switch on and off.
- The whole-robot Auto keys switch is at the top with one line saying what the auto keys do.
- Several cores: a segmented control at the top picks whose keys you edit.

The logic is in `packages/app/src/builder/keys.ts` (pure, tested in `packages/app/test/keysUi.test.ts`); the rows are `ui/InputRows.tsx`, the tab is `ui/BindingsPanel.tsx`.

## Group tags
- Every part carries an implicit tag for its type (`wheel`, `thruster`, `propeller`), so "all wheels" is a binding target without tagging anything. User tags remain for finer groups.
- Channel values show as percent in the builder: `speed +100%` is full forward, `-100%` full reverse.

## Builder: part menu and eraser (Logan, 2026-09-23; changes `10`)
(M16: the floating part menu is gone; its contents are the inspector's Part tab, see `10`.)
- **Right-click a part** opens a small menu next to it, in the spirit of Kerbal Space Program's part menu. It edits the selection when the clicked part is selected (box-select 5 wheels, right-click one, all 5 change), else just that part. Contents: tags (add, remove, pick an existing group), auto controls on or off, rotation, delete. It replaces the side selection panel.
- **Erasing** is a tool: press `E` (or click the eraser in the palette) and left-click or left-drag to erase. Right-click no longer erases. Delete still removes the selection.

## Calls made while building M3 (Claude's, overturnable at Gate 3)
- Switching back to a robot that is still holding a key shows that key lit in the keys bar. Tap the key to let go of it (the press is ignored because it is already held, the release goes through).
- A new custom control starts on the first key that neither a custom nor an auto control uses, so it never doubles up on the wheels. Gate 2's "new controls default to D, then A" still holds when auto controls are off.
- Auto controls come first in each robot's binding list, so the keys bar shows W A S D before custom keys.
- M7: after the bound keys, a divider and the keys the robot's running scripts read (`keys.down('w')` found in their code), outlined dashed. A hover drone shows H, then W A S D. Clicking one presses it like the keyboard. A released missile's keys bar shows its own core's keys.
- The effect a part shows (flame length, propeller spin speed) follows its first input channel, so new parts get it from data.
- Right-click opens the part menu with any tool held; left-click with the eraser erases, one undo step per drag, mirrored in mirror mode.
- Robots are placed and clicked with direct collider tests (Rapier's query index lags behind new colliders).

## Gyro (Gate 3, Logan)
- A reaction wheel part for steering in the air. Q turns counterclockwise and E clockwise (auto controls, like KSP's roll keys), with a fixed torque per gyro (40 N m), so heavy robots need more gyros.
- With no Q or E it only damps spin: a small torque (at most 15 N m) that stops turning. It never levels the robot or holds an angle; Logan: that is a script's job, and a gyro that flies for you is no fun. A hard spin overpowers it.
- `damp` (0 to 1, default 1) turns the damping off with a custom binding. The keys an axis part uses and how the builder names its two directions are data in the part def (`autoControl.keys`, `autoControl.labels`).
