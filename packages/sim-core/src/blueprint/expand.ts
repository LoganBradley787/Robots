import { isRotation } from '../parts/faces';
import type { Rotation } from '../parts/types';
import { DEFAULT_LEGEND } from './legend';
import type { Binding, BindingMode, Blueprint, CoreControls, Issue, LegendEntry, PlacedPart, Recipe, ScriptSpec } from './types';

const TOP_KEYS = ['format', 'name', 'grid', 'legend', 'parts', 'bindings', 'scripts', 'primaryCore', 'corePriority', 'autoControls', 'cores', 'recipes'];
const MODES: readonly BindingMode[] = ['hold', 'toggle', 'pulse', 'script'];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function unknownKeys(o: Obj, allowed: readonly string[]): string[] {
  return Object.keys(o).filter((k) => !allowed.includes(k));
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v !== '';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isNonEmptyString);
}

export function partId(part: string, x: number, y: number): string {
  return `${part}@${x},${y}`;
}

function mergeTags(...lists: (readonly string[] | undefined)[]): string[] {
  const out: string[] = [];
  for (const list of lists) for (const t of list ?? []) if (!out.includes(t)) out.push(t);
  return out;
}

/**
 * Checks the blueprint's shape and expands `grid` + `legend` (or `parts`) into a flat part list.
 * Knows nothing about part defs; the validator checks part names, overlaps, and connectivity.
 */
export function expandBlueprint(raw: unknown): { blueprint?: Blueprint; issues: Issue[] } {
  const issues: Issue[] = [];
  const err = (code: string, message: string, extra: Partial<Issue> = {}): void => {
    issues.push({ severity: 'error', code, message, ...extra });
  };

  if (!isObj(raw)) {
    err('BAD_FORMAT', 'a blueprint must be a JSON object');
    return { issues };
  }
  for (const k of unknownKeys(raw, TOP_KEYS)) {
    err('BAD_FORMAT', `unknown field '${k}' (expected one of: ${TOP_KEYS.join(', ')})`, { path: k });
  }
  if (raw.format !== 1) err('BAD_FORMAT', `format must be 1, got ${JSON.stringify(raw.format)}`, { path: 'format' });
  if (!isNonEmptyString(raw.name)) err('BAD_FORMAT', 'name must be a non-empty string', { path: 'name' });
  const hasGrid = raw.grid !== undefined;
  const hasParts = raw.parts !== undefined;
  if (hasGrid === hasParts) err('BAD_FORMAT', 'a blueprint needs exactly one of grid or parts');
  if (raw.primaryCore !== undefined && !isNonEmptyString(raw.primaryCore)) {
    err('BAD_FORMAT', 'primaryCore must be a part id string', { path: 'primaryCore' });
  }
  if (raw.corePriority !== undefined && !isStringArray(raw.corePriority)) {
    err('BAD_FORMAT', 'corePriority must be a list of part ids', { path: 'corePriority' });
  }
  if (raw.autoControls !== undefined && typeof raw.autoControls !== 'boolean') {
    err('BAD_FORMAT', 'autoControls must be true or false', { path: 'autoControls' });
  }
  if (issues.length > 0) return { issues };

  const parts: PlacedPart[] = [];
  const continuations: { x: number; y: number }[] = [];
  if (hasGrid) expandGrid(raw, parts, continuations, err);
  else expandParts(raw.parts, parts, err);

  const bindings = readBindings(raw.bindings, err);
  const scripts = readScripts(raw.scripts, err);
  const cores = readCores(raw.cores, err);
  const recipes = readRecipes(raw.recipes, err);
  if (issues.length > 0) return { issues };

  const blueprint: Blueprint = { format: 1, name: raw.name as string, parts, bindings, scripts, continuations };
  if (raw.primaryCore !== undefined) blueprint.primaryCore = raw.primaryCore as string;
  if (raw.corePriority !== undefined) blueprint.corePriority = raw.corePriority as string[];
  if (raw.autoControls === false) blueprint.autoControls = false;
  if (cores.length > 0) blueprint.cores = cores;
  if (recipes.length > 0) blueprint.recipes = recipes;
  return { blueprint, issues };
}

/**
 * `recipes` (M12): an object of name to a whole blueprint, what the robot's fabricator bays make. Each is expanded like
 * any blueprint; its issues come back under `recipes.<name>`. A recipe has no recipes of its own.
 */
