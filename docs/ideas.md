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
