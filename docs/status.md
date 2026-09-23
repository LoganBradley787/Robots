# Status

Updated: 2026-09-23, by a coding session (Opus 5.5)

- Current milestone: M0, plan `docs/plans/M0-skeleton.md`
- Done: planning. M0 T1 (workspace scaffold): install, typecheck, test, `pnpm sim`, and the DOM firewall check all verified.
- In progress: none
- Next: M0 T2 (seeded PRNG and state hasher)
- Known issues: none
- Decisions since the plan:
  - pnpm 11 blocks dependency build scripts by default. `pnpm-workspace.yaml` has `allowBuilds: { esbuild: true }` so tsx's esbuild installs. Add future native deps there on purpose, not by blanket approval.
  - `@types/web` stays `*` in package.json; the lockfile pins 0.0.357, which works with PixiJS 8.21 and TS 7.
- Next gate: Gate 1 (Look) at the end of M1
