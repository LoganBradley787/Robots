# Rendering and tooling research: 2D robot sandbox (TypeScript + Vite)

Researched 2026-09-22. Every version below was read from the npm registry or the project's own docs on that date. Where a claim could not be verified it is marked as such.

## 0. Verified versions (npm `latest`, 2026-09-22)

- pixi.js 8.21.0 (released 2026-09-17): https://registry.npmjs.org/pixi.js/latest, https://github.com/pixijs/pixijs/releases
- vite 8.3.0 (Node ^20.19 || >=22.12): https://registry.npmjs.org/vite/latest
- vitest 5.0.1 (Node ^22.12 || ^24 || >=26; peer vite ^6.4 || ^7 || ^8): https://registry.npmjs.org/vitest/latest
- typescript 7.0.2 (the Go-native compiler now ships as `typescript`): https://registry.npmjs.org/typescript/latest
- @dimforge/rapier2d 0.20.0, @dimforge/rapier2d-compat 0.20.0, @dimforge/rapier2d-simd-compat 0.20.0
- quickjs-emscripten 0.32.0; idb-keyval 6.3.0
- pngjs 7.0.0; sharp 0.35.4; @napi-rs/canvas 1.0.9; canvas 3.2.3
- codemirror 6.0.2; @codemirror/state 6.7.6; @codemirror/view 6.43.13; @codemirror/lang-javascript 6.2.5; monaco-editor 0.56.0
- preact 10.29.8 + @preact/preset-vite 2.10.6; solid-js 1.9.15 + vite-plugin-solid 2.11.14; react 19.3.0 + @vitejs/plugin-react 6.1.1
- vite-plugin-wasm 3.6.0; vite-plugin-top-level-await 1.6.0
- Node: v24 and v22 are LTS, v26 is Current (https://nodejs.org/en/about/previous-releases). Use Node 24.

## 1. PixiJS current state

- Current major is v8 (8.21.0). Single package `pixi.js`; sub-packages (`@pixi/*`) are gone. Migration guide: https://pixijs.com/8.x/guides/migrations/v8
- Init is async: `const app = new Application(); await app.init({ resizeTo: window, background: '#1a1a1a', antialias: false, resolution: devicePixelRatio, autoDensity: true }); container.appendChild(app.canvas);` https://pixijs.com/8.x/guides/components/application
- Renderer selection: `preference: 'webgl' | 'webgpu'` (default `'webgl'`), or an array to whitelist, via `autoDetectRenderer`. WebGL is marked "Recommended", WebGPU is "Experimental: inconsistencies in browser implementations may lead to unexpected behavior". A Canvas renderer appears in the API's `preference` options but the guide still lists it as "coming soon". https://pixijs.com/8.x/guides/components/renderers
- WebGL renderer prefers WebGL2 and falls back to WebGL1 (`preferWebGLVersion`, default 2): https://pixijs.download/release/docs/rendering.WebGLOptions.html
- Minimum browsers: PixiJS publishes no version matrix. Practical floor is "any browser with WebGL 1"; the v8 launch post cites WebGL on ~95% of browsers and WebGPU on ~27%: https://pixijs.com/blog/pixi-v8-launches
- Bundle: ~261 kB gzip for the full `pixi.js` entry (https://bundlephobia.com/package/pixi.js@8.21.0). Tree shaking is weak by design (extensions self-register): https://github.com/pixijs/pixijs/issues/10392
- v8 + Vite pain points (all verified issues):
  - #12068: Vite dev server failed on `parse-svg-path` default import (CJS dep) in 8.18.1; workaround `optimizeDeps: { include: ['parse-svg-path'] }`; fix PR #12069. https://github.com/pixijs/pixijs/issues/12068
  - #11981 (closed): canvas-2d mode with filters broke under `vite build`. https://github.com/pixijs/pixijs/issues/11981
  - TypeScript 6/7: PixiJS types conflicted with the built-in WebGPU lib types. 8.21.0 fixes this; with TS 6/7 use `@types/web` instead of `lib: ["DOM"]` and drop `@webgpu/types`. https://github.com/pixijs/pixijs/pull/12157
- Bonus: PixiJS ships official skills for AI coding agents (https://github.com/pixijs/pixijs-skills). Worth vendoring into the repo so assistants use v8 idioms.

## 2. Assets and texture manifest

- Manifest shape and calls (https://pixijs.com/8.x/guides/components/assets/manifest):
  - `{ "bundles": [ { "name": "parts", "assets": [ { "alias": "parts", "src": "sheets/parts.json" } ] } ] }`
  - `await Assets.init({ manifest, basePath: '/assets' }); const parts = await Assets.loadBundle('parts');`
  - `src` accepts `{png,webp}` and `@2x` patterns; `Assets.init({ texturePreference: { resolution: 2, format: ['webp','png'] } })` picks variants. Init options: https://pixijs.download/release/docs/assets.AssetInitOptions.html
  - Per-asset texture options live under `data`: `{ alias: 'parts', src: 'parts.json', data: { scaleMode: 'nearest' } }` (from the official skill: https://github.com/pixijs/pixijs-skills/blob/main/skills/pixijs-assets/SKILL.md)
- Spritesheets: JSON hash format with `frames` (frame, rotated, trimmed, spriteSourceSize, sourceSize, optional anchor), `meta` (image, size, scale), and `animations` (name -> array of frame names). `const sheet = await Assets.load('sheets/fx.json'); new Sprite(sheet.textures['wheel']); new AnimatedSprite(sheet.animations['propeller']);` TexturePacker and free-tex-packer both emit this. https://pixijs.download/release/docs/assets.Spritesheet.html
- AnimatedSprite (https://pixijs.download/release/docs/scene.AnimatedSprite.html):
  - `animationSpeed` default 1 (frames advanced per ticker frame at 60 fps target); negative reverses, 0 pauses. `loop` default true. `autoUpdate` default true (drives from `Ticker.shared`). `play()`, `stop()`, `gotoAndStop(i)`, `onFrameChange`, `onLoop`, `updateAnchor`.
  - Propeller: `prop.animationSpeed = throttle * 0.6; if (throttle === 0) prop.stop(); else if (!prop.playing) prop.play();` Set `autoUpdate: false` and call `prop.update(ticker)` from your own render loop if you want it in lockstep with interpolation.
  - Thruster flame: 2 to 4 frame `flame` animation, `visible = thrust > 0`, `alpha`/`scale.y` proportional to thrust, anchor at the nozzle edge (`anchor.set(0.5, 0)`).
- Recommended layout (art swap without code changes):
  - `public/assets/manifest.json` (bundles: `core`, `parts`, `fx`, `ui`), `public/assets/sheets/parts.json` + `parts.png`, `public/assets/sheets/fx.json` + `fx.png`, `public/assets/ui/*.png`.
  - Code only references frame names (`Assets.get<Spritesheet>('parts').textures['part.wheel']`) and animation names (`sheet.animations['fx.propeller']`). Frame names are the contract; keep a `src/render/assetKeys.ts` with string constants and a Vitest test that asserts every constant exists in the loaded JSON.
  - Generate placeholders directly into that atlas format (section 3), so replacing art means replacing `parts.png` + `parts.json` from TexturePacker or free-tex-packer. Add `@2x` variants later via `texturePreference` without touching code.

## 3. Placeholder asset generation (pure Node)

- pngjs 7.0.0: pure JS, zero dependencies, no install scripts. `const png = new PNG({ width: 64, height: 64 }); png.data[(w*y+x)<<2 ...] = r,g,b,a; fs.writeFileSync(out, PNG.sync.write(png));` Enough for filled rects, circles, rings, outlines, checkerboards (rasterize per pixel; 4x supersample for smooth edges). https://github.com/pngjs/pngjs
- @napi-rs/canvas 1.0.9: Skia via Node-API, prebuilt per-platform binaries as optionalDependencies, "zero system dependencies" (glibc >= 2.18 on Linux), no node-gyp. Full Canvas2D API incl. text; `canvas.encode('png')`. Native binary, but zero build. https://github.com/Brooooooklyn/canvas
- sharp 0.35.4: prebuilt libvips (`@img/sharp-*` optional deps), Node >= 20.9. Good at compositing and resizing, and it rasterizes SVG buffers, so "write SVG string, `sharp(Buffer.from(svg)).png()`" is a viable primitive path. Heavier install than needed here. https://registry.npmjs.org/sharp/latest
- canvas 3.2.3 (node-canvas): `prebuild-install || node-gyp rebuild`, needs Cairo/Pango system libs when no prebuilt matches. Avoid.
- free-tex-packer-core 0.3.9 pulls in sharp and jimp; not worth it for placeholders.
- Recommendation: `scripts/gen-placeholders.ts` using pngjs, which draws each part into a 64x64 cell of a grid atlas and writes the matching PixiJS JSON hash (frames keyed by part id, plus `animations` for `fx.propeller` and `fx.flame`). Zero native deps, deterministic, runs in CI. Upgrade to @napi-rs/canvas only if you want text labels or anti-aliased arcs without writing a rasterizer.

## 4. Scene structure

- One `Container` per rigid body, one `Sprite` per grid part as children at body-local offsets (`part.x = col * CELL_PX`). Each render frame set only `bodyView.position` and `bodyView.rotation`. Hundreds of sprites is trivial for the v8 batcher as long as they share one atlas (batches hold up to 16 textures): https://pixijs.com/8.x/guides/concepts/performance-tips
- Do not use individual free sprites per part: you would recompute N transforms per frame in JS instead of one per body, and detach/reattach logic becomes bookkeeping. When a part breaks off, `newBody.addChild(sprite)` or `reparentChild` to keep world transform: https://pixijs.com/8.x/guides/components/scene-objects/container
- Render groups: `new Container({ isRenderGroup: true })` for the world and another for HUD overlays drawn in canvas. Docs warn against overuse ("majority of the time you won't need to use them"): https://pixijs.com/8.x/guides/concepts/render-groups
- Culling: opt-in. `extensions.add(CullerPlugin)` culls `cullable` containers against the screen each frame, or call `Culler.shared.cull(world, viewRect)` yourself. Only matters once arenas exceed the viewport. https://pixijs.com/8.x/guides/components/application/culler-plugin
- Fixed step + interpolation (Gaffer on Games, https://gafferongames.com/post/fix_your_timestep/):
  - `world.timestep = 1/60` (Rapier recommends ~0.016): https://rapier.rs/javascript2d/classes/World.html
  - In `app.ticker.add(t => ...)`: `acc += Math.min(t.deltaMS, 250); while (acc >= 16.667) { snapshotPrev(); world.step(); acc -= 16.667; } alpha = acc / 16.667;` Clamp to avoid the spiral of death. Ticker API: https://pixijs.download/release/docs/ticker.Ticker.html
  - Per body keep `{ prevX, prevY, prevAngle, currX, currY, currAngle }` from `body.translation()` / `body.rotation()`. Render at `lerp(prev, curr, alpha)`; lerp angles via shortest arc (wrap the delta into [-pi, pi]).
  - This renders one physics tick behind, which is the standard trade for smoothness.
- Camera as the world container: `world.pivot.set(cam.x, cam.y); world.position.set(screen.w/2, screen.h/2); world.scale.set(zoom * PPM, -zoom * PPM)` handles zoom-about-center in one place. Follow by lerping `cam` toward the target each frame.
  - Y axis: Rapier is y-up, Pixi is y-down. Either flip via negative `scale.y` on the world (then set `sprite.scale.y = -1` or a flipped child container so art is upright) or convert in the sync step (`view.y = -body.y * PPM; view.rotation = -angle`). Pick one and put it in `src/render/units.ts` with `toScreen`/`toWorld` helpers; do not sprinkle sign flips.
- Units: define `METERS_PER_CELL` and `PIXELS_PER_METER` once. A sensible pair is cell = 0.5 m, PPM = 64, so one cell is 32 px at zoom 1 and 64x64 placeholders stay sharp to 2x zoom. Rapier is tuned for body sizes on the order of 0.1 to 10 m, so a 10-cell robot at 5 m is in range.
- Crispness when zooming:
  - Pixel art: `TextureStyle.defaultOptions.scaleMode = 'nearest'` before any texture is created (maintainer answer: https://github.com/pixijs/pixijs/discussions/11018), zoom in integer steps, and consider `roundPixels: true` on the renderer (floors x/y; can make interpolated motion look steppy): https://pixijs.download/dev/docs/rendering.RendererOptions.html
  - Vector or painted art: keep `'linear'`, author textures at the largest zoom you expect, and enable mipmaps for downscaling. Per-texture override: `texture.source.scaleMode = 'nearest'`: https://pixijs.com/8.x/guides/components/textures
  - Always `resolution: devicePixelRatio, autoDensity: true` so HiDPI displays get real pixels.

## 5. Debug drawing (Rapier debugRender into Pixi Graphics)

- `world.debugRender(filterFlags?, filterPredicate?)` returns `DebugRenderBuffers`: `vertices` is a flat Float32Array with 2 floats per point and 2 points per line; `colors` has 4 floats (RGBA, 0..1) per vertex. https://rapier.rs/javascript2d/classes/DebugRenderBuffers.html
- v8 Graphics API is shape-then-style: `g.moveTo(x0,y0).lineTo(x1,y1).stroke({ color, alpha, pixelLine: true })`, `g.clear()` to reset. https://pixijs.com/8.x/guides/components/scene-objects/graphics
- `pixelLine: true` draws GPU-native 1 px lines that stay 1 px at any zoom and skip triangulation, which is exactly what a debug overlay wants. Limit: always 1 px. https://pixijs.com/8.x/guides/components/scene-objects/graphics/graphics-pixel-line
- Efficient per-frame loop: keep one long-lived `Graphics` inside the world container (so it inherits the camera), `clear()` once, iterate segments, and only call `stroke()` when the color changes between consecutive segments (Rapier emits runs of the same color per collider), packing color as `(r*255<<16)|(g*255<<8)|(b*255)`. Feed it meters (the world container applies PPM and the y-flip).
- The Graphics guide says "do not clear and rebuild graphics every frame" for general content; a toggled debug layer is the accepted exception. Users reported memory growth when clearing and redrawing hundreds of 1 px lines every frame in early v8 (https://github.com/pixijs/pixijs/discussions/9791): reuse one instance, never allocate a new Graphics per frame, and profile once. If it ever becomes a bottleneck, the escape hatch is a custom Mesh whose vertex/color buffers you overwrite in place each frame.

## 6. UI layer and script editor

- Interop pattern is the same for every option: Pixi canvas in a full-size `div`, UI root as a sibling with `position: absolute; inset: 0; pointer-events: none`, and `pointer-events: auto` on panels. Share state through a small framework-agnostic store (signals or an EventTarget) that the sim loop writes and the UI reads.
- Plain DOM + TS: 0 kB, no plugin. Fine for a keybinding list and a few sliders; gets painful once panels reflect live sim state (manual diffing, listener cleanup).
- Preact 10.29.8 + @preact/preset-vite 2.10.6 (peer vite up to 8.x): ~4.8 kB gzip (https://bundlephobia.com/package/preact@10.29.8). React API surface, so AI assistants' React output works nearly verbatim (`preact/compat` for React-only libs). `@preact/signals` maps well to parameter sliders.
- Solid 1.9.15 + vite-plugin-solid 2.11.14: ~8.4 kB gzip (https://bundlephobia.com/package/solid-js@1.9.15). Best raw reactivity for high-frequency telemetry, but components run once and props must not be destructured; AI assistants routinely emit React idioms that silently break in Solid.
- React 19.3.0 + @vitejs/plugin-react 6.1.1 (peer vite ^8, now Oxc-based): ~69 kB gzip for `react` + `react-dom/client` (https://bundlejs.com). Best AI familiarity and widest component ecosystem (e.g. @monaco-editor/react 4.7.0), heaviest bundle.
- Recommendation: Preact with the Vite preset. React-shaped code for the assistants, small enough to not care, and `preact/compat` if a React-only dependency shows up. Start UI panels in plain DOM only if you are certain the panel count stays at two or three.
- Script editor:
  - Phase 1: `<textarea spellcheck="false">` with monospace font and Tab handling. Zero cost, good enough for a first script loop.
  - Phase 2: CodeMirror 6. `import { EditorView, basicSetup } from 'codemirror'; import { javascript } from '@codemirror/lang-javascript'; new EditorView({ doc, extensions: [basicSetup, javascript(), EditorView.updateListener.of(u => { if (u.docChanged) onChange(u.state.doc.toString()) })], parent })`. `codemirror` 6.0.2 + `@codemirror/lang-javascript` 6.2.5 bundle to ~169 kB gzip (https://bundlejs.com); `@codemirror/theme-one-dark` for dark UI. Guide: https://codemirror.net/docs/guide/, ref: https://codemirror.net/docs/ref/
  - Monaco 0.56.0: roughly 5 MB of language services if imported naively, and in Vite you must wire `self.MonacoEnvironment.getWorker` with `?worker` imports (https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md). Its one killer feature is TypeScript IntelliSense: you could feed the robot script API `.d.ts` into its TS worker for autocomplete.
  - Recommendation: textarea, then CodeMirror 6. Revisit Monaco only if typed autocompletion against the script API becomes a headline feature.

## 7. Vite and TypeScript project setup

- Vite 8.3.0: Rolldown replaces esbuild + Rollup, Oxc does transforms, "most existing Vite plugins work out of the box", Node 20.19+/22.12+ (https://vite.dev/blog/announcing-vite8). 8.1 added native WebAssembly ESM integration and experimental bundled dev mode (https://vite.dev/blog/announcing-vite8-1).
- Vitest 5.0.1 (2026-09-03): Node >= 22.12, Vite >= 6.4; inline projects inherit the root config; `vi.when()`; stricter unawaited async assertions (https://vitest.dev/blog/vitest-5.html). Projects: `test.projects: ['packages/*']` or inline `{ test: { name: 'core', environment: 'node' } }` (https://vitest.dev/guide/projects).
- TypeScript 7.0.2 is the native Go compiler published as `typescript` (`tsc` runs it). Breaking defaults that matter here: `strict` defaults to true, `types` defaults to `[]` (so add `"types": ["vite/client"]` explicitly), `baseUrl` is gone (use relative `paths`), `moduleResolution` must be `bundler` or `nodenext`, `target: es5` removed. `@typescript/typescript6` provides `tsc6` if a tool lags. https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- Baseline tsconfig (create-vite `template-vanilla-ts`): `target es2023`, `module esnext`, `moduleResolution bundler`, `verbatimModuleSyntax`, `moduleDetection force`, `noEmit`, `skipLibCheck`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`. Vite requires `isolatedModules`-compatible code because Oxc transpiles without type info. https://github.com/vitejs/vite/blob/main/packages/create-vite/template-vanilla-ts/tsconfig.json, https://vite.dev/guide/features
- For PixiJS with TS 7: `"lib": ["ES2023"]` plus `"types": ["@types/web", "vite/client"]` instead of `lib: ["DOM"]` (section 1).
- Path aliases: Vite 8 has built-in `resolve.tsconfigPaths: true` (reads `compilerOptions.paths`, default false): https://vite.dev/config/shared-options. Vitest does not honor it yet (open issue https://github.com/vitest-dev/vitest/issues/10054); workaround is `vite-tsconfig-paths` or duplicating aliases in `resolve.alias`. A workspace avoids aliases entirely (import by package name).
- WASM in Vite:
  - Rapier's regular package is wasm-bindgen output: `import * as wasm from "./rapier_wasm2d_bg.wasm"` plus a JS glue module (verified at https://unpkg.com/@dimforge/rapier2d@0.20.0/rapier_wasm2d.js). Vite 8.1+ native ESM integration states "If the WebAssembly module declares imports of its own, Vite resolves them from JavaScript modules", and was upstreamed from vite-plugin-wasm's author (https://vite.dev/guide/features#webassembly). In principle no plugin is needed on Vite 8.1+; vite-plugin-wasm 3.6.0 (peer vite up to ^8) remains the fallback.
  - Top-level await: direct `.wasm` imports need it. Vite 8's default `build.target` is `['chrome111','edge111','firefox114','safari16.4','ios16.4']` (https://vite.dev/config/build-options); TLA landed in Chrome/Edge/Firefox 89 and Safari 15 (MDN marks Safari 15 to 26 as partial, full at 27: https://github.com/mdn/browser-compat-data/blob/main/javascript/operators/await.json). vite-plugin-top-level-await is only needed if you lower the target.
  - Simplest path: `@dimforge/rapier2d-compat` 0.20.0 embeds the 1.5 MB wasm as base64 (~2 MB of JS), works unchanged in browser, Vite, Vitest and a Node CLI, and needs `await RAPIER.init()`. https://rapier.rs/docs/user_guides/javascript/getting_started_js. SIMD variants (`-simd`, `-simd-compat`) exist for browsers with simd128; deterministic variants too. https://github.com/dimforge/rapier/blob/master/typescript/README.md
  - Rapier project status: `dimforge/rapier.js` was archived 2026-07-12 and the bindings now live in `dimforge/rapier/typescript` (https://github.com/dimforge/rapier.js). v0.20.0 (2026-08-08) moved dist files to `dist/`, upgraded to Rapier 0.35 with rewritten sleeping and sweep CCD on by default. Unreleased changelog shows soft bodies with breaking signature changes (`removeCollider`, `PhysicsPipeline.step`, `DebugRenderPipeline.render` gain a `SoftBodySet` arg). Pin `0.20.x` and read the changelog before bumping. https://github.com/dimforge/rapier/blob/master/typescript/CHANGELOG.md
  - QuickJS: use `quickjs-emscripten-core` with an explicit variant instead of the meta package. Browser: `@jitl/quickjs-singlefile-browser-release-sync` (wasm embedded, no bundler config). Node: `@jitl/quickjs-wasmfile-release-sync`. Select per environment with package.json subpath imports (`"browser"` condition). Use `runtime.setMemoryLimit`, `setMaxStackSize`, `setInterruptHandler(shouldInterruptAfterDeadline(...))` for untrusted scripts. https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten-core/README.md
- Package structure recommendation: pnpm workspace, three packages.
  - `packages/sim-core`: pure TS, `lib: ["ES2023"]`, `types: []`, no `@types/web`, depends on rapier2d-compat and quickjs-emscripten-core. The compiler now enforces "no DOM" (a single-package alias layout cannot).
  - `packages/app`: Vite + PixiJS + Preact, depends on `"@robots/sim-core": "workspace:*"`. Vite treats linked workspace packages as source (no pre-bundling, must be ESM; https://vite.dev/guide/dep-pre-bundling), so HMR into core works.
  - `packages/cli`: Node headless runner / replay checker importing sim-core; run with `tsx` or Node's built-in type stripping (erasable syntax only, which `erasableSyntaxOnly` guarantees).
  - `pnpm-workspace.yaml`: `packages: ['packages/*']` (https://pnpm.io/pnpm-workspace_yaml). Root `vitest.config.ts` with `projects: ['packages/*']`, core under `environment: 'node'`, app under `happy-dom`.
  - Single package with `@core/*` aliases is viable for a solo spike, but it needs the Vitest alias workaround above and gives no compile-time DOM firewall. Not recommended.

## 8. Persistence in the browser

- localStorage: 5 MiB per origin, synchronous (blocks the frame), strings only, `QuotaExceededError` on overflow. Use only for small prefs and keybindings. https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- IndexedDB via idb-keyval 6.3.0: 295 B (get/set) to 573 B brotli, async, stores structured-clonable objects directly (no JSON.stringify needed), `createStore('robots', 'blueprints')` for a named store, `keys()`/`entries()` for listing. https://github.com/jakearchibald/idb-keyval
  - Quota: Chrome up to 60% of disk per origin; Firefox best-effort min(10% disk, 10 GiB); Safari ~60% but evicts script-written storage after 7 days without user interaction when ITP is on. `navigator.storage.persist()` lowers eviction risk (Firefox prompts, Chrome/Safari decide silently); `navigator.storage.estimate()` for headroom.
- File System Access API (`showSaveFilePicker`/`showOpenFilePicker`): Chrome 105+, Edge 105+, Opera 91+ full; no Firefox (position "harmful"), no Safari (OPFS only). About 31% global. Secure context and a user gesture are required. https://caniuse.com/native-filesystem-api, https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker
- Universal fallback: `new Blob([json], { type: 'application/json' })` + `URL.createObjectURL` + `<a download="robot.json">`, and `<input type="file" accept=".json">` or drag-drop for import. Works everywhere.
- Recommendation:
  - Autosave every blueprint edit (debounced ~500 ms) to IndexedDB via idb-keyval under a versioned envelope `{ schemaVersion, savedAt, blueprint }`; keep a small migrations table keyed by `schemaVersion`.
  - Explicit Export/Import buttons: `if ('showSaveFilePicker' in window)` use it (and stash the handle in IndexedDB for one-click re-save), else the download/upload fallback.
  - localStorage only for UI prefs (last camera, panel layout, keybinding overrides).
  - Call `navigator.storage.persist()` once after the first save; surface the Safari 7-day caveat in the UI with a nudge to export.
