import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { nearestNames, resolveScripts, SCRIPT_FILE } from '@robots/sim-core';
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
  if (arg.endsWith('.json') || arg.includes('/')) {
    const path = resolveUserPath(arg);
    if (!existsSync(path)) throw new Error(`no file at ${path} (a path is read from the folder the command was typed in; a blueprint in blueprints/ goes by its bare name, like car)`);
    return path;
  }
  const p = resolve(BLUEPRINT_DIR, `${arg}.json`);
  if (!existsSync(p)) {
    // The likely ones first (review Q3): the whole list is 90 names long.
    const all = listBlueprints();
    const near = nearestNames(arg, all, 3);
    throw new Error(`no blueprint named '${arg}'${near.length > 0 ? `; nearest: ${near.join(', ')}` : ''} (all: ${all.join(', ') || 'none'})`);
  }
  return p;
}

/** A json file's content. A path that leads nowhere and text that is not JSON are said in plain words, with the file's name (review Q3). */
export function readJson(path: string): unknown {
  if (!existsSync(path)) throw new Error(`no file at ${path} (a path is read from the folder the command was typed in)`);
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    const comma = /,\s*[}\]]/.test(text) ? '; JSON allows no comma after the last item of a list or object, and this file has one' : '';
    throw new Error(`${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}${comma}`);
  }
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

/**
 * A blueprint by name or path with its scripts loaded, for a command that deploys or checks it. A script file that is
 * not there is an error (review T1): the robot would spawn with a script that stops at t=0.
 */
export function loadBlueprintFile(arg: string): unknown {
  const path = resolveBlueprint(arg);
  const loaded = readBlueprint(path);
  if (loaded.missing.length > 0) {
    throw new Error(loaded.missing.map((f) => `error MISSING_SCRIPT: script file ${f} not found next to ${path} (a script's file sits in the blueprint's folder; write it, or fix "file" in the blueprint)`).join('\n'));
  }
  return loaded.raw;
}
