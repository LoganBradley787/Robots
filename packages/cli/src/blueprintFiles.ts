import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const BLUEPRINT_DIR = resolve(REPO_ROOT, 'blueprints');
export const DEFAULT_WORLD = resolve(REPO_ROOT, 'worlds/flat.json');

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
