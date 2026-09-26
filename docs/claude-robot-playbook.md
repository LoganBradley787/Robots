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
  - `--drop <bp>@<t>:<x>,<y>[:enemy][:flip][:rot90]`: spawn another blueprint mid-run (a target `wall`, a `bomb`). Repeatable. `:enemy` puts it on the other team (so sensors call it an enemy), `:flip` deploys it facing the other way, `:rot90` (or 180, 270) turns it.
  - `--team enemy`, `--flip`, `--rot <deg>`: the same for robot A.
  - `--unlimited`: energy never runs out. `--json`: the whole report as JSON.
  - `--world <path>`: another world file (`worlds/flat.json` is the default).
- `pnpm sim determinism <bp> [run flags]`: runs twice, compares hashes.
- `pnpm sim bench [hover|big|battle|debris] [--n <count>]` (M9): ms per tick on this machine for fixed scenes (1 to 100 hovering drones, one `flying-silo`, an enemy drone battle), split into scripts and the rest. For checking that a script or a change did not get slow.
- `pnpm sim place <target> <source> --at x,y [--rot 90] [--mirror] [--save <name or path.json>] [--force]`: copies `source` onto `target` with its core (else its first part) at cell (x, y). See Placing.
- `pnpm sim mirror <bp> [--axis <half cells>] [--save <name or path.json>] [--force]`: flips left to right in place.
- `place` and `mirror` print the blueprint's JSON on stdout (scripts inline) and their notes on stderr, so `> draft.json` captures a clean file. Better: `--save drafts/x.json` writes the blueprint and every script as files there (`x.hover.js`, `x.missile1.guide.js`); `--save x` writes them into `blueprints/`.
- Every command takes `--help`.