function readRecipes(raw: unknown, err: Err): Recipe[] {
  if (raw === undefined) return [];
  if (!isObj(raw)) {
    err('BAD_FORMAT', 'recipes must be an object of name to blueprint', { path: 'recipes' });
    return [];
  }
  const out: Recipe[] = [];
  for (const [name, r] of Object.entries(raw)) {
    const path = `recipes.${name}`;
    if (isObj(r) && r.recipes !== undefined) {
      err('BAD_RECIPE', `${path} has recipes of its own; a recipe cannot (make the bay's blueprint carry them)`, { path });
      continue;
    }
    const e = expandBlueprint(r);
    for (const i of e.issues) err(i.code, `${path}: ${i.message}`, { path: i.path === undefined ? path : `${path}.${i.path}` });
    if (e.blueprint) out.push({ name, blueprint: e.blueprint });
  }
  return out;
}

type Err = (code: string, message: string, extra?: Partial<Issue>) => void;

/** A Map, not an object, so tokens like `toString` or `__proto__` are plain keys. */
function readLegend(raw: unknown, err: Err): Map<string, LegendEntry> {
  const legend = new Map<string, LegendEntry>(Object.entries(DEFAULT_LEGEND));
  if (raw === undefined) return legend;
  if (!isObj(raw)) {
    err('BAD_FORMAT', 'legend must be an object of token to entry', { path: 'legend' });
    return legend;
  }
  for (const [token, entry] of Object.entries(raw)) {
    const path = `legend.${token}`;
    if (token === '' || /\s/.test(token) || token === '.' || token === '=') {
      err('BAD_FORMAT', `legend token '${token}' is not allowed (no spaces, not '.' or '=')`, { path });
      continue;
    }
    if (!isObj(entry)) {
      err('BAD_FORMAT', `${path} must be an object like { "part": "frame" }`, { path });
      continue;
    }
    if (entry.blueprint !== undefined) {
      err('UNSUPPORTED', `${path} names a blueprint; blueprints are not referenced, they are copied in (\`pnpm sim place\` or the builder's Blueprints palette)`, { path });
      continue;
    }
    const extra = unknownKeys(entry, ['part', 'rot', 'tags', 'auto', 'armed', 'makes']);
    if (extra.length > 0) {
      err('BAD_FORMAT', `${path} has unknown field '${extra[0]}' (expected part, rot, tags, auto, armed, makes)`, { path });
      continue;
    }
    if (entry.auto !== undefined && typeof entry.auto !== 'boolean') {
      err('BAD_FORMAT', `${path}.auto must be true or false`, { path: `${path}.auto` });
      continue;
    }
    if (entry.makes !== undefined && !isNonEmptyString(entry.makes)) {
      err('BAD_FORMAT', `${path}.makes must be the name of a recipe`, { path: `${path}.makes` });
      continue;
    }
    if (entry.armed !== undefined && typeof entry.armed !== 'boolean') {
      err('BAD_FORMAT', `${path}.armed must be true or false`, { path: `${path}.armed` });
      continue;
    }
    if (!isNonEmptyString(entry.part)) {
      err('BAD_FORMAT', `${path}.part must be a part name`, { path: `${path}.part` });
      continue;
    }
    if (entry.rot !== undefined && !isRotation(entry.rot)) {
      err('BAD_ROTATION', `${path}.rot must be 0, 90, 180, or 270, got ${JSON.stringify(entry.rot)}`, { path: `${path}.rot` });
      continue;
    }
    if (entry.tags !== undefined && !isStringArray(entry.tags)) {
      err('BAD_FORMAT', `${path}.tags must be a list of strings`, { path: `${path}.tags` });
      continue;
    }
    const e: LegendEntry = { part: entry.part };
    if (entry.rot !== undefined) e.rot = entry.rot;
    if (entry.tags !== undefined) e.tags = entry.tags;
    if (entry.auto === false) e.auto = false;
    if (entry.armed === true) e.armed = true;
    if (entry.makes !== undefined) e.makes = entry.makes as string;
    legend.set(token, e);
  }
  return legend;
}

