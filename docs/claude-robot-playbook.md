# Claude robot playbook

For a Claude Code session asked to build a robot in plain words ("build me a drone with missiles"). Read `CLAUDE.md` first (no em dashes, bullets, push back when Logan is wrong), then this. You do not need `START-HERE.md`, `status.md`, or the milestone plans. You build blueprints as files, test them headless with `pnpm sim`, and hand Logan something that validates, does what was asked in the sim, and works when Logan opens it in the builder and deploys it, with no manual editing.

## The loop
1. **Understand the ask.** If it is vague ("a cool robot"), ask one or two questions with a recommendation each. If it is clear ("a car that climbs the ramp"), go.
2. **Look at what exists.** `ls blueprints/`, then `pnpm sim show <name>` on the closest example (see Examples). `pnpm sim parts` prints every part with its numbers. Copying a working example beats starting blank.
3. **Design on paper first.** Mass, thrust or torque against weight, energy for the run, where the center of mass sits. The numbers are below.
4. **Write the blueprint** to `blueprints/<name>.json` (scripts in `blueprints/<name>.<id>.js`).
5. **`pnpm sim validate <name>`.** Fix every error; the messages name the part and cell.
6. **`pnpm sim show <name>`.** Check the grid came out as you meant, the mass, the body count (each wheel and rotator is its own body), and every core's controls.
7. **`pnpm sim run <name>` with keys** that do what Logan would do. Read the events and the side view (below). Did it do the thing?
8. **Change one thing, run again.** Keep the runs that answer a question; do not tune blind.
9. **Finish:** `pnpm sim determinism <name> <same flags>` passes, the blueprint validates with no warnings you cannot explain, and you tell Logan how to fly it (keys, what to try, what to watch for).

All commands run from the repo root. `<bp>` is a name in `blueprints/` or a path to any `.json` file, so drafts can live in your scratchpad until they work.

## Commands
- `pnpm sim parts`: every part: builder key, legend tokens, mass, health, attach faces, power, and what it does. `--json` for data.
- `pnpm sim show <bp>`: grid, legend, mass, center of mass, bodies, every core's controls.
- `pnpm sim validate <bp>`: validator issues; exit 1 on errors.
- `pnpm sim run <bp> [flags]`: simulate and report.
  - `--x <n> --y <n>`: where the core lands (default: the world spawn at (0, 6)). Spawn in open ground, like `--x -100 --y 3`; the flat world's boxes are near x 0 to 18.
  - `--seconds <n>` (default 5), `--seed <n>`.
  - `--keys "d:0-3, w:5, f:6.5"`: keys on the spawned robot, in seconds. `k:a-b` holds from a to b; `k:t` taps once. Keys only reach the spawned robot (A), never a missile after it is released.
  - `--drop <bp>@<t>:<x>,<y>`: spawn another blueprint mid-run (a target `wall`, a `bomb`). Repeatable.
  - `--unlimited`: energy never runs out. `--json`: the whole report as JSON.
  - `--world <path>`: another world file (`worlds/flat.json` is the default).
- `pnpm sim determinism <bp> [run flags]`: runs twice, compares hashes.
- `pnpm sim place <target> <source> --at x,y [--rot 90] [--mirror] [--save <name or path.json>] [--force]`: copies `source` onto `target` with its core (else its first part) at cell (x, y). See Placing.
- `pnpm sim mirror <bp> [--axis <half cells>] [--save <name or path.json>] [--force]`: flips left to right in place.
- `place` and `mirror` print the blueprint's JSON on stdout (scripts inline) and their notes on stderr, so `> draft.json` captures a clean file. Better: `--save drafts/x.json` writes the blueprint and every script as files there (`x.hover.js`, `x.missile1.guide.js`); `--save x` writes them into `blueprints/`.
- Every command takes `--help`.

