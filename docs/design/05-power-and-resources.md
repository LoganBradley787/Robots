# 05 Power and resources

Status: draft 2026-09-22; decisions with Logan 2026-09-23 (M4) below, which win where they differ.

## Generic resource system
- `ResourceKind` is a string. v1 ships `"energy"`. Fuel later is a second kind with no engine changes.
- Container parts declare `resource: { kind, capacity }` in their def. Each `PartInstance` of a container holds `stored`.
- Consumer parts declare `powerDraw` (units per second at full command) and the kind they consume (default `"energy"`).
- Producers are parts that pour into a pool: solar panels, and reactors (below).

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
- Under Unlimited energy a robot reads every pool as full (`self.energy.stored`, `energy`, `charge`), so a script that stopped at low energy starts again: the Juggernaut sat still at 2.7 percent because the pool stands still and its pilot read that (2026-10-30). Nothing is taken from the pool or put in it, so `World.energy` and the hash keep what is really stored, and the robot reads that again when the switch goes off.
- Events: `energyEmpty` once per pool, in `World.events` (not hashed). The app shows it as a notice.
- Measured (`pnpm sim tune`): car (core + battery, 2100) drives 210 s; hopper thrusts 53 s at full. With no air drag a hopper that thrusts for the whole 53 s reaches about 20 km: flagged to Logan for M5 planning.

## Sealed bays (Logan, 2026-10-31)
A copy a fabricator bay holds is not part of its carrier yet. Logan: "What you're generating is a part that is not truly attached to your robot, so I don't think you should be able to siphon charge from that." And he does not want missiles to need charging: wait for it to build, then launch it.

