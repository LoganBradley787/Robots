# Ideas

Out-of-scope ideas noticed during work. Not a backlog; a planning session promotes items into a milestone or deletes them.

- Throttle up and down for thrusters (Logan, Gate 3: "if it were a rocket game... but this ain't a rocket game"). Could be a held key that ramps a throttle channel, or scripts in M5.
- Wheel suspension (a sprung joint) so cars have travel over bumps and are harder to high-center.
- Air drag, so thrust-driven robots have a top speed (Gate 3 note).

## Logan's longer view (Gate 3 / M4 questions, 2026-09-23). A game might grow out of the sandbox; not planned.
- Big robots carry a battery block that enemies can target: shoot the batteries and a flier has to land, or its weapons go dark.
- Preset enemies, e.g. an airship with a large battery reserve and homing missiles out the bottom. Get under it, hit the batteries, it makes an emergency landing and can only fire out the top.
- Missiles need some way to regenerate, or enemies run dry after one volley.
- A game layer: building parts costs electricity, solar panels and generators produce it, materials to find, territory to take for solar farms that enemies can spot and bomb.
- Recharging (solar, generators) comes later, as parts that produce energy.

## From Gate 4 (2026-09-23)
- Hover relative to the ground, not a fixed height: an altimeter or downward rangefinder sensor part (Q2 sensor parts).
- Enemy drones that stay up: upgraded batteries, solar panels, or recharging, so a preset enemy does not fall out of the air after 2 minutes.
- Scripts that track the player: `world.robots()` in the script API, then weapons (cannons, dive bombing).
- Stacked propellers give lift through each other (Gate 4, Logan: fine for now). Later: a part directly above a propeller could block its lift.

## From Gate 5 (2026-09-23)
- Homing missiles (Logan: "These missiles are hard to aim"): a finder or scanner sensor part (`02`, deferred sensor parts) plus `world.robots()` for scripts, then a missile with its own core and a guidance script (needs M7 sub-assemblies so the missile core carries its script).

## From M7 planning (Logan, 2026-09-24): sensors, targeting, teams
- Sensors need their own milestone, planned properly. Open: what a sensor senses (cores, but also batteries and other parts), and how it tells who is who.
- Logan's thinking: a default sensor finds "heat signatures". It sees cores plus who controls each one (the player, a friendly AI, an enemy AI, nobody), and the script decides what to chase. For testing, a missile would lock onto any core that is not its own robot and not controlled by the player.
- Teams: single player, so probably two sides (player versus AI, or AI versus AI). Some robots are the player's, some are definitely enemy AI robots.
- Possession follows teams: the player can switch to their own cores (a released missile included) but never into an enemy's robots. AI robots do not "switch cores"; an AI builds and scripts its robots, and each core runs its own script.

## After Gate 6 (Logan, 2026-09-25): what to build next, and what performance allows
### The goal for the next milestone
- Logan: "I should be able to build an enemy missile drone that can track me, shoot homing missiles, and then also see incoming missiles and dodge them." The homing missile matters most: "if we can make a homing missile, we're getting closer to what's cool."
- So: sensors (Q22 in `07`, the notes above), `world.robots()` or a sensor part for scripts, teams (who is an enemy), a homing guide script, then an AI drone that tracks, fires, and dodges. Performance first (below), because homing missiles mean many scripts running at once.

### Logan after flying turret drones (2026-09-25)
- In 2D, rotating things is limited, so the meta is probably flying and firing missiles in one direction: the player starts on the left, enemies come from the right. To fire both ways, launch straight up or down and let homing or Javelin guidance turn the missile at once, or drop a missile held vertically so it speeds off, works out where to go, and dives on the target. Another reason homing comes first.

