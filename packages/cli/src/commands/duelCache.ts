import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadBlueprintFile, readJson, REPO_ROOT } from '../blueprintFiles';
import { ARENA_WORLD, parseAdd } from './duel';
import type { MatchResult, MatchRunner, MatchSpec, Titan, TournamentOptions } from './tournament';

/**
 * Tournament results kept by what they depend on, so a duel that has been run is never run again: the same code, the
 * same two robots with their scripts, the same seed and settings give the same result on any machine (determinism is
 * a feature). Kept per user, not per checkout, so worktrees share them. Nothing in a key names a tick's timing: a kept
 * speed check shows the timing of the run that made it.
 */
export const DUEL_CACHE_DIR = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'robots-sim', 'duels');

/** What a result depends on besides its robots and settings: the sim's code, how a duel is run, and the locked packages. */
const ENGINE_PATHS = ['packages/sim-core/src', 'packages/cli/src/commands/duel.ts', 'packages/cli/src/scriptHost.ts', 'pnpm-lock.yaml'];

function addFiles(path: string, hash: ReturnType<typeof createHash>, root: string): void {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) addFiles(join(path, name), hash, root);
    return;
  }
  hash.update(path.slice(root.length));
  hash.update(readFileSync(path));
}

/** One text for the code every duel runs: any change to it starts the kept results over. */
export function engineStamp(root: string = REPO_ROOT): string {
  const hash = createHash('sha256');
  for (const path of ENGINE_PATHS) {
    const full = resolve(root, path);
    if (existsSync(full)) addFiles(full, hash, root);
  }
  return hash.digest('hex');
}

/** A robot as it runs: its name, height and blueprint with every script's code in it. */
function robotKey(t: Titan, load: (name: string) => unknown): unknown {
  return { name: t.name, y: t.y, raw: load(t.name) };
}

/** The key of a duel: `seconds` in `opts` is the length this duel runs (a speed check's, when it is one). */
export function duelKey(m: MatchSpec, opts: Pick<TournamentOptions, 'seconds' | 'world' | 'bounds' | 'add'>, stamp: string, load: (name: string) => unknown = loadBlueprintFile): string {
  const key = {
    stamp,
    kind: m.kind,
    a: robotKey(m.a, load),
    b: robotKey(m.b, load),
    seed: m.seed,
    seconds: opts.seconds,
    world: readJson(opts.world ?? ARENA_WORLD),
    bounds: opts.bounds,
    add: (opts.add ?? []).map((text) => ({ text, raw: load(parseAdd(text).name) })),
  };
  return createHash('sha256').update(JSON.stringify(key)).digest('hex');
}

/**
 * `run` with its results kept in `dir`: one already there comes back at once (`cached`), a new one is written there.
 * A duel that did not run (no report) is not kept. `fresh` runs every duel again and keeps the new results.
 */
export function cachedDuels(run: MatchRunner, opts: { dir?: string; stamp?: string; fresh?: boolean; load?: (name: string) => unknown } = {}): MatchRunner {
  const dir = opts.dir ?? DUEL_CACHE_DIR;
  const stamp = opts.stamp ?? engineStamp();
  return async (m, o) => {
    const file = join(dir, `${duelKey(m, o, stamp, opts.load)}.json`);
    if (opts.fresh !== true && existsSync(file)) return { ...(JSON.parse(readFileSync(file, 'utf8')) as MatchResult), cached: true };
    const r = await run(m, o);
    if (r.report) {
      mkdirSync(dir, { recursive: true });
      // Written whole, then moved into place: another job reading it never sees half a file.
      const part = `${file}.${process.pid}.tmp`;
      writeFileSync(part, JSON.stringify(r));
      renameSync(part, file);
    }
    return r;
  };
}
