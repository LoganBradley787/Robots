# M0 Skeleton and Deterministic World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `CLAUDE.md` and `docs/status.md` first, then this plan. Update `docs/status.md` at the end of every session.

**Goal:** A pnpm workspace where a pure simulation core steps a Rapier 2D world deterministically at 60 Hz, a Vite app renders a falling box with pause, single step, time scale, and camera, and a Node CLI proves two runs hash identically.

**Architecture:** Three packages. `@robots/sim-core` owns physics, world, replay log, and hashing with no DOM types. `@robots/app` renders it with PixiJS and a fixed-step loop with interpolation. `@robots/cli` runs the same core headless. Rapier is loaded once through a single loader module; nothing outside `sim-core/src/physics` imports Rapier.

**Tech Stack:** Node 24, pnpm, TypeScript 7.0.2, Vite 8.3.0, Vitest 5.0.1, `@dimforge/rapier2d-deterministic-compat` 0.20.0, `pixi.js` 8.21.0, `tsx` for the CLI.

**Spec:** `docs/design/01-architecture.md`, `docs/design/03-assembly-physics-destruction.md` (solver settings, momentum notes), `docs/design/06-milestones.md` (M0), `docs/design/08-tech-stack.md`, `docs/design/09-execution-strategy.md`. Research with verified APIs: `docs/research/rapier2d.md`, `docs/research/rendering-and-tooling.md`.

## Global Constraints

- Node `>=24`. Package manager pnpm. Exact pins: `typescript@7.0.2`, `vite@8.3.0`, `vitest@5.0.1`, `pixi.js@8.21.0`, `@dimforge/rapier2d-deterministic-compat@0.20.0`. Never install the `canary` tag of Rapier.
- `packages/sim-core` compiles with `"lib": ["ES2023", "ESNext.Disposable"]` and `"types": []`. Any use of `window`, `document`, `performance`, `Date.now`, or `Math.random` inside `sim-core/src` is a bug. Time comes only from tick counts and `dt`.
- `erasableSyntaxOnly` is on everywhere: no `enum`, no `namespace`, no constructor parameter properties (`constructor(private x: T)`), no `import x = require()`.
- Relative imports are extensionless (`./rapier`, not `./rapier.ts`). The CLI runs through `tsx`, which handles this; Vite and Vitest do too.
- Coordinates in `sim-core` are meters, x right, y up, one grid cell = 1 m, `dt = 1/60`, gravity `(0, -9.81)`. The single y flip lives in `packages/app/src/render/units.ts`.
- Never use em dashes anywhere, including code comments and commit messages.
- Commit after every task with the message format `M0 T<n>: <what>`. Never leave the tree red at the end of a task.
- Rapier facts that bite (from `docs/research/rapier2d.md`): forces accumulate across steps (this plan uses none), colliders have no user data, only `World` and `EventQueue` need `.free()`, hashes are per-body state, never snapshot bytes.

---

## File structure

```
package.json                          root scripts, dev tooling pins
pnpm-workspace.yaml                   packages/*
tsconfig.base.json                    shared strict TS 7 options
vitest.config.ts                      projects: packages/*
.github/workflows/ci.yml              install, typecheck, test, build
.claude/launch.json                   dev server config for the in-app browser
worlds/flat.json                      first world: flat ground, three boxes, spawn point
docs/status.md                        session handoff state
packages/sim-core/
  package.json  tsconfig.json  tsconfig.test.json  vitest.config.ts
  src/index.ts                        public exports
  src/rng/Prng.ts                     seeded sfc32
  src/replay/StateHasher.ts           FNV-1a over float bits
  src/replay/InputLog.ts              InputFrame type, sparse per-tick log
  src/physics/rapier.ts               the only module that imports Rapier for loading; loadRapier()
  src/physics/PhysicsWorld.ts         bodies by stable id, step, prev/curr state, hashInto, debugRender
  src/world/WorldFile.ts              world JSON schema, parseWorldFile, buildWorld
  src/world/World.ts                  tick orchestration, input log, hash
  test/*.test.ts
packages/cli/
  package.json  tsconfig.json  vitest.config.ts
  src/commands/run.ts                 runSim(file, opts): RunReport
  src/commands/determinism.ts         checkDeterminism(file, opts)
  src/main.ts                         argv parsing and printing only
  test/run.test.ts
packages/app/
  package.json  tsconfig.json  vite.config.ts  vitest.config.ts  index.html
  src/main.ts                         boot and wiring only
  src/render/units.ts                 PIXELS_PER_METER, toScreen, toWorld
  src/render/Renderer.ts              Pixi Application, world container
  src/render/DebugDraw.ts             Rapier debug buffers to Graphics
  src/render/BoxView.ts               interpolated rectangle for a dynamic body
  src/render/interpolate.ts           lerp, lerpAngle, interpolateState
  src/render/camera.ts                pure camera math (no Pixi import)
  src/render/cameraView.ts            applyCamera(container, cam, screen)
  src/app/FixedStepper.ts             accumulator, time scale, alpha
  src/app/TimeControls.ts             paused, scale index, step request
  src/app/Hud.ts                      DOM text overlay
  src/app/keys.ts                     keyboard handling for controls and camera
  test/*.test.ts                      pure modules only
```

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `README.md`
- Modify: `docs/status.md` (exists; set Next to M0 T2 when this task is done)
- Create: `packages/sim-core/package.json`, `packages/sim-core/tsconfig.json`, `packages/sim-core/tsconfig.test.json`, `packages/sim-core/vitest.config.ts`, `packages/sim-core/src/index.ts`, `packages/sim-core/test/smoke.test.ts`
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/vitest.config.ts`, `packages/cli/src/main.ts`
- Create: `packages/app/package.json`, `packages/app/tsconfig.json`, `packages/app/vite.config.ts`, `packages/app/vitest.config.ts`, `packages/app/index.html`, `packages/app/src/main.ts`

**Interfaces:**
- Produces: workspace commands `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm dev`, `pnpm sim`. Package names `@robots/sim-core`, `@robots/cli`, `@robots/app`.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "robots",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "pnpm --filter @robots/app dev",
    "build": "pnpm --filter @robots/app build",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "sim": "pnpm --filter @robots/cli start --"
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "vite": "8.3.0",
    "vitest": "5.0.1"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "isolatedModules": true,
    "erasableSyntaxOnly": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
```

`README.md`:
```markdown
# Robots

2D side-view robot sandbox. Design docs in `docs/design/`, start with `docs/design/00-index.md`.

- `pnpm install`
- `pnpm dev` runs the app at http://localhost:5173
- `pnpm test` runs all tests, `pnpm typecheck` checks every package
- `pnpm sim run --seconds 5` runs the headless simulation
- `pnpm sim determinism --seconds 10` runs it twice and compares hashes
```

- [ ] **Step 2: sim-core package**

`packages/sim-core/package.json`:
```json
{
  "name": "@robots/sim-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.test.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@dimforge/rapier2d-deterministic-compat": "0.20.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "7.0.2",
    "vitest": "5.0.1"
  }
}
```

`packages/sim-core/tsconfig.json` (the purity firewall: no DOM, no Node types):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "ESNext.Disposable"],
    "types": []
  },
  "include": ["src"]
}
```

`packages/sim-core/tsconfig.test.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

`packages/sim-core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'sim-core',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

`packages/sim-core/src/index.ts`:
```ts
export const SIM_CORE_VERSION = '0.0.0';
```

`packages/sim-core/test/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { SIM_CORE_VERSION } from '../src/index';

describe('sim-core package', () => {
  it('exports a version', () => {
    expect(SIM_CORE_VERSION).toBe('0.0.0');
  });
});
```

- [ ] **Step 3: cli package**

`packages/cli/package.json`:
```json
{
  "name": "@robots/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/main.ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@robots/sim-core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.0.0",
    "typescript": "7.0.2",
    "vitest": "5.0.1"
  }
}
```

`packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "ESNext.Disposable"],
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`packages/cli/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'cli',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

`packages/cli/src/main.ts` (replaced in Task 6):
```ts
import { SIM_CORE_VERSION } from '@robots/sim-core';

console.log(`robots cli, sim-core ${SIM_CORE_VERSION}`);
```

- [ ] **Step 4: app package**

`packages/app/package.json`:
```json
{
  "name": "@robots/app",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@robots/sim-core": "workspace:*",
    "pixi.js": "8.21.0"
  },
  "devDependencies": {
    "@types/web": "*",
    "typescript": "7.0.2",
    "vite": "8.3.0",
    "vitest": "5.0.1"
  }
}
```

`packages/app/tsconfig.json` (DOM comes from `@types/web`, never from `lib`, because PixiJS 8.21 under TypeScript 7 requires it):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "ESNext.Disposable"],
    "types": ["web", "vite/client"]
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`packages/app/vite.config.ts`:
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: true },
});
```

`packages/app/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

`packages/app/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Robots</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #101418; }
      #app canvas { display: block; }
      #hud {
        position: absolute; top: 8px; left: 8px; color: #d8dee9;
        font: 12px/1.5 ui-monospace, Menlo, monospace; white-space: pre;
        pointer-events: none; user-select: none;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div id="hud"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`packages/app/src/main.ts` (replaced in Task 7):
```ts
import { SIM_CORE_VERSION } from '@robots/sim-core';

const hud = document.getElementById('hud');
if (hud) hud.textContent = `robots app, sim-core ${SIM_CORE_VERSION}`;
```

- [ ] **Step 5: Install and verify the pipeline**

Run: `pnpm install`
Expected: succeeds, creates `pnpm-lock.yaml`. If `@types/web` resolves to a version that errors later, pin it to the version pnpm picked.

Run: `pnpm typecheck`
Expected: three packages pass with no output besides pnpm's headers.

