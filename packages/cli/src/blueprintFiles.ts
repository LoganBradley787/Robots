import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { resolveScripts, SCRIPT_FILE } from '@robots/sim-core';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const BLUEPRINT_DIR = resolve(REPO_ROOT, 'blueprints');
export const DEFAULT_WORLD = resolve(REPO_ROOT, 'worlds/flat.json');
export const REPLAY_DIR = resolve(REPO_ROOT, 'replays');

/** pnpm runs scripts inside the package; INIT_CWD is where the user typed the command. */
function userCwd(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

export function resolveUserPath(p: string): string {
  return isAbsolute(p) ? p : resolve(userCwd(), p);
}

export function listBlueprints(): string[] {
  if (!existsSync(BLUEPRINT_DIR)) return [];
  return readdirSync(BLUEPRINT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/** A path to a .json file, or a bare name looked up in blueprints/. */
export function resolveBlueprint(arg: string): string {
  if (arg.endsWith('.json') || arg.includes('/')) return resolveUserPath(arg);
  const p = resolve(BLUEPRINT_DIR, `${arg}.json`);
  if (!existsSync(p)) throw new Error(`no blueprint named '${arg}' (available: ${listBlueprints().join(', ') || 'none'})`);
  return p;
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** A path to a replay file, or a bare name looked up in replays/. */
export function resolveReplay(arg: string): string {
  if (arg.endsWith('.json') && (arg.includes('/') || existsSync(resolveUserPath(arg)))) return resolveUserPath(arg);
  const p = resolve(REPLAY_DIR, arg.endsWith('.json') ? arg : `${arg}.json`);
  if (!existsSync(p)) throw new Error(`no replay '${arg}' (looked in ${REPLAY_DIR})`);
  return p;
}

/** A blueprint file with its scripts' code loaded from the `.js` files next to it. Missing files are listed. */
export function readBlueprint(path: string): { raw: unknown; missing: string[] } {
  const dir = dirname(path);
  return resolveScripts(readJson(path), (file) => {
    // Only plain names next to the blueprint; never a path out of the folder.
    if (!SCRIPT_FILE.test(file) || file.includes('..')) return undefined;
    const p = join(dir, file);
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  });
}
