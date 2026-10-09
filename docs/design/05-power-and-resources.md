# 05 Power and resources

Status: draft 2026-09-22; decisions with Logan 2026-09-23 (M4) below, which win where they differ.

## Generic resource system
- `ResourceKind` is a string. v1 ships `"energy"`. Fuel later is a second kind with no engine changes.
- Container parts declare `resource: { kind, capacity }` in their def. Each `PartInstance` of a container holds `stored`.
- Consumer parts declare `powerDraw` (units per second at full command) and the kind they consume (default `"energy"`).
- Producers (solar, generator) are a later addition: the same interface with a negative request.

## Pools are derived, not stored
- A chunk's pool for a kind is the set of container parts in that chunk. `capacity` and `stored` are sums over those parts.
- Because the pool is derived from parts, splitting needs no bookkeeping: each chunk simply sees the batteries it physically contains.
- Drains are distributed across containers proportionally to their stored amount, so batteries empty together. Sorting by part id before distributing keeps float sums deterministic.

## Per-tick resolution (two phases)
1. Request. During the behavior phase each active consumer requests `powerDraw * |command| * dt` from its chunk pool. Requests are collected, not granted yet.
2. Resolve. After all requests: if the total is at most `stored`, every request is granted in full. Otherwise every consumer gets the same grant factor `stored / total` and the pool goes to zero (brownout). Behaviors scale their output by the grant factor.

Brownout is proportional rather than first-come so the result does not depend on part order.

## Rules
- A pool at zero means every consumer in that chunk produces nothing, including latched actuators on headless chunks.
- Batteries start full. A blueprint may later set an initial charge fraction per battery.
- No recharge in v1. The `EnergyEmpty` event fires once when a pool first hits zero.
- Battery output channel `charge` reports the part's own fraction so scripts can watch it.

## Metrics
- The headless runner reports `energyRemaining` (sum over the robot's chunks) and `energyUsed`.
- The UI shows the possessed chunk's pool as a bar.

## Decisions with Logan (before M4, 2026-09-23)
- **Energy lasts long; it rarely runs out.** Numbers (tunable in part defs): the core holds a reserve of 600, like Kerbal Space Program's command pods. That is about a minute of driving on two wheels, or 15 s of full thrust on two thrusters. A battery holds 1500 (2.5 times the core). A car with one battery drives about 3.5 minutes.
- **The core is a container like any battery** (`resource` in its def), so a robot without batteries still moves for a while. No engine special case.
- **Stacking batteries is the way to range.** Logan: a huge robot might carry a block of 30 batteries, which becomes a target once damage exists (M6).
- **No recharge in M4.** Producers (solar, generators) come later as parts with a negative request.
- **Unlimited energy** is a sandbox switch on the world toolbar, off by default. It is part of the simulation (logged with its tick) so replays match.

## As built (M4, 2026-09-23)
- Behaviors plan, then run: `plan(ctx)` returns `{ load, run(grant) }`, the world sums each chunk's requests (`powerDraw * load * dt`), grants and drains the pool (`resources/pools.ts`), then runs every action with its grant. A part that asks for nothing acts in full.
- Loads: wheel `|speed|` (coasting and an empty pool both leave the wheel slack), thrust = throttle, gyro `|spin|` or its damping torque over `maxTorque`.
- M14: the laser draws the most of any part: 2400 J/s at load 1 while it fires (a fabricator bay is 400, a propeller 10). A dense battery is 2.5 s of beam, a battery 0.6 s. Its grant is the beam's strength, so a brownout burns weaker.
- M15: a charged gun draws 1000 J/s only while it charges (6000 J for a cannon shot, 3000 J for a lance's), nothing while held full. It is the first part that gives energy back: a charge let go early drains into its chunk's containers at the rate it was taken (`BehaviorContext.giveBack`, poured once per chunk after the tick's grants, lost where it does not fit), and the robot's `used` total comes down by what went back.
- `World.energy(robot)` is the pool of the chunk the robot is controlled through; `World.partOutput` serves `charge` (a container's own fraction) and `energy` / `energyCapacity` (its chunk's pool).
- `World.setUnlimitedEnergy` applies on the next tick and is logged in the input log (`world: { unlimitedEnergy }`), so replays match; the hash includes the switch and every container's stored energy.
- Events: `energyEmpty` once per pool, in `World.events` (not hashed). The app shows it as a notice.
- Measured (`pnpm sim tune`): car (core + battery, 2100) drives 210 s; hopper thrusts 53 s at full. With no air drag a hopper that thrusts for the whole 53 s reaches about 20 km: flagged to Logan for M5 planning.