The grips still make the copy one chunk and one body with its carrier, for physics and control. Only power is cut, in both directions:
- **Out of the pool:** a held copy's containers are in no pool. They are not drained or filled, and they are not in the carrier's `stored` or `capacity`, so neither `self.energy`, the core's `energy` and `energyCapacity`, the HUD nor `World.energy` count them. A container's own `charge` still reads its own fraction, so a script can look at what it holds.
- **Off:** a held copy spends nothing, not even its own charge. Nothing it asks for is granted. So a seeker, a radio, a radar and a damping gyro, which all draw while idle, cost nobody anything and do nothing, and a carrier cannot steer, spin or see with what it holds. A copy launches exactly as full as it was built. A copy that could spend its own charge would leak 1 to 20 J/s for as long as a pilot waits, which is the thing this rule is for.
- **Joints hold:** a rotator or piston in a held copy keeps its aim for nothing and takes no commands. Off, a turret swung up to 2.3 rad about in its bay. A wheel is just slack.
- **Not a producer:** a held copy's reactors and solar panels make nothing, and they are not in the robot's reactor list, so they add nothing to its rating or heat.
- **Not a victim:** frying never picks a held copy's batteries or its draw. Its parts are not in the carrier's fuse list, and what they ask for belongs to no chunk.
- **What it costs:** the build pays for the charge (`joulesPerKg` times mass, plus what the copy's containers hold), and now that charge goes out with the copy. A build no longer pays the carrier back, so charge in a recipe is a real price: a Mirage ghost is 1100 J, a Hive dart 850 J, a Woodpecker burner 18.6 kJ.

**It is read off the bays, not stored** (`partLists.sealed`, `sealedParts`): the parts whose first tag is the scope a live bay of this robot `holds`. Nothing is hashed, and a copy is free the moment its bay lets go or is gone:
- **Released, or its bay shot out:** the copy is its own piece with its charge whole, and it wakes as ever.
- **A piece breaks off with the bay and the copy:** with exactly one core on it, that core wakes (`04`) and runs the piece, so the copy is the robot now and the seal is gone. Its pool is the whole piece's.
- **The carrier's core is shot out:** nothing wakes (Q1), so the copy stays sealed in a wreck, full and a dud, as `04` says of a dormant core on a robot that keeps its id. The wreck's latched parts cannot drain it.

Scripts in a held copy do not run (its core sleeps), so they have nothing to draw with. A decoupler's racked missile is not a bay's copy: it shares its robot's pool while attached, as ever.

## Reactors (as built, 2026-10-31)
Goal (Logan): long casual fights without Unlimited energy. A reactor is the part that gives a robot steady power; a battery stays the part that pays for spikes. Parts are data, `reactor` and `smallreactor`, both 12 J/s per kg.

**Tick order**
1. `runReactors`, right after `runSolar`: per chunk, the live reactors pour their rating in (`fillHeld`), times `push` when pushed. A pool with no room takes less, and what did not fit was never made. What they may make this tick goes on the robot's behavior list, so a rebuild mid-tick drops it the same way on every host.
2. Both behavior passes: `resolvePool` makes up what the pool cannot pay, up to what is left of the limit, sharing one budget between the passes.
3. `settleReactors`, right after the late pass: `x = (filled + extra) / rating`, `over = clamp((x - 1) / (cap - 1), 0, 1)`, then for each reactor `heat += (over * over - heat) * dt / tau`. If `over > 0`, the chunk burns `burn * heat * dt` for each reactor.

**The rules**
- Over rating is never "the laser is on": batteries pay for spikes, and a laser on a 1.5 kW reactor with charge in the pool makes no heat. Overdrive starts only when the pool cannot pay this tick's requests.
- `x` is a chunk's, shared by its reactors: paralleled, they run at the same load.
- At the cap, output stops, heat tends to 1, and anything still asked for browns out as ever.
- **No core needed (Logan):** reactors keep running on a wreck. A reactor on a piece with nothing to fill and nothing drawing makes nothing.
- **Split pieces do not share:** each piece has the reactors it holds. Heat lives on the part and goes with it.
- **Output is full until the reactor is destroyed.** No fuel (Logan): a hover is not idling, so fuel and "stays up for good" cannot both hold.
- **Unlimited energy:** reactors make nothing and cool.

**`push` (the reactor's one input, holds until changed)**
- 0, the default, is automatic: the rules above, no script needed.
- 1 to `cap`: it runs at that many times its rating even with charge left, refilling the pool faster, and stops there; it does not go past `push` when the pool runs dry. It heats and fries by the same line.
- Above 0 and under 1: it never goes past its rating.
- It makes only what the pool can take, so a pushed reactor on a full pool stays cold. It heats once the pool has room for what it is pushed to. Batteries fry first, so it can burn the batteries it is filling. That is the price (Logan: "I don't care if I lose a couple batteries").
- Mixed `push` values on one chunk add up, then all of its reactors share the load.

**Who fries, each chunk, while its burn this tick is left**
1. Parts with `fuse`, full or empty: the one nearest to burnt out first. A burnt-out one is skipped.
2. Then what draws this tick, from both passes: the top drawer and anything within 10 percent of it, lowest health first.
3. Exact ties go by the world's seeded RNG, one draw per pick.
- A victim takes what it can and the rest spills to the next, so a big robot is not held to one part a tick. Nearest to burnt out, and lowest health among the drawers, makes a victim stick, so parts go one at a time.
- A copy a bay holds is never picked (Sealed bays, above).
- The core and the reactor are never picked: no `fuse`, no draw. With nothing drawing, nothing fries.
- A part past the fuses loses health and goes in the damage phase with its own blast (a cannon going up). `partDestroyed` says `cooked: true`, and duel reports count it as a loss even when it blasted.

**A fuse burns out, it does not die (Logan)**
- Batteries are often structure: cooked batteries once cut `titan-mirage-r` in two. So frying takes no health off a part with `fuse`. It adds to its burnt share (`PartInstance.burnt`, 0 to 1), a whole part's health in burn taking it from 0 to 1, the pace batteries used to die at.
- **Charge stays whole until 1.** At 1 it has no charge and no capacity, and what it held is lost, not moved to the others. `stored` goes undefined, so no pool, fill or reading counts it. `charge` reads 0, also under Unlimited energy.
- **It stays as structure:** same mass, same footprint, still connecting what it connected. So frying cannot split a robot through its batteries, or make a flier lighter. A part past the fuses can still fall off with its fried neighbor's loss, as any part can.
- **Two meters, kept apart (Claude's call):** burn is not damage and health is not burn. Bullets, blasts and crashes take health as usual and can destroy a fuse at any burn. A battery on its last health point still has its whole burn to go, and a burnt-out one has all the health it had. Tying them would either let frying kill a battery again, the thing this is here to stop, or make a brown shell tougher or weaker than the battery it was, for no reason a player could see.
- Hashed once set, so a robot frying never reached hashes as before. Event `fried`, once per fuse, not hashed; `pnpm sim run` counts it under `parts fried`. No part type is named: it all reads `fuse`.
- **Looks:** the sprite goes brown from the outside in, covering the burnt share of the part, all of it only at 1 (`render/burnRing.ts`, one overlay sprite per burnt part, on one shared texture for each of 16 steps).

**Hot blast: a pushed reactor is a thing you risk**
- `onDestroyed.explode` is the cold blast. `reactor.blast` is what heat adds to it, an `ExplodeSpec` at heat 1. Destroyed at heat `h`, whatever destroyed it (a shot, a ram, another blast), a reactor goes off once with each number being `cold + h * hot` (`hotBlast`, `damage/explosion.ts`, called from `destroyDeadParts`). In line with heat, no step anywhere.
- One blast, not a cold one and a hot one: the second of two would find the first's dead parts gone and dig through what they covered, and would spend a second place under the 100 blast cap. The `explosion` event's radius grows with it, so the fireball and the sound do too.
- Numbers (first guess, Logan tunes them in the json):

| | cold | adds at heat 1 | heat 0.25 (2 times) | heat 1 (3 times) |
|---|---|---|---|---|
| `reactor` | 80 damage, 3 m, push 30 to 5 m | 240, 2 m, push 30, 3 m | 140, 3.5 m | 320, 5 m, push 60 to 8 m |
| `smallreactor` | 40, 2 m, push 15 to 3.5 m | 120, 2 m, push 15, 2.5 m | 70, 2.5 m | 160, 4 m, push 30 to 6 m |

- Heat 0 is the cold blast itself, the same object, so a reactor that dies cold changes no hash. Heat falls with `tau` once the load falls, so a reactor shot 10 s after a push (big) has a third of the blast's extra left.
- A full pool takes nothing, so `push` alone does not make a reactor hot: only a pool with room, or a draw past rating, does. A titan pushed in a fight with its pool nearly full stays under heat 0.2 (`push` above). The blast is a price for running a dry robot flat out, not for touching the key.
- **Chains:** a blast that destroys a hot reactor sets that one off too, in the same damage phase. Each reactor goes once, so a chain ends; past the 100 blast cap the rest wait in the hashed queue for the next tick. Order is robots in order, parts in blueprint order. A full 300 health reactor needs 300 damage at its worst cell, and heat 1 gives at most 256 at 1 m, so big reactors do not chain from full health; they do once hurt. Small ones touching chain from about heat 0.45.
- Its center is the reactor's origin cell like any blast, not the middle of the 3 by 3.
- Heat is hashed on parts with a `reactor` block only; a queued blast hashes its numbers, so a hot one waiting is in the hash.
- `p.spec.reactor` does not show `blast`: blocks inside blocks stay out of `partSpec`.

**Reads**
- Scripts: `heat` and `load` outputs, `p.in.push`, `p.spec.reactor.power`, `cap`, `tau`, `burn`. `self.energy` still means what is stored, but no longer "time left": a reactor pilot adds steady power to its budget. A burnt-out battery reads `charge` 0 and is out of `self.energy.capacity`. How far along a burn is does not show: charge stays 1 of what it holds until it is all brown. `p.spec.resource` is the part's def, so it still says what a new one holds.
- `World.reactors(id)` for readouts; `World.powered(id)` is "something stored or a reactor making something", because a robot on overdrive ends every tick with an empty pool and must keep its flames and sound.
- Event `overload`, once per pool, not hashed.