## Reading a run report
- **Once per second:** robot A's core position, tilt in degrees (counterclockwise positive), speed, resting.
- **drive / energy / destruction:** distance, max altitude (the core's highest y; the ground is y 0, so a high spawn counts), max tilt, top speed; energy used and left; parts destroyed and blasts. While attached, a placed missile's core and cell share the robot's energy pool (the pilot drains them too), so a drone with two missiles shows a bigger capacity until they leave; each piece's own energy is in the pieces list.
- **events:** everything in time order with the robot's letter. A is the spawned robot; B, C, ... are pieces that broke off (missiles) and drops, in the order they appeared. Keys, drops, decouplers firing, splits, a core waking with its keys and scripts, scripts turning on or off, parts lost, explosions, `log()` lines (a repeated line is folded: "and 40 more times until t=3.20"), script crashes, energy running out.
- **Sensors and messages** (M8) are events too: "A sees B (enemy)", "C lost sight of B" (first sight and loss per pair), "A sent core@8,6 (missile1): {...}", and on waking how many messages wait in the core's inbox. `time per tick` shows how long the run took per tick (scripts are most of it; the browser has 16.7 ms).
- **pieces:** each letter's final state (with `[enemy]` for the other team, and the last point its scripts marked), or "gone at t=..., last seen at (x, y)". Pieces with no core are counted at the end.
- **side view:** lowercase letters are each piece's core path (every 0.1 s), uppercase its parts where it ended (so a dropped wall shows its shape), `*` an explosion, `@` a point a script marked, `#` the ground and boxes where they started. The header gives the scale of a column and a row; they differ, so slopes look steeper or flatter than they are.
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
- **Default legend** (arrows point the way the part acts): `C` core, `F` frame, `B` battery, `E` cell, `X` warhead, `G` gyro; `W` wheel hanging below what it mounts to (`W^` above, `W<` on the left side, `W>` on the right); `T^ Tv T< T>` thrusters pushing up, down, left, right; `P` propeller lifting up (`Pv` down); `D Dv D< D>` decouplers releasing up, down, left, right; `R Rv R< R>` rotators carrying their turret up, down, left, right; `S^ Sv S< S>` seekers looking up, down, left, right; `O` radar; `K^ Kv K< K>` boosters; `H` heavy warhead; `Y` heavy gyro; `Z` dense battery. A thruster pushing right sits on the left end of a robot (`T>`).
- **Legend entries** `{ "part", "rot", "tags", "auto", "armed" }` define your own tokens (lowercase letters are free). `rot` is 0, 90, 180, 270 counterclockwise. `"auto": false` takes a part off auto controls (do this for every part a script drives, or the auto keys fight the script). `"armed": true` starts a warhead armed (M10, below).
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
- `contacts` (M8): every robot this robot's sensor parts see this tick, nearest first: `{ id, side, core, pos, vel, center, mass, parts, distance, by }`. `side` is `enemy` (another team), `friend`, or `none` (debris, or a robot whose core is gone); `core` is whether it has a live core; `pos` is its core's (its center of mass's without one) and `vel` the velocity of the body its core is on; `by` lists the sensor parts that see it. Empty with no seeker or radar.
- `scan(id)`: a seen robot's parts `[{ id, type, pos, angle, health, maxHealth }]`, or null if it is not seen this tick. At most 4 calls per script per tick.
- `send(to, data)`: a message for a core still attached to this robot, named by its scope (`missile1`), a tag, or its part id. `data` is anything JSON, up to 1 KB; up to 16 calls per script per tick and 32 per robot. It arrives next tick.
- `inbox`: messages that arrived, `[{ from, tick, data }]`, shown once. A placed core that is still attached keeps its messages until it wakes, so its `setup()` reads what the launcher sent just before letting go.
- `mark(x, y, label)`: a point drawn in the app's debug overlay and the run report's side view (up to 4 per tick). For showing where a script is aiming.
- `parts` entries are the same objects every tick (M9), with their numbers (`pos`, `angle`, `in`, `out` values) updated in place. They are sealed: `id`, `type`, `tags`, `pos`, `mass`, `in`, `out` cannot be replaced, no key can be added or deleted (ignored, or a TypeError under `'use strict'`), and `tags` is frozen. Treat them as read-only and copy what you keep (`state.start = { x: p.pos.x, y: p.pos.y }`, not `state.start = p.pos`). `parts` itself, `self`, `contacts`, and `inbox` are new every tick; `get()` reads the parts as sent, whatever the script does to its own `parts` array.
- `contacts`, `inbox`, `parts`, `self`, `state`, `keys` are set by the host every tick: do not name your own variables that. `set()` with NaN or Infinity is ignored with one log line; `mark()` skips such points.
- Signs that trip people: a gyro's `spin` is clockwise positive (the opposite of `self.angle`); a rotator's `angle` output is -1 to 1 of its range.
- Name parts by tag or type in scripts, never by id: ids change when a blueprint is placed or mirrored.

## Numbers that matter
Run `pnpm sim parts` for the full table. g is 9.81.
- **Mass (kg):** core 2, frame 1, battery 3, cell 0.5, wheel 1.5, thruster 1, propeller 1, decoupler 1, warhead 1, gyro 1, rotator 1.5, seeker 0.3, radar 1, booster 1.5, heavy warhead 1.5, heavy gyro 1.5, dense battery 3, flare 0.2.
- **Push:** thruster 160 N (20 J/s), propeller 120 N (10 J/s), both along their arrow (Gate 6: Logan raised both). Lift must beat weight: a flier needs thrust-to-weight well above 1 (1.5 to 2 hovers with room to climb; the missile flies at about 3). Propellers only push along their arrow; a drone moves sideways by leaning.
- **Missile parts (Gate 7):** booster 400 N (60 J/s), heavy gyro 200 N m (15 J/s), heavy warhead 250 damage out to 4 m. Every homing missile uses all three: without lift or fins, a missile turns only by swinging its nose with a gyro and pointing its push, so the gyro sets how tight it can turn.
- **Turning:** a gyro gives 40 N m. That is plenty for a small robot and far too little for a wide heavy one: a 38 kg, 11-wide drone needs its left and right propellers throttled differently to lean (see `missile-drone.hover.js`). Rotators hold 600 N m and turn at most 2 rad/s, within plus or minus 90 degrees.
- **Wheels:** 20 N m each, radius 0.45 m, grip friction 1.5. The stock car (12 kg, two wheels) does about 15 m/s and climbs the flat world's ramp.
- **Sensors:** a seeker sees a 90 degree cone out to 300 m (1 J/s), a radar all around out to 500 m (3 J/s). Terrain blocks sight; robots do not. Their `on` input (default 1) switches them off to save energy.
- **Energy:** core 600 J, battery 1500 J, dense battery 6000 J (3 kg, blue), cell 250 J. Draw at full input per second: thruster 20, propeller 10, wheel 5, gyro 5, rotator 3, radar 3, seeker 1. The 6-propeller missile drone uses about 30 J/s hovering, about two minutes on two batteries. Out of energy, nothing moves.
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

## Arming (M10)
- **Warheads are safe until armed** (`warhead` and `heavywarhead`; any part whose def says `arming`). Unarmed, a warhead is a plain part: a blast or a hit destroys it without a blast of its own, a hard hit does nothing, and `detonate` does nothing. This is what stops one hit on a loaded drone setting off every missile it carries.
- **Arming:** set its `arm` input above 0.5 once, and it is armed for good (no disarm): a key (`{ "key": "x", "mode": "pulse", "target": "warhead", "channel": "arm", "value": 1 }`) or a script (`set('heavywarhead', 'arm', 1)`). Arm and `detonate` on the same tick go off. Its `armed` output (1 or 0) says which it is; the run report logs `armed`; an armed warhead draws a lit red light.
- **Armed at start:** `"armed": true` on a legend entry or part (the builder's part menu: Armed at start). For a live bomb with no core (`bomb`), or a ram. The validator refuses it on parts that are never armed.
- **Missiles arm themselves once launched:** the seeker guide (`missile-seeker.guide.js` and its copies) sets `arm` once it is clear of its launcher (`clear`, `clearDist`) and only if it was launched at something (a message with a point) or tracks an enemy, so a missile knocked loose by a hit stays a dud. The older key-fired guides (`missile.guide.js`, `missile-v2.guide.js`) arm in `setup()`, when let go. A carrier can also arm a carried bomb through its own controls before dropping it.

## Flares (M11)
- **A flare is a decoy** (`flare`, legend `Q^ Qv Q< Q>`, 0.2 kg, health 5): its `ignite` input above 0.5 lights it for good, and it burns 2 s, then is gone. While it burns, every sensor that sees it takes it for the robot it was part of when lit: `contacts` report that robot at the flare (the flare's position and speed, the robot's id, side, mass, parts), and `scan` returns the flare. Rules go by sensor, never by kind of robot (Logan): a missile's guide, a drone bomb's pilot, and a launcher's aim are all fooled because they steer by contacts, and so are your own robots' sensors.
- **Release it, do not wear it:** a rack is flares each on its own grip (`flare-rack`: three flares on `D<` grips, tagged `flare1` to `flare3` and `fgrip1` to `fgrip3`). Light the flare and fire its grip on the same tick, so it leaves burning at about 8 m/s (a decoupler's 2 N s on 0.2 kg, less what the robot takes). A flare mounts by its base only, so stacked flares do not hold each other on.
- **Racks on a robot:** give the host two empty columns of dots on each side, then `pnpm sim place <host> flare-rack --at <left top> ` and `pnpm sim place <that> flare-rack --at <right top> --mirror`; their tags become `flare-rack1.flare1` and so on. Add `flare-rack.flares.js` as the host's `flares` script (`<host>.flares.js`): V lets go of the next flare of every rack (one each side), with `auto` 1 it pops a pair by itself when something light (under `minMass` 10 kg) on the other side will pass within `miss` (8 m) in the next `ahead` (1.2 s), at most once per `gap` (1.5 s). `hunter-drone`, `big-drone`, and `carrier` have racks on V; `enemy-drone`, `enemy-big-drone`, `enemy-flying-silo`, and `enemy-carrier` pop their own.
- **Timing (measured, a seeker missile at about 130 m/s against a hovering hunter drone):** lit 0.4 to 2.5 s before it arrives, the missile goes off at the flare, 12 to 30 m away; 3 s or more early, the flare burns out and it comes back (or, lit before launch, the launcher aims at the flare); 0.2 s or less, it is already there. A drone bomb (slower, brakes at 7 m/s^2) overshoots a flare thrown toward it: flare and fly off, or pop them while it is still far.
- **Guides and flares:** the seeker guide goes off when its warhead will pass within `proximity` (2 m) before the next tick (at 130 m/s it covers 2 m a tick), and when it loses sight of what it was about to reach within `near` (5 m): its seeker is in the nose, so a flare it flies past drops out of its cone before the core gets close.

## Sensors, teams, and homing (M8)
- **Teams:** every robot has a team (0 is Logan's, 1 the enemy; more later). Pieces keep their robot's team. Scripts only see `side`, so one blueprint works on either team.
- **Handing a missile its target:** the launcher's script picks a contact and calls `send(<missile's scope or core id>, { x, y, vx, vy, id })`, then fires the decoupler on the same tick. The missile's guide reads it from `inbox` in `setup()`. See `launcher-seeker.fire.js` (it finds its missile by looking for the core that is not its own) and `missile-seeker.guide.js`.
- **The seeker guide** (`missile-seeker.guide.js`, shared by every homing missile): flies to the point it was sent, and once its seeker tracks an enemy near that point (within `acquire`), follows it and aims ahead by its speed. If it loses track it flies to the last point it had, then on, looking. `arc 1` climbs toward `height` (60) above the point holding `arcSpeed` (50 m/s), and dives once the ground left is what it needs to stop moving sideways (or the point is `dive` degrees below). It flies straight for `clearDist` meters before turning, pushes only as far as its nose points the right way, and `thrust` and `gyroTorque` must match its parts (400 and 200 for booster and heavy gyro). `minMass` skips light robots (other missiles). Every homing missile's guide is a copy of it (63 files, identical): change one, copy it over the rest (`md5 -r blueprints/*.guide.js` groups them).
- **Launch with some loft.** A missile leaves a rail slow and sags before its nose comes up; a level launch from a car's turret scrapes along the ground. The launcher scripts tilt the turret up by `loft` (12 degrees, 70 for the arc launcher) above the line to the target before firing.
- **Two missiles meet in the air.** Missiles are robots and collide; two drones firing at each other at the same moment send mirror-image arcs into each other. The enemy drone waits a random 0 to 1 s extra per launch and each arc's height varies a little, so it happens less. Since M10 a missile hitting a drone's rack no longer sets off the missiles still attached (they are not armed until let go).
- **Several missiles on a drone:** hang them nose up on top, each gripped from the side by a decoupler (`hunter-drone`, `enemy-drone`). A missile launched up cannot hit the ground while it turns and tips over onto its target from above. Hanging them nose down and dropping them does not work below about 25 m: the gyro needs about a second to turn the nose level and the missile is falling fast by then.
- **Propellers under the body:** a propeller has no N face, so a row of them can hang below the body between frames (they attach sideways to the frames and each other). `hunter-drone` gets its 14 propellers that way.
- **An AI robot is only scripts:** `enemy-drone.pilot.js` flies the hover with a wanted sideways speed and height instead of keys, picks a spot beside the nearest enemy, launches on a timer, and dodges. Everything it knows comes from `contacts`.
- **Dodging:** predict each incoming missile's closest pass from its relative position and velocity (`contacts` gives both), and move whichever way leaves the widest gap. Scripts cannot see the ground: the enemy drone only dodges down with room above what it tracks, after it flew its own missiles into the ground.
- **Flipped robots:** tags do not flip, so a hover that uses `lprop` and `rprop` should decide left and right by position (the hunter and enemy hovers do). Scripts that work in world coordinates from `contacts` and `parts` work flipped.

## Examples to start from
- `car`: two wheels on a frame, auto controls only. D and A drive.
- `drone` + `drone.hover.js`: five-wide hover drone; the hover script owns the propellers (`auto: false`), W and S set the height, A and D lean with a gyro.
- `missile` + `missile.guide.js`: `M g E C X` (thruster at the tail, gyro, cell, core, warhead at the nose). The guide steers the thrust so it holds the line it was released on and cancels gravity; it detonates after `fuse` seconds (10). It flies nose-up about 20 degrees, so its tail hangs about 1 m below its core. Its `thrust` param must match the thruster's force (160). It holds its heading and cancels sideways drift, but does not steer back onto the line it was released on: a shot at a downward angle sags below its line at first and recovers slowly.
- `missile-v2` + `missile-v2.guide.js`: the same missile, but it steers back onto the line it was released on: it cuts back toward the line as fast as it can still stop on it (v^2 = 2 a d, at most `cut` degrees across its path, easing in over the last meter, param `ease`), and turns its nose time-optimally with its gyro (full torque, braking just in time, inertia from its parts). Flat shots from a turret sag about 6 m in the first 1.5 s (no speed yet, the nose still turning), then settle within 1 m by about 3.8 s with 1 to 2 m of overshoot; v1 never returns to its line. A firmer drift damper (`hold` 3 or more) makes it swing wide. Place it like `missile`. `launcher-v2` and `turret-drone-v2` are the launcher and the turret drone with v2's guide on their missile.
- `launcher`: a car with a rotator turret and a `missile` hanging under a `Dv` rail. Z and X aim, F fires (a pulse on every `decoupler`).
- `turret-drone`: a drone with one missile on a turret hanging below it, nose down, aiming anywhere from left through down to right (Z left, X right, C back to straight down, F fires). Built by a fresh session from this playbook (Gate 6). Its hover is `missile-drone-10prop`'s.
- `missile-drone-10prop`: the same with 10 propellers, leaning to 50 degrees (param `lean`, in degrees). Its hover is the best example of fast, stable control: it works out its moment of inertia and full turning torque from `parts`, spins toward the lean at full torque and brakes at the last moment (v squared = 2 a d), cancels an off-center weight at once, and divides the throttle by the cosine of the tilt to hold height while leaning.
- `missile-drone`: 11 wide, 6 propellers, two missiles under `left` and `right` rails. Its hover leans by propeller throttle and learns its trim when a missile is gone; `missile-drone.fire.js` fires the right missile first on F, then the left.
- `missile-seeker` + `launcher-seeker`: the homing missile (`M g E C X S>`) and a launcher with a radar that aims its turret at the nearest enemy (plus loft), sends the point, and fires on F. Hits a parked car 80 m away, a hovering drone, and one flying sideways at 10 m/s.
- `missile-arc` + `launcher-arc`: the same guide with `arc` on: it climbs about 35 m and comes down almost straight onto its target.
- `missile-up`: `S X C g M` standing nose up, arc on, for drones.
- `hunter-drone`: 14 propellers, a radar under the core, four `missile-up`s on top. Hover as `missile-drone-10prop` (W S A D), F launches the next missile at the nearest enemy (left outer, right outer, left inner, right inner).
- `enemy-drone`: the same airframe flown by `enemy-drone.pilot.js`, no keys. Deploy it as an enemy (`:enemy`): it holds a spot 50 m beside and 12 m above you, launches every 3 s once it has tracked you for 1.5 s, and dodges.
- `big-missile` + `big-launcher` (Logan): a missile two cells wide, nose up: seeker, 2 x 2 heavy warheads, core and battery, two heavy gyros, two boosters (17 kg, 800 N, 400 N m, 17 s of burn). The cart grips it from both sides and F launches it at the nearest enemy the cart's radar tracks; it arcs up about 60 m and comes down. On a missile two cells wide the guide takes its heading from the motors to the center of mass (the core is off the middle line).
- `silo` (Logan): twelve `missile-up`s on a 30-wide ground base with a radar; each F launches the next one at the tracked enemy sent the fewest so far (nearest first), so spamming F spreads a volley. Missiles cannot stand in neighboring columns (their sides attach and they would fuse), so they go in pairs around a shared gap, gripped from the outside: 2.5 columns per missile. Deploy it resting on the ground: dropped even 1 m, its 128 kg landing sets off every warhead.
- `flying-silo` (Logan's, hover by Claude): the silo lifted by twelve boosters under its ends and eighteen heavy gyros, on four dense batteries. `flying-silo.hover.js` is the hunter hover lifting on boosters tagged `lboost` and `rboost` (off auto controls), leaning 30 degrees by throttling one side more. Roughly a minute of flight. Its missiles arm only when launched (M10), so a hit on the rack no longer sets them all off.
- **Arc or straight, per shot:** the drone and silo fire scripts put `arc` in the handoff message: straight in (after a 15 m climb clear, `clearDist`) at a target level or above, which hits drones from below where their propellers are; over the top at a target more than `below` (10 m) lower.
- `drone-bomb` (M10): a 12 kg drone (four propellers, radar, heavy warhead, gyro, cell) that chases the nearest enemy and goes off when its warhead is within 1.5 m of any of the target's parts, or after touching the target with its side for 0.4 s. `drone-bomb.pilot.js` flies the enemy drone's hover asked for a velocity: toward where the target will be, at the fastest closing speed it can still brake from over the distance left but never under 3 m/s (so it neither flies past a moving drone nor parks against it), 6 m over the target until close so it comes down on it warhead first, and never more than 40 m over where it started (two drone bombs chasing each other used to climb forever). It arms the first time it has a target, so one waiting, or carried on something bigger, is safe. A drone that flees flat out escapes (no drag: it keeps speeding up); anything slower is caught.
- `enemy-flying-silo` (M10): `flying-silo` with `enemy-flying-silo.pilot.js`: holds 80 m beside and 20 m over its target, fires every 1.5 s spread over targets, waits 10 m up with nothing tracked. About 70 s of flight on its batteries.
- `enemy-truck` (M10): a wheeled base with a radar and four `missile-up`s. `enemy-truck.pilot.js` drives toward the nearest enemy until 150 m away, brakes (a wheel only holds back when asked to turn the other way: speed 0 coasts), fires every 3 s once stopped, backs off inside 40 m.
- `big-drone` (Logan, after M10): four `big-missile`s standing on a 16-wide base, each gripped from both sides (grips `grip1` to `grip4`, two decouplers each), lifted by ten boosters under the ends (`lboost`, `rboost`) with four heavy gyros (`stab`) and four dense batteries; 119 kg, about 140 s of flight. Built with `pnpm sim place` onto a base blueprint (a missile's core at (1, 4), (5, 4), (9, 4), (13, 4)). `big-drone.hover.js` is the flying silo's hover (`gyroTorque` 800); `big-drone.fire.js` sends each F's missile to the tracked enemy sent the fewest so far, straight or arc per shot. `enemy-big-drone` flies itself with the enemy flying silo's pilot (100 m off, 20 m up, one big missile every 3 s).
- `carrier` (Logan): six `drone-bomb`s standing on a 36-wide deck, lifted by twelve boosters, six heavy gyros, six dense batteries (172 kg). F lets go of the next drone bomb, G of all left; `carrier.release.js` tells each which tracked enemy to go after (fewest sent first), so a swarm spreads. A drone bomb's bottom row (warhead, gyro, cell) would attach to a deck it touched, so each stands one row above the deck on its grips alone: a frame column with a grip at the bomb's frame row on its left, a grip at its cell on its right. Its placed drone bombs get `clearWidth` 24 (22 before its flare racks) so they hold their height until past the deck's edge. `enemy-carrier` flies itself (the enemy big drone's pilot: 120 m off, 25 m up, one drone bomb every 4 s, all of them at anything within 70 m, and only while it is not climbing or sinking faster than 2 m/s, or it flies up into the bomb it just let go).
- **Drone bombs in a swarm:** woken, a drone bomb climbs straight up 5 m at 6 m/s (faster only overshoots: a climb brakes at 1 g) and arms only after; it keeps 7 m from friendly robots, so one blast does not set off the rest; it goes after the robot its carrier names (`send(..., { id })`) while it sees it.
- **Placed copies keep their own script files:** `pnpm sim place` copies a script into a new file per copy (`carrier.drone-bomb1.pilot.js`). Editing the original does not change the copies: copy it over them again.
- `longcar`, `bomb`, `wall`: targets and drop tests (`--drop wall@0:-80,5.5` puts a wall 20 m in front of a robot at x -100).

## Traps (learned the hard way)
- **Flare racks on the sides are armor too (M11):** a drone bomb homes on the nearest part it scans and a missile strikes whatever sticks out, so a hit from the side often lands on a rack 2 m outside the frame. Tests that expect a robot to die fast may need rethinking after adding racks.
- **Test flares with the attack already under way:** lit before a launcher fires, its radar aims at the flare too, so a test of "too early" must light them after the launch.
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
- **Keys in the app:** keys go to the robot Logan controls. After a missile is released the player stays on the launcher; `,` cycles to other robots of theirs they can control, and clicking one of theirs takes it (enemies can only be watched), so a missile's own keys (`x` detonate) work only after switching to it. Headless, `--keys` reach robot A only.
- **Fire order:** when two missiles hang side by side pointing the same way, fire the front one first, or the back one flies through it.
- **Spawn in the open.** `worlds/flat.json`: a 2 by 2 m box from x 7 to 9, the ramp (a 6 by 1 m box tilted 18 degrees, x 12 to 18, top about 1.9 m), a 1 by 1 m box from x -8.5 to -7.5, and ground from x -500 to 500. Open ground: x below -10 or between 20 and 490. In the app Logan deploys wherever they click, so a robot for the ramp can start anywhere left of it; headless, the gap between the 2 m box and the ramp is only 3 m (x 9 to 12), so a car tested there must be at most about 5 wide with its rear edge past x 9, or spawn at x 20 and drive left.
- **Energy.** Check `energy:` in the report; fliers run dry in tens of seconds on one battery.
- **An unarmed warhead is a dud.** A new missile, bomb, or ram whose warhead is never armed (no `arm` in its guide, no `"armed": true`, no arm key) hits and does nothing. The report's `armed` line shows when it happened; `pnpm sim show` marks parts armed at start.
- **Ground robots and sight lines.** Robots on the ground often cannot see each other across the flat world's boxes and ramp (x 7 to 18): terrain blocks sensors. Test ground fights in open ground (x below -10).
- **A part kept in `state` keeps moving.** Since M9 part objects are reused between ticks, so `state.p = parts[0]` follows that part live instead of remembering where it was. Copy the numbers you want to remember.
- **Script cost.** Since M9 a script call costs about 20 us before it does anything; the rest is its own work (the drone hover's four loops over 38 parts cost about 40 us more). 100 hovering drones fit in one frame headless. A loop over every part inside another loop over every part is what gets slow on big robots; `pnpm sim bench` shows it.

- **Deploying in the app:** the robot lands where Logan clicks, and no part may be below the ground. A tall robot can stand on a missile's nose (a warhead only goes off on a hit of more than 5 m/s).
- **Replays in tests need the script host:** `runReplay(replay, undefined, host)`. Without it every scripted robot sits still in the replay and the hashes never match.

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