function expandGrid(raw: Obj, parts: PlacedPart[], continuations: { x: number; y: number }[], err: Err): void {
  if (!Array.isArray(raw.grid) || !raw.grid.every((r) => typeof r === 'string')) {
    err('BAD_FORMAT', 'grid must be a list of strings, one per row, top row first', { path: 'grid' });
    return;
  }
  const legend = readLegend(raw.legend, err);
  const rows = raw.grid as string[];
  rows.forEach((row, i) => {
    const y = rows.length - 1 - i;
    const tokens = row.trim() === '' ? [] : row.trim().split(/\s+/);
    tokens.forEach((token, x) => {
      if (token === '.') return;
      if (token === '=') {
        continuations.push({ x, y });
        return;
      }
      const entry = legend.get(token);
      if (!entry) {
        err('UNKNOWN_TOKEN', `grid token '${token}' at row ${i} column ${x} is not in the legend`, { cell: { x, y } });
        return;
      }
      const id = partId(entry.part, x, y);
      const placed: PlacedPart = { id, part: entry.part, x, y, rot: entry.rot ?? 0, tags: mergeTags(entry.tags, [id]) };
      if (entry.auto === false) placed.auto = false;
      if (entry.armed === true) placed.armed = true;
      if (entry.makes !== undefined) placed.makes = entry.makes;
      parts.push(placed);
    });
  });
}

function expandParts(raw: unknown, parts: PlacedPart[], err: Err): void {
  if (!Array.isArray(raw)) {
    err('BAD_FORMAT', 'parts must be a list', { path: 'parts' });
    return;
  }
  raw.forEach((p, i) => {
    const path = `parts[${i}]`;
    if (!isObj(p)) {
      err('BAD_FORMAT', `${path} must be an object`, { path });
      return;
    }
    const extra = unknownKeys(p, ['id', 'part', 'x', 'y', 'rot', 'tags', 'auto', 'armed', 'makes']);
    if (extra.length > 0) {
      err('BAD_FORMAT', `${path} has unknown field '${extra[0]}' (expected id, part, x, y, rot, tags, auto, armed, makes)`, { path });
      return;
    }
    if (p.auto !== undefined && typeof p.auto !== 'boolean') return err('BAD_FORMAT', `${path}.auto must be true or false`, { path: `${path}.auto` });
    if (p.armed !== undefined && typeof p.armed !== 'boolean') return err('BAD_FORMAT', `${path}.armed must be true or false`, { path: `${path}.armed` });
    if (p.makes !== undefined && !isNonEmptyString(p.makes)) return err('BAD_FORMAT', `${path}.makes must be the name of a recipe`, { path: `${path}.makes` });
    if (!isNonEmptyString(p.part)) return err('BAD_FORMAT', `${path}.part must be a part name`, { path: `${path}.part` });
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
      return err('BAD_FORMAT', `${path}.x and .y must be integers`, { path });
    }
    if (p.rot !== undefined && !isRotation(p.rot)) {
      return err('BAD_ROTATION', `${path}.rot must be 0, 90, 180, or 270, got ${JSON.stringify(p.rot)}`, { path: `${path}.rot` });
    }
    if (p.id !== undefined && !isNonEmptyString(p.id)) return err('BAD_FORMAT', `${path}.id must be a string`, { path: `${path}.id` });
    if (p.tags !== undefined && !isStringArray(p.tags)) {
      return err('BAD_FORMAT', `${path}.tags must be a list of strings`, { path: `${path}.tags` });
    }
    const x = p.x as number;
    const y = p.y as number;
    const id = (p.id as string | undefined) ?? partId(p.part, x, y);
    const placed: PlacedPart = { id, part: p.part, x, y, rot: (p.rot as Rotation | undefined) ?? 0, tags: mergeTags(p.tags as string[] | undefined, [id]) };
    if (p.auto === false) placed.auto = false;
    if (p.armed === true) placed.armed = true;
    if (p.makes !== undefined) placed.makes = p.makes as string;
    parts.push(placed);
  });
}