Run: `pnpm test`
Expected: `sim-core` project runs 1 test, passes; `cli` and `app` report no tests, pass.

Run: `pnpm sim`
Expected: prints `robots cli, sim-core 0.0.0`.

- [ ] **Step 6: Prove the DOM firewall**

Temporarily append to `packages/sim-core/src/index.ts`:
```ts
export const leak = document.title;
```
Run: `pnpm --filter @robots/sim-core typecheck`
Expected: FAIL with `Cannot find name 'document'`. Remove the line, run again, expect PASS. This is the check that keeps the sim pure; if it ever passes with DOM code, the tsconfig is wrong.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "M0 T1: pnpm workspace with sim-core, cli, and app packages"
```

---

### Task 2: Seeded PRNG and state hasher

**Files:**
- Create: `packages/sim-core/src/rng/Prng.ts`, `packages/sim-core/src/replay/StateHasher.ts`
- Modify: `packages/sim-core/src/index.ts`
- Test: `packages/sim-core/test/Prng.test.ts`, `packages/sim-core/test/StateHasher.test.ts`

**Interfaces:**
- Produces: `class Prng { constructor(seed: number); nextU32(): number; next(): number; range(min: number, max: number): number }`
- Produces: `class StateHasher { addInt(v: number): void; addF64(v: number): void; digest(): number; static hex(h: number): string }`

- [ ] **Step 1: Write the failing tests**

`packages/sim-core/test/Prng.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Prng } from '../src/rng/Prng';

describe('Prng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    expect(sa).toEqual(sb);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Prng(1);
    const b = new Prng(2);
    expect(a.nextU32()).not.toBe(b.nextU32());
  });

  it('next() is in [0, 1) and range() respects bounds', () => {
    const p = new Prng(7);
    for (let i = 0; i < 1000; i++) {
      const v = p.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const r = p.range(-3, 5);
      expect(r).toBeGreaterThanOrEqual(-3);
      expect(r).toBeLessThan(5);
    }
  });
});
```

`packages/sim-core/test/StateHasher.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { StateHasher } from '../src/replay/StateHasher';

