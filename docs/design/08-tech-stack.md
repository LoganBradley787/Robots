# 08 Tech stack

Status: draft, 2026-09-22. Versions were verified against npm on that date; details and citations are in `docs/research/`. Pin the versions below in `package.json` and bump deliberately.

## Choices

| Concern | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node | 24 LTS | Installed; Vitest 5 needs 22.12+. |
| Package manager | pnpm workspace | 11.x | Three packages, one lockfile. |
| Language | TypeScript | 7.0.2 | The Go compiler now ships as `typescript`. `strict` is on by default. |
| Build | Vite | 8.3.0 | Rolldown bundler, native WASM ESM, top-level await in the default target. |
| Tests | Vitest | 5.0.1 | `projects`: sim core under node, app under happy-dom. |
| Physics | `@dimforge/rapier2d-deterministic-compat` | 0.20.0, pinned | `enhanced-determinism` build with embedded WASM, `await RAPIER.init()`, identical bytes in browser, Vitest, and Node. |
| Rendering | `pixi.js` | 8.21.0 | WebGL preference (WebGPU still experimental). |
| UI | `preact` + `@preact/preset-vite` | 10.29.8 / 2.10.6 | React-shaped code that AI writes well, about 5 kB. |
| Script sandbox | `quickjs-emscripten-core` + a release-sync variant | 0.32.0 | See `04` and `docs/research/script-sandbox.md`. |
| Script editor | `<textarea>` first, then `codemirror` + `@codemirror/lang-javascript` | 6.0.2 / 6.2.5 | Monaco only if typed autocomplete becomes a headline feature. |
| Placeholder art | `pngjs` | 7.0.0 | Pure JS, zero native deps, writes the atlas directly. |
| Persistence | `idb-keyval` + File System Access API with download fallback | 6.3.0 | IndexedDB autosave, explicit export and import. |

## Repository layout

```
packages/sim-core/     pure TypeScript simulation. lib ES2023, types []. No DOM types, so DOM use fails to compile.
  src/parts, blueprint, assembly, physics, control, script, resources, damage, world, replay, metrics
packages/app/          Vite + PixiJS + Preact. Depends on @robots/sim-core (workspace:*).
  src/render, src/ui, src/main.ts, public/assets/
  scripts/gen-placeholders.ts
packages/cli/          Node headless runner and replay checker. Depends on @robots/sim-core only.
blueprints/            shipped and Claude-authored blueprints (json plus js scripts)
worlds/                world files
docs/                  design, research, plans
```

- Vite treats linked workspace packages as source, so edits in `sim-core` hot reload in the app.
- The CLI runs with Node's built-in type stripping, which `erasableSyntaxOnly` guarantees works, or with `tsx` if that proves fragile.
- Root `vitest.config.ts` lists `projects: ['packages/*']`.

## TypeScript 7 settings that matter
- Base: `target es2023`, `module esnext`, `moduleResolution bundler`, `verbatimModuleSyntax`, `moduleDetection force`, `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noEmit`, `skipLibCheck`.
- `types` defaults to `[]` now, so `app` sets `"types": ["@types/web", "vite/client"]` and must not use `lib: ["DOM"]` (PixiJS 8.21 requires `@types/web` under TS 7). `cli` sets `"types": ["node"]`. `sim-core` leaves it empty.
- `baseUrl` is gone; the workspace avoids path aliases entirely, which also sidesteps Vitest not honoring `resolve.tsconfigPaths` yet.

