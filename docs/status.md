# Status

Updated: 2026-09-23, by a coding session (Opus 5.5)

- Current milestone: M0 complete, plan `docs/plans/M0-skeleton.md`. Logan chose to run straight on to Gate 1: this session writes the M1 plan and builds M1 without a stop at M0.
- Done: M0 T1 to T10. Workspace, PhysicsWorld, world file, World with input log and hashing, headless CLI, Pixi app with fixed step, time controls, interpolation, camera, CI.
- In progress: writing `docs/plans/M1-parts-and-assembly.md`.
- Next: M1 T1 once the plan is written.
- Known issues:
  - Debug outlines are faint (1 px, Rapier's default colors). Fine for debug; sprites replace them as the main visual in M1.
- Decisions since the plan:
  - Root `sim` script is `pnpm --filter @robots/cli start` with no trailing `--`: pnpm forwards args itself, and the extra `--` reached `process.argv` and would break `parseArgs`. Plan updated.
  - pnpm 11 blocks dependency build scripts by default. `pnpm-workspace.yaml` has `allowBuilds: { esbuild: true }` so tsx's esbuild installs. Add future native deps there on purpose.
  - `@types/web` stays `*` in package.json; the lockfile pins 0.0.357, which works with PixiJS 8.21 and TS 7.
  - Dev server port is 5180, not 5173: Docker on Logan's machine holds 5173. Changed in vite config, launch.json, README, and the plan.
  - Keys fall back to `event.key` when `event.code` is empty, because automation tools (the in-app browser) send synthetic events with no code.
  - Review fixes after T9: the world hash includes the RNG state (golden hash updated before CI existed, `docs/design/01` updated: hashes are exact bits, not quantized); `parseWorldFile` rejects unknown keys and non-boolean `dynamic`; `InputLog` is keyed by tick and rejects non-increasing ticks; `PhysicsWorld.world` is private; a failed Rapier init can be retried; CLI `--json` is a boolean flag and `--seed` must be a u32 integer.
  - Per-task reviews are batched (T2 to T6, then T7 to T10) instead of one agent per task, to save cost.
  - Verified: the browser and the Node CLI produce the same hash at tick 180 (`8db3e048` before the RNG was added to the hash), so determinism holds across the two runtimes on one machine.
- Carry into M1: `PhysicsWorld.removeBody` must delete from both maps; free any `EventQueue` in `free()`; add a golden-hash scene with a jointed, wheeled robot.
- Next gate: Gate 1 (Look) at the end of M1