/** `cores`: an object of core part id to that core's controls, in file order. */
function readCores(raw: unknown, err: Err): CoreControls[] {
  if (raw === undefined) return [];
  if (!isObj(raw)) {
    err('BAD_FORMAT', 'cores must be an object of core part id to { bindings, scripts, scope, autoControls }', { path: 'cores' });
    return [];
  }
  const out: CoreControls[] = [];
  for (const [core, entry] of Object.entries(raw)) {
    const path = `cores.${core}`;
    if (!isObj(entry)) {
      err('BAD_FORMAT', `${path} must be an object like { "bindings": [], "scripts": [] }`, { path });
      continue;
    }
    const extra = unknownKeys(entry, ['scope', 'bindings', 'scripts', 'autoControls']);
    if (extra.length > 0) {
      err('BAD_FORMAT', `${path} has unknown field '${extra[0]}' (expected scope, bindings, scripts, autoControls)`, { path });
      continue;
    }
    if (entry.scope !== undefined && !isNonEmptyString(entry.scope)) {
      err('BAD_FORMAT', `${path}.scope must be a tag like "missile1"`, { path: `${path}.scope` });
      continue;
    }
    if (entry.autoControls !== undefined && typeof entry.autoControls !== 'boolean') {
      err('BAD_FORMAT', `${path}.autoControls must be true or false`, { path: `${path}.autoControls` });
      continue;
    }
    const c: CoreControls = { core, bindings: readBindings(entry.bindings, err, `${path}.bindings`), scripts: readScripts(entry.scripts, err, `${path}.scripts`) };
    if (entry.scope !== undefined) c.scope = entry.scope as string;
    if (entry.autoControls === false) c.autoControls = false;
    out.push(c);
  }
  return out;
}

function readBindings(raw: unknown, err: Err, at = 'bindings'): Binding[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    err('BAD_BINDING', `${at} must be a list`, { path: at });
    return [];
  }
  const out: Binding[] = [];
  raw.forEach((b, i) => {
    const path = `${at}[${i}]`;
    const bad = (msg: string): void => err('BAD_BINDING', `${path}: ${msg}`, { path });
    if (!isObj(b)) return bad('must be an object');
    const extra = unknownKeys(b, ['key', 'mode', 'target', 'channel', 'value', 'script']);
    if (extra.length > 0) return bad(`unknown field '${extra[0]}'`);
    if (!isNonEmptyString(b.key)) return bad('key must be a non-empty string');
    if (!MODES.includes(b.mode as BindingMode)) return bad(`mode must be one of ${MODES.join(', ')}, got ${JSON.stringify(b.mode)}`);
    const mode = b.mode as BindingMode;
    if (mode === 'script') {
      if (!isNonEmptyString(b.script)) return bad('a script binding needs "script": "<script id>"');
      out.push({ key: b.key, mode, script: b.script });
      return;
    }
    if (!isNonEmptyString(b.target)) return bad('target must be a tag');
    if (!isNonEmptyString(b.channel)) return bad('channel must be a channel name');
    if (typeof b.value !== 'number' || !Number.isFinite(b.value)) return bad('value must be a number');
    out.push({ key: b.key, mode, target: b.target, channel: b.channel, value: b.value });
  });
  return out;
}

function readScripts(raw: unknown, err: Err, at = 'scripts'): ScriptSpec[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    err('BAD_SCRIPT', `${at} must be a list`, { path: at });
    return [];
  }
  const out: ScriptSpec[] = [];
  raw.forEach((s, i) => {
    const path = `${at}[${i}]`;
    const bad = (msg: string): void => err('BAD_SCRIPT', `${path}: ${msg}`, { path });
    if (!isObj(s)) return bad('must be an object');
    const extra = unknownKeys(s, ['id', 'enabled', 'params', 'source', 'file']);
    if (extra.length > 0) return bad(`unknown field '${extra[0]}'`);
    if (!isNonEmptyString(s.id)) return bad('id must be a non-empty string');
    if (s.enabled !== undefined && typeof s.enabled !== 'boolean') return bad('enabled must be true or false');
    const params: Record<string, number> = {};
    if (s.params !== undefined) {
      if (!isObj(s.params)) return bad('params must be an object of numbers');
      for (const [k, v] of Object.entries(s.params)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) return bad(`params.${k} must be a number`);
        params[k] = v;
      }
    }
    let source: ScriptSpec['source'];
    if (typeof s.source === 'string') source = s.source;
    else if (isObj(s.source) && isNonEmptyString(s.source.file) && unknownKeys(s.source, ['file']).length === 0) source = { file: s.source.file };
    else return bad('source must be a string or { "file": "name.js" }');
    if (s.file !== undefined && !isNonEmptyString(s.file)) return bad('file must be a file name like "drone.hover.js"');
    const file = typeof source === 'string' ? (s.file as string | undefined) : source.file;
    // A script starts on deploy unless it says otherwise (Logan, before M5).
    out.push({ id: s.id, enabled: s.enabled !== false, params, source, ...(file !== undefined ? { file } : {}) });
  });
  return out;
}
