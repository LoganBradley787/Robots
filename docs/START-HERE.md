# Start here

For any session picking up this project, on any model. Read in this order, then work the current plan.

1. `CLAUDE.md`: working rules. Non-negotiable: no em dashes anywhere, ask before large work, parts are data, `sim-core` has no DOM, critique gates at layer boundaries only.
2. `docs/status.md`: where things stand and the next task.
3. `docs/design/00-index.md`, then `01` through `05` (the design), `06` (milestones and gates), `07` (every decision and the reason), `08` (stack, versions, repo layout), `09` (how work is done: tasks, commits, handoff, gates).
4. The current plan in `docs/plans/`. M0 is `docs/plans/M0-skeleton.md`.
5. `docs/research/` only when a task touches that library (Rapier, PixiJS and tooling, script sandbox). The plans already carry the verified facts.

## Building a robot on request
If Logan asks for a robot rather than milestone work, read `docs/claude-robot-playbook.md` instead of the plan.

## How to work a plan
- Use the superpowers `subagent-driven-development` skill (recommended) or `executing-plans`. One task at a time, tests first, then implementation, then the plan's verification step.
- Commit after every task: `M0 T3: rapier loader and PhysicsWorld`. Never leave the tree red.
- Push rarely (Logan, 2026-09-25): every push runs CI on the GitHub Actions free plan. Push at a milestone's gate (with its tag) or when Logan asks, not after each commit.
- Golden hashes (M9): `packages/cli/test/golden.test.ts` fails when any of its scenes (21 at M11) ends in a different state. A change that should not change the sim must keep them; one that changes the sim on purpose rewrites them with `UPDATE_GOLDEN=1 pnpm test` and says why in the commit.
- If a step's expected output does not match, stop and fix it before moving on. If a fix changes a design decision, edit the design doc in the same commit.
- Non-blocking questions go to `docs/questions-pending.md` with the assumption you proceeded under. Ideas go to `docs/ideas.md`.
- Do not stop for critique inside a milestone. The gate is at the milestone boundary (see `09`).
- End every session by updating `docs/status.md`: done, in progress, next, known issues, decisions.

## Milestone boundary
When the last task of a milestone is done, committed, and pushed (the one push of the milestone, with its tag), stop. Logan plays it at the gate and files a punch list in `docs/critique/`. The next milestone's plan is written by a planning session after the punch list is empty.

## Opening line for a new session
"Read docs/START-HERE.md and begin the next task in docs/status.md."
