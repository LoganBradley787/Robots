import type { Blueprint, CoreControls, ScriptSpec } from './types';

/**
 * Loads script files into a blueprint file's JSON (M5: scripts are separate `.js` files next to the blueprint).
 * Every script whose `source` is `{ file }` gets the file's text as `source` and keeps `file`. Pure: the caller
 * passes how to read a file (disk in the CLI, the dev server in the app). Files that cannot be read are listed.
 */
export function resolveScripts(raw: unknown, read: (file: string) => string | undefined): { raw: unknown; missing: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { raw, missing: [] };
  const o = raw as Record<string, unknown>;
  const missing: string[] = [];
  const resolveList = (list: unknown): unknown => {
    if (!Array.isArray(list)) return list;
    return list.map((s: unknown) => {
      if (typeof s !== 'object' || s === null) return s;
      const src = (s as { source?: unknown }).source;
      if (typeof src !== 'object' || src === null || typeof (src as { file?: unknown }).file !== 'string') return s;
      const file = (src as { file: string }).file;
      const text = read(file);
      if (text === undefined) {
        missing.push(file);
        return s;
      }
      return { ...(s as object), source: text, file };
    });
  };
  const out: Record<string, unknown> = { ...o };
  if (Array.isArray(o.scripts)) out.scripts = resolveList(o.scripts);
  // Other cores' scripts (M7) live under `cores.<id>.scripts`.
  if (typeof o.cores === 'object' && o.cores !== null && !Array.isArray(o.cores)) {
    const cores: Record<string, unknown> = {};
    for (const [id, entry] of Object.entries(o.cores as Record<string, unknown>)) {
      const e = typeof entry === 'object' && entry !== null && !Array.isArray(entry) && Array.isArray((entry as { scripts?: unknown }).scripts) ? { ...(entry as object), scripts: resolveList((entry as { scripts: unknown }).scripts) } : entry;
      Object.defineProperty(cores, id, { value: e, enumerable: true, writable: true, configurable: true });
    }
    out.cores = cores;
  }
  // Recipes (M12) are whole blueprints with scripts of their own.
  if (typeof o.recipes === 'object' && o.recipes !== null && !Array.isArray(o.recipes)) {
    const recipes: Record<string, unknown> = {};
    for (const [name, r] of Object.entries(o.recipes as Record<string, unknown>)) {
      const done = resolveScripts(r, read);
      missing.push(...done.missing);
      Object.defineProperty(recipes, name, { value: done.raw, enumerable: true, writable: true, configurable: true });
    }
    out.recipes = recipes;
  }
  return { raw: out, missing };
}

/** Every script of a blueprint: the primary core's, then each other core's (M7), then its recipes' (M12). */
export function allScripts(bp: Blueprint): ScriptSpec[] {
  return [...bp.scripts, ...(bp.cores ?? []).flatMap((c) => c.scripts), ...(bp.recipes ?? []).flatMap((r) => allScripts(r.blueprint))];
}

/** The `.js` files a blueprint's scripts are saved to, with their text. Scripts not loaded yet are skipped. */
export function scriptFiles(bp: Blueprint): { file: string; text: string }[] {
  return allScripts(bp).flatMap((s) => (s.file !== undefined && typeof s.source === 'string' ? [{ file: s.file, text: s.source }] : []));
}

/** `drone.json` + `hover` gives `drone.hover.js`. */
export function scriptFileName(blueprintFile: string, scriptId: string): string {
  const stem = blueprintFile.replace(/\.json$/, '');
  const id = scriptId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'script';
  return `${stem}.${id}.js`;
}

/** A name part for file names: lowercase letters, digits, and dashes. */
function fileWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The name a core's scripts are filed under: its scope (`missile1`), else its id (`core-3-2`). */
function coreWord(c: CoreControls): string {
  return fileWord(c.scope ?? c.core) || 'core';
}

