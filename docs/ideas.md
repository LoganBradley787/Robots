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
- Recommended as the first task of the sensors milestone.

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