describe('StateHasher', () => {
  it('starts at the FNV-1a offset basis', () => {
    expect(StateHasher.hex(new StateHasher().digest())).toBe('811c9dc5');
  });

  it('is deterministic for the same input', () => {
    const a = new StateHasher();
    const b = new StateHasher();
    for (const v of [0, 1.5, -2.25, 1e-9]) { a.addF64(v); b.addF64(v); }
    a.addInt(600); b.addInt(600);
    expect(a.digest()).toBe(b.digest());
  });

  it('changes when a single float bit changes', () => {
    const a = new StateHasher();
    const b = new StateHasher();
    a.addF64(1.0);
    b.addF64(1.0 + Number.EPSILON);
    expect(a.digest()).not.toBe(b.digest());
  });

  it('hex is 8 lowercase hex digits', () => {
    const h = new StateHasher();
    h.addInt(123456);
    expect(StateHasher.hex(h.digest())).toMatch(/^[0-9a-f]{8}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robots/sim-core test`
Expected: FAIL, cannot find module `../src/rng/Prng` and `../src/replay/StateHasher`.

- [ ] **Step 3: Implement**

`packages/sim-core/src/rng/Prng.ts`:
```ts
// sfc32: small, fast, and fully deterministic across JS engines because it only uses 32-bit integer ops.
export class Prng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    let s = seed >>> 0;
    const mix = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15;
      t = Math.imul(t, 0x735a2d97);
      return (t ^ (t >>> 15)) >>> 0;
    };
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = mix();
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}
```

`packages/sim-core/src/replay/StateHasher.ts`:
```ts
// FNV-1a over the exact bytes of each value. Exact bits, not quantized: the sim is supposed to be
// bit-identical run to run, and any drift should show up immediately.
export class StateHasher {
  private h = 0x811c9dc5;
  private readonly view = new DataView(new ArrayBuffer(8));

  private addByte(b: number): void {
    this.h ^= b & 0xff;
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
  }

  addInt(v: number): void {
    this.view.setInt32(0, v | 0, true);
    for (let i = 0; i < 4; i++) this.addByte(this.view.getUint8(i));
  }

  addF64(v: number): void {
    this.view.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.addByte(this.view.getUint8(i));
  }

  digest(): number {
    return this.h >>> 0;
  }

  static hex(h: number): string {
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
```

Append to `packages/sim-core/src/index.ts`:
```ts
export { Prng } from './rng/Prng';
export { StateHasher } from './replay/StateHasher';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robots/sim-core test`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "M0 T2: seeded sfc32 PRNG and FNV-1a state hasher"
```

---

### Task 3: Rapier loader and PhysicsWorld

**Files:**
- Create: `packages/sim-core/src/physics/rapier.ts`, `packages/sim-core/src/physics/PhysicsWorld.ts`
- Modify: `packages/sim-core/src/index.ts`
- Test: `packages/sim-core/test/PhysicsWorld.test.ts`

**Interfaces:**
- Consumes: `StateHasher` from Task 2.
- Produces: `loadRapier(): Promise<void>`, `rapierVersion(): string`.
- Produces: `type BodyId = number`, `interface BodyState { x; y; angle; vx; vy; w }`, `interface DebugBuffers { vertices: Float32Array; colors: Float32Array }`.
- Produces: `class PhysicsWorld { constructor(gravityY: number, dt: number); createFixedBox(cx, cy, w, h, angle?): BodyId; createDynamicBox(cx, cy, w, h, mass, angle?): BodyId; step(): void; state(id): BodyState; prevState(id): BodyState; bodyIds: BodyId[]; hashInto(h: StateHasher): void; debugRender(): DebugBuffers; free(): void }`.

- [ ] **Step 1: Verify the Rapier module shape before writing code**

Run from the repo root:
```bash
node -e "import('@dimforge/rapier2d-deterministic-compat').then(async (m) => { await m.init(); console.log('named init ok, version', m.version()); })"
```
Expected: prints `named init ok, version <x.y.z>`. The plan uses the module namespace (`import * as RAPIER`) with the named `init()`; this is the documented compat pattern. If `m.init` is undefined but `m.default.init` exists, use `import RAPIER from ...` instead throughout this task and record that in `docs/status.md`.

- [ ] **Step 2: Write the failing tests**

`packages/sim-core/test/PhysicsWorld.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, rapierVersion } from '../src/physics/rapier';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { StateHasher } from '../src/replay/StateHasher';

beforeAll(async () => {
  await loadRapier();
});

describe('PhysicsWorld', () => {
  it('reports a semver rapier version', () => {
    expect(rapierVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('a dynamic box falls onto the ground and settles at y = 0.5', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    pw.createFixedBox(0, -1, 100, 2); // top surface at y = 0
    const box = pw.createDynamicBox(0, 5, 1, 1, 1);
    for (let i = 0; i < 180; i++) pw.step();
    const s = pw.state(box);
    expect(s.y).toBeCloseTo(0.5, 1);
    expect(Math.abs(s.vy)).toBeLessThan(0.05);
    expect(pw.bodyIds).toEqual([1, 2]);
    pw.free();
  });

  it('keeps the previous state for interpolation', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const box = pw.createDynamicBox(0, 5, 1, 1, 1);
    pw.step();
    expect(pw.prevState(box).y).toBe(5);
    expect(pw.state(box).y).toBeLessThan(5);
    pw.free();
  });

  it('applies the initial rotation of fixed boxes', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const ramp = pw.createFixedBox(0, 0, 4, 1, 0.5);
    expect(pw.state(ramp).angle).toBeCloseTo(0.5, 6);
    pw.free();
  });

  it('debugRender returns line buffers with 4 color floats per vertex', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    pw.createFixedBox(0, -1, 10, 2);
    pw.step();
    const d = pw.debugRender();
    expect(d.vertices.length).toBeGreaterThan(0);
    expect(d.colors.length).toBe(d.vertices.length * 2);
    pw.free();
  });

  it('hashInto is identical for identical worlds', () => {
    const make = (): PhysicsWorld => {
      const pw = new PhysicsWorld(-9.81, 1 / 60);
      pw.createFixedBox(0, -1, 100, 2);
      pw.createDynamicBox(0.3, 5, 1, 1, 1, 0.2);
      for (let i = 0; i < 120; i++) pw.step();
      return pw;
    };
    const a = make();
    const b = make();
    const ha = new StateHasher();
    const hb = new StateHasher();
    a.hashInto(ha);
    b.hashInto(hb);
    expect(ha.digest()).toBe(hb.digest());
    a.free();
    b.free();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @robots/sim-core test`
Expected: FAIL, cannot find module `../src/physics/rapier`.

- [ ] **Step 4: Implement the loader**

`packages/sim-core/src/physics/rapier.ts`:
```ts
import * as RAPIER from '@dimforge/rapier2d-deterministic-compat';

let ready: Promise<void> | null = null;

/** Loads the Rapier WASM exactly once. Every entry point awaits this before constructing a PhysicsWorld. */
export function loadRapier(): Promise<void> {
  if (!ready) ready = RAPIER.init().then(() => undefined);
  return ready;
}

export function rapierVersion(): string {
  return RAPIER.version();
}
```

- [ ] **Step 5: Implement PhysicsWorld**

`packages/sim-core/src/physics/PhysicsWorld.ts`:
```ts
import * as RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { StateHasher } from '../replay/StateHasher';

/** Stable id owned by us. Rapier handles are index plus generation and get reused; ours never do. */
export type BodyId = number;

export interface BodyState {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  w: number;
}

export interface DebugBuffers {
  vertices: Float32Array;
  colors: Float32Array;
}

function readState(body: RAPIER.RigidBody): BodyState {
  const t = body.translation();
  const v = body.linvel();
  return { x: t.x, y: t.y, angle: body.rotation(), vx: v.x, vy: v.y, w: body.angvel() };
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly bodies = new Map<BodyId, RAPIER.RigidBody>();
  private readonly prev = new Map<BodyId, BodyState>();
  private nextId: BodyId = 1;

  constructor(gravityY: number, dt: number) {
    this.world = new RAPIER.World({ x: 0, y: gravityY });
    this.world.timestep = dt;
  }

  createFixedBox(cx: number, cy: number, w: number, h: number, angle = 0): BodyId {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy).setRotation(angle);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2), body);
    return this.register(body);
  }

  createDynamicBox(cx: number, cy: number, w: number, h: number, mass: number, angle = 0): BodyId {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(cx, cy).setRotation(angle);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2).setMass(mass), body);
    return this.register(body);
  }

  private register(body: RAPIER.RigidBody): BodyId {
    const id = this.nextId++;
    this.bodies.set(id, body);
    this.prev.set(id, readState(body));
    return id;
  }

  /** Snapshots every body's state for interpolation, then advances one fixed step. */
  step(): void {
    for (const [id, body] of this.bodies) this.prev.set(id, readState(body));
    this.world.step();
  }

  state(id: BodyId): BodyState {
    const body = this.bodies.get(id);
    if (!body) throw new Error(`unknown body ${id}`);
    return readState(body);
  }

  prevState(id: BodyId): BodyState {
    const s = this.prev.get(id);
    if (!s) throw new Error(`unknown body ${id}`);
    return s;
  }

  get bodyIds(): BodyId[] {
    return [...this.bodies.keys()];
  }

  /** Feeds every body's exact state into the hasher in creation order. */
  hashInto(h: StateHasher): void {
    for (const [, body] of this.bodies) {
      const s = readState(body);
      h.addF64(s.x);
      h.addF64(s.y);
      h.addF64(s.angle);
      h.addF64(s.vx);
      h.addF64(s.vy);
      h.addF64(s.w);
    }
  }

  debugRender(): DebugBuffers {
    const d = this.world.debugRender();
    return { vertices: d.vertices, colors: d.colors };
  }

  free(): void {
    this.world.free();
  }
}
```

Append to `packages/sim-core/src/index.ts`:
```ts
export { loadRapier, rapierVersion } from './physics/rapier';
export { PhysicsWorld } from './physics/PhysicsWorld';
export type { BodyId, BodyState, DebugBuffers } from './physics/PhysicsWorld';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @robots/sim-core test`
Expected: PASS, 14 tests. If the settle test fails with `y` slightly above 0.5 by more than 0.05, check that the ground box is 2 m thick centered at y = -1 and that gravity is negative.

Run: `pnpm --filter @robots/sim-core typecheck`
Expected: PASS. If it complains about `Symbol.dispose`, confirm `"ESNext.Disposable"` is in `lib`.

- [ ] **Step 7: Commit**

```bash
git add packages/sim-core
git commit -m "M0 T3: rapier loader and PhysicsWorld with stable body ids"
```

---

### Task 4: World file format

**Files:**
- Create: `packages/sim-core/src/world/WorldFile.ts`, `worlds/flat.json`
- Modify: `packages/sim-core/src/index.ts`
- Test: `packages/sim-core/test/WorldFile.test.ts`

**Interfaces:**
- Consumes: `PhysicsWorld`, `BodyId` from Task 3.
- Produces: `interface WorldBox { x; y; w; h; angleDeg; dynamic; mass }`, `interface WorldFile { name; ground: { width; thickness }; boxes: WorldBox[]; spawn: { x; y } }`, `class WorldFileError extends Error`, `parseWorldFile(raw: unknown): WorldFile`, `buildWorld(physics: PhysicsWorld, file: WorldFile): { groundId: BodyId; boxIds: BodyId[] }`.

- [ ] **Step 1: Write the world file**

`worlds/flat.json`:
```json
{
  "name": "flat",
  "ground": { "width": 400, "thickness": 2 },
  "spawn": { "x": 0, "y": 6 },
  "boxes": [
    { "x": 8, "y": 1, "w": 2, "h": 2 },
    { "x": 15, "y": 0.6, "w": 6, "h": 1, "angleDeg": 18 },
    { "x": -8, "y": 0.5, "w": 1, "h": 1 }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`packages/sim-core/test/WorldFile.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { loadRapier } from '../src/physics/rapier';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { buildWorld, parseWorldFile, WorldFileError } from '../src/world/WorldFile';

beforeAll(async () => {
  await loadRapier();
});

describe('parseWorldFile', () => {
  it('parses the shipped flat world with defaults filled in', () => {
    const w = parseWorldFile(flatJson);
    expect(w.name).toBe('flat');
    expect(w.ground).toEqual({ width: 400, thickness: 2 });
    expect(w.spawn).toEqual({ x: 0, y: 6 });
    expect(w.boxes).toHaveLength(3);
    expect(w.boxes[0]).toEqual({ x: 8, y: 1, w: 2, h: 2, angleDeg: 0, dynamic: false, mass: 1 });
    expect(w.boxes[1]?.angleDeg).toBe(18);
  });

  it('names the missing field in its error', () => {
    expect(() => parseWorldFile({ name: 'x', ground: { width: 10 } })).toThrow(WorldFileError);
    expect(() => parseWorldFile({ name: 'x', ground: { width: 10 } })).toThrow('world.spawn');
  });

  it('rejects non-positive sizes', () => {
    expect(() => parseWorldFile({ ground: { width: 0 }, spawn: { x: 0, y: 0 } })).toThrow('world.ground.width');
    expect(() =>
      parseWorldFile({ ground: { width: 10 }, spawn: { x: 0, y: 0 }, boxes: [{ x: 0, y: 0, w: 1, h: -1 }] }),
    ).toThrow('world.boxes[0].h');
  });
});

describe('buildWorld', () => {
  it('creates one ground body plus one body per box', () => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    const file = parseWorldFile(flatJson);
    const built = buildWorld(pw, file);
    expect(built.boxIds).toHaveLength(3);
    expect(pw.bodyIds).toHaveLength(4);
    expect(pw.state(built.groundId).y).toBe(-1);
    expect(pw.state(built.boxIds[1] ?? 0).angle).toBeCloseTo((18 * Math.PI) / 180, 6);
    pw.free();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @robots/sim-core test`
Expected: FAIL, cannot find module `../src/world/WorldFile`.

- [ ] **Step 4: Implement**

`packages/sim-core/src/world/WorldFile.ts`:
```ts
import type { BodyId, PhysicsWorld } from '../physics/PhysicsWorld';

export interface WorldBox {
  x: number;
  y: number;
  w: number;
  h: number;
  angleDeg: number;
  dynamic: boolean;
  mass: number;
}

export interface WorldFile {
  name: string;
  ground: { width: number; thickness: number };
  boxes: WorldBox[];
  spawn: { x: number; y: number };
}

export class WorldFileError extends Error {}

function record(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new WorldFileError(`${path} must be an object`);
  return v as Record<string, unknown>;
}

function num(obj: Record<string, unknown>, key: string, path: string, fallback?: number): number {
  const v = obj[key];
  if (v === undefined) {
    if (fallback !== undefined) return fallback;
    throw new WorldFileError(`${path}.${key} is required`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new WorldFileError(`${path}.${key} must be a finite number`);
  return v;
}

function positive(obj: Record<string, unknown>, key: string, path: string, fallback?: number): number {
  const v = num(obj, key, path, fallback);
  if (v <= 0) throw new WorldFileError(`${path}.${key} must be greater than 0`);
  return v;
}

export function parseWorldFile(raw: unknown): WorldFile {
  const root = record(raw, 'world');
  const name = typeof root.name === 'string' ? root.name : 'unnamed';
  const ground = record(root.ground, 'world.ground');
  const spawn = record(root.spawn, 'world.spawn');
  const boxesRaw = root.boxes === undefined ? [] : root.boxes;
  if (!Array.isArray(boxesRaw)) throw new WorldFileError('world.boxes must be an array');
  const boxes: WorldBox[] = boxesRaw.map((b, i) => {
    const path = `world.boxes[${i}]`;
    const o = record(b, path);
    return {
      x: num(o, 'x', path),
      y: num(o, 'y', path),
      w: positive(o, 'w', path),
      h: positive(o, 'h', path),
      angleDeg: num(o, 'angleDeg', path, 0),
      dynamic: o.dynamic === true,
      mass: positive(o, 'mass', path, 1),
    };
  });
  return {
    name,
    ground: { width: positive(ground, 'width', 'world.ground'), thickness: positive(ground, 'thickness', 'world.ground', 2) },
    boxes,
    spawn: { x: num(spawn, 'x', 'world.spawn'), y: num(spawn, 'y', 'world.spawn') },
  };
}

/** Creates the static ground (top surface at y = 0) and every box. Order is fixed so body ids are stable. */
export function buildWorld(physics: PhysicsWorld, file: WorldFile): { groundId: BodyId; boxIds: BodyId[] } {
  const groundId = physics.createFixedBox(0, -file.ground.thickness / 2, file.ground.width, file.ground.thickness);
  const boxIds = file.boxes.map((b) => {
    const angle = (b.angleDeg * Math.PI) / 180;
    return b.dynamic
      ? physics.createDynamicBox(b.x, b.y, b.w, b.h, b.mass, angle)
      : physics.createFixedBox(b.x, b.y, b.w, b.h, angle);
  });
  return { groundId, boxIds };
}
```

Append to `packages/sim-core/src/index.ts`:
```ts
export { parseWorldFile, buildWorld, WorldFileError } from './world/WorldFile';
export type { WorldFile, WorldBox } from './world/WorldFile';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @robots/sim-core test && pnpm --filter @robots/sim-core typecheck`
Expected: PASS, 18 tests. If TypeScript cannot type the JSON import in the test, confirm `resolveJsonModule` and `esModuleInterop` are in `tsconfig.base.json`.

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core worlds
git commit -m "M0 T4: world file schema, parser, and builder with the flat world"
```

---

### Task 5: World, input log, and the determinism test

**Files:**
- Create: `packages/sim-core/src/replay/InputLog.ts`, `packages/sim-core/src/world/World.ts`
- Modify: `packages/sim-core/src/index.ts`
- Test: `packages/sim-core/test/InputLog.test.ts`, `packages/sim-core/test/World.test.ts`, `packages/sim-core/test/determinism.test.ts`

**Interfaces:**
- Consumes: `loadRapier`, `PhysicsWorld`, `BodyId`, `parseWorldFile`, `buildWorld`, `WorldFile`, `Prng`, `StateHasher`.
- Produces: `interface InputFrame { sourceId: string; down: string[]; pressed: string[]; released: string[] }`, `class InputLog { append(tick, frames): void; framesAt(tick): InputFrame[]; length: number; toJSON(): LoggedTick[]; static fromJSON(entries): InputLog }`.
- Produces: `interface WorldOptions { seed: number; dt?: number; gravityY?: number }`, `class World { static create(opts, file): Promise<World>; dt; seed; rng; physics; inputLog; file; tick; time; spawnBox(x, y, size?, mass?): BodyId; step(frames?): void; hash(): string; dispose(): void }`.

- [ ] **Step 1: Write the failing tests**

`packages/sim-core/test/InputLog.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { InputLog, type InputFrame } from '../src/replay/InputLog';

const frame = (down: string[]): InputFrame => ({ sourceId: 'keyboard', down, pressed: [], released: [] });

describe('InputLog', () => {
  it('stores only ticks that had input', () => {
    const log = new InputLog();
    log.append(0, []);
    log.append(1, [frame(['a'])]);
    log.append(2, []);
    expect(log.length).toBe(1);
    expect(log.framesAt(1)).toEqual([frame(['a'])]);
    expect(log.framesAt(2)).toEqual([]);
  });

  it('returns copies so callers cannot mutate the log', () => {
    const log = new InputLog();
    const f = frame(['a']);
    log.append(3, [f]);
    f.down.push('b');
    const got = log.framesAt(3);
    expect(got[0]?.down).toEqual(['a']);
    got[0]?.down.push('c');
    expect(log.framesAt(3)[0]?.down).toEqual(['a']);
  });

  it('round-trips through JSON', () => {
    const log = new InputLog();
    log.append(5, [frame(['w']), { sourceId: 'ai', down: [], pressed: ['x'], released: [] }]);
    const copy = InputLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
    expect(copy.toJSON()).toEqual(log.toJSON());
  });
});
```

`packages/sim-core/test/World.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

const flat = parseWorldFile(flatJson);

describe('World', () => {
  it('builds the world file and advances tick and time', async () => {
    const w = await World.create({ seed: 1 }, flat);
    expect(w.physics.bodyIds).toHaveLength(4);
    expect(w.tick).toBe(0);
    w.step();
    w.step();
    expect(w.tick).toBe(2);
    expect(w.time).toBeCloseTo(2 / 60, 9);
    w.dispose();
  });

  it('spawnBox drops a box that lands on the ground', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const box = w.spawnBox(flat.spawn.x, flat.spawn.y);
    for (let i = 0; i < 240; i++) w.step();
    expect(w.physics.state(box).y).toBeCloseTo(0.5, 1);
    w.dispose();
  });

  it('records input frames into the log', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.step([{ sourceId: 'keyboard', down: ['a'], pressed: ['a'], released: [] }]);
    w.step();
    expect(w.inputLog.length).toBe(1);
    expect(w.inputLog.framesAt(0)[0]?.down).toEqual(['a']);
    w.dispose();
  });

  it('exposes a seeded rng', async () => {
    const a = await World.create({ seed: 9 }, flat);
    const b = await World.create({ seed: 9 }, flat);
    expect(a.rng.nextU32()).toBe(b.rng.nextU32());
    a.dispose();
    b.dispose();
  });
});
```

`packages/sim-core/test/determinism.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { BodyState } from '../src/physics/PhysicsWorld';

const flat = parseWorldFile(flatJson);

async function run(seconds: number, seed: number): Promise<{ hash: string; box: BodyState }> {
  const w = await World.create({ seed }, flat);
  const box = w.spawnBox(flat.spawn.x + 0.3, flat.spawn.y);
  const ticks = Math.round(seconds / w.dt);
  for (let i = 0; i < ticks; i++) w.step();
  const out = { hash: w.hash(), box: w.physics.state(box) };
  w.dispose();
  return out;
}

describe('determinism', () => {
  it('two sequential runs are bit-identical', async () => {
    const a = await run(10, 1);
    const b = await run(10, 1);
    expect(a.hash).toBe(b.hash);
    expect(a.box).toEqual(b.box);
  });

  it('two interleaved worlds stay identical (no shared mutable state)', async () => {
    const a = await World.create({ seed: 1 }, flat);
    const b = await World.create({ seed: 1 }, flat);
    a.spawnBox(0.3, 6);
    b.spawnBox(0.3, 6);
    for (let i = 0; i < 600; i++) {
      a.step();
      b.step();
    }
    expect(a.hash()).toBe(b.hash());
    a.dispose();
    b.dispose();
  });

  it('the hash changes as the world evolves', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.spawnBox(0, 6);
    const h0 = w.hash();
    w.step();
    expect(w.hash()).not.toBe(h0);
    w.dispose();
  });

  it('matches the committed golden hash for 10 s of the flat world', async () => {
    // The snapshot file is committed. CI runs on Linux while development runs on macOS, so this test
    // also checks cross-platform determinism of the deterministic Rapier build. If it fails only in CI,
    // do not update the snapshot: record the finding in docs/status.md and docs/questions-pending.md.
    const a = await run(10, 1);
    expect(a.hash).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robots/sim-core test`
Expected: FAIL, cannot find module `../src/replay/InputLog` and `../src/world/World`.

- [ ] **Step 3: Implement InputLog**

`packages/sim-core/src/replay/InputLog.ts`:
```ts
/** One input source's view of one tick. Arrays, not Sets, so it serializes as is. */
export interface InputFrame {
  sourceId: string;
  down: string[];
  pressed: string[];
  released: string[];
}

export interface LoggedTick {
  tick: number;
  frames: InputFrame[];
}

function cloneFrame(f: InputFrame): InputFrame {
  return { sourceId: f.sourceId, down: [...f.down], pressed: [...f.pressed], released: [...f.released] };
}

/** Sparse per-tick log of every input frame the world consumed. Replay = world file + blueprints + this. */
export class InputLog {
  private readonly entries: LoggedTick[] = [];

  append(tick: number, frames: readonly InputFrame[]): void {
    if (frames.length === 0) return;
    this.entries.push({ tick, frames: frames.map(cloneFrame) });
  }

  framesAt(tick: number): InputFrame[] {
    const entry = this.entries.find((e) => e.tick === tick);
    return entry ? entry.frames.map(cloneFrame) : [];
  }

  get length(): number {
    return this.entries.length;
  }

  toJSON(): LoggedTick[] {
    return this.entries.map((e) => ({ tick: e.tick, frames: e.frames.map(cloneFrame) }));
  }

  static fromJSON(entries: LoggedTick[]): InputLog {
    const log = new InputLog();
    for (const e of entries) log.append(e.tick, e.frames);
    return log;
  }
}
```

- [ ] **Step 4: Implement World**

`packages/sim-core/src/world/World.ts`:
```ts
import { loadRapier } from '../physics/rapier';
import { PhysicsWorld, type BodyId } from '../physics/PhysicsWorld';
import { Prng } from '../rng/Prng';
import { StateHasher } from '../replay/StateHasher';
import { InputLog, type InputFrame } from '../replay/InputLog';
import { buildWorld, type WorldFile } from './WorldFile';

export interface WorldOptions {
  seed: number;
  dt?: number;
  gravityY?: number;
}

export class World {
  readonly dt: number;
  readonly seed: number;
  readonly rng: Prng;
  readonly physics: PhysicsWorld;
  readonly inputLog = new InputLog();
  readonly file: WorldFile;
  private tickCount = 0;

  private constructor(opts: WorldOptions, file: WorldFile) {
    this.dt = opts.dt ?? 1 / 60;
    this.seed = opts.seed;
    this.rng = new Prng(opts.seed);
    this.physics = new PhysicsWorld(opts.gravityY ?? -9.81, this.dt);
    this.file = file;
    buildWorld(this.physics, file);
  }

  /** The only way to make a World: guarantees the Rapier WASM is loaded first. */
  static async create(opts: WorldOptions, file: WorldFile): Promise<World> {
    await loadRapier();
    return new World(opts, file);
  }

  get tick(): number {
    return this.tickCount;
  }

  get time(): number {
    return this.tickCount * this.dt;
  }

  /** M0 stand-in for a robot. Removed when M1 spawns blueprints. */
  spawnBox(x: number, y: number, size = 1, mass = 1): BodyId {
    return this.physics.createDynamicBox(x, y, size, size, mass);
  }

  step(frames: readonly InputFrame[] = []): void {
    this.inputLog.append(this.tickCount, frames);
    this.physics.step();
    this.tickCount++;
  }

  /** Hex hash of tick count plus every body's exact state. */
  hash(): string {
    const h = new StateHasher();
    h.addInt(this.tickCount);
    this.physics.hashInto(h);
    return StateHasher.hex(h.digest());
  }

  dispose(): void {
    this.physics.free();
  }
}
```

Append to `packages/sim-core/src/index.ts`:
```ts
export { InputLog } from './replay/InputLog';
export type { InputFrame, LoggedTick } from './replay/InputLog';
export { World } from './world/World';
export type { WorldOptions } from './world/World';
```

- [ ] **Step 5: Run tests twice, then typecheck**

Run: `pnpm --filter @robots/sim-core test`
Expected: PASS, 29 tests. The golden test writes `packages/sim-core/test/__snapshots__/determinism.test.ts.snap` on this first run.

Run: `pnpm --filter @robots/sim-core test`
Expected: PASS again, and the snapshot now compares rather than writes. Open the `.snap` file and confirm it contains one 8-character hex string.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit (including the snapshot)**

```bash
git add packages/sim-core
git commit -m "M0 T5: World tick loop, input log, and determinism tests with golden hash"
```

---

### Task 6: Headless CLI

**Files:**
- Create: `packages/cli/src/commands/run.ts`, `packages/cli/src/commands/determinism.ts`
- Modify: `packages/cli/src/main.ts` (replace the Task 1 placeholder)
- Test: `packages/cli/test/run.test.ts`

**Interfaces:**
- Consumes: `World`, `parseWorldFile`, `WorldFile`, `BodyState` from `@robots/sim-core`.
- Produces: `runSim(file: WorldFile, opts: RunOptions): Promise<RunReport>`, `checkDeterminism(file: WorldFile, opts: RunOptions): Promise<DeterminismResult>`. Commands: `pnpm sim run [--world <path>] [--seconds <n>] [--seed <n>] [--json]` and `pnpm sim determinism [--world <path>] [--seconds <n>] [--seed <n>]`.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/run.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import { runSim } from '../src/commands/run';
import { checkDeterminism } from '../src/commands/determinism';

const flat = parseWorldFile(flatJson);

describe('runSim', () => {
  it('samples once per second and reports the final box state', async () => {
    const r = await runSim(flat, { seconds: 2, seed: 1 });
    expect(r.ticks).toBe(120);
    expect(r.samples).toHaveLength(2);
    expect(r.samples[0]?.tick).toBe(60);
    expect(r.box.y).toBeLessThan(flat.spawn.y);
    expect(r.finalHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', async () => {
    const d = await checkDeterminism(flat, { seconds: 3, seed: 2 });
    expect(d.equal).toBe(true);
    expect(d.hashA).toBe(d.hashB);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @robots/cli test`
Expected: FAIL, cannot find module `../src/commands/run`.

- [ ] **Step 3: Implement the commands**

`packages/cli/src/commands/run.ts`:
```ts
import { World, type BodyState, type WorldFile } from '@robots/sim-core';

export interface RunOptions {
  seconds: number;
  seed: number;
  sampleEverySeconds?: number;
}

export interface RunSample {
  tick: number;
  time: number;
  box: BodyState;
  hash: string;
}

export interface RunReport {
  world: string;
  seconds: number;
  seed: number;
  ticks: number;
  finalHash: string;
  box: BodyState;
  samples: RunSample[];
}

/** Spawns the M0 test box at the world's spawn point and steps for the requested time. */
export async function runSim(file: WorldFile, opts: RunOptions): Promise<RunReport> {
  const world = await World.create({ seed: opts.seed }, file);
  const box = world.spawnBox(file.spawn.x, file.spawn.y);
  const ticks = Math.round(opts.seconds / world.dt);
  const every = Math.max(1, Math.round((opts.sampleEverySeconds ?? 1) / world.dt));
  const samples: RunSample[] = [];
  for (let i = 0; i < ticks; i++) {
    world.step();
    if (world.tick % every === 0) {
      samples.push({ tick: world.tick, time: world.time, box: world.physics.state(box), hash: world.hash() });
    }
  }
  const report: RunReport = {
    world: file.name,
    seconds: opts.seconds,
    seed: opts.seed,
    ticks,
    finalHash: world.hash(),
    box: world.physics.state(box),
    samples,
  };
  world.dispose();
  return report;
}
```

`packages/cli/src/commands/determinism.ts`:
```ts
import type { WorldFile } from '@robots/sim-core';
import { runSim, type RunOptions } from './run';

export interface DeterminismResult {
  equal: boolean;
  hashA: string;
  hashB: string;
  ticks: number;
}

/** Runs the same simulation twice in one process and compares final hashes. */
export async function checkDeterminism(file: WorldFile, opts: RunOptions): Promise<DeterminismResult> {
  const a = await runSim(file, opts);
  const b = await runSim(file, opts);
  return { equal: a.finalHash === b.finalHash, hashA: a.finalHash, hashB: b.finalHash, ticks: a.ticks };
}
```

- [ ] **Step 4: Replace main.ts**

`packages/cli/src/main.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWorldFile, type WorldFile } from '@robots/sim-core';
import { runSim } from './commands/run';
import { checkDeterminism } from './commands/determinism';

const DEFAULT_WORLD = fileURLToPath(new URL('../../../worlds/flat.json', import.meta.url));

const USAGE = `robots sim <command> [flags]

commands
  run            simulate the world with a test box, print samples once per second
  determinism    run twice and compare final hashes (exit 1 on mismatch)

flags
  --world <path>     world json (default: worlds/flat.json)
  --seconds <n>      simulated seconds (default: 5)
  --seed <n>         world seed (default: 1)
  --json             print the run report as json`;

function parseArgs(argv: string[]): { command: string; flags: Map<string, string> } {
  const flags = new Map<string, string>();
  let command = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(a.slice(2), next);
        i++;
      } else {
        flags.set(a.slice(2), 'true');
      }
    } else if (command === '') {
      command = a;
    }
  }
  return { command, flags };
}

function numberFlag(flags: Map<string, string>, key: string, fallback: number): number {
  const raw = flags.get(key);
  if (raw === undefined) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`--${key} must be a number, got ${raw}`);
  return v;
}

function loadWorld(path: string): WorldFile {
  return parseWorldFile(JSON.parse(readFileSync(path, 'utf8')));
}

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const worldPath = flags.get('world') ?? DEFAULT_WORLD;
  const seconds = numberFlag(flags, 'seconds', 5);
  const seed = numberFlag(flags, 'seed', 1);

  if (command === 'run') {
    const report = await runSim(loadWorld(worldPath), { seconds, seed });
    if (flags.has('json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      for (const s of report.samples) {
        console.log(
          `t=${s.time.toFixed(2).padStart(6)}  box x=${s.box.x.toFixed(3)} y=${s.box.y.toFixed(3)} angle=${s.box.angle.toFixed(3)}  hash=${s.hash}`,
        );
      }
      console.log(`final: ticks=${report.ticks} hash=${report.finalHash}`);
    }
    return 0;
  }

  if (command === 'determinism') {
    const d = await checkDeterminism(loadWorld(worldPath), { seconds, seed });
    console.log(`run A: ${d.hashA}`);
    console.log(`run B: ${d.hashB}`);
    console.log(d.equal ? `DETERMINISTIC over ${d.ticks} ticks` : 'MISMATCH: the simulation is not deterministic');
    return d.equal ? 0 : 1;
  }

  console.log(USAGE);
  return command === '' || command === 'help' ? 0 : 2;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);
```

- [ ] **Step 5: Run tests and the real commands**

Run: `pnpm --filter @robots/cli test && pnpm --filter @robots/cli typecheck`
Expected: PASS, 2 tests.

Run: `pnpm sim run --seconds 3`
Expected: three sample lines with `y` decreasing toward 0.5, then `final: ticks=180 hash=<8 hex>`.

Run: `pnpm sim determinism --seconds 10; echo "exit $?"`
Expected: two equal hashes, `DETERMINISTIC over 600 ticks`, `exit 0`.

Run: `pnpm sim bogus; echo "exit $?"`
Expected: usage text, `exit 2`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli
git commit -m "M0 T6: headless cli with run and determinism commands"
```

---

### Task 7: App bootstrap with PixiJS and debug rendering

**Files:**
- Create: `packages/app/src/render/units.ts`, `packages/app/src/render/Renderer.ts`, `packages/app/src/render/DebugDraw.ts`, `.claude/launch.json`
- Modify: `packages/app/src/main.ts` (replace the Task 1 placeholder)
- Test: `packages/app/test/units.test.ts`

**Interfaces:**
- Consumes: `World`, `parseWorldFile`, `DebugBuffers` from `@robots/sim-core`.
- Produces: `METERS_PER_CELL`, `PIXELS_PER_METER`, `interface Vec2 { x; y }`, `toScreen(m: Vec2): Vec2`, `toWorld(px: Vec2): Vec2`, `toScreenAngle(a: number): number`.
- Produces: `class Renderer { app: Application; world: Container; debug: Graphics; init(parent: HTMLElement): Promise<void>; screenWidth; screenHeight }`, `drawDebug(g: Graphics, buffers: DebugBuffers, visible: boolean): void`.

- [ ] **Step 1: Write the failing test**

`packages/app/test/units.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { PIXELS_PER_METER, toScreen, toScreenAngle, toWorld } from '../src/render/units';

describe('units', () => {
  it('flips y and scales by pixels per meter', () => {
    expect(toScreen({ x: 2, y: 3 })).toEqual({ x: 2 * PIXELS_PER_METER, y: -3 * PIXELS_PER_METER });
  });

  it('round-trips', () => {
    const p = toWorld(toScreen({ x: -1.5, y: 0.25 }));
    expect(p.x).toBeCloseTo(-1.5, 9);
    expect(p.y).toBeCloseTo(0.25, 9);
  });

  it('negates angles because screen y points down', () => {
    expect(toScreenAngle(0.7)).toBe(-0.7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @robots/app test`
Expected: FAIL, cannot find module `../src/render/units`.

- [ ] **Step 3: Implement units, Renderer, DebugDraw**

`packages/app/src/render/units.ts`:
```ts
// The single place where physics meters (y up) become screen pixels (y down). Nothing else flips signs.
export const METERS_PER_CELL = 1;
export const PIXELS_PER_METER = 32;

export interface Vec2 {
  x: number;
  y: number;
}

export function toScreen(m: Vec2): Vec2 {
  return { x: m.x * PIXELS_PER_METER, y: -m.y * PIXELS_PER_METER };
}

export function toWorld(px: Vec2): Vec2 {
  return { x: px.x / PIXELS_PER_METER, y: -px.y / PIXELS_PER_METER };
}

export function toScreenAngle(a: number): number {
  return -a;
}
```

`packages/app/src/render/Renderer.ts`:
```ts
import { Application, Container, Graphics } from 'pixi.js';

export class Renderer {
  readonly app = new Application();
  /** Everything in world space goes in here; the camera transforms this container. */
  readonly world = new Container();
  readonly debug = new Graphics();

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: window,
      background: 0x101418,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: 'webgl',
    });
    parent.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.debug);
  }

  get screenWidth(): number {
    return this.app.screen.width;
  }

  get screenHeight(): number {
    return this.app.screen.height;
  }
}
```

`packages/app/src/render/DebugDraw.ts`:
```ts
import type { Graphics } from 'pixi.js';
import type { DebugBuffers } from '@robots/sim-core';
import { toScreen } from './units';

function packColor(r: number, g: number, b: number): number {
  return ((Math.round(r * 255) & 0xff) << 16) | ((Math.round(g * 255) & 0xff) << 8) | (Math.round(b * 255) & 0xff);
}

/**
 * Rapier debug buffers: vertices hold 2 floats per point and 2 points per segment; colors hold 4 floats per point.
 * One stroke per run of identical color keeps draw calls low. pixelLine keeps lines 1 px at any zoom.
 */
export function drawDebug(g: Graphics, buffers: DebugBuffers, visible: boolean): void {
  g.clear();
  if (!visible) return;
  const v = buffers.vertices;
  const c = buffers.colors;
  const segments = Math.floor(v.length / 4);
  let current = -1;
  let open = false;
  for (let i = 0; i < segments; i++) {
    const color = packColor(c[i * 8] ?? 1, c[i * 8 + 1] ?? 1, c[i * 8 + 2] ?? 1);
    if (color !== current) {
      if (open) g.stroke({ color: current, pixelLine: true });
      current = color;
      open = true;
    }
    const a = toScreen({ x: v[i * 4] ?? 0, y: v[i * 4 + 1] ?? 0 });
    const b = toScreen({ x: v[i * 4 + 2] ?? 0, y: v[i * 4 + 3] ?? 0 });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  if (open) g.stroke({ color: current, pixelLine: true });
}
```

- [ ] **Step 4: Replace main.ts with a first render loop**

`packages/app/src/main.ts` (temporary one-tick-per-frame loop; Task 8 replaces it):
```ts
import { World, parseWorldFile } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import { Renderer } from './render/Renderer';
import { drawDebug } from './render/DebugDraw';
import { toScreen } from './render/units';

async function boot(): Promise<void> {
  const file = parseWorldFile(flatJson);
  const world = await World.create({ seed: 1 }, file);
  world.spawnBox(file.spawn.x, file.spawn.y);

  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app');
  const renderer = new Renderer();
  await renderer.init(root);

  const focus = toScreen({ x: file.spawn.x, y: file.spawn.y - 3 });
  renderer.world.pivot.set(focus.x, focus.y);

  renderer.app.ticker.add(() => {
    renderer.world.position.set(renderer.screenWidth / 2, renderer.screenHeight / 2);
    world.step();
    drawDebug(renderer.debug, world.physics.debugRender(), true);
  });
}

boot().catch((err: unknown) => {
  console.error(err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = String(err);
});
```

`.claude/launch.json` (lets the in-app browser start the dev server by name):
```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "app", "runtimeExecutable": "pnpm", "runtimeArgs": ["dev"], "port": 5173 }
  ]
}
```

- [ ] **Step 5: Test, typecheck, build**

Run: `pnpm --filter @robots/app test && pnpm --filter @robots/app typecheck`
Expected: PASS, 3 tests. If typecheck fails inside `pixi.js` types about WebGPU, confirm `types` contains `web` and `lib` does not contain `DOM`.

Run: `pnpm build`
Expected: Vite build succeeds and prints the bundle sizes. The Rapier compat WASM shows up as a large chunk (about 2 MB before gzip); that is expected.

- [ ] **Step 6: Verify in the browser**

Start the dev server with the in-app browser tools (`preview_start` with name `app`) or `pnpm dev`, then open http://localhost:5173.
Expected: a dark canvas, a long horizontal line pair for the ground, three small outlined boxes on the right and left, and a box outline falling from the top center and stopping on the ground within a couple of seconds. The browser console shows no errors. Resize the window: the canvas follows.

- [ ] **Step 7: Commit**

```bash
git add packages/app .claude/launch.json
git commit -m "M0 T7: pixi app boots the world and draws rapier debug lines"
```

---

### Task 8: Fixed step loop, time controls, interpolation, HUD

**Files:**
- Create: `packages/app/src/app/FixedStepper.ts`, `packages/app/src/app/TimeControls.ts`, `packages/app/src/app/Hud.ts`, `packages/app/src/app/keys.ts`, `packages/app/src/render/interpolate.ts`, `packages/app/src/render/BoxView.ts`
- Modify: `packages/app/src/main.ts`
- Test: `packages/app/test/FixedStepper.test.ts`, `packages/app/test/TimeControls.test.ts`, `packages/app/test/interpolate.test.ts`

**Interfaces:**
- Consumes: `BodyState` from `@robots/sim-core`; `toScreen`, `toScreenAngle`, `PIXELS_PER_METER` from Task 7.
- Produces: `class FixedStepper { constructor(dtMs: number, maxFrameMs?: number); advance(frameMs: number, timeScale: number): number; alpha: number; reset(): void }`.
- Produces: `TIME_SCALES`, `class TimeControls { paused; timeScale; togglePause(); faster(); slower(); requestStep(); takePendingSteps(): number }`.
- Produces: `lerp`, `lerpAngle`, `interpolateState(prev, curr, alpha): BodyState`, `class BoxView { gfx: Graphics; sync(state: BodyState): void }`, `class Hud { set(lines: string[]): void }`, `bindKeys(target: Window, actions: KeyActions): () => void`.

- [ ] **Step 1: Write the failing tests**

`packages/app/test/FixedStepper.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/app/FixedStepper';

const DT = 1000 / 60;

describe('FixedStepper', () => {
  it('runs one tick per 16.67 ms frame at 1x', () => {
    const s = new FixedStepper(DT);
    expect(s.advance(DT, 1)).toBe(1);
    expect(s.alpha).toBeCloseTo(0, 6);
  });

  it('accumulates fractional frames', () => {
    const s = new FixedStepper(DT);
    expect(s.advance(10, 1)).toBe(0);
    expect(s.alpha).toBeCloseTo(10 / DT, 6);
    expect(s.advance(10, 1)).toBe(1);
  });

  it('runs fewer ticks at 0.5x and more at 2x', () => {
    const slow = new FixedStepper(DT);
    expect(slow.advance(DT, 0.5)).toBe(0);
    expect(slow.advance(DT, 0.5)).toBe(1);
    const fast = new FixedStepper(DT);
    expect(fast.advance(DT, 2)).toBe(2);
  });

  it('clamps huge frames to avoid the spiral of death', () => {
    const s = new FixedStepper(DT, 250);
    expect(s.advance(5000, 1)).toBe(15);
  });

  it('reset drops the accumulator', () => {
    const s = new FixedStepper(DT);
    s.advance(10, 1);
    s.reset();
    expect(s.alpha).toBe(0);
  });
});
```

`packages/app/test/TimeControls.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TIME_SCALES, TimeControls } from '../src/app/TimeControls';

describe('TimeControls', () => {
  it('starts running at 1x', () => {
    const t = new TimeControls();
    expect(t.paused).toBe(false);
    expect(t.timeScale).toBe(1);
  });

  it('steps through the scale table and clamps at both ends', () => {
    const t = new TimeControls();
    for (let i = 0; i < 10; i++) t.faster();
    expect(t.timeScale).toBe(TIME_SCALES[TIME_SCALES.length - 1]);
    for (let i = 0; i < 10; i++) t.slower();
    expect(t.timeScale).toBe(TIME_SCALES[0]);
  });

  it('requestStep pauses and queues exactly one tick', () => {
    const t = new TimeControls();
    t.requestStep();
    t.requestStep();
    expect(t.paused).toBe(true);
    expect(t.takePendingSteps()).toBe(2);
    expect(t.takePendingSteps()).toBe(0);
  });
});
```

`packages/app/test/interpolate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { interpolateState, lerp, lerpAngle } from '../src/render/interpolate';

describe('interpolate', () => {
  it('lerp is linear', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });

  it('lerpAngle takes the short way around', () => {
    const r = lerpAngle(3.0, -3.0, 0.5);
    expect(Math.abs(Math.abs(r) - Math.PI)).toBeLessThan(1e-9);
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 9);
  });

  it('interpolateState blends position and angle, keeps current velocity', () => {
    const prev = { x: 0, y: 0, angle: 0, vx: 0, vy: 0, w: 0 };
    const curr = { x: 2, y: -4, angle: 1, vx: 3, vy: 4, w: 5 };
    expect(interpolateState(prev, curr, 0.5)).toEqual({ x: 1, y: -2, angle: 0.5, vx: 3, vy: 4, w: 5 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robots/app test`
Expected: FAIL, three missing modules.

- [ ] **Step 3: Implement the pure modules**

`packages/app/src/app/FixedStepper.ts`:
```ts
/** Classic fixed-timestep accumulator. Time scale multiplies frame time, so dt itself never changes. */
export class FixedStepper {
  private acc = 0;
  readonly dtMs: number;
  readonly maxFrameMs: number;

  constructor(dtMs: number, maxFrameMs = 250) {
    this.dtMs = dtMs;
    this.maxFrameMs = maxFrameMs;
  }

  /** Returns how many fixed ticks to run this frame. */
  advance(frameMs: number, timeScale: number): number {
    this.acc += Math.min(frameMs, this.maxFrameMs) * timeScale;
    let ticks = 0;
    while (this.acc >= this.dtMs) {
      this.acc -= this.dtMs;
      ticks++;
    }
    return ticks;
  }

  /** Fraction of the way from the previous tick to the current one, for render interpolation. */
  get alpha(): number {
    return this.acc / this.dtMs;
  }

  reset(): void {
    this.acc = 0;
  }
}
```

`packages/app/src/app/TimeControls.ts`:
```ts
export const TIME_SCALES = [0.25, 0.5, 1, 2, 4] as const;

export class TimeControls {
  paused = false;
  private scaleIndex = 2;
  private pendingSteps = 0;

  get timeScale(): number {
    return TIME_SCALES[this.scaleIndex] ?? 1;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  faster(): void {
    this.scaleIndex = Math.min(TIME_SCALES.length - 1, this.scaleIndex + 1);
  }

  slower(): void {
    this.scaleIndex = Math.max(0, this.scaleIndex - 1);
  }

  /** Single step: pauses and queues one tick. */
  requestStep(): void {
    this.paused = true;
    this.pendingSteps++;
  }

  takePendingSteps(): number {
    const n = this.pendingSteps;
    this.pendingSteps = 0;
    return n;
  }
}
```

`packages/app/src/render/interpolate.ts`:
```ts
import type { BodyState } from '@robots/sim-core';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolates along the shortest arc so a body crossing the pi boundary does not spin the long way. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export function interpolateState(prev: BodyState, curr: BodyState, alpha: number): BodyState {
  return {
    x: lerp(prev.x, curr.x, alpha),
    y: lerp(prev.y, curr.y, alpha),
    angle: lerpAngle(prev.angle, curr.angle, alpha),
    vx: curr.vx,
    vy: curr.vy,
    w: curr.w,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robots/app test`
Expected: PASS, 14 tests.

- [ ] **Step 5: Implement BoxView, Hud, keys**

`packages/app/src/render/BoxView.ts`:
```ts
import { Graphics } from 'pixi.js';
import type { BodyState } from '@robots/sim-core';
import { PIXELS_PER_METER, toScreen, toScreenAngle } from './units';

/** A filled rectangle that follows an interpolated body state. Sprites replace this in M1. */
export class BoxView {
  readonly gfx = new Graphics();

  constructor(widthM: number, heightM: number, color: number) {
    const w = widthM * PIXELS_PER_METER;
    const h = heightM * PIXELS_PER_METER;
    this.gfx.rect(-w / 2, -h / 2, w, h).fill(color).stroke({ color: 0xffffff, width: 1, alpha: 0.4 });
  }

  sync(state: BodyState): void {
    const p = toScreen(state);
    this.gfx.position.set(p.x, p.y);
    this.gfx.rotation = toScreenAngle(state.angle);
  }
}
```

`packages/app/src/app/Hud.ts`:
```ts
export class Hud {
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  set(lines: string[]): void {
    this.el.textContent = lines.join('\n');
  }
}
```

`packages/app/src/app/keys.ts`:
```ts
export interface KeyActions {
  togglePause(): void;
  step(): void;
  faster(): void;
  slower(): void;
  toggleDebug(): void;
  toggleFollow(): void;
  reset(): void;
}

/** Binds the M0 control keys. Returns an unbind function. Uses event.code so layouts do not matter. */
export function bindKeys(target: Window, actions: KeyActions): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        actions.togglePause();
        break;
      case 'Period':
        actions.step();
        break;
      case 'BracketRight':
        actions.faster();
        break;
      case 'BracketLeft':
        actions.slower();
        break;
      case 'KeyD':
        actions.toggleDebug();
        break;
      case 'KeyF':
        actions.toggleFollow();
        break;
      case 'KeyR':
        actions.reset();
        break;
      default:
        return;
    }
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
```

- [ ] **Step 6: Rewrite main.ts around the fixed stepper**

`packages/app/src/main.ts`:
```ts
import { World, parseWorldFile } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import { Renderer } from './render/Renderer';
import { drawDebug } from './render/DebugDraw';
import { BoxView } from './render/BoxView';
import { interpolateState } from './render/interpolate';
import { toScreen } from './render/units';
import { FixedStepper } from './app/FixedStepper';
import { TimeControls } from './app/TimeControls';
import { Hud } from './app/Hud';
import { bindKeys } from './app/keys';

const HELP = 'Space pause   . step   [ ] speed   D debug   F follow   R reset';

async function boot(): Promise<void> {
  const file = parseWorldFile(flatJson);
  const world = await World.create({ seed: 1 }, file);
  const box = world.spawnBox(file.spawn.x, file.spawn.y);

  const root = document.getElementById('app');
  const hudEl = document.getElementById('hud');
  if (!root || !hudEl) throw new Error('missing #app or #hud');
  const renderer = new Renderer();
  await renderer.init(root);
  const hud = new Hud(hudEl);

  const boxView = new BoxView(1, 1, 0x4c8dff);
  renderer.world.addChild(boxView.gfx);

  const focus = toScreen({ x: file.spawn.x, y: file.spawn.y - 3 });
  renderer.world.pivot.set(focus.x, focus.y);

  const stepper = new FixedStepper(1000 * world.dt);
  const time = new TimeControls();
  let debugVisible = true;
  let lastHash = world.hash();

  bindKeys(window, {
    togglePause: () => time.togglePause(),
    step: () => time.requestStep(),
    faster: () => time.faster(),
    slower: () => time.slower(),
    toggleDebug: () => {
      debugVisible = !debugVisible;
    },
    toggleFollow: () => {},
    reset: () => location.reload(),
  });

  renderer.app.ticker.add((ticker) => {
    renderer.world.position.set(renderer.screenWidth / 2, renderer.screenHeight / 2);

    let ticks = time.takePendingSteps();
    if (time.paused) stepper.reset();
    else ticks += stepper.advance(ticker.deltaMS, time.timeScale);
    for (let i = 0; i < ticks; i++) {
      world.step();
      if (world.tick % 60 === 0) lastHash = world.hash();
    }

    const alpha = time.paused ? 1 : stepper.alpha;
    boxView.sync(interpolateState(world.physics.prevState(box), world.physics.state(box), alpha));
    drawDebug(renderer.debug, world.physics.debugRender(), debugVisible);

    hud.set([
      `tick ${world.tick}   t=${world.time.toFixed(2)}s   ${Math.round(ticker.FPS)} fps`,
      `${time.paused ? 'PAUSED' : 'running'}   x${time.timeScale}`,
      `hash ${lastHash}`,
      HELP,
    ]);
  });
}

boot().catch((err: unknown) => {
  console.error(err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = String(err);
});
```

- [ ] **Step 7: Typecheck and verify in the browser**

Run: `pnpm --filter @robots/app typecheck && pnpm --filter @robots/app test`
Expected: PASS.

In the browser at http://localhost:5173:
- The box is now a filled blue square with a debug outline on top of it; the two coincide at rest.
- Space pauses; the HUD says PAUSED and the tick stops. Period advances exactly one tick per press.
- `]` raises the speed to x2 and x4 (the box falls visibly faster, ticks per second rise); `[` lowers it to x0.5 and x0.25 with smooth motion at every speed because of interpolation.
- D hides and shows the debug outlines. R reloads.
- Check the hash line while paused at the same tick after two reloads and identical key presses at the same ticks: it matches. Simpler check: press R, wait for the box to rest, pause, then read the hash; repeat; the two hashes at the same tick are equal.

- [ ] **Step 8: Commit**

```bash
git add packages/app
git commit -m "M0 T8: fixed step loop with time scale, single step, interpolation, and hud"
```

---

### Task 9: Camera

**Files:**
- Create: `packages/app/src/render/camera.ts`, `packages/app/src/render/cameraView.ts`
- Modify: `packages/app/src/main.ts`
- Test: `packages/app/test/camera.test.ts`

**Interfaces:**
- Consumes: `PIXELS_PER_METER`, `Vec2`, `toScreen` from Task 7.
- Produces: `interface CameraState { x; y; zoom; follow }`, `ZOOM_MIN`, `ZOOM_MAX`, `createCamera(x, y)`, `followTarget(cam, target, dtSeconds, stiffness?)`, `zoomBy(cam, factor)`, `panByPixels(cam, dxPx, dyPx)`, `setFollow(cam, follow)`, `screenToWorld(cam, sx, sy, screenW, screenH)`, `applyCamera(container, cam, screenW, screenH)`.

- [ ] **Step 1: Write the failing test**

`packages/app/test/camera.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  createCamera,
  followTarget,
  panByPixels,
  screenToWorld,
  setFollow,
  zoomBy,
} from '../src/render/camera';
import { PIXELS_PER_METER } from '../src/render/units';

describe('camera', () => {
  it('zoom clamps to the allowed range', () => {
    let cam = createCamera(0, 0);
    for (let i = 0; i < 50; i++) cam = zoomBy(cam, 1.5);
    expect(cam.zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 50; i++) cam = zoomBy(cam, 0.5);
    expect(cam.zoom).toBe(ZOOM_MIN);
  });

  it('dragging right and down moves the camera left and up in world space, and stops following', () => {
    const cam = panByPixels(createCamera(0, 0), PIXELS_PER_METER, PIXELS_PER_METER);
    expect(cam.x).toBeCloseTo(-1, 9);
    expect(cam.y).toBeCloseTo(1, 9);
    expect(cam.follow).toBe(false);
  });

  it('pan distance scales with zoom', () => {
    const cam = panByPixels(zoomBy(createCamera(0, 0), 2), PIXELS_PER_METER, 0);
    expect(cam.x).toBeCloseTo(-0.5, 9);
  });

  it('follow converges on the target and does nothing when off', () => {
    let cam = createCamera(0, 0);
    for (let i = 0; i < 300; i++) cam = followTarget(cam, { x: 10, y: -2 }, 1 / 60);
    expect(cam.x).toBeCloseTo(10, 3);
    expect(cam.y).toBeCloseTo(-2, 3);
    const off = followTarget(setFollow(cam, false), { x: 0, y: 0 }, 1 / 60);
    expect(off.x).toBeCloseTo(cam.x, 9);
  });

  it('screenToWorld maps the screen center to the camera position', () => {
    const cam = createCamera(3, 4);
    expect(screenToWorld(cam, 400, 300, 800, 600)).toEqual({ x: 3, y: 4 });
    const right = screenToWorld(cam, 400 + PIXELS_PER_METER, 300, 800, 600);
    expect(right.x).toBeCloseTo(4, 9);
    const down = screenToWorld(cam, 400, 300 + PIXELS_PER_METER, 800, 600);
    expect(down.y).toBeCloseTo(3, 9);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @robots/app test`
Expected: FAIL, cannot find module `../src/render/camera`.

- [ ] **Step 3: Implement**

`packages/app/src/render/camera.ts` (pure, no Pixi import, so it tests under node):
```ts
import { PIXELS_PER_METER, type Vec2 } from './units';

export interface CameraState {
  /** World position (meters) at the center of the screen. */
  x: number;
  y: number;
  zoom: number;
  follow: boolean;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;

export function createCamera(x: number, y: number): CameraState {
  return { x, y, zoom: 1, follow: true };
}

/** Exponential smoothing toward the target; frame-rate independent. */
export function followTarget(cam: CameraState, target: Vec2, dtSeconds: number, stiffness = 6): CameraState {
  if (!cam.follow) return cam;
  const k = 1 - Math.exp(-stiffness * dtSeconds);
  return { ...cam, x: cam.x + (target.x - cam.x) * k, y: cam.y + (target.y - cam.y) * k };
}

export function zoomBy(cam: CameraState, factor: number): CameraState {
  return { ...cam, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor)) };
}

/** Drag by screen pixels: the world moves with the pointer, so the camera moves the other way. */
export function panByPixels(cam: CameraState, dxPx: number, dyPx: number): CameraState {
  const s = cam.zoom * PIXELS_PER_METER;
  return { ...cam, follow: false, x: cam.x - dxPx / s, y: cam.y + dyPx / s };
}

export function setFollow(cam: CameraState, follow: boolean): CameraState {
  return { ...cam, follow };
}

export function screenToWorld(cam: CameraState, sx: number, sy: number, screenW: number, screenH: number): Vec2 {
  const s = cam.zoom * PIXELS_PER_METER;
  return { x: cam.x + (sx - screenW / 2) / s, y: cam.y - (sy - screenH / 2) / s };
}
```

`packages/app/src/render/cameraView.ts`:
```ts
import type { Container } from 'pixi.js';
import type { CameraState } from './camera';
import { toScreen } from './units';

/** Zoom about the screen center: pivot at the camera's world point, position at the center, scale by zoom. */
export function applyCamera(container: Container, cam: CameraState, screenW: number, screenH: number): void {
  const p = toScreen(cam);
  container.pivot.set(p.x, p.y);
  container.position.set(screenW / 2, screenH / 2);
  container.scale.set(cam.zoom);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robots/app test`
Expected: PASS, 19 tests.

- [ ] **Step 5: Wire the camera into main.ts**

In `packages/app/src/main.ts`, add imports:
```ts
import { createCamera, followTarget, panByPixels, setFollow, zoomBy } from './render/camera';
import { applyCamera } from './render/cameraView';
```

Replace the two `focus` lines (`const focus = ...` and `renderer.world.pivot.set(...)`) with:
```ts
  let cam = createCamera(file.spawn.x, file.spawn.y - 3);

  const canvas = renderer.app.canvas;
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam = zoomBy(cam, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  let dragging: { id: number; x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    cam = panByPixels(cam, e.clientX - dragging.x, e.clientY - dragging.y);
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  const endDrag = (e: PointerEvent): void => {
    if (dragging && e.pointerId === dragging.id) dragging = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
```

Replace `toggleFollow: () => {},` with:
```ts
    toggleFollow: () => {
      cam = setFollow(cam, !cam.follow);
    },
```

Replace the line `renderer.world.position.set(renderer.screenWidth / 2, renderer.screenHeight / 2);` at the top of the ticker callback with nothing (delete it), and after `boxView.sync(...)` add:
```ts
    const boxState = interpolateState(world.physics.prevState(box), world.physics.state(box), alpha);
    cam = followTarget(cam, boxState, ticker.deltaMS / 1000);
    applyCamera(renderer.world, cam, renderer.screenWidth, renderer.screenHeight);
```
and change the earlier `boxView.sync(interpolateState(...))` line to `boxView.sync(boxState);` placed after `boxState` is computed. Add the follow state to the HUD's second line: `` `${time.paused ? 'PAUSED' : 'running'}   x${time.timeScale}   zoom ${cam.zoom.toFixed(2)}   follow ${cam.follow ? 'on' : 'off'}` ``.

Remove the now-unused `toScreen` import from `main.ts`.

- [ ] **Step 6: Typecheck and verify in the browser**

Run: `pnpm --filter @robots/app typecheck && pnpm --filter @robots/app test`
Expected: PASS.

In the browser:
- The view follows the box as it falls and eases to a stop.
- Mouse wheel zooms about the screen center between 0.25x and 8x; lines stay 1 px, the blue square scales.
- Dragging pans and switches follow off (HUD shows `follow off`). F turns follow back on and the camera glides back to the box.
- Resizing the window keeps the box centered.

- [ ] **Step 7: Commit**

```bash
git add packages/app
git commit -m "M0 T9: camera with follow, wheel zoom, and drag pan"
```

---

### Task 10: CI, status, and the m0 tag

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `docs/status.md`, `README.md`

- [ ] **Step 1: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - run: pnpm sim determinism --seconds 10
```

- [ ] **Step 2: Full local check**

Run: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build && pnpm sim determinism --seconds 10`
Expected: everything passes. Total tests: sim-core 29, cli 2, app 19.

- [ ] **Step 3: Update status and README**

`docs/status.md`:
```markdown
# Status

Updated: (today's date), by the M0 session

- Current milestone: M0 complete, plan `docs/plans/M0-skeleton.md`
- Done: M0 T1 to T10. Workspace, PhysicsWorld, world file, World with input log and hashing, headless CLI, Pixi app with fixed step, time controls, interpolation, camera, CI.
- In progress: none
- Next: a planning session writes `docs/plans/M1-parts-and-assembly.md` from `docs/design/02` and `03`. Gate 1 (Look) opens at the end of M1.
- Known issues: (list anything observed, for example the golden hash differing on CI, or Pixi warnings in the console)
- Decisions since the plan: (list any deviations, for example if Rapier needed a default import)
- Next gate: Gate 1 (Look) at the end of M1
```

Add a "Controls" section to `README.md`:
```markdown
## Controls (M0)

Space pause, `.` single step, `[` and `]` time scale (0.25x to 4x), D debug outlines, F follow the box, R reset, mouse wheel zoom, drag to pan.
```

- [ ] **Step 4: Commit, tag, push, and watch CI**

```bash
git add -A
git commit -m "M0 T10: ci workflow, status, and controls in readme"
git tag m0
git push origin main --tags
```

Then check the workflow run with `gh run watch` or `gh run list --limit 1`. Expected: green. If the golden hash test fails on Linux but passes locally, do not update the snapshot. Record it in `docs/status.md` under known issues and in `docs/questions-pending.md` as "cross-platform determinism differs between macOS and Linux with rapier2d-deterministic-compat 0.20.0"; that is a real finding for the evolution plans, and M0 is still done because same-machine determinism holds.

---

## Self-review notes

- Spec coverage: M0 in `06` asks for the workspace and purity firewall (T1), Rapier loaded once for browser and Node (T3, T6, T7), flat ground with gravity and a falling box (T4, T5, T7), fixed 60 Hz tick with interpolation and time scale including pause and single step (T8), camera follow, zoom, and pan (T9), replay log and state hash with a two-run test in CI (T5, T6, T10). The world file also carries the ramp and boxes from Q6 so M1 does not need to touch it.
- Type consistency: `World.spawnBox` (T5) is what T6 and T7 call; `PhysicsWorld.prevState`, `state`, `debugRender`, `bodyIds` (T3) are used by T5, T8, T9; `DebugBuffers` is the type `drawDebug` (T7) takes; `BodyState` flows from `sim-core` into `interpolateState` and `BoxView` (T8); `TimeControls.takePendingSteps` (T8) is the name main.ts uses.
- Out of scope on purpose: sprites, textures, parts, blueprints (M1); Preact panels (M2); any input source (M3). `InputFrame` exists only so the log and `World.step` have their final shape now.
