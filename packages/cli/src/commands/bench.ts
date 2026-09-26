import { orientRaw, parseWorldFile, World, type WorldFile } from '@robots/sim-core';
import { DEFAULT_WORLD, readBlueprint, readJson, resolveBlueprint } from '../blueprintFiles';
import { scriptHost } from '../scriptHost';
import { timedHost } from '../timedHost';

export const BENCH_SCENES = ['hover', 'big', 'battle', 'debris'] as const;
export type BenchScene = (typeof BENCH_SCENES)[number];

export interface BenchOptions {
  scene: BenchScene;
  /** Robots (hover), robots per side (battle), or loose parts (debris). One count; `hover` without it runs 1, 10, 25, 50, 100. */
  n?: number;
  /** Seconds measured after a one-second warm-up. */
  seconds?: number;
}

export interface BenchRow {
  scene: BenchScene;
  n: number;
  ticks: number;
  avgMs: number;
  p95Ms: number;
  worstMs: number;
  /** Of the average: time inside scripts, and everything else (physics, behaviors, building script input). */
  scriptMs: number;
  restMs: number;
  callsPerTick: number;
  hash: string;
}

const DEFAULT_N: Record<BenchScene, number[]> = { hover: [1, 10, 25, 50, 100], big: [1], battle: [6], debris: [500] };
const DEFAULT_SECONDS: Record<BenchScene, number> = { hover: 5, big: 5, battle: 20, debris: 5 };
const WARMUP_TICKS = 60;

/** `pnpm sim bench` (M9): how long a tick takes on this machine for a few fixed scenes. Local only, never in CI. */
export async function bench(opts: BenchOptions): Promise<BenchRow[]> {
  const counts = opts.n !== undefined ? [opts.n] : DEFAULT_N[opts.scene];
  const rows: BenchRow[] = [];
  for (const n of counts) rows.push(await benchOne(opts.scene, n, opts.seconds ?? DEFAULT_SECONDS[opts.scene]));
  return rows;
}

function loadBlueprint(name: string, enableScripts: boolean): unknown {
  const raw = readBlueprint(resolveBlueprint(name)).raw as { scripts?: { enabled?: boolean }[] };
  if (enableScripts) for (const s of raw.scripts ?? []) s.enabled = true;
  return raw;
}

/** The default world, widened so `width` meters of robots fit on it. */
function worldFor(width: number): WorldFile {
  const file = parseWorldFile(readJson(DEFAULT_WORLD));
  return { ...file, ground: { ...file.ground, width: Math.max(file.ground.width, width + 400) } };
}

/** Spawns `bp` at `n` spots `gap` meters apart around x = 0, skipping spots the world refuses. */
function spawnRow(world: World, bp: unknown, n: number, gap: number, y: number, x0: number, team = 0): void {
  let placed = 0;
  for (let i = 0; placed < n && i < n * 3; i++) {
    const at = { x: x0 + i * gap, y };
    if (!world.canPlace(bp, at).ok) continue;
    world.spawnBlueprint(bp, at, { team });
    placed++;
  }
  if (placed < n) throw new Error(`bench: only ${placed} of ${n} robots fit`);
}

async function benchOne(scene: BenchScene, n: number, seconds: number): Promise<BenchRow> {
  const { host, clock } = timedHost(await scriptHost());
  const gap = scene === 'debris' ? 2 : 30;
  const world = await World.create({ seed: 1, scripts: host }, worldFor(n * gap));
  try {
    if (scene === 'hover') {
      spawnRow(world, loadBlueprint('missile-drone-10prop', true), n, 30, 3, -((n - 1) * 30) / 2 - 200);
      world.setUnlimitedEnergy(true);
    } else if (scene === 'big') {
      // On the ground as the golden scene deploys it (the placing check is stricter by half a cell); n side by side.
      const bp = loadBlueprint('flying-silo', true);
      for (let i = 0; i < n; i++) world.spawnBlueprint(bp, { x: -200 + i * 60, y: 0.5 });
    } else if (scene === 'battle') {
      const left = loadBlueprint('enemy-drone', false);
      const right = readBlueprint(resolveBlueprint('enemy-drone')).raw;
      const flipped = orientRaw(right, { flip: true }, world.registry);
      spawnRow(world, left, n, 25, 20, -150 - n * 25, 1);
      spawnRow(world, flipped, n, 25, 22, 150, 2);
    } else {
      const piece = { format: 1, name: 'debris', grid: ['F'] };
      const perRow = 50;
      for (let i = 0; i < n; i++) world.spawnBlueprint(piece, { x: -50 + (i % perRow) * 2, y: 5 + Math.floor(i / perRow) * 2 }, {});
    }
    for (let i = 0; i < WARMUP_TICKS; i++) world.step();
    clock.take();
    const ticks = Math.max(1, Math.round(seconds / world.dt));
    const times: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const t = performance.now();
      world.step();
      times.push(performance.now() - t);
    }
    const scripts = clock.take();
    const total = times.reduce((a, b) => a + b, 0);
    const sorted = [...times].sort((a, b) => a - b);
    const avg = total / ticks;
    const scriptMs = scripts.ms / ticks;
    return {
      scene,
      n,
      ticks,
      avgMs: avg,
      p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
      worstMs: sorted[sorted.length - 1] ?? 0,
      scriptMs,
      restMs: avg - scriptMs,
      callsPerTick: scripts.calls / ticks,
      hash: world.hash(),
    };
  } finally {
    world.dispose();
  }
}

/** The bench as a table, one row per run. */
export function formatBench(rows: readonly BenchRow[]): string {
  const f = (v: number): string => v.toFixed(2).padStart(7);
  const lines = ['scene     n     avg ms  p95 ms  worst   scripts  rest    calls/tick  hash'];
  for (const r of rows) {
    lines.push(`${r.scene.padEnd(8)}${String(r.n).padStart(4)}  ${f(r.avgMs)} ${f(r.p95Ms)} ${f(r.worstMs)} ${f(r.scriptMs)} ${f(r.restMs)} ${r.callsPerTick.toFixed(1).padStart(8)}     ${r.hash}`);
  }
  lines.push('(ms per tick on this machine; the browser has 16.7 ms per frame. scripts: time inside robot scripts; rest: physics, behaviors, and building what scripts see)');
  return lines.join('\n');
}
