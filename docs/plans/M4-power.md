# M4 Power Implementation Plan

> **For agentic workers:** Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, and `docs/design/05-power-and-resources.md` (with its "Decisions with Logan" section) first. Tests first for every pure module, one commit per task (`M4 T<n>: <what>`), tree green at every commit, `docs/status.md` updated at session end.

**Goal:** Robots run on energy. Cores hold a small reserve, batteries hold more, parts draw while they act, and an empty pool stops the robot. There is an energy bar in the world, an unlimited-energy switch, energy in the builder stats, and energy metrics in the headless runner. No gate of its own: M4 is judged with M5 at Gate 4.

**Spec:** `05` (resource system, pools, two-phase resolution, brownout), its Logan decisions (long battery life, core reserve, no recharge, unlimited switch), `06` M4.

**Written by:** an Opus 5.5 coding session, 2026-09-23, after Logan answered the power questions.

## Decisions made in this plan (Claude's call, overturnable at Gate 4)

1. **Numbers:**
   - Core `resource: { kind: "energy", capacity: 600 }`. Battery 1500 (was 600).
   - Draws unchanged: wheel 5/s, thruster 20/s, propeller 10/s, gyro 5/s, each at full command.
   - Result: a core alone drives two wheels for 60 s or fires two thrusters for 15 s. A car with one battery drives about 3.5 minutes.
2. **Load is the behavior's call.** A behavior plans its action and says how hard it is working (0 to 1):
   - Wheel: `|speed|`. Coasting draws nothing.
   - Thrust: throttle.
   - Gyro: `|spin|` while turning, else the damping torque it is about to apply as a fraction of `maxTorque`.
   - The request is `powerDraw * load * dt`. The world grants requests per pool, then runs every action scaled by its grant (a weaker motor, less thrust, less torque). Behaviors go from `apply(ctx)` to `plan(ctx) -> { load, run(grant) }`.
3. **Pools are per chunk and derived from the parts,** as in `05`. The energy each container holds lives on its `PartInstance`. A drain is shared in proportion to what each container holds, iterating in part id order, so batteries empty together and floats are deterministic.
4. **Brownout is proportional:** when a pool cannot cover the tick, every consumer gets `stored / requested` and the pool hits 0. `EnergyEmpty` fires once per pool, as a world event with its tick and robot (not hashed).
5. **Unlimited energy is simulation state.** `World.setUnlimitedEnergy(on)` takes effect on the next tick and is logged with the tick, so replays match. While on, grants are 1 and nothing drains. The hash includes the flag and every container's stored energy.
6. **Outputs:** a container part with an output channel named `charge` reports its own stored fraction. The battery and the core declare it, and M5 scripts will read it. `World.partOutput(robot, part, name)` serves render, UI, and later scripts.
7. **UI:**
   - A slim energy bar on the keys bar for the controlled robot, showing stored and capacity. It says "unlimited" while the switch is on.
   - A notice when a robot runs dry.
   - "Unlimited energy" as a toggle button on the world toolbar.
   - Builder stats add "energy 2100, full draw 50/s (42 s)" so energy can be designed for.
8. **CLI:** `run` and `replay` report energy used and remaining. `--unlimited` turns the switch on from tick 0. `tune` prints how long the car and the hopper last.

## File structure

```
packages/sim-core/src/parts/defs/core.json, battery.json   resource numbers, charge output
packages/sim-core/src/resources/pools.ts                    containers per chunk, request and grant, proportional drain (pure)
packages/sim-core/src/behaviors/*.ts                        plan(ctx) -> { load, run(grant) }
packages/sim-core/src/world/World.ts                        two-phase behavior step, unlimited flag, events, partOutput, hash
packages/sim-core/src/replay/InputLog.ts, replayFile.ts     world events (unlimited on or off) in the log
packages/sim-core/src/blueprint/stats.ts                    energy capacity and full draw
packages/cli/src/commands/run.ts, replay.ts, tune.ts        energy metrics, --unlimited
packages/app/src/ui/KeysBar.tsx, WorldToolbar.tsx           energy bar, unlimited toggle
packages/app/src/ui/BuilderUi.tsx                           energy in the stats badge
```

## Tasks

### T1: pools (sim-core, pure)
- Tests first:
  - A pool sums its chunk's containers.
  - A drain splits in proportion to what each holds.
  - A request above what is stored gives a grant factor and empties the pool.
  - Iteration order does not change the result.
  - A core-less chunk with no container has an empty pool.
- `PartInstance` gains `stored` for containers, starting full.

### T2: two-phase behaviors, brownout, unlimited, events
- Behaviors return a planned action with a load.
- `World.step`: plan all actions, request per pool, resolve, run with grants, then physics.
- Unlimited flag: set, logged, and hashed.
- `EnergyEmpty` events.
- Tests:
  - The hopper holding W runs dry near its computed time, then its thrust stops and it falls.
  - A brownout scales thrust.
  - Coasting draws nothing.
  - Unlimited never drains.
  - A replay with an unlimited toggle mid-run matches.
- Regenerate golden hashes (the hash now includes energy).

### T3: outputs and stats
- `charge` output on containers; `World.partOutput`.
- `staticStats` gains energy capacity and full draw.
- Tests.

### T4: CLI
- Energy in the run and replay reports; `--unlimited`; battery life in `tune`. CI's keyed determinism run covers energy through the hash.

### T5: app
- Energy bar, empty notice, unlimited toggle, builder energy stat.
- Browser check: the hopper runs dry and drops; unlimited keeps it flying; the bar and stats read right.

### T6: review and wrap-up
- Opus review subagent over the M4 diff; fix findings.
- Update `05`, `status.md`; tag `m4`. Then plan M5 (scripting) with Logan's taste questions, build it, and stop at Gate 4.

## Task dependencies
T1 then T2. T3 needs T1. T4 needs T2 and T3. T5 needs T2 and T3. T6 needs all.