### Testing wishes (Logan, testing missile-v2, 2026-09-25)
- Flip a robot left to right when deploying it in the world (like the builder's F for a held blueprint), so a second launcher can face the first.
- Right-click a rotator in the world and type an angle to send it there; right-click a thruster (or any part with an input) and set a value that overrides what its keys and scripts are doing. A small "inspect and poke" panel for testing.
- missile-v2 finding (measured): a launcher's turret droops about 0.48 degrees under the missile's weight (the rotator's position motor holds like a stiff spring, so a load leaves a small steady error), so the missile leaves pointing slightly down; the decoupler's kick then spins it nose-up, and it records its line a tick later at -0.23 degrees and holds that line to within a centimeter, creeping down about 0.4 m per second at 100 m/s. Launched flat off a block or from a tube, it flies flat. Backing out the kick's spin would make it worse (-0.67). The real fix is in the rotator: hold the exact angle under load (an integral term that builds until the sag is gone), a sim-core change that touches every turret; plan it as a task. Done (Batch): the rotator's position motor has an integral term.

### Cores talking to each other (Logan, 2026-09-25)
- Logan: should a robot be able to spot an enemy, pick a spot, launch a missile, and tell it "go here", or should the missile figure it out after launch?
- Three styles, all worth having: fire and forget (the missile's own sensor part), told at launch (the launcher's sensor, a cheap dumb missile), steered in flight (the launcher keeps correcting it; breaks if the launcher dies or loses sight).
- Claude's recommendation: (1) with sensors, a handoff at launch: while attached, the pilot's script leaves a message for a placed core (`send('missile1', { x, y })`), and that core's script reads it from an `inbox` in `setup()` when it wakes. No new part. (2) Later, a radio part for messages in flight between separate cores of one team, with range (and maybe delay and energy cost) as data: something to armor or to shoot out, and how drones would share targets.
- Logan agreed on the handoff at launch (2026-09-25), with a Javelin-style missile as the example: the launcher hands off an approximate x, y; the missile's own seeker homes when it sees the target and updates the point; if the target hides from the seeker, the missile still flies to the last point it knew and lands near it. A top-attack path (climb, then dive) is worth trying, since every part in a blast's way halves its damage and robots armored at the front are soft from above. A good done-when robot for the sensors milestone.
- Deterministic: messages sent in a tick arrive the next tick, in a fixed order. Cores are addressed by the names they already have (scopes like `missile1`, the main core). Only a team's own cores receive its messages.

### Script performance (measured 2026-09-25, headless, Node, 60 ticks per second, 16.7 ms budget)
- 1 `missile-drone-10prop` hovering: 0.5 ms per tick. 10: 4.6 ms. 25: 11.8 ms. 50: 23 ms (too slow). One 200-propeller giant: 2.2 ms. 500 loose missiles with no scripts: 3.1 ms.
- Physics is cheap: about 0.03 ms per drone. Scripts are the cost: about 0.2 ms per script per tick even for an empty `tick()`. The shipped drone runs two (hover, fire).
- Where it goes, for one call on a 38-part robot: crossing into the sandbox 13 us, the host's `JSON.stringify` of the input 15 us, QuickJS parsing that JSON back into 38 part objects about 145 us, the script's real work (4 loops over every part) about 20 us. QuickJS is an interpreter with no JIT, so parsing text inside it is slow; Rapier is compiled WebAssembly, so physics is fast. The parse grows with robot size: 400 parts cost 1.6 ms per script per tick before the script does anything.
- Plan (Logan agreed, 2026-09-25): send each part's id, type, tags, and mass only when the robot's parts change (a decoupler, a part destroyed, a split: `Robot.version` already bumps then); each tick send only the numbers that move (positions, angles, channel values) as one binary block of numbers the sandbox reads without parsing; build that once per robot, not once per script. Scripts see the same `parts` as today, so none change, and the numbers are the same, so replays and determinism hold. Estimate: about 160 us to about 30 us per script, so the drone from about 0.47 to about 0.1 ms, and 100 or more scripted drones instead of about 25. Add a benchmark to the CLI (`pnpm sim bench`) so regressions show.
- Done in M9 (2026-09-25): the layout is sent once, the moving numbers as one binary block, part objects kept between ticks; host-side lookups by id. 100 hovering drones: 46.2 to 12.6 ms per tick headless (scripts 40.6 to 9.1 ms). A script call now costs about 19 us before its own work (was about 180). Measurements in `docs/plans/M9-script-speed.md`, As built.
- What is left, if it is ever needed: the scripts' own work is now most of it (QuickJS interprets, no JIT); behaviors (thruster and gyro forces) are next at about 16 percent. The browser runs scripts about 20 to 40 percent slower than Node.
- **Web Worker** (still an idea): the sim on its own thread, so drawing never waits for a slow tick. When a tick costs close to a whole frame the fixed step catches up in bursts of several ticks per frame and the frame rate drops, though the sim keeps real time.

### After Gate 9 (Logan, 2026-09-26)
- **A bomber:** flies above you and drops bombs (armed at start, or armed by the bomber as it lets go).
- **A jammer pod:** dropped, it blinds every sensor within about 30 m for a few seconds (flares came first).
- **Missiles that do not run out** (the fabricator bay) would also change "fire everything, then float".

### After Gate 8 (Logan, 2026-09-25)
- **MASTER DRONE:** four seeker missiles, a big missile, and two drone bombs on one big drone. The drone bomb already sleeps while carried and arms when let go; a carrier needs grips for it and a fire script that hands it its target (it finds its own with its radar, so a plain release works too).
- **Drone bomb carriers:** an enemy drone that carries two drone bombs and drops them on you.
- **Terrain for drone bombs:** "navigating choppy terrain" needs a part that sees the ground (a downward range finder or a ground scanner); today the drone bomb keeps 6 m over its target until close.
- **The enemy flying silo's energy:** about 70 s of flight. More dense batteries, or a landing and waiting mode, if fights run longer.

### Missiles that turn like real ones (Logan, Gate 7)
- Logan: a real missile goes straight and turns fast because fins push on the air; here there is no lift or drag and the thruster has no gimbal, so a missile turns only by swinging its nose with a gyro and pointing its push. Gate 7 added a heavy gyro (200 N m) for missiles. Later, worth trying: air drag and lift (a fin part), or a thruster that can swivel a little.

### Denser batteries (Logan, Gate 7)
- If missiles run short on energy: a battery denser than the battery (blue instead of green), then an even denser one (red, or another color). Not needed yet: a missile-up still flew 5 s and hit after its drone hovered 60 s.

### Missiles that do not run out (Logan: an enemy needs more than two)
- Claude's pick: a fabricator bay part that holds a count of missiles, not physical ones. On fire it spawns a copy of a missile blueprint at its release face (the same copy-placing as the builder, so the missile's own core and guide script wake as usual), costing energy (say 300 J) and a reload time. Materials could replace energy later.
- Others: a one-part rocket (tiny, but no longer a robot you can switch into); enemies regenerating over time (fine as an AI-only cheat); a world spawner or enemy factory that sends out drones on a timer (with teams and AI).

### Debris
- Claude's pick: pieces with no core that have rested for about 10 s fade out, and a cap (say 200 pieces, oldest first), all counted in ticks so replays hold. "Clear debris" exists as a button.

### Multi-cell parts (Logan's T-shaped propeller: a two-cell shaft with blades one cell out each side at the top)
- About half is built since M1 (Q4): footprints are lists of cells with their own attach faces, `=` continuation cells in the grid, the validator's coverage check, overlap checks, one physics box per cell with the mass split among them.
- Left: a sprite drawn over the whole footprint (art plus render code), the builder's ghost and hover for the full shape, mirroring asymmetric footprints, lift applied at the blade rather than the anchor cell, and `show` counting mass per cell. About a third of a milestone, mostly drawing and builder work.

### Impact damage
- Today the only impact rule is the warhead's fuze (a hit that changes its speed by more than 5 m/s); other parts take no damage from collisions (Q11, Q17). Logan: probably should eventually.

### Could it run natively (a desktop app in C++, C#, or Rust)? Door left open, not planned
- The engines exist natively: Rapier is a Rust library (the browser uses its WebAssembly build of the same code, with the same determinism), Box2D v3 is C. Drawing: Bevy or macroquad (Rust), SDL or raylib (C). UI panels: egui or Dear ImGui instead of Preact. Scripts: native QuickJS, or Lua / LuaJIT for much faster scripts.
- Effort, Claude's estimate: "kind of hard, but whatever": roughly the size of what has been built so far (about 11k lines of source and 6k of tests), but mostly a port, since the design, the tests, and the determinism checks already exist. Rust plus Rapier is the natural path (same physics engine, same behavior). Unity or Godot would work too, but their physics is not deterministic across machines, which replays and the headless runner rely on.
- What it would buy: WebAssembly runs at very roughly 60 to 90 percent of native speed, so the physics gains are modest; scripts gain the most (a JIT like LuaJIT is tens of times faster than QuickJS). Most of the headroom in the browser comes first from architecture: the script plumbing above, then running the sim in a Web Worker off the drawing thread. Wrapping the web app as a desktop app (Tauri or Electron) needs no rewrite but gains no speed.
- Feature by feature (Logan's follow-up: "is there stuff that we do now that doesn't really transfer well?"): physics (Rapier is natively Rust), blueprints and the grid format, the validator, part defs, the headless runner, and drawing carry over as they are. JavaScript scripts carry over if the port embeds QuickJS natively (it is a C library); switching to Lua would mean rewriting every script and the playbook. What does not carry over well: the Preact panels and the in-app script editor (rebuilt in something like egui, whose text box is not a code editor); replays recorded in the browser may not replay bit for bit natively (our own `Math.sin` and `sqrt` calls could differ in the last digit; new replays would be deterministic); the instant hot reload (a Rust rebuild takes seconds to a minute); and play-from-a-URL. Nothing in the design depends on the browser.
- Stack, if it ever happens (Claude's leaning, needs research first): no custom interpreter, physics, or graphics engine is needed; games embed a script interpreter as a library. Rust, because Rapier is a Rust library: Rapier for physics, QuickJS embedded through the `rquickjs` crate so robot scripts stay JavaScript (Lua through `mlua` is faster but means rewriting every script), Bevy or macroquad for drawing, egui for panels. A C++ route works as well: Box2D v3, SDL or raylib, QuickJS (a C library). Research before choosing: whether `rquickjs` can stop a runaway script mid-tick and cap its memory as our sandbox does; a code editor inside egui; Bevy against macroquad; whether Rapier's browser and native builds give bit-identical results. Middle path: rewrite only the sim in Rust compiled to WebAssembly for the web app; the same code later builds native.
- Before any port (Logan): benchmark first, so it is written once. Build the same scene (say 100 scripted drones and 500 loose pieces) on each candidate: Rapier and Box2D, QuickJS and Lua, Rust and C++. The engines and the script interpreter likely matter more than the language (Rust and C++ both compile to native code and usually land close).

## Sharing it: a static site on GitHub Pages (Logan, 2026-09-25)
- Logan wants to show it to people without an install: a link, or clone and run two commands. The game is already a static site (`pnpm build` gives HTML, JavaScript, and WebAssembly; the physics and the script sandbox run in the browser). Only file saving needs the dev server (the `blueprintStore` and `replayStore` Vite plugins read and write `blueprints/` and `replays/`).
- For GitHub Pages: bundle the shipped blueprints into the build, save to browser storage (IndexedDB), and add Export and Import for sharing blueprint and replay files. A task or two.

## From playing the fab drones (Logan, 2026-09-26)
- Balance later, not now. Nothing gets kneecapped by script params (a pilot holding a finished missile for no reason); things get better or worse by changing parts in their entirety.
- Build time per part (Logan's leaning): a bay's build time comes from what the copy is made of, not only its mass. Boosters are advanced and slow to build, propellers basic and quick. Energy cost stays as it is: running out of power is boring.
- Nothing is balanced while energy is effectively free: a huge drone with 15 missile bays, blue batteries, and boosters would fire one or two missiles a second forever. Likely answers: a swarm of drones that tracks you and hangs a fixed distance off to soak up missiles, or a fab bay that builds flares and lets them go.

## From playing the guns (Logan, 2026-09-28)
- **Hidden guns:** guns kept rotated in, or behind a wall on a rotator that swings open to expose more guns once the other side's guns are gone ("the gun war"). Not now.
- **Everything is close quarters:** radars see 500 m and guns reach 250 m, so once two robots see each other they are in gun range, and missiles cannot be launched from outside it. Options: shells spread a little (seeded) so guns are weak far out; longer range radars or missiles. Test the new drone designs first (Logan).
- **Design over parts:** guns off the core's line, walls around a fab bay, many guns; `enemy-armored-gun-drone`, `enemy-fab-gun-drone`, `enemy-many-gun-drone` are the first tries.

## From playing the missilenator (Logan, 2026-09-28)
- **A fast gun drone out of a bay (later):** launched from a fab bay, flies fast, locks on and shoots from afar. Logan is still thinking on it: guns on the sides, the front, or everywhere; boosters instead of propellers, like a rocket, some on all four sides (fewer each) so it boosts to the target, then brakes and holds itself in gun range, with fast steering and sideways moves from the boosters; it zooms by and guns people down. Needs turrets that hit from a shaking platform (turret `shake`).
- **The missilenator's warheads behind its crown:** the crown holds a target 3 m off, so the blast barely reaches; it wrecks by ramming. Warheads in front of the crown is Logan's call.

## From the titans tournament (Logan, 2026-10-01)
Notes for after the tournament. Logan's rule while it ran: change nothing, see it to its conclusion.
- **Heavy armor should be WAY heavier (Logan):** right now you can just keep adding it and weight is no real concern, and it should be. An armor plate is 5 kg for 250 health and takes a tenth of a shell (a frame is 1 kg, 60 health, a quarter). The round 2 titans carry it by the thousand: a flying brick six plates deep (2825 parts, 9.3 t) and a ground fortress with 24 plates in front of its core (10.8 t). Weight cost a flier lift and a ground robot nothing.
- **Gun sights see everything (Logan):** a gun's sight is a ray from the barrel and reports what it touches, its side and its robot id. Jammers do not affect it, so every titan with guns found every hidden core by sweeping. Hiding parts mean little while that holds. To settle: should a sight see into a jammer bubble or through smoke at all?
- **Robot ids give away the main robot:** the two starting robots are ids 1 and 2 and every piece or copy is higher, so a script picks the other side's main robot by its number (three builders found it, then all were told). A flagship should not be told from its escorts by a serial number.
- **Nobody keeps moving (Logan):** every titan that kept away ran to one fixed spot, usually near an edge, and was found, bumped out or worn down there. Logan expected one to dash to the opposite corner whenever something came near, using its longest reach all the while. Five builders reached the same idea in round 2 and none finished it: a hidden core is blind, so it cannot dodge what it cannot see.
- **Being pushed out of bounds replaced ramming:** with crash damage local, the rams win by carrying things past the arena's edge (a nose on the ground, a spar to the ceiling in the air, even shell pushes on a falling wreck). Ground ropes (grapples cast at the ground) are the counter two builders found. The bounds were only meant to stop running away.
- **Engine, found on the way and not fixed:** a rebuilt robot is skipped by the crash check for two ticks, so one losing a part every tick takes no crash damage; a jointless robot rebuilt on consecutive ticks ignores thrust and contact in its speed (`World.motion()` returns the last kick's target); removing only the lost part's collider in place would make a loss tick about ten times cheaper again but changes every hash with damage; script proposals left open (a script opting out of `parts` or `contacts`, a filter or cap on `scan`).
- **The browser duel** (`?duel=a,b&ya=&yb=`) has no bounds rule and no "who won" notice yet, so it runs on after the scored match would have ended.
- **Guns: shorter reach, and a long gun for range (Logan's gut):** limit the ordinary gun's range, and add a second gun part that sends heavier shells with less spread and sees farther, but is heavier, fires much slower, and probably takes more cells, "so you can't just pop 30 of them down on any robot". Today's gun is one cell, 1 kg, 10 shells a second of 5 damage, 0.5 degrees of spread, a 150 m sight and a shell that flies 1 s at 300 m/s (about 300 m of reach); the gun wall carries 192 of them and the juggernaut 126. This also bears on "gun sights see everything": a short sight on the common gun leaves far seeing to a part that costs something. It is a new part as data (its own `gun` block and a bigger footprint), no engine change.
