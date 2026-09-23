import type { Blueprint, ScriptSpec } from './types';

/**
 * Loads script files into a blueprint file's JSON (M5: scripts are separate `.js` files next to the blueprint).
 * Every script whose `source` is `{ file }` gets the file's text as `source` and keeps `file`. Pure: the caller
 * passes how to read a file (disk in the CLI, the dev server in the app). Files that cannot be read are listed.
 */
export function resolveScripts(raw: unknown, read: (file: string) => string | undefined): { raw: unknown; missing: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { raw, missing: [] };
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.scripts)) return { raw, missing: [] };
  const missing: string[] = [];
  const scripts = o.scripts.map((s: unknown) => {
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
  return { raw: { ...o, scripts }, missing };
}

/** The `.js` files a blueprint's scripts are saved to, with their text. Scripts not loaded yet are skipped. */
export function scriptFiles(bp: Blueprint): { file: string; text: string }[] {
  return bp.scripts.flatMap((s) => (s.file !== undefined && typeof s.source === 'string' ? [{ file: s.file, text: s.source }] : []));
}

/** `drone.json` + `hover` gives `drone.hover.js`. */
export function scriptFileName(blueprintFile: string, scriptId: string): string {
  const stem = blueprintFile.replace(/\.json$/, '');
  const id = scriptId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'script';
  return `${stem}.${id}.js`;
}

/**
 * Points scripts at files named after `blueprintFile` (Save As writes copies; the originals stay). Every script gets
 * its own file: a name another script already uses gets a number (`drone.hover-2.js`), so two scripts never overwrite
 * each other. A script whose code was never loaded keeps its file, since there is nothing to copy.
 */
export function assignScriptFiles(bp: Blueprint, blueprintFile: string, onlyMissing: boolean): Blueprint {
  const keep = (s: ScriptSpec): boolean => s.file !== undefined && (onlyMissing || typeof s.source !== 'string');
  const used = new Set(bp.scripts.filter(keep).map((s) => s.file as string));
  const scripts: ScriptSpec[] = bp.scripts.map((s) => {
    if (keep(s)) return s;
    const base = scriptFileName(blueprintFile, s.id).replace(/\.js$/, '');
    let file = `${base}.js`;
    for (let n = 2; used.has(file); n++) file = `${base}-${n}.js`;
    used.add(file);
    return { ...s, file };
  });
  return { ...bp, scripts };
}
