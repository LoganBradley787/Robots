# M8 Sensors, Teams, and Homing Implementation Plan

> **For agentic workers:** Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, `docs/design/02-parts-and-blueprints.md` (deferred sensor parts), `04` (script API, possession, wake-up), `07` (Q1, Q2, Q22), `docs/ideas.md` ("After Gate 6"), `docs/critique/gate-6.md` (finding 6), and `docs/claude-robot-playbook.md` first. Tests first for every pure module, one commit per task (`M8 T<n>: <what>`), tree green at every commit, `docs/status.md` updated at session end.

**Goal:** robots can see each other and tell friend from enemy. A launcher tells its missile where to go before letting it go, and the missile's own seeker homes in, or flies to the last point it knew when the target hides. An enemy drone, built only from parts and scripts, tracks you, fires homing missiles, and dodges yours. Ends at Gate 7.

**Spec:** `07` Q2 and Q22 (decided by this plan), `docs/ideas.md` "After Gate 6" (goal, cores talking, Javelin), `02` deferred sensor parts.

**Written by:** an Opus 5.5 session, 2026-09-25, after Logan answered the M8 questions.

## Logan's answers (2026-09-25)
- **Sensing is parts.** A `seeker` (narrow cone, light) and a `radar` (all around, further, heavier). Make them strong: "It's no fun if the sensors are too big of power draws or too limiting... sensors are able to do a lot, so you can do a lot with your scripts." The seeker must see far enough for a Javelin that climbs, turns, and comes back down.
- **What a sensor reports:** a contact list every tick (one entry per robot seen), plus `scan(id)` for a seen robot's parts on demand, so weak points can be found without paying for every part every tick.
- **Line of sight:** terrain and static blocks hide a robot; other robots do not.
- **Teams:** picked at deploy, and the choice sticks for the next deploy. You only switch into your own cores.
- **Deploy flip and 90 degree turns** are in M8 ("otherwise you can't make stuff like two launchers fight each other").
- **Targeting:** the launcher's radar picks the nearest enemy and hands that point off. Clicking a spot is later, and Logan flagged fairness: a click is something an AI robot cannot do.
- **Enemy drone:** carries 4 missiles, no reload. The fabricator bay stays next on the list.
- **Display:** what sensors see is drawn in the debug overlay, off by default.
- **Plan approved** (Logan, 2026-09-25, "do it"): teams must be real team numbers, not a friendly flag, so more teams can come later (decision 1 already is); the world will grow and get real terrain, so nothing may assume 1000 m or flat ground; wants both a direct homing missile and a Javelin.
- **Order** (Logan, earlier): sensors, teams, and handoff first; then homing and Javelin missiles; then the enemy drone. Fix the fast hover's overshoot early. Script speed is its own later milestone.