## Physics package notes
- The JS bindings moved: `dimforge/rapier.js` was archived on 2026-07-12 and the bindings now live in `dimforge/rapier/typescript`. 0.20.0 (2026-08-08, wrapping Rust rapier 0.35) moved dist files, rewrote sleeping, and enables sweep CCD by default. The `canary` tag carries soft-body changes with breaking signatures on `removeCollider` and `step`, so pin exactly 0.20.0 and read the changelog before any bump.
- Six 2D packages exist: base, `-simd`, `-deterministic`, each with a `-compat` twin. `-deterministic` is the cargo `enhanced-determinism` feature; base is documented as locally deterministic only. Use `-deterministic-compat` everywhere: the non-compat build fails in plain Node and needs WASM plugins under Vite, while compat is 2.1 MB on disk (about 0.8 MB gzipped) and loads by `import` or `require` with zero config.
- Measured in the spike: the same build is bit-identical run to run. Different builds agree on body state for hundreds of steps but not on snapshot bytes, so hashes are per-body state, never snapshot bytes.
- `takeSnapshot` and `restoreSnapshot` round-trip, but user data is not part of the JS API and `restoreSnapshot` leaks about 1.7 KB per call (open issue). v1 uses replay, not snapshots.
- Performance headroom: about 2 ms per step for 3,000 awake boxes on an M3 Pro, body creation about 5 microseconds, destruction about 1.5 microseconds. Sleeping bodies are nearly free.
- TypeScript: add `esnext.disposable` to `lib` (or keep `skipLibCheck`) so the shipped types resolve under strict mode.
- Behavioral facts that shape `03`: forces accumulate across steps (use impulses), colliders carry no user data (side table by handle), mass properties lag collider removal (recompute explicitly), and the JS guide pages lag the code (trust the shipped `.d.ts` and the repo changelog).

## Rendering conventions
- `packages/app/src/render/units.ts` owns `METERS_PER_CELL`, `PIXELS_PER_METER`, `toScreen`, `toWorld`, and the single y flip. No sign flips anywhere else.
- One `Container` per rigid body, one `Sprite` per part at body-local offsets. Each frame sets only the container's position and rotation. When a part changes body, reparent its sprite.
- Fixed step with an accumulator clamped at 250 ms, previous and current transforms per body, render at `lerp(prev, curr, alpha)` with shortest-arc angle lerp. Rendering is one tick behind by design.
- Camera is the world container: `pivot` at the camera position, `position` at screen center, `scale` for zoom and the y flip.
- `resolution: devicePixelRatio, autoDensity: true`. Placeholder art is 64 px per cell (2x the 32 px-per-meter zoom-1 size) with `scaleMode: 'linear'`, set before any texture loads (changed in M1 from `nearest`: a 2x downscale with `nearest` drops pixel rows; linear stays clean on Retina at zoom 1 and when zoomed). Atlas frames have 2 px padding and 1 px edge extrusion so linear filtering never bleeds. Terrain tiles are standalone PNGs so they can repeat in a `TilingSprite`. Sprites are sized to one cell in code, so art resolution can change without code changes.
- Debug draw: one long-lived `Graphics` inside the world container, `clear()` per frame, `stroke({ pixelLine: true })` once per color run from `world.debugRender()`.
- Assets: `public/assets/manifest.json` with bundles `parts` and `fx`, each a spritesheet JSON plus PNG. Code references frame names only, through `src/render/assetKeys.ts`, with a test that every key exists in the loaded sheet. Real art is a file swap. Propeller spin and thruster flame are `AnimatedSprite` animations in the `fx` sheet with `animationSpeed` driven by throttle.
- Vendor the official PixiJS agent skills (`pixijs/pixijs-skills`) into the repo so coding sessions use v8 idioms.

## Script sandbox packaging
- `sim-core` exposes `createQuickJsHost(variant)`. The app passes `@jitl/quickjs-singlefile-browser-release-sync` (WASM embedded, no bundler config). The CLI and tests pass `@jitl/quickjs-wasmfile-release-sync`. Both are the same engine build, so semantics match.
- One runtime per script instance with `setMemoryLimit`, `setMaxStackSize`, and a counting `setInterruptHandler`. Never `shouldInterruptAfterDeadline`, which is wall clock.
- Handles are disposed inside the host wrapper only; nothing outside `script/` sees a QuickJS type.

## UI conventions
- PixiJS canvas fills a `div`; the Preact root is a sibling with `pointer-events: none` and `pointer-events: auto` on panels.
- Sim state reaches the UI through a small store the tick loop writes and components read. The UI sends commands (spawn, possess, toggle script, set param) to the sim; it never mutates sim objects.
- Keyboard capture is suspended while a text field has focus.

## Persistence
- Autosave every editor change, debounced, to IndexedDB via `idb-keyval` under `{ schemaVersion, savedAt, blueprint }` with a migrations table keyed by `schemaVersion`.
- Export and import: `showSaveFilePicker` when present (Chromium only, about a third of browsers), else Blob download and `<input type="file">`.
- `localStorage` only for UI preferences. Call `navigator.storage.persist()` once after the first save. Safari evicts script-written storage after 7 days without interaction, so the UI nudges export.
