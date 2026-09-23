# 07 Open questions and decisions

Status: all decided, 2026-09-23. Logan answered Q1, Q2, Q11, Q16, Q17 directly and delegated the rest ("you're the expert"). Delegated decisions are marked "Claude's call" with the reason, and Logan can overturn any of them at a critique gate. New questions go to `docs/questions-pending.md`.

## Answered by Logan

### Q1. Multi-core: no takeover
- Decision: when the active core dies, the chunk goes headless and latches, even if dormant cores (missile brains) remain in it. A dormant core wakes only when it becomes the sole core in its own chunk, which happens when its sub-assembly splits off.
- Logan's reasoning: with four missiles attached, picking one to take over is arbitrary, and a missile brain is not "activated" just because the pilot died. Shoot the pilot of a fighter jet and it does not start flying by its missiles.
- Consequence: no redundant-core designs in v1. An opt-in `backupCore` flag could be added later as data.

### Q2. Sensors: core built-ins plus sensor parts
- Decision: every core provides position, velocity, acceleration, angle, spin (angular velocity), and energy (stored and capacity). Nobody should have to place an accelerometer or a battery monitor.
- Exotic sensing is a physical part with mass and power draw. Logan's concrete ideas, recorded in `02` as deferred parts: a scanner that reports what is in front of it, and a finder with a 30 or 60 degree cone that reports the nearest enemy core's distance and bearing, possibly in several power levels.
- Motivating use: a power-saving script that shuts engines at 5 percent energy and runs an auto-landing sequence.

### Q11 and Q17. Damage: warheads only
- Decision: the only v1 damage source is the warhead explosion. Batteries do not explode. No impact damage.
- Logan's reasoning: moving robots matters more than damage right now, but destruction has to be testable, so a warhead is worth having.
- Acceptance test for M6, in Logan's words: build a long robot with two wheels and the core on one end, drive it forward, spawn a bomb above it, let it drop and explode, and make sure the robot properly breaks in half.

### Q16. Repo
- Decision: private GitHub repository `Robots` under `LoganBradley787`, pushed by Claude. Logan manages `gh auth switch` between accounts as needed; there is no default state to restore.

## Claude's call (Logan delegated)

### Q3. Controls UI: both
- Keyboard binds plus an on-screen panel listing the possessed core's binds as clickable buttons that act as the same virtual keys. The panel doubles as the binding editor. Judged at Gate 2 and Gate 3.

### Q4. Multi-tile parts: supported in data, all v1 parts 1x1
- `footprint` is a list of cells from day one, the grid uses `=` for continuation cells, the validator checks coverage. The editor gains multi-cell placement only when the first multi-cell part arrives. Reason: near-zero cost now, four-module refactor later.

### Q5. Rotator: M6
- Same revolute joint as the wheel in position mode, one part def, input channel `angle` in [-1, 1] mapped to a configured range. Cheap once wheels exist, and it makes aimed missiles possible in the destruction milestone.

### Q6. World: flat ground, boxes, a ramp
- JSON world file with a flat static ground and a short list of static boxes and a ramp. Targets are core-less blueprints (a wall of frame blocks) so destruction works on them for free. Hills and a terrain editor stay deferred behind the same file.

### Q7. Scale: 1 tile = 1 m
- Gravity 9.81, 32 px per meter at zoom 1, starting masses and forces per the table in `02`. Reason: blueprint coordinates, metrics, and explosion radii are all in the same integer units, which keeps Claude-authored blueprints and test reports readable. One constant, tunable via the headless runner, judged at Gate 1 and Gate 3.

### Q8. Camera and time
- Follow the possessed core with smoothing, wheel zoom, drag to pan (pauses follow until a re-follow key), pause, single step, 0.25x to 4x. Time scale is ticks per frame so determinism holds. Judged at Gate 1.

### Q9. Persistence: files in the repo, explicit save (revised by Logan, 2026-09-23)
- Originally IndexedDB autosave plus export and import. Logan chose instead: blueprints are files in `blueprints/`, written through the dev server, with explicit Save and Save As (autosave would wreck a design you are experimenting on). Claude and Logan share one set of blueprints. Details in `10-builder.md`.

### Q10. Script API
- The draft in `04` stands, including `world.robots()` with perfect information for later targeting. Revisited at Gate 4 with a real hover script in hand.

### Q12. Script sandbox: QuickJS in WASM
- `quickjs-emscripten`, one runtime per script, instruction-count budget. A spike confirmed the interrupt is bytecode based, deterministic, and uncatchable. Details in `04`, `08`, and `docs/research/script-sandbox.md`.

### Q13. Blueprint text format: JSON with an ASCII grid
- `grid` rows plus `legend` inside the JSON, scripts as separate `.js` files on disk, inlined in memory. One parser, still readable by Claude and humans. A fully custom text format was rejected as a second surface to keep in sync.

### Q14. Milestone order and gates
- Look, builder, robot feel, power and scripts, destruction, Claude loop, with a critique gate at each boundary. Reason for putting visuals first: the backend is protected by tests and the headless runner, which do not need Logan's eyes; visuals and UX can only be judged by Logan, so the gates sit where Logan's attention adds the most information. Logan called the order an example and delegated it.

### Q15. UI: Preact, textarea then CodeMirror
- Preact with the Vite preset for panels, plain textarea for scripts in M5, CodeMirror 6 after Gate 4 if the textarea is the complaint.

### Q18. Decoupler: directional
- A release face set by rotation. Firing severs only that face and applies a small separation impulse. The decoupler stays as an inert part on the parent side.

### Q19. Binding conflicts: sum and clamp
- Multiple held bindings on one channel sum and clamp, so A plus D gives 0. A toggle that is on counts as manual and overrides scripts on that channel until toggled off. Scripts read keys freely to blend.

### Q20. Spawn: click to place, from the builder
- Ghost preview, primary core (or the single part for core-less blueprints like a bomb) lands on the cursor, works in mid-air. Overlap is refused. Revised with Logan 2026-09-23: spawning starts only from the builder's Deploy button (one drop per deploy); a quick-spawn menu and a respawn shortcut in the world are not planned for now.

### Q21. Terrain: immune
- Terrain takes no damage in v1. Destructible terrain later means terrain made of cells, a separate feature.
