# 09 Execution strategy

Status: proposed, 2026-09-23. How a project too big for one agent gets built by many sessions without losing the thread.

## Roles
- Planning sessions (Fable): design docs, milestone plans, design reviews at milestone boundaries, resolving cross-cutting questions with Logan.
- Coding sessions (Opus 5.5): execute one plan task at a time, test first inside `sim-core`, commit per task, update status.
- Subagents: Opus only. Used for research, code review after a task, and for independent tasks run in parallel.
- Logan: answers questions, approves plans at milestone boundaries, plays with the result. Nothing else is required of Logan for the project to move.

## Units of work
- Milestone (M0 to M7, see `06`): one plan file `docs/plans/M<n>-<name>.md`, written from the design docs, approved by Logan before any code.
- Task: one numbered step in a plan, sized so a single session finishes and verifies it in one sitting. Each task states: files to create or change, tests to write first, the done-when check, and which earlier tasks it depends on.
- Session: starts by reading `CLAUDE.md`, `docs/status.md`, and the current plan; takes the next unblocked task or the one Logan names; ends with tests green, a commit, and `status.md` updated.

## Handoff protocol
- `docs/status.md` is the single place a fresh session looks: current milestone, tasks done, in progress, and next; known issues; mid-milestone decisions with dates. Updated at the end of every session, no exceptions.
- One commit per task. Message format: `M2 T4: bindings evaluate hold mode`. Never leave the tree red or uncommitted at session end.
- A decision that changes a design doc is edited into that doc in the same commit, with the doc's status line updated. Docs never lag the code.
- Questions for Logan that are not blocking go to `docs/questions-pending.md` with the assumption the session proceeded under. Blocking questions stop the task and say so in `status.md`.
- New ideas go to `docs/ideas.md`, not into scope.

## Verification gates
- Every task: `pnpm test` and `pnpm typecheck` pass across the workspace. `sim-core` compiles without DOM types, which is the purity check. The determinism test passes.
- Every task: an Opus review agent reads the diff against the task's done-when and the design docs, looking specifically for part-specific branches in engine code, wall-clock or unordered iteration in `sim-core`, and channel writes outside `control/`. Findings are fixed before the next task starts.
- Every milestone: the done-when demo from `06` is run in the browser (via the in-app browser tools) and in the headless runner where it applies. The plan carries a short demo checklist; the result is recorded in `status.md`.
- The headless runner is the coding sessions' main test tool from M1 on. If it cannot show a behavior, add a metric before adding the behavior.

## Critique gates (the anti-slop rule)
Logan's rule: build in layers, and critique each layer before the next one is built on top of it. Otherwise crappy textures get bad physics on top, then an unintuitive UI on top of that, and everything is cooked. Gates are few and big, not fifty small ones.

- A gate is the end of a layer, not the end of a task. Coding sessions do not stop for critique inside a layer unless Logan asks.
- At a gate the build pauses. Logan plays it and rips it apart: textures, scale, how things fit together, how hard it is to get from the builder to the world, how the world looks, how the physics feel. Nothing is too small.
- A session turns the critique into a numbered punch list at `docs/critique/<gate>.md`, one line per complaint in Logan's words plus the fix approach. Ambiguous complaints get a clarifying question, not a guess.
- Items are fixed one at a time, one commit each, verified in the browser, then Logan looks again. The gate stays closed until the list is empty or Logan explicitly defers items to `ideas.md`.
- No work on the next layer starts while a gate is closed. If a fix reveals a design problem (for example the editor and world need to be one screen), the design doc changes first and the fix follows the doc.
- Repeated complaints of one kind become a rule in `CLAUDE.md` or a convention in `08` so later sessions do not reintroduce them.

## The gate ladder
Each gate is a milestone boundary in `06`. The order is chosen so that what is judged at a gate is the foundation for the next one. Logan delegated the order; the reason visuals come first is that the backend is protected by tests and the headless runner, which do not need Logan's eyes, while visuals and UX can only be judged by Logan.

1. Gate 1, Look (end of M1): the world, camera, scale, placeholder textures on a spawned robot resting on its wheels. Nothing drives yet. Judge: textures, sprite fit, world look, camera feel, time controls.
2. Gate 2, Builder (end of M2): the editor, palette, placement, rotation, tags, save and load, spawning, and the trip between builder and world. Judge: is building intuitive, does the transition suck.
3. Gate 3, Robot feel (end of M3): wheels, thrusters, propellers, keybinds, possession. Judge: do the physics make sense, do controls feel right, is it fun.
4. Gate 4, Power and scripts (end of M5, M4 folds into it): energy bar, running dry, script panel, sliders, crash messages, the hover drone. Judge: is scripting approachable, does power feel meaningful.
5. Gate 5, Destruction (end of M6): explosions, splitting, debris, decouplers, missiles. Judge: does blowing things up look and feel right.
6. Gate 6, Claude loop (end of M7): Logan asks for a robot, Claude builds it. Judge: the loop from Logan's side.

## Parallelism
- Each plan marks task dependencies. Independent tasks (for example the blueprint validator and the sprite renderer) run in separate git worktrees by separate sessions and merge when green.
- Interfaces first: any `sim-core` public type that two tasks share (`PartDef`, `BlueprintJson`, `InputSource`, `ScriptHost`) is landed in its own early task so parallel work codes against a fixed contract.
- Keep parallel width small, two or three sessions, so merges stay trivial.

## Scope control
- No task adds a part-specific branch to engine code. Add a def or a behavior module.
- No task widens scope beyond its plan step, even for a one-line improvement elsewhere. Note it in `ideas.md` or `status.md` instead.
- Deferred features in the handoff stay deferred until a planning session promotes them into a milestone.

## Milestone boundaries
1. Coding sessions finish the last task and record the demo result.
2. A planning session reviews what shipped against `06` and the design docs, edits the docs to match reality, and lists what the next milestone needs answered.
3. Logan answers, the planning session writes the next plan, Logan approves, coding resumes.

## Git
- One repository, `main` always green. Feature branches per task are optional when working alone; required when two sessions run in parallel.
- Tags at each milestone (`m0`, `m1`, ...) so a demo can always be checked out.