## Reading a run report
- **Once per second:** robot A's core position, tilt in degrees (counterclockwise positive), speed, resting.
- **drive / energy / destruction:** distance, max altitude (the core's highest y; the ground is y 0, so a high spawn counts), max tilt, top speed; energy used and left; parts destroyed and blasts. While attached, a placed missile's core and cell share the robot's energy pool (the pilot drains them too), so a drone with two missiles shows a bigger capacity until they leave; each piece's own energy is in the pieces list.
- **events:** everything in time order with the robot's letter. A is the spawned robot; B, C, ... are pieces that broke off (missiles) and drops, in the order they appeared. Keys, drops, decouplers firing, splits, a core waking with its keys and scripts, scripts turning on or off, parts lost, explosions, `log()` lines (a repeated line is folded: "and 40 more times until t=3.20"), script crashes, energy running out.
- **pieces:** each letter's final state, or "gone at t=..., last seen at (x, y)". Pieces with no core are counted at the end.
- **side view:** lowercase letters are each piece's core path (every 0.1 s), uppercase its parts where it ended (so a dropped wall shows its shape), `*` an explosion, `#` the ground and boxes where they started. The header gives the scale of a column and a row; they differ, so slopes look steeper or flatter than they are.
- A piece that keeps flying after its core died is debris (a blown missile's thruster and gyro); its path can arc up after the blast.

## Blueprint format
```json
{
  "format": 1,
  "name": "hopper",
  "grid": [
    "F  T^ C  B  T^ F",
    "W  .  .  .  .  W"
  ],
  "legend": { "W": { "part": "wheel", "tags": ["wheels"] } },
  "bindings": [{ "key": "j", "mode": "hold", "target": "thruster", "channel": "throttle", "value": 1 }],
  "scripts": [{ "id": "hover", "enabled": false, "params": { "climb": 2 }, "source": { "file": "hopper.hover.js" } }]
}
```
- **Grid:** one cell is 1 m. The first row is the top; the bottom row is y 0, the left column x 0. Tokens are separated by spaces, `.` is empty. Parts get ids `<part>@<x>,<y>` (`wheel@0,0`), and every part answers to its id and its part type (`thruster`) as well as its tags.
- **Default legend** (arrows point the way the part acts): `C` core, `F` frame, `B` battery, `E` cell, `X` warhead, `G` gyro; `W` wheel hanging below what it mounts to (`W^` above, `W<` on the left side, `W>` on the right); `T^ Tv T< T>` thrusters pushing up, down, left, right; `P` propeller lifting up (`Pv` down); `D Dv D< D>` decouplers releasing up, down, left, right; `R Rv R< R>` rotators carrying their turret up, down, left, right. A thruster pushing right sits on the left end of a robot (`T>`).
- **Legend entries** `{ "part", "rot", "tags", "auto" }` define your own tokens (lowercase letters are free). `rot` is 0, 90, 180, 270 counterclockwise. `"auto": false` takes a part off auto controls (do this for every part a script drives, or the auto keys fight the script).
- **Attachment:** parts join through faces that touch (`pnpm sim parts` lists them). A wheel attaches only by its mount face; a propeller has no N face (nothing on top of it); a thruster has no S face (its nozzle). Everything must connect to the core.
- **Tags** group parts for bindings and scripts: `"tags": ["lprop"]`.
- **`primaryCore` and `cores`** appear once something is placed: `primaryCore` names the pilot, and `cores` holds each placed copy's controls under its core's id with its scope (`"core@3,0": { "scope": "missile1", "bindings": [...], "scripts": [...] }`). You may edit them by hand like the top-level ones; targets inside a scoped entry mean that copy's parts.
- **Auto controls** (on unless `"autoControls": false`): wheels get D and A, thrusters and propellers the key for the way they push (W up, S down, D right, A left), gyros E and Q, rotators Z and X. Most robots need no bindings at all for driving.
- **Bindings:** `{ key, mode, target, channel, value }` with `mode` `hold` (while held), `toggle` (press on, press off), `pulse` (one tick: decouplers, warheads), or `{ key, "mode": "script", "script": "<id>" }` to turn a script on and off. Keys are one lowercase letter or digit; avoid the auto keys unless you mean to add to them. Two writers on one channel add and clamp; a key held by the player beats a script on the same channel.
- **Scripts:** `{ id, enabled, params, source: { file } }`. `enabled` defaults to true (the script runs from deploy, and its key turns it off). The file sits next to the blueprint, named `<blueprint>.<id>.js`.

## Script API
Scripts run every tick (60 per second) before the parts act. Plain JavaScript, sandboxed, deterministic.
```js
const lean = param('lean', 0.3, { min: 0, max: 1 }); // tunable; the value can be set in the blueprint's params

function setup() { state.target = self.pos.y; } // once, when the script starts (deploy, its key, or its core waking)

function tick() {
  if (keys.down('w')) state.target += 3 * dt;
  const err = state.target - self.pos.y;
  set('props', 'throttle', clamp(0.6 + 0.15 * err - 0.25 * self.vel.y, 0, 1));
}
```
- `self`: `{ pos: {x, y}, vel: {x, y}, angle, angVel, mass, energy: { stored, capacity } }` of the script's core and its piece. Angles in radians, counterclockwise positive, 0 as built.
- `parts`: `[{ id, type, tags, pos, angle, mass, in, out }]` for every part in the piece still attached: `pos` and `angle` in world coordinates, `mass` in kg, `in` the input channels, `out` the outputs like a decoupler's `armed`.
- `set(target, channel, value)`, `get(target, channel)`: target is a tag, a part type, or an id.
- `keys.down(k)`, `keys.pressed(k)` (this tick only), `keys.released(k)`.
- `state` (kept between ticks), `dt`, `time`, `frame`, `param()`, `log(...)` (up to 20 lines per second per robot; the run report shows them), `random()`, `clamp`, `lerp`, `sign`, `Math`.
- No `world`, no other robots, no sensors yet: a missile cannot home. It can only fly a line.
- Signs that trip people: a gyro's `spin` is clockwise positive (the opposite of `self.angle`); a rotator's `angle` output is -1 to 1 of its range.
- Name parts by tag or type in scripts, never by id: ids change when a blueprint is placed or mirrored.

## Numbers that matter
Run `pnpm sim parts` for the full table. g is 9.81.
- **Mass (kg):** core 2, frame 1, battery 3, cell 0.5, wheel 1.5, thruster 1, propeller 1, decoupler 1, warhead 1, gyro 1, rotator 1.5.
- **Push:** thruster 160 N (20 J/s), propeller 120 N (10 J/s), both along their arrow (Gate 6: Logan raised both). Lift must beat weight: a flier needs thrust-to-weight well above 1 (1.5 to 2 hovers with room to climb; the missile flies at about 3). Propellers only push along their arrow; a drone moves sideways by leaning.
- **Turning:** a gyro gives 40 N m. That is plenty for a small robot and far too little for a wide heavy one: a 38 kg, 11-wide drone needs its left and right propellers throttled differently to lean (see `missile-drone.hover.js`). Rotators hold 600 N m and turn at most 2 rad/s, within plus or minus 90 degrees.
- **Wheels:** 20 N m each, radius 0.45 m, grip friction 1.5. The stock car (12 kg, two wheels) does about 15 m/s and climbs the flat world's ramp.
- **Energy:** core 600 J, battery 1500 J, cell 250 J. Draw at full input per second: thruster 20, propeller 10, wheel 5, gyro 5, rotator 3. The 6-propeller missile drone uses about 30 J/s hovering, about two minutes on two batteries. Out of energy, nothing moves.
- **Damage:** a warhead does 120 at its center falling to 0 at 3 m, halved by every part in the way, and pushes things away up to 5 m. Health: frame 60, core 50, battery and decoupler and gyro 30, thruster and wheel 25, warhead 20, propeller 15, cell 10. A core right next to a warhead dies.
- **Fuze:** a warhead goes off when a hit changes its speed by more than 5 m/s in one step: a fall of about 1.3 m, a landing, a missile clipping a box. A robot with a warhead must not be deployed high in the air or land hard.

## Placing one blueprint on another
- `pnpm sim place launcher-base missile --at 8,6 --save launcher` copies `missile` onto the base with the missile's core at cell (8, 6). The copy is ordinary parts of the new robot; editing `missile.json` later changes nothing already placed.
- `--at` is where the source's root lands after `--mirror` and `--rot` (the flip and the turn happen around it). A bottom row or left column of dots in the target is allowed, as room to place into.
- If the target has a core, the copy gets a scope `missile1` (then `missile2`): its parts get the tag `missile1`, its own tags become `missile1.<tag>`, and its bindings and scripts move to its core's entry in `cores`. They stay asleep while attached and start when its piece breaks off (a decoupler fires, or a blast cuts it free). Inside the missile's own controls, `thruster` means that missile's thruster only.
- The robot's own controls reach the copy's parts by part type or id (`decoupler`, `thruster@3,0`) or by the scope tag (`missile1`). Tag the robot's own parts (`left`, `right`) so its controls never grab a missile's parts by type.
- Parts must not overlap. Leave an empty row or column of dots where the copy goes if it would land below row 0 or left of column 0; otherwise the file falls back to the long `parts` form (`place` says so).
- Logan does the same in the builder: the palette's Blueprints section holds a copy (R turns, F flips), and the Controls and Scripts panels have a Controls for picker for each placed core.
- `--save <name>` writes the blueprint and a copy of every script under the new name (`launcher.missile1.guide.js`). `--force` replaces an existing file.

## Turrets (rotators)
Learned building `turret-drone` (Gate 6); most of a turret's design time goes to this geometry.
- `R` carries its turret up and mounts on the part below; `Rv` hangs from the part above and carries its turret down; `R<` and `R>` sideways. Everything touching its other faces turns with it as one separate body.
- The hinge is the rotator's cell center.
- The turret and the body it is mounted on do not collide: a swinging arm passes through its own robot and never jams. Other robots, broken-off pieces (a released missile included), and the ground do collide.
- It swings plus or minus 90 degrees from how it was built. Its `turn` input is a rate (-1 to 1, at most 2 rad/s, slower for heavy turrets: about sqrt(0.2 x 600 / inertia) rad/s); with no input it holds its aim. Its `angle` output reads -1 to 1 of its range.
- Auto keys: Z turns it counterclockwise, X clockwise. For a turret pointing up, Z swings the barrel left; for one hanging down (`Rv`), Z swings it right. To have Z mean left on a downward turret, take the rotator off auto controls and drive `turn` from a small script (`turret-drone.turret.js`).
- A decoupler on the turret turns with it, and so does its release direction. A missile leaves along the turret's aim plus the robot's tilt: level off before firing for a clean shot.
- Recipe, a missile pointing down: keep the missile in the hinge column (below the rotator, through a short leg), gripped from the side by a decoupler beside its thruster. The thruster's nozzle faces up and cannot attach, so nothing can hold it from above. Off the hinge column, a full swing puts the missile on the arm or the body and the decoupler pushes it into them.
- The run report shows each rotator's aim in degrees every second (`aim rotator@3,5 -90.0`, counterclockwise positive from how it was built) and the robot's tilt on every decoupler event.

## Examples to start from
- `car`: two wheels on a frame, auto controls only. D and A drive.
- `drone` + `drone.hover.js`: five-wide hover drone; the hover script owns the propellers (`auto: false`), W and S set the height, A and D lean with a gyro.
- `missile` + `missile.guide.js`: `M g E C X` (thruster at the tail, gyro, cell, core, warhead at the nose). The guide steers the thrust so it holds the line it was released on and cancels gravity; it detonates after `fuse` seconds (10). It flies nose-up about 20 degrees, so its tail hangs about 1 m below its core. Its `thrust` param must match the thruster's force (160). It holds its heading and cancels sideways drift, but does not steer back onto the line it was released on: a shot at a downward angle sags below its line at first and recovers slowly.
- `missile-v2` + `missile-v2.guide.js`: the same missile, but it steers back onto the line it was released on: it cuts back toward the line as fast as it can still stop on it (v^2 = 2 a d, at most `cut` degrees across its path, easing in over the last meter, param `ease`), and turns its nose time-optimally with its gyro (full torque, braking just in time, inertia from its parts). Flat shots from a turret sag about 6 m in the first 1.5 s (no speed yet, the nose still turning), then settle within 1 m by about 3.8 s with 1 to 2 m of overshoot; v1 never returns to its line. A firmer drift damper (`hold` 3 or more) makes it swing wide. Place it like `missile`. `launcher-v2` and `turret-drone-v2` are the launcher and the turret drone with v2's guide on their missile.
- `launcher`: a car with a rotator turret and a `missile` hanging under a `Dv` rail. Z and X aim, F fires (a pulse on every `decoupler`).
- `turret-drone`: a drone with one missile on a turret hanging below it, nose down, aiming anywhere from left through down to right (Z left, X right, C back to straight down, F fires). Built by a fresh session from this playbook (Gate 6). Its hover is `missile-drone-10prop`'s at a gentler lean (50 degrees) because of the known issue below.
- `missile-drone-10prop`: the same with 10 propellers, leaning to 50 degrees (param `lean`, in degrees). Its hover is the best example of fast, stable control: it works out its moment of inertia and full turning torque from `parts`, spins toward the lean at full torque and brakes at the last moment (v squared = 2 a d), cancels an off-center weight at once, and divides the throttle by the cosine of the tilt to hold height while leaning.
- `missile-drone`: 11 wide, 6 propellers, two missiles under `left` and `right` rails. Its hover leans by propeller throttle and learns its trim when a missile is gone; `missile-drone.fire.js` fires the right missile first on F, then the left.
- `longcar`, `bomb`, `wall`: targets and drop tests (`--drop wall@0:-80,5.5` puts a wall 20 m in front of a robot at x -100).

## Traps (learned the hard way)
- **A script's key turns it off.** Scripts start on; the H binding toggles. Pressing H "to start the hover" turns it off (the report shows "script hover turned off").
- **A thruster cannot sit on top of a frame.** Its nozzle side attaches to nothing, so `T^` goes in the body row beside other parts (see `hopper`), and a propeller (`P`) sits on top with nothing above it.
- **Auto controls fight scripts.** Mark every part a script drives `"auto": false`.
- **Missiles on a rail:** hang them under a `Dv` rail. A missile resting on top of a tilted rail slides off the end.
- **Heavy turrets tip cars.** Keep the turret's weight near its hinge and give the car a long base.
- **Missiles need drop room.** A flat shot sinks about 3 m before it levels out, and its tail hangs lower still: fire from at least 5 m up, higher over boxes.
- **Wide fliers wobble** on gyros alone. Lean with differential propeller throttle and damp with the angular speed.
- **Tuning a hover** (both loops are a spring and a damper, so pick them from the robot's numbers instead of guessing):
  - Height: throttle `base + kp * err - kd * vel.y`. The force per unit of throttle is F = total lift (N); with mass m, `kp = m * w^2 / F` and `kd = 2 * m * w / F` settle in about 4 / w seconds (w of 1.5 to 2 feels right).
  - Lean: left and right throttle differ by `k * off - c * angVel`. Torque per unit of difference is T = sum over props of (lift x |distance from the core column|); with I about m * width^2 / 12, `k = I * w^2 / T` and `c = 2 * I * w / T`.
  - Weight off center (a missile gone from one side): compute it instead of learning it. The pilot's `parts` list is what is still attached, with world positions; the torque of their weight about the core is known, so feed the differential that cancels it straight away (each entry in `parts` has its `mass`).
  - Then a slow integral (a trim that creeps toward what holds level) for what is left: gain about 0.05 per radian second. Higher (0.4) winds up during a held lean and the drone swings and will not settle.
  - `param()` the gains so Logan can tune them in the builder.
- **The second shot goes where the drone points.** Losing one missile shifts the weight and tilts the drone until its trim catches up (a few seconds). A missile released while the drone is tilted flies along that tilt, into the ground if the tilt is down. Wait for level, or fire both together, or balance the load (one missile each side facing opposite ways fires in any order).
- **A graze does not fuze a warhead.** The fuze needs a 5 m/s change in one step; a missile that glances off the ground slides on, armed. Check the pieces list: a piece at y about 0.5 is on the ground.
- **Name your own parts by tag in the robot's scripts.** `set('gyro', ...)` from the pilot also turns any attached missile's gyro (types reach every part). Tag the robot's own gyro (`stab`) and use the tag.
- **Keys in the app:** keys go to the robot Logan controls. After a missile is released the player stays on the launcher; `,` cycles to other robots they can control, and clicking a robot takes it, so a missile's own keys (`x` detonate) work only after switching to it. Headless, `--keys` reach robot A only.
- **Fire order:** when two missiles hang side by side pointing the same way, fire the front one first, or the back one flies through it.
- **Spawn in the open.** `worlds/flat.json`: a 2 by 2 m box from x 7 to 9, the ramp (a 6 by 1 m box tilted 18 degrees, x 12 to 18, top about 1.9 m), a 1 by 1 m box from x -8.5 to -7.5, and ground from x -500 to 500. Open ground: x below -10 or between 20 and 490. In the app Logan deploys wherever they click, so a robot for the ramp can start anywhere left of it; headless, the gap between the 2 m box and the ramp is only 3 m (x 9 to 12), so a car tested there must be at most about 5 wide with its rear edge past x 9, or spawn at x 20 and drive left.
- **Energy.** Check `energy:` in the report; fliers run dry in tens of seconds on one battery.

- **Deploying in the app:** the robot lands where Logan clicks, and no part may be below the ground. A tall robot can stand on a missile's nose (a warhead only goes off on a hit of more than 5 m/s).
- **Known issue, the fast hover with a load that moves:** `missile-drone-10prop.hover.js` (and `turret-drone`'s copy) overshoots when it leans toward a heavy side that has swung off center (74 degrees at a 60 degree lean) and falls short leaning away. Use a gentler `lean` and `brake` until it is fixed.

## Done checks for common requests
- **Drives:** `run --keys "d:0.5-4.5"` gives drive distance well over 20 m, max tilt under 30, and it ends upright (`tilt` near 0).
- **Climbs the ramp:** the flat world's ramp is a 6 by 1 m box tilted 18 degrees, centered at (15, 0.45): it rises from x 12 to about 1.9 m at x 18 and drops off sharply there. Spawn at `--x 10 --y 1.5`, hold D; max altitude goes above 2.5 and it ends past x 25 upright.
- **Hovers:** the core holds a height within about 0.5 m for 5 s after the climb, tilt within a few degrees, energy left at the end.
- **Fires:** the events show the decoupler firing, a piece breaking off and waking with its script, and its path in the side view going where it should.
- **Hits a target:** `--drop wall@...` and the events show the explosion belonging to the missile's letter, and the wall losing parts or knocked over (its tilt in the pieces list).
- Always: `pnpm sim determinism` with the same flags passes.

## Handing it to Logan
- Leave the blueprint and its scripts in `blueprints/`; delete scratch drafts. Commit only if Logan asked.
- Tell Logan: the file name, the keys (from `show`), the command you tested with and what it showed, and anything that is only roughly right. It opens from the builder's blueprint dropdown and deploys it.