/**
 * Forgets the file of every script whose file is not named after `blueprintFile` (or of every script, without one),
 * so the next save gives it a file of this blueprint's own (M7 review: a blueprint made from another's JSON would
 * otherwise save over the other's script, a live link Logan ruled out).
 */
export function dropForeignScriptFiles(bp: Blueprint, blueprintFile?: string): Blueprint {
  const stem = blueprintFile === undefined ? undefined : `${blueprintFile.replace(/\.json$/, '')}.`;
  const fix = (s: ScriptSpec): ScriptSpec => {
    if (s.file === undefined || typeof s.source !== 'string' || (stem !== undefined && s.file.startsWith(stem))) return s;
    const { file: _file, ...rest } = s;
    return rest;
  };
  const out: Blueprint = { ...bp, scripts: bp.scripts.map(fix) };
  if (bp.cores) out.cores = bp.cores.map((c) => ({ ...c, scripts: c.scripts.map(fix) }));
  if (bp.recipes) out.recipes = bp.recipes.map((r) => ({ ...r, blueprint: dropForeignScriptFiles(r.blueprint, blueprintFile) }));
  return out;
}

/** A file two scripts of the blueprint (its recipes' included) both name, if any: saving would write one over the other. */
export function scriptFileClash(bp: Blueprint): string | undefined {
  const seen = new Set<string>();
  for (const s of allScripts(bp)) {
    if (s.file === undefined) continue;
    if (seen.has(s.file)) return s.file;
    seen.add(s.file);
  }
  return undefined;
}

/**
 * Points scripts at files named after `blueprintFile` (Save As writes copies; the originals stay). Every script gets
 * its own file: a name another script already uses gets a number (`drone.hover-2.js`), so two scripts never overwrite
 * each other. A script whose code was never loaded keeps its file, since there is nothing to copy. Other cores'
 * scripts are named with their core: `launcher.missile1.guide.js`.
 */
export function assignScriptFiles(bp: Blueprint, blueprintFile: string, onlyMissing: boolean): Blueprint {
  const keep = (s: ScriptSpec): boolean => s.file !== undefined && (onlyMissing || typeof s.source !== 'string');
  // One set of taken names for the blueprint and its recipes (review E2): a core scoped `child` and a recipe named
  // `child` both file a `guide` script as `<name>.child.guide.js`, and the second must get a number.
  const used = new Set(allScripts(bp).filter(keep).map((s) => s.file as string));
  return assignFiles(bp, blueprintFile, keep, used);
}

function assignFiles(bp: Blueprint, blueprintFile: string, keep: (s: ScriptSpec) => boolean, used: Set<string>): Blueprint {
  const assign = (s: ScriptSpec, core?: CoreControls): ScriptSpec => {
    if (keep(s)) return s;
    const id = core ? `${coreWord(core)}.${fileWord(s.id) || 'script'}` : s.id;
    const base = core ? `${blueprintFile.replace(/\.json$/, '')}.${id}` : scriptFileName(blueprintFile, s.id).replace(/\.js$/, '');
    let file = `${base}.js`;
    for (let n = 2; used.has(file); n++) file = `${base}-${n}.js`;
    used.add(file);
    return { ...s, file };
  };
  const scripts = bp.scripts.map((s) => assign(s));
  const out: Blueprint = { ...bp, scripts };
  if (bp.cores && bp.cores.length > 0) out.cores = bp.cores.map((c) => ({ ...c, scripts: c.scripts.map((s) => assign(s, c)) }));
  // A recipe's scripts (M12) are filed under the recipe: `fab-drone.missile-up.guide.js`.
  if (bp.recipes) out.recipes = bp.recipes.map((r) => ({ ...r, blueprint: assignFiles(r.blueprint, `${blueprintFile.replace(/\.json$/, '')}.${fileWord(r.name) || 'recipe'}.json`, keep, used) }));
  return out;
}
