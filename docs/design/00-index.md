# Design docs

Read in order. Status lines at the top of each doc say whether it is draft, proposed, or approved.

- `01-architecture.md`: layers, module map, tick order, determinism rules, events.
- `02-parts-and-blueprints.md`: PartDef schema, starting parts, blueprint JSON with ASCII grid, default legend, validator.
- `03-assembly-physics-destruction.md`: attachment graph vs body partition, compound bodies, joints, forces, damage pipeline, splitting, explosions.
- `04-control-and-scripting.md`: channels, tags, bindings, arbitration, latching, input sources, script API, ScriptHost.
- `05-power-and-resources.md`: generic resource pools, batteries, brownout.
- `06-milestones.md`: M0 to M7 with done-when criteria.
- `07-open-questions.md`: every open question with a recommendation and the milestone it blocks.
- `08-tech-stack.md`: library choices, versions, repo layout, rendering and sandbox packaging conventions.
- `09-execution-strategy.md`: roles, task units, handoff protocol, verification gates, parallelism, milestone boundaries.
- `10-builder.md`: the blueprint builder screen, saving, and deploy, as decided with Logan.
- `11-control.md`: possession, robots you stop controlling, driving feel, the keys bar, and replays, as decided with Logan.

Source of truth for the vision: `../handoff-2026-09-22.md`. Working rules: `../../CLAUDE.md`.
