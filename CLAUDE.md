# Robots: 2D robot sandbox

Browser, TypeScript, Rapier 2D (WASM, deterministic), PixiJS, Vite. See `docs/design/` for the design and `docs/handoff-2026-09-22.md` for the original vision.

Every session starts by reading `docs/START-HERE.md`, then `docs/status.md`, except a request to build a robot (next paragraph).

**Asked to build a robot** ("build me a drone with missiles")? Read `docs/claude-robot-playbook.md` and follow its loop: write the blueprint in `blueprints/`, check it with `pnpm sim validate`, `show`, and `run`, and hand it over when it works. That work skips `START-HERE.md`, `status.md`, and the milestone plan.

## Working with Logan (read this first)

- Logan is a CS student and software engineer. This is a personal side project pushed far with AI while Logan spends little time. Fun sandbox, not a product.
- Before any large piece of work, ask clarifying questions. Logan prefers being asked a lot over you assuming.
- Push back when you think Logan is wrong. Phrase it as "I think you may be mistaken," never "you're wrong."
- Proactively flag things Logan did not ask about.
- Bullet points over padded prose.
- NEVER use em dashes anywhere: not in docs, code comments, commit messages, or replies. Use commas, colons, or periods.
- Give recommendations with each question so Logan can answer "agree with all except #N."
- Commit often, push rarely: push only at a milestone's gate or when Logan asks (every push spends GitHub Actions minutes on the free plan).

## Project rules

- Planning before code. Do not write game code for a milestone until its open questions are answered and its plan is approved.
- `packages/sim-core/` is pure TypeScript: no DOM, no PixiJS, no browser globals. It is compiled without DOM types on purpose and must run unchanged in Node for the headless runner. Rendering and UI live in `packages/app/`, the headless runner in `packages/cli/`.
- Determinism is a feature. Fixed timestep, seeded RNG, stable iteration order, inputs sampled once per tick. Never read wall-clock time inside `sim-core`.
- Parts are data. Adding a part means adding a definition (and at most a small behavior module). Never special-case a part type in engine code.
- Every part has health from day one. Every resource (energy now, fuel later) goes through the generic resource system.
- Keep the AI-facing hooks alive: blueprint validator with actionable errors, ASCII grid layout, headless runner. If a change breaks them, fix them in the same change.

## Conventions

- Package manager: pnpm workspace. Tests: Vitest, focused on `sim-core`. TypeScript 7 (strict by default, `types` must be listed explicitly).
- Coordinates in `sim-core` are physics coordinates: meters, x right, y up. Grid cells are integers in the same frame. Rendering flips y.
- Rotations are 0, 90, 180, 270 degrees counterclockwise.
- Docs live in `docs/design/` (numbered), research in `docs/research/`, milestone plans in `docs/plans/`.
