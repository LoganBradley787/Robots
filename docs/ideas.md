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