## What exists already
- Every robot is a `Robot` in `World.robots`, in spawn order. A woken piece (M6, M7) is a new robot with `brokeFrom` and runs its core's own controls from `cores`, scripts first ticking the tick after release.
- Scripts get `self`, `parts` (with world positions and mass), `keys`, `param`, `state`, `set`, `get`, `log` (`script/prelude.ts`, `World.scriptInput`). Input crosses into QuickJS as JSON each tick.
- Scopes: a placed missile's parts carry the tag `missile1`, and its core's controls live in `cores` with scope `missile1`.
- `mirrorBlueprint` and `placeBlueprint` (with `rot` and `mirror`) in `sim-core/blueprint`. The builder's stamp flips with F and turns with R.
- App: possession cycles with `,` and by clicking a robot (`control/possession.ts`); deploy holds a `SpawnGhost` until a click (`world/WorldScreen.ts`); `\` draws the debug overlay (`render/DebugDraw.ts`).
- CLI: `pnpm sim run <bp> --keys ... --drop <bp>@<t>:<x>,<y>` with a report of events, pieces, a side view, and rotator aims.
- Physics: Rapier ray casts are available through `PhysicsWorld` (add a method if none fits).

## Decisions (Claude's call unless marked Logan's, overturnable at Gate 7)

1. **Teams (sim-core).**
   - `Robot.team: number`. Team 0 is yours, team 1 is the enemy. A number rather than two names so AI against AI with more sides needs no format change; the app and CLI say "yours" and "enemy".
   - `spawnBlueprint(raw, at, { team })`, default 0. The spawn log, replays, and the state hash carry it. A replay without `team` loads as 0, so old replays still play.
   - Every piece that breaks off keeps its parent's team (a released missile is on its launcher's side).
   - Scripts never see team numbers: a contact's `side` is relative to the viewer (`enemy`, `friend`, or `none` for debris and headless robots). The same blueprint works on either side, which is what lets a blueprint fight a flipped copy of itself.
2. **Sensor parts are data.**
   - A def gains `sensor: { cone: <degrees, 360 for all around>, range: <m> }`, facing its `acts` face. The world reads `sensor`; no part type is special-cased.
   - A `sensor` behavior draws power while its `on` input (0 to 1, default 1) is above 0.5, so a script can switch a sensor off to save energy. An unpowered or switched-off sensor sees nothing.
   - Starting numbers (tuned in T2, Logan asked for strong): `seeker` 0.3 kg, health 20, cone 90 degrees, range 300 m, 1 J/s; `radar` 1 kg, health 40, all around, range 500 m, 3 J/s. The world is 1000 m wide.
   - Placeholder sprites through `packages/app/scripts/gen-placeholders.ts`; legend letters and builder keys in `02` and `10` (T2 picks free ones).
3. **What a sensor sees.**
   - A robot is seen when its reference point (its live core, or for debris and headless robots its center of mass) is inside a working sensor's cone and range, and the segment from the sensor to that point crosses no terrain or static block (one ray cast against fixed colliders only). Other robots never block (Logan).
   - Contacts are computed once per tick for robots that have a scripted core and a sensor, right before scripts run, from positions after the last physics step. Robots in spawn order, so the list is deterministic.
   - A robot never sees itself. Its own attached missiles are its parts, not contacts; once released they are separate robots and show up as friends.
4. **Script API additions** (`04`, Script API):
   - `contacts`: every robot this robot's sensors see this tick, nearest first (ties by id). Each: `{ id, side, core, pos, vel, center, mass, parts, distance, by }`. `id` is the robot id (stable while it lives), `core` is true when it has a live core (false for debris), `pos` and `vel` are the reference point's, `center` the center of mass, `parts` the part count, `by` the tags of the sensor parts that see it.
   - `scan(id)`: the seen robot's parts as `[{ type, pos, angle, health, maxHealth }]`, or `null` if it is not seen this tick. A host function, so the cost is paid only on call; at most 4 calls per script per tick (more return `null` and log once).
   - `send(to, data)`: `to` is a scope name (`missile1`) or a core part id; the core must be attached to the sender's robot right now (no radio yet). `data` is anything JSON, at most 1 KB. Returns true when queued. Delivered at the start of the next tick.
   - `inbox`: messages delivered to this core and not yet shown to its scripts, as `[{ from, tick, data }]`. A dormant core keeps its messages (at most 16, oldest dropped) until it wakes, so its `setup()` reads the launcher's handoff. The queue lives on the core's `PartInstance`, so it travels through splits, and it is in the state hash.
   - `mark(x, y, label?)`: draws a point in the debug overlay and the CLI side view (at most 4 per script per tick). Not simulation state. For showing a missile's handoff or last known point.
5. **Possession and teams in the app (Logan: only your own cores).**
   - `,` cycles and a click possesses only team 0 robots. Clicking an enemy follows it with the camera; the keys bar says it is an enemy you are watching.
   - Enemy robots are tinted red (like the damage tint), so the two sides can be told apart at a glance.
6. **Deploy (Logan).**
   - The world toolbar gets a "Deploy as: Yours / Enemy" toggle; it sticks (saved in the browser) until changed.
   - While a ghost is held, `F` flips it and `R` turns it 90 degrees, like the builder's stamp; the ghost shows the result and `canPlace` checks it. Flip and turn also stick for the next deploy (placing five enemies facing left is five clicks). Claude's call: while a ghost is held, R and F go to placing, not to the possessed robot.
   - One pure `orientBlueprint(bp, { flip, rot })` in `sim-core/blueprint` (built on `placeBlueprint`'s geometry), used by the app and the CLI, so the replay records the oriented blueprint and replays need no new field.
   - Flipping keeps tags and scripts as they are (as the builder's mirror does). A script that steers by `parts` positions and the core's heading works flipped; one with hard-coded left and right may not. The shipped examples are written to work flipped, and the playbook says how.
7. **Homing missiles.**
   - New `missile-seeker` blueprint: the M7 missile with a seeker behind the warhead (layout tuned in T6). Its `seeker.guide.js`:
     - reads the handoff point from `inbox` in `setup()` (none: flies straight like `missile-v2`);
     - flies toward the point, steering by proportional navigation on the line of sight (the time-optimal nose turn from `missile-v2`);
     - once its seeker sees an enemy with a live core near the point, updates the point to it every tick (the contact's velocity gives a lead);
     - when the target hides (behind a wall or out of the cone), keeps flying to the last point it knew and lands near it;
     - param `top` (default off): top attack, climbing to a height above the point and diving onto it, since every part in a blast's way halves its damage and robots armored at the front are soft from above;
     - `fuse` as before; ignores contacts lighter than a param `minMass` so it does not chase missiles (param, so an anti-missile missile is one change).
   - Shipped twice (Logan wants both): `missile-seeker` (direct) and `javelin` (the same guide with `top` on).
   - `missile` and `missile-v2` stay as they are, so every placed copy does too.
8. **Your drone and the enemy drone.**
   - `hunter-drone`: the `missile-drone-10prop` hover with a radar and 4 `missile-seeker`s. F fires the next missile at the nearest enemy the radar sees (the fire script sends the point to that missile's scope, then fires its decoupler); with no enemy seen it fires straight like before.
   - `enemy-drone`: the same airframe (flip-safe), all scripts start on deploy, no keys needed:
     - track: holds a standoff (param, about 60 m sideways and 10 m above) from the nearest enemy robot with a live core, and returns to where it was deployed when it sees nothing;
     - fire: in range and with a clear line, fires a missile at it, at most one every 3 s (param), 4 in all;
     - dodge: an enemy contact under `minMass` closing on it (distance shrinking, heading within a few meters of passing) makes it throw itself sideways, away from the missile's path, then return to tracking.
   - The AI is only blueprint and scripts; the engine has no AI code. That keeps "an AI builds and scripts its robots" (Logan, Q22) and means Claude builds more enemies with the playbook.
9. **Fast hover fix (Gate 6, finding 6, early).** `missile-drone-10prop.hover.js` overshoots when leaning toward a load that swung off center (74 degrees at a 60 degree lean) and falls short leaning away. T4 measures first (the fresh session's guess: the turn planner assumes full torque while some is spent holding the weight), then fixes it in the script: the braking and turning numbers use the torque left after the balance share. The stock `missile-drone`'s tilt after its first shot (known issue) is fixed the same way by computing its balance from `parts`. `hunter-drone` and `enemy-drone` use the fixed hover.
10. **Debug overlay.** With `\` on: each sensor's cone and range (faint), a line from the robot to each contact (red for enemy, blue for friend, grey for none), and script marks. Drawn from a read-only `World.sensorView(robotId)` and the last tick's marks, so rendering never runs the sensors itself.
11. **CLI and report.**
    - `--team enemy` for the main robot; drops take suffixes: `--drop enemy-drone@0:80,20:enemy:flip` (`:enemy`, `:flip`, `:rot90`).
    - Report events: "A sees B (enemy)" and "A lost B" (first sight and loss per pair, folded), "A sent missile1 {...}", and inbox reads on wake. The side view draws each piece's last mark as `@`. Pieces list their team.
    - `pnpm sim parts` shows sensor cone and range.
    - The playbook gains a Sensors section (the API, cones, line of sight, a homing recipe, the handoff recipe, flip-safe scripts, an enemy recipe) and the three new examples.
12. **Performance note (known, not fixed here).** The enemy drone runs about three scripts plus one per flying missile, at about 0.2 ms each (measured at Gate 6). Five enemy drones in a volley is fine; twenty is not, until the script speed milestone. The report's timing line (T5) makes it visible.

## Tasks

### T1: teams (sim-core, CLI)
- Tests first: spawn with a team; pieces inherit it through a decoupler and a blast split; hash changes with team; replay round trip with team; an old replay without `team` loads as 0; CLI drop suffix parsing (`:enemy`, `:flip`, `:rot90`, errors that say how to write them).
- `Robot.team`, `spawnBlueprint` option, `SpawnRecord`, `replayFile.ts`, split paths in `rebuild.ts` and `World`, CLI `--team` and drop suffixes (flip and turn wait for T8's `orientBlueprint`; until then the suffix parser accepts them and T8 wires them).
- Verify: `pnpm -r test`, `pnpm -r typecheck`, `pnpm sim determinism` still matches every CI snapshot.

### T2: sensor parts and contacts (sim-core)
- Tests first (`sensors.world.test.ts`): a radar sees a robot 100 m away and not one 600 m away; a seeker sees only inside its cone and turns with its part; a wall between hides the target and a robot between does not; side is enemy, friend, or none (debris, headless); a released missile is a friend; switched off or out of energy sees nothing; power drawn matches the def; order and values deterministic; parsePartDef accepts `sensor` and rejects bad cones and ranges.
- `parts/types.ts` and `parsePartDef.ts` (`sensor`), `seeker.json`, `radar.json`, `behaviors/sensor.ts`, a fixed-colliders ray cast in `PhysicsWorld`, `World` contacts before scripts, `contacts` in `ScriptInput` and the prelude, `scan()` as a QuickJS host function with its per-tick cap, sprites in `gen-placeholders.ts`, legend letters, `pnpm sim parts` columns.
- Verify as T1, plus a scratch run where a radar drone logs its contacts.

### T3: handoff messages (sim-core)
- Tests first: `send('missile1', { x, y })` from the pilot reaches the placed core; its `setup()` sees it in `inbox` on waking; a message sent in tick t is in `inbox` on tick t+1, in send order; a detached core cannot be sent to (returns false); size and queue caps; the queue survives a split and is hashed; `mark()` records points without touching the hash.
- `PartInstance.inbox`, delivery at the start of `step`, `send`, `inbox`, `mark` in the prelude and `ScriptInput`, `World.marks(robotId)`.
- Verify as T1.

### T4: fast hover fix (blueprint scripts)
- Measure the overshoot with a swung load (a `pnpm sim run` of `turret-drone` with the turret swung, and `missile-drone-10prop` with one missile gone), confirm the cause, fix `missile-drone-10prop.hover.js`, and give `missile-drone.hover.js` the balance from `parts`.
- Done-when (in `destructionDoneWhen.test.ts` or a new hover test): leaning 60 degrees toward and away from an off-center load ends within 5 degrees of 60, and the missile drone's tilt after its first shot stays under 2 degrees.
- CI determinism snapshots for these blueprints update, with the reason in the commit.

### T5: overlay and report
- `World.sensorView`, `DebugDraw` cones, contact lines, and marks; enemy tint in `RobotView`.
- CLI report: sight and send events, marks in the side view, teams in the piece list, a per-run script timing line (ms per tick, average and worst).
- Tests first for the pure parts (event folding, plot marks).

### T6: homing missiles (blueprints)
- `missile-seeker.json` and `seeker.guide.js` (decision 7), a `launcher-seeker` (the launcher with a radar and the seeker missile) to test with.
- Done-when tests (`homingDoneWhen.test.ts`), each in the CLI too:
  - fired flat at a hovering enemy drone 150 m away and 20 m higher, it hits (the target loses parts or is destroyed) within 5 s;
  - the same target moving sideways at 10 m/s: still hits;
  - the target behind the 2 m box (hidden from the seeker at launch): lands within 5 m of the handoff point;
  - `top` on: climbs above the point and comes down on the target from above;
  - fired with no handoff and nothing seen: flies straight and detonates on its fuse.

### T7: hunter drone and enemy drone (blueprints)
- `hunter-drone` and `enemy-drone` with their scripts (decision 8), both flip-safe.
- Done-when tests (and a CI determinism step for the duel):
  - `enemy-drone` alone with a parked target robot (team 0) 150 m away: moves to its standoff, fires, and the target is hit;
  - `enemy-drone` fired at by a dumb `missile` (straight line, team 0): dodges it in the test's scenario;
  - `hunter-drone` with F pressed and an `enemy-drone` in front: the missile goes after the enemy (distance to it shrinks and ends under 5 m, or the enemy dodges and the missile passes, both reported);
  - the duel: `hunter-drone` hovering and `enemy-drone` deployed flipped as enemy, run 30 s, deterministic.

### T8: deploy flip, turn, and side (app, sim-core helper)
- Tests first: `orientBlueprint` (flip, 90, 180, 270, flip plus turn; ids, rotations, bindings, `cores` follow; the core stays the anchor); sticky deploy settings as pure state; possession skips enemies.
- `orientBlueprint` in `sim-core/blueprint` and CLI drop suffixes wired to it; `WorldScreen` placing with F and R, the toolbar side toggle (saved in local storage), possession by team, keys bar text for an enemy.
- Verify in the browser at `http://localhost:5180` (Logan runs `pnpm dev`; use a separate port if a preview is needed and stop it after): deploy two `launcher`s facing each other, one as enemy; deploy an `enemy-drone` flipped; `,` never lands on the enemy.

### T9: docs, playbook, review, gate
- `02` (sensor parts as built), `04` (script API: contacts, scan, send, inbox, mark; teams and possession), `07` (Q2 note, Q22 decided), `10` (deploy side, flip, turn), `11` (replays with team), the playbook (Sensors section, examples, traps found during T6 and T7), `docs/critique/gate-7.md` with what to try, this plan's As built section.
- Opus review subagent over the milestone diff; fix findings; tag `m8`; status handoff; stop at Gate 7.

## Gate 7 (Logan)
- Deploy `enemy-drone` as Enemy (flip it to face you), then your `hunter-drone`. Fly around: the enemy should follow at a distance, fire homing missiles at you, and duck your missiles some of the time. Fire back with F.
- With the overlay on (`\`), watch the cones, the contact lines, and each missile's marked target point.
- Park something behind the 2 m box and fire a seeker missile at it with `top` on: it should climb and come down on it, or land near where it was last seen.
- Deploy two launchers facing each other, one as Enemy.
- Try `,`: it should never switch you into an enemy.
