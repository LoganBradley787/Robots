import { buildReplay, defaultRegistry, orientRaw, parseReplay, parseWorldFile, replayHashes, StateHasher, World, type ReplayFile } from '@robots/sim-core';
import { readBlueprint, readJson, resolveBlueprint } from '../blueprintFiles';
import { scriptHost } from '../scriptHost';
import { spawnBattle, worldFor } from './bench';
import { ARENA_WORLD } from './duel';

/**
 * `pnpm sim hashes` (M16): the state hash after every tick, to prove another engine runs the same replay to the same
 * bits (`01`, Determinism). `arena` is the mixed fight Chrome and Node first parted on (at tick 35, from `Math.cos`);
 * `battle` is the Sandbox menu's 6 against 6, as `pnpm sim bench battle` sets it up.
 */
export const HASH_SCENES = ['arena', 'battle'] as const;
export type HashScene = (typeof HASH_SCENES)[number];

/** Per-tick hashes with the replay that made them, so a browser (or another Node) can run it and compare. */
export interface TickHashes {
  format: 1;
  /** Where the hashes were made: `Node 24.4.1 arm64`, or the browser's user agent. */
  runtime: string;
  replay: ReplayFile;
  hashes: string[];
}

const DEFAULT_SECONDS: Record<HashScene, number> = { arena: 21, battle: 20 };

/** The arena fight: a laser tower and a truck on team 0 against a many-gun drone and a drone on team 1, no keys. */
const ARENA: { bp: string; x: number; y: number; team: number; flip?: boolean }[] = [
  { bp: 'enemy-laser-tower', x: -60, y: 3.5, team: 0 },
  { bp: 'enemy-truck', x: -85, y: 1.45, team: 0 },
  { bp: 'enemy-many-gun-drone', x: 70, y: 30, team: 1, flip: true },
  { bp: 'enemy-drone', x: 100, y: 45, team: 1, flip: true },
];

/** Runs a scene from tick 0 for `seconds` and returns its replay. */
export async function sceneReplay(scene: HashScene, seconds = DEFAULT_SECONDS[scene]): Promise<ReplayFile> {
  const scripts = await scriptHost();
  const file = scene === 'arena' ? parseWorldFile(readJson(ARENA_WORLD)) : worldFor(6 * 30);
  const world = await World.create({ seed: 1, scripts }, file);
  try {
    if (scene === 'arena') {
      for (const s of ARENA) {
        const raw = readBlueprint(resolveBlueprint(s.bp)).raw;
        world.spawnBlueprint(s.flip ? orientRaw(raw, { flip: true, rot: 0 }, defaultRegistry()) : raw, { x: s.x, y: s.y }, { team: s.team });
      }
    } else spawnBattle(world, 6);
    const ticks = Math.max(1, Math.round(seconds / world.dt));
    for (let i = 0; i < ticks; i++) world.step();
    return buildReplay(world);
  } finally {
    world.dispose();
  }
}

/** The replay's per-tick hashes in this process. */
export async function tickHashes(replay: ReplayFile): Promise<TickHashes> {
  const hashes = await replayHashes(replay, await scriptHost());
  return { format: 1, runtime: `Node ${process.versions.node} ${process.arch}`, replay, hashes };
}

/** One hash for the whole list, to compare two runs at a glance. */
export function digest(hashes: readonly string[]): string {
  const h = new StateHasher();
  for (const s of hashes) h.addString(s);
  return StateHasher.hex(h.digest());
}

/** Reads a file `--save` wrote. */
export function readTickHashes(path: string): TickHashes {
  const raw = readJson(path) as Partial<TickHashes>;
  if (raw.format !== 1 || !Array.isArray(raw.hashes) || typeof raw.runtime !== 'string') throw new Error(`${path} is not a file pnpm sim hashes --save wrote`);
  return { format: 1, runtime: raw.runtime, replay: parseReplay(raw.replay), hashes: raw.hashes.map(String) };
}

/** The first tick (1 is the first step) where two lists differ, or undefined when they are the same. */
export function firstDifference(a: readonly string[], b: readonly string[]): number | undefined {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i + 1;
  return undefined;
}

export function formatTickHashes(t: TickHashes): string {
  return `${t.runtime}: ${t.hashes.length} ticks, ends on ${t.hashes.at(-1) ?? '-'}, every tick's hash digested to ${digest(t.hashes)}`;
}

/** How this run compares with one saved elsewhere, and whether they agree. */
export function compareTickHashes(here: TickHashes, there: TickHashes): { same: boolean; text: string } {
  const at = firstDifference(here.hashes, there.hashes);
  if (at === undefined) return { same: true, text: `SAME: the hash after every one of the ${here.hashes.length} ticks is the one ${there.runtime} saved` };
  const show = (h: string | undefined): string => h ?? '(no tick)';
  return { same: false, text: `DIFFERENT from tick ${at}: here ${show(here.hashes[at - 1])}, ${there.runtime} ${show(there.hashes[at - 1])}` };
}
